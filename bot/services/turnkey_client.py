"""
Turnkey wallet infrastructure client.

Provides TEE-backed wallet creation, signing, and management via Turnkey's API.
All private keys stay in Turnkey's secure enclaves - they never touch our servers.
"""

import json
import re
import time
import hashlib
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
import aiohttp

from bot.utils.http_client import get_session as get_http_session

logger = logging.getLogger(__name__)


@dataclass
class TurnkeyWallet:
    """Represents a wallet created in Turnkey."""

    wallet_id: str
    wallet_name: str
    accounts: List[str]  # List of addresses

    @property
    def address(self) -> Optional[str]:
        """Get the first (default) account address."""
        return self.accounts[0] if self.accounts else None

    @property
    def account_id(self) -> Optional[str]:
        """Get the default account ID for signing.

        Turnkey uses the address as the account identifier for signing.
        """
        return self.address


@dataclass
class TurnkeySubOrganization:
    """Represents a sub-organization in Turnkey (one per user)."""

    sub_org_id: str
    sub_org_name: str
    root_user_id: Optional[str] = None


class TurnkeyClient:
    """
    Client for Turnkey wallet infrastructure API.

    Uses ECDSA P-256 signing for API request authentication ("stamps").
    """

    def __init__(
        self,
        organization_id: str,
        api_public_key: str,
        api_private_key: str,
        base_url: str = "https://api.turnkey.com",
    ):
        """
        Initialize Turnkey client.

        Args:
            organization_id: Parent organization ID
            api_public_key: Hex-encoded P-256 public key
            api_private_key: Hex-encoded P-256 private key
            base_url: Turnkey API base URL
        """
        self._org_id = organization_id
        self._api_private_key = api_private_key
        self._base_url = base_url.rstrip("/")

        # Build P-256 signing key from raw private key hex
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        from cryptography.hazmat.backends import default_backend

        private_value = int(api_private_key, 16)

        # Parse or derive public key
        pub_key_bytes = bytes.fromhex(api_public_key)
        if pub_key_bytes[0] == 0x04 and len(pub_key_bytes) == 65:
            # Uncompressed format
            x = int.from_bytes(pub_key_bytes[1:33], "big")
            y = int.from_bytes(pub_key_bytes[33:65], "big")
        elif pub_key_bytes[0] in (0x02, 0x03) and len(pub_key_bytes) == 33:
            # Compressed format — decompress via cryptography lib
            from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePublicKey

            tmp_pub = EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pub_key_bytes)
            nums = tmp_pub.public_numbers()
            x, y = nums.x, nums.y
        else:
            # Derive from private key as fallback
            tmp_key = ec.derive_private_key(private_value, ec.SECP256R1(), default_backend())
            pub_numbers = tmp_key.public_key().public_numbers()
            x, y = pub_numbers.x, pub_numbers.y

        pub_numbers = ec.EllipticCurvePublicNumbers(x, y, ec.SECP256R1())
        priv_numbers = ec.EllipticCurvePrivateNumbers(private_value, pub_numbers)
        self._signing_key = priv_numbers.private_key(default_backend())

        # Store compressed public key (Turnkey's expected format for stamps and rootUsers)
        pub_key_obj = self._signing_key.public_key()
        compressed = pub_key_obj.public_bytes(Encoding.X962, PublicFormat.CompressedPoint)
        self._api_public_key = compressed.hex()
        # Also store uncompressed for compatibility
        self._api_public_key_uncompressed = api_public_key

        # Validate key pair: sign and verify a test payload
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec as ec_mod

        test_msg = b"turnkey-key-validation"
        test_sig = self._signing_key.sign(test_msg, ec_mod.ECDSA(hashes.SHA256()))
        try:
            pub_key_obj.verify(test_sig, test_msg, ec_mod.ECDSA(hashes.SHA256()))
        except Exception as e:
            raise ValueError(
                f"Turnkey API key pair validation failed — public key does not match private key: {e}"
            )

        logger.info(
            f"TurnkeyClient initialized (org={organization_id[:8]}..., pubkey={self._api_public_key[:16]}... [{len(compressed)}B compressed])"
        )

    def _create_stamp(self, body: str) -> str:
        """
        Create a cryptographic stamp for API request authentication.

        Turnkey uses a custom authentication scheme where each request
        is signed with the API key pair. The stamp is base64-encoded JSON
        with hex-encoded signature.
        """
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec as ec_module
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
        import base64

        # Sign the body with ECDSA P-256 (SHA-256)
        signature_der = self._signing_key.sign(body.encode(), ec_module.ECDSA(hashes.SHA256()))

        # Encode signature as hex (Turnkey's required format)
        signature_hex = signature_der.hex()

        stamp_obj = {
            "publicKey": self._api_public_key,
            "signature": signature_hex,
            "scheme": "SIGNATURE_SCHEME_TK_API_P256",
        }

        # Base64 encode the JSON stamp
        stamp_json = json.dumps(stamp_obj, separators=(",", ":"))
        stamp_b64 = base64.urlsafe_b64encode(stamp_json.encode()).decode()

        return stamp_b64

    async def _request(
        self,
        method: str,
        endpoint: str,
        body: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Make an authenticated request to Turnkey API.

        Args:
            method: HTTP method
            endpoint: API endpoint path
            body: Request body (will be JSON encoded)

        Returns:
            Response JSON
        """
        url = f"{self._base_url}{endpoint}"
        body_str = json.dumps(body, separators=(",", ":")) if body else "{}"

        stamp = self._create_stamp(body_str)

        headers = {
            "Content-Type": "application/json",
            "X-Stamp": stamp,  # Already base64-encoded
        }

        # Signing activities can legitimately take longer than the shared
        # session's default total timeout (20s) — use the shared session for
        # pooling/DNS caching but keep a per-request 30s override.
        session = await get_http_session()
        async with session.request(
            method,
            url,
            data=body_str,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=30),
        ) as response:
            # Get response text first for better error handling
            text = await response.text()

            try:
                result = json.loads(text) if text else {}
            except json.JSONDecodeError:
                logger.error(f"Turnkey API returned non-JSON: {text[:200]}")
                raise TurnkeyAPIError(response.status, f"Invalid JSON response: {text[:200]}")

            if response.status >= 400:
                if isinstance(result, dict):
                    error_msg = result.get("message", str(result))
                else:
                    error_msg = str(result)
                logger.error(f"Turnkey API error: {response.status} - {error_msg}")
                raise TurnkeyAPIError(response.status, error_msg)

            return result

    async def _submit_activity(
        self,
        activity_type: str,
        parameters: Dict[str, Any],
        organization_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Submit an activity to Turnkey and wait for completion.

        Args:
            activity_type: Type of activity (e.g., ACTIVITY_TYPE_CREATE_WALLET)
            parameters: Activity-specific parameters
            organization_id: Target organization (defaults to parent org)

        Returns:
            Activity result
        """
        org_id = organization_id or self._org_id

        body = {
            "type": activity_type,
            "organizationId": org_id,
            "parameters": parameters,
            "timestampMs": str(int(time.time() * 1000)),
        }

        # Convert activity type to endpoint path
        # Strip ACTIVITY_TYPE_ prefix and version suffixes (e.g., _V2, _V7)
        # ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V7 -> create_sub_organization
        # ACTIVITY_TYPE_SIGN_TRANSACTION_V2 -> sign_transaction
        endpoint_name = activity_type.replace("ACTIVITY_TYPE_", "")
        endpoint_name = re.sub(r"_V\d+$", "", endpoint_name).lower()
        endpoint = f"/public/v1/submit/{endpoint_name}"

        result = await self._request("POST", endpoint, body)

        # Check if activity completed immediately
        activity = result.get("activity", {})
        status = activity.get("status")

        if status == "ACTIVITY_STATUS_COMPLETED":
            return activity.get("result", {})
        elif status == "ACTIVITY_STATUS_FAILED":
            raise TurnkeyActivityError(activity.get("id"), "Activity failed")

        # Poll for completion if needed
        activity_id = activity.get("id")
        return await self._poll_activity(org_id, activity_id)

    async def _poll_activity(
        self,
        organization_id: str,
        activity_id: str,
        max_attempts: int = 30,
        delay_ms: int = 500,
    ) -> Dict[str, Any]:
        """Poll an activity until completion."""
        import asyncio

        for _ in range(max_attempts):
            result = await self._request(
                "POST",
                "/public/v1/query/get_activity",
                {
                    "organizationId": organization_id,
                    "activityId": activity_id,
                },
            )

            activity = result.get("activity", {})
            status = activity.get("status")

            if status == "ACTIVITY_STATUS_COMPLETED":
                return activity.get("result", {})
            elif status == "ACTIVITY_STATUS_FAILED":
                raise TurnkeyActivityError(activity_id, "Activity failed")

            await asyncio.sleep(delay_ms / 1000)

        raise TurnkeyActivityError(activity_id, "Activity timed out")

    # === Organization Management ===

    async def create_sub_organization(
        self,
        name: str,
        root_user_email: Optional[str] = None,
    ) -> TurnkeySubOrganization:
        """
        Create a sub-organization for a user.

        Each bot user gets their own sub-org for wallet isolation.

        Args:
            name: Sub-organization name (e.g., "user_12345")
            root_user_email: Optional email for the root user

        Returns:
            TurnkeySubOrganization with the new sub-org details
        """
        # V8 requires at least one root user with our API key for signing
        root_user = {
            "userName": name,
            "apiKeys": [
                {
                    "apiKeyName": f"{name}_api_key",
                    "publicKey": self._api_public_key,  # Compressed hex P-256 key
                    "curveType": "API_KEY_CURVE_P256",
                }
            ],
            "authenticators": [],
            "oauthProviders": [],
        }
        if root_user_email:
            root_user["userEmail"] = root_user_email

        params = {
            "subOrganizationName": name,
            "rootUsers": [root_user],
            "rootQuorumThreshold": 1,
        }

        logger.info(
            f"Creating sub-org '{name}' with rootUser publicKey={self._api_public_key[:16]}..."
        )

        result = await self._submit_activity(
            "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8",
            params,
        )

        # Try V8 result key first, fallback to V7 for backward compatibility
        sub_org = result.get("createSubOrganizationResultV8") or result.get(
            "createSubOrganizationResultV7", {}
        )

        return TurnkeySubOrganization(
            sub_org_id=sub_org.get("subOrganizationId", ""),
            sub_org_name=name,
            root_user_id=(
                sub_org.get("rootUserIds", [None])[0] if sub_org.get("rootUserIds") else None
            ),
        )

    async def get_sub_organization(self, sub_org_id: str) -> Dict[str, Any]:
        """Get sub-organization details."""
        return await self._request(
            "POST", "/public/v1/query/get_organization", {"organizationId": sub_org_id}
        )

    # === Wallet Operations ===

    async def create_wallet(
        self,
        wallet_name: str,
        chain_type: str,
        organization_id: Optional[str] = None,
    ) -> TurnkeyWallet:
        """
        Create a new wallet in Turnkey.

        Args:
            wallet_name: Name for the wallet
            chain_type: "evm" or "solana"
            organization_id: Target org (defaults to parent org for hot wallets)

        Returns:
            TurnkeyWallet with wallet and account details
        """
        # Determine curve based on chain type
        if chain_type.lower() == "evm":
            curve = "CURVE_SECP256K1"
            address_format = "ADDRESS_FORMAT_ETHEREUM"
        elif chain_type.lower() == "solana":
            curve = "CURVE_ED25519"
            address_format = "ADDRESS_FORMAT_SOLANA"
        else:
            raise ValueError(f"Unsupported chain type: {chain_type}")

        params = {
            "walletName": wallet_name,
            "accounts": [
                {
                    "curve": curve,
                    "pathFormat": "PATH_FORMAT_BIP32",
                    "path": (
                        "m/44'/60'/0'/0/0" if chain_type.lower() == "evm" else "m/44'/501'/0'/0'"
                    ),
                    "addressFormat": address_format,
                }
            ],
        }

        result = await self._submit_activity(
            "ACTIVITY_TYPE_CREATE_WALLET",
            params,
            organization_id=organization_id,
        )

        wallet_result = result.get("createWalletResult", {})
        addresses = wallet_result.get("addresses", [])

        if not addresses:
            raise TurnkeyAPIError(
                status_code=500,
                message=f"Turnkey created wallet '{wallet_name}' but returned no addresses. "
                f"walletId={wallet_result.get('walletId')}, raw result: {wallet_result}",
            )

        logger.info(
            f"Turnkey wallet created: {wallet_result.get('walletId')} with {len(addresses)} account(s)"
        )

        return TurnkeyWallet(
            wallet_id=wallet_result.get("walletId", ""),
            wallet_name=wallet_name,
            accounts=addresses,
        )

    async def get_wallet(
        self,
        wallet_id: str,
        organization_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get wallet details."""
        org_id = organization_id or self._org_id

        return await self._request(
            "POST",
            "/public/v1/query/get_wallet",
            {
                "organizationId": org_id,
                "walletId": wallet_id,
            },
        )

    async def list_wallets(
        self,
        organization_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List all wallets in an organization."""
        org_id = organization_id or self._org_id

        result = await self._request(
            "POST", "/public/v1/query/list_wallets", {"organizationId": org_id}
        )

        return result.get("wallets", [])

    # === Signing Operations ===

    async def sign_transaction(
        self,
        unsigned_transaction: str,
        sign_with: str,
        transaction_type: str = "TRANSACTION_TYPE_ETHEREUM",
        organization_id: Optional[str] = None,
    ) -> str:
        """
        Sign a transaction using Turnkey's secure enclave.

        Args:
            unsigned_transaction: Hex-encoded unsigned transaction
            sign_with: Address or wallet ID to sign with
            transaction_type: TRANSACTION_TYPE_ETHEREUM or TRANSACTION_TYPE_SOLANA
            organization_id: Target organization

        Returns:
            Hex-encoded signed transaction
        """
        params = {
            "type": transaction_type,
            "unsignedTransaction": unsigned_transaction,
            "signWith": sign_with,
        }

        result = await self._submit_activity(
            "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
            params,
            organization_id=organization_id,
        )

        sign_result = result.get("signTransactionResult", {})
        return sign_result.get("signedTransaction", "")

    async def sign_raw_payload(
        self,
        payload: str,
        sign_with: str,
        encoding: str = "PAYLOAD_ENCODING_HEXADECIMAL",
        hash_function: str = "HASH_FUNCTION_KECCAK256",
        organization_id: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Sign a raw payload (message hash).

        Args:
            payload: Payload to sign (hex or text based on encoding)
            sign_with: Address or wallet ID to sign with
            encoding: PAYLOAD_ENCODING_HEXADECIMAL or PAYLOAD_ENCODING_TEXT_UTF8
            hash_function: Hash function to apply
            organization_id: Target organization

        Returns:
            Dict with 'r', 's', 'v' signature components
        """
        params = {
            "payload": payload,
            "signWith": sign_with,
            "encoding": encoding,
            "hashFunction": hash_function,
        }

        result = await self._submit_activity(
            "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
            params,
            organization_id=organization_id,
        )

        return result.get("signRawPayloadResult", {})

    async def sign_typed_data(
        self,
        typed_data: dict,
        sign_with: str,
        organization_id: Optional[str] = None,
    ) -> str:
        """
        Sign EIP-712 typed data via Turnkey.

        Computes the EIP-712 hash locally, then uses sign_raw_payload
        to sign the hash with Turnkey's secure enclave.
        """
        from eth_account.messages import encode_typed_data
        from eth_utils import keccak

        signable = encode_typed_data(full_message=typed_data)
        message_hash = keccak(signable.body).hex()

        result = await self.sign_raw_payload(
            payload=message_hash,
            sign_with=sign_with,
            encoding="PAYLOAD_ENCODING_HEXADECIMAL",
            hash_function="HASH_FUNCTION_NO_OP",  # Already hashed
            organization_id=organization_id,
        )

        # Reconstruct signature from r, s, v. Turnkey returns these as hex
        # strings (no 0x prefix), matching eth_account's signature layout.
        r = result.get("r", "")
        s = result.get("s", "")
        v = result.get("v", "")

        # Strip any 0x prefix (use slicing, not lstrip, to avoid eating
        # legitimate leading "0" nibbles of r/s).
        if r.startswith("0x"):
            r = r[2:]
        if s.startswith("0x"):
            s = s[2:]
        if v.startswith("0x"):
            v = v[2:]

        # Validate component lengths: r and s must be 32 bytes (64 hex chars).
        if len(r) != 64 or len(s) != 64:
            raise ValueError(
                f"Invalid signature components: r={len(r)} chars, "
                f"s={len(s)} chars (expected 64 each)"
            )

        # Normalize v to a 1-byte (2 hex char) recovery value. Turnkey returns
        # v as hex; accept a bare recovery id (00/01) and map it to 27/28.
        try:
            v_int = int(v, 16)
        except (TypeError, ValueError) as e:
            raise ValueError(f"Invalid signature v (not hex): {v!r}") from e
        # A bare recovery id is 0..3; map it into the EIP-155 27..30 range.
        if v_int < 27:
            if v_int > 3:
                raise ValueError(
                    f"Invalid signature v: {v_int} (expected bare recovery id 0-3 " f"or 27/28)"
                )
            v_int += 27
        # Final guard: a usable EVM signature must recover with v in {27, 28}.
        # Without this, a bad upstream v (e.g. 0x63=99) would pass through and
        # produce an unrecoverable signature that downstream silently rejects.
        if v_int not in (27, 28):
            raise ValueError(
                f"Invalid signature v after normalization: {v_int} "
                f"(expected 27 or 28; Turnkey returned raw v={v!r})"
            )
        v_hex = format(v_int, "02x")

        # Return a properly formatted 65-byte EIP-712 signature: 0x<r><s><v>.
        signature = "0x" + r + s + v_hex
        return signature

    # === Import/Export ===

    async def export_wallet(
        self,
        wallet_id: str,
        organization_id: Optional[str] = None,
    ) -> str:
        """
        Export a wallet's private key from Turnkey using ACTIVITY_TYPE_EXPORT_WALLET.

        Turnkey returns the mnemonic/key via an encrypted bundle. For server-side
        export we use Turnkey's plaintext export (no HPKE) which is available when
        using API key auth from the parent org.

        Args:
            wallet_id: Turnkey wallet ID to export
            organization_id: Target organization

        Returns:
            Private key hex string
        """
        params = {
            "walletId": wallet_id,
        }

        result = await self._submit_activity(
            "ACTIVITY_TYPE_EXPORT_WALLET",
            params,
            organization_id=organization_id,
        )

        export_result = result.get("exportWalletResult", {})
        mnemonic = export_result.get("mnemonic", "")

        if not mnemonic:
            raise TurnkeyActivityError(
                "export_wallet", "Turnkey export returned empty mnemonic/key"
            )

        # Derive private key from mnemonic for the appropriate path
        # Turnkey returns the mnemonic — we derive the key for the wallet's path
        return self._derive_key_from_mnemonic(mnemonic)

    @staticmethod
    def _derive_key_from_mnemonic(mnemonic: str) -> str:
        """
        Derive a private key from a BIP-39 mnemonic.

        Uses the default EVM derivation path m/44'/60'/0'/0/0.
        For Solana wallets, callers should handle ed25519 derivation separately.

        Args:
            mnemonic: BIP-39 mnemonic phrase

        Returns:
            Hex-encoded private key (without 0x prefix)
        """
        try:
            from eth_account import Account

            Account.enable_unaudited_hdwallet_features()
            acct = Account.from_mnemonic(mnemonic)
            return acct.key.hex().replace("0x", "")
        except Exception as e:
            # If mnemonic derivation fails, it may already be a raw hex key
            clean = mnemonic.strip()
            if len(clean) == 64 and all(c in "0123456789abcdefABCDEF" for c in clean):
                return clean.lower()
            raise ValueError(f"Cannot derive private key from export result: {e}")

    async def import_private_key(
        self,
        private_key: str,
        key_name: str,
        curve: str,
        organization_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Import an existing private key into Turnkey.

        NOT IMPLEMENTED — fails closed.

        Turnkey's ``ACTIVITY_TYPE_IMPORT_PRIVATE_KEY`` requires the key to be
        HPKE-encrypted to the enclave's import target public key (obtained via an
        INIT_IMPORT activity) before it is sent. The previous implementation put
        the *raw* hex key in ``encryptedBundle``, which both leaks the key to the
        API layer and is rejected by Turnkey. Rather than ship a second
        unverified crypto path, this refuses server-side plaintext import. Use
        Turnkey's secure iframe import flow on the client, or implement and test
        the INIT_IMPORT + HPKE encrypted-bundle flow before re-enabling this.

        Args:
            private_key: Hex-encoded private key
            key_name: Name for the imported key
            curve: CURVE_SECP256K1 or CURVE_ED25519
            organization_id: Target organization

        Raises:
            NotImplementedError: always — server-side plaintext import is unsafe.
        """
        raise NotImplementedError(
            "Server-side private key import is disabled: it would send the raw "
            "key to Turnkey instead of an HPKE-encrypted import bundle. Use the "
            "secure iframe import flow, or implement INIT_IMPORT + encrypted "
            "bundle encryption before re-enabling this method."
        )

    # === Policies ===

    async def create_policy(
        self,
        policy_name: str,
        effect: str,
        consensus: str,
        condition: str,
        organization_id: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> str:
        """
        Create a policy in Turnkey.

        Args:
            policy_name: Name for the policy
            effect: EFFECT_ALLOW or EFFECT_DENY
            consensus: Consensus requirement
            condition: Policy condition expression
            organization_id: Target organization
            notes: Optional description/metadata

        Returns:
            Policy ID
        """
        params = {
            "policyName": policy_name,
            "effect": effect,
            "consensus": consensus,
            "condition": condition,
        }
        if notes:
            params["notes"] = notes

        result = await self._submit_activity(
            "ACTIVITY_TYPE_CREATE_POLICY_V3",
            params,
            organization_id=organization_id,
        )

        return result.get("createPolicyResult", {}).get("policyId", "")

    async def delete_policy(
        self,
        policy_id: str,
        organization_id: Optional[str] = None,
    ) -> bool:
        """
        Delete a policy from Turnkey.

        Args:
            policy_id: ID of the policy to delete
            organization_id: Target organization

        Returns:
            True if deleted successfully
        """
        params = {
            "policyId": policy_id,
        }

        await self._submit_activity(
            "ACTIVITY_TYPE_DELETE_POLICY",
            params,
            organization_id=organization_id,
        )
        return True

    async def list_policies(
        self,
        organization_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        List all policies in an organization.

        Args:
            organization_id: Target organization

        Returns:
            List of policy dicts
        """
        org_id = organization_id or self._org_id

        result = await self._request(
            "POST", "/public/v1/query/list_policies", {"organizationId": org_id}
        )

        return result.get("policies", [])

    async def create_spending_limit_policy(
        self,
        wallet_address: str,
        limit_amount_wei: str,
        time_window_seconds: int,
        policy_name: str,
        organization_id: Optional[str] = None,
    ) -> str:
        """
        Create a spending limit policy that restricts transaction value.

        Uses Turnkey's policy condition language to enforce that the
        cumulative value of sign_transaction activities within a time
        window does not exceed limit_amount_wei.

        Args:
            wallet_address: Address the policy applies to
            limit_amount_wei: Max value in wei (as string) per window
            time_window_seconds: Rolling window in seconds (3600=hourly, 86400=daily)
            policy_name: Human-readable name
            organization_id: Sub-org owning the wallet

        Returns:
            Policy ID
        """
        condition = (
            f"activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2' && "
            f"activity.resource == '{wallet_address}' && "
            f"cumulative(activity.intent.value, {time_window_seconds}) <= '{limit_amount_wei}'"
        )

        return await self.create_policy(
            policy_name=policy_name,
            effect="EFFECT_DENY",
            consensus="approvers.any()",
            condition=condition,
            organization_id=organization_id,
            notes=f"Spending limit: {limit_amount_wei} wei per {time_window_seconds}s for {wallet_address}",
        )

    async def create_address_whitelist_policy(
        self,
        wallet_address: str,
        allowed_addresses: List[str],
        policy_name: str,
        organization_id: Optional[str] = None,
    ) -> str:
        """
        Create a whitelist policy that restricts which addresses
        the wallet can send transactions to.

        Args:
            wallet_address: Address the policy applies to
            allowed_addresses: List of allowed destination addresses
            policy_name: Human-readable name
            organization_id: Sub-org owning the wallet

        Returns:
            Policy ID
        """
        addr_list = ", ".join(f"'{a.lower()}'" for a in allowed_addresses)
        condition = (
            f"activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2' && "
            f"activity.resource == '{wallet_address}' && "
            f"!([{addr_list}].contains(activity.intent.destination))"
        )

        return await self.create_policy(
            policy_name=policy_name,
            effect="EFFECT_DENY",
            consensus="approvers.any()",
            condition=condition,
            organization_id=organization_id,
            notes=f"Whitelist policy for {wallet_address}: {len(allowed_addresses)} addresses",
        )

    # === Recovery Operations ===

    async def init_email_recovery(
        self,
        email: str,
        target_public_key: str,
        organization_id: Optional[str] = None,
    ) -> str:
        """
        Initialize email-based recovery for a sub-organization.

        Sends a recovery email with a credential bundle that allows
        the user to create a new authenticator.

        Args:
            email: Recovery email address
            target_public_key: Public key of the new authenticator
            organization_id: Sub-org to recover

        Returns:
            Activity ID for tracking
        """
        params = {
            "email": email,
            "targetPublicKey": target_public_key,
        }

        result = await self._submit_activity(
            "ACTIVITY_TYPE_INIT_USER_EMAIL_RECOVERY",
            params,
            organization_id=organization_id,
        )

        return result.get("initUserEmailRecoveryResult", {}).get("userId", "")

    async def recover_user(
        self,
        authenticator: dict,
        organization_id: Optional[str] = None,
    ) -> str:
        """
        Complete recovery by adding a new authenticator.

        Called after the user receives the recovery email and
        creates a new passkey/API key.

        Args:
            authenticator: New authenticator details (name, type, challenge, attestation)
            organization_id: Sub-org being recovered

        Returns:
            Authenticator ID
        """
        params = {
            "authenticator": authenticator,
        }

        result = await self._submit_activity(
            "ACTIVITY_TYPE_RECOVER_USER",
            params,
            organization_id=organization_id,
        )

        return result.get("recoverUserResult", {}).get("authenticatorId", [""])[0]

    async def create_api_keys(
        self,
        user_id: str,
        api_keys: list,
        organization_id: Optional[str] = None,
    ) -> list:
        """
        Create API keys for a user (used during recovery to add new auth).

        Args:
            user_id: Target user ID
            api_keys: List of API key configs [{apiKeyName, publicKey}]
            organization_id: Target organization

        Returns:
            List of created API key IDs
        """
        params = {
            "userId": user_id,
            "apiKeys": api_keys,
        }

        result = await self._submit_activity(
            "ACTIVITY_TYPE_CREATE_API_KEYS",
            params,
            organization_id=organization_id,
        )

        return result.get("createApiKeysResult", {}).get("apiKeyIds", [])


# === Authentication Helpers ===

import secrets
from datetime import datetime, timezone, timedelta

# Store for auth challenges (in production, use Redis/DB)
_auth_challenges: Dict[str, Dict[str, Any]] = {}


def generate_auth_challenge(address: str, domain: str = "app.suwappu.com") -> Dict[str, str]:
    """
    Generate an EIP-4361 style sign-in message for wallet authentication.

    Args:
        address: The wallet address requesting authentication
        domain: The domain for the sign-in message

    Returns:
        Dict with 'challenge', 'nonce', and 'expiresAt' fields
    """
    nonce = secrets.token_urlsafe(32)
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(minutes=10)

    # EIP-4361 SIWE-style message
    challenge = f"""{domain} wants you to sign in with your Ethereum account:
{address}

Sign in to Suwappu

URI: https://{domain}
Version: 1
Chain ID: 1
Nonce: {nonce}
Issued At: {issued_at.isoformat()}Z
Expiration Time: {expires_at.isoformat()}Z"""

    # Store challenge for verification
    _auth_challenges[nonce] = {
        "address": address.lower(),
        "challenge": challenge,
        "expires_at": expires_at,
    }

    return {
        "challenge": challenge,
        "nonce": nonce,
        "expiresAt": expires_at.isoformat() + "Z",
    }


def verify_auth_signature(address: str, signature: str, nonce: str) -> bool:
    """
    Verify a wallet signature against a stored challenge.

    Args:
        address: The wallet address that signed
        signature: The hex-encoded signature
        nonce: The nonce from the original challenge

    Returns:
        True if signature is valid, False otherwise
    """
    # Get stored challenge
    challenge_data = _auth_challenges.get(nonce)
    if not challenge_data:
        logger.warning(f"Auth verification failed: nonce not found")
        return False

    # Check expiration
    if datetime.now(timezone.utc) > challenge_data["expires_at"]:
        del _auth_challenges[nonce]
        logger.warning(f"Auth verification failed: challenge expired")
        return False

    # Check address matches
    if challenge_data["address"] != address.lower():
        logger.warning(f"Auth verification failed: address mismatch")
        return False

    # Verify signature using eth_account
    try:
        from eth_account.messages import encode_defunct
        from eth_account import Account

        message = encode_defunct(text=challenge_data["challenge"])
        recovered_address = Account.recover_message(message, signature=signature)

        if recovered_address.lower() != address.lower():
            logger.warning(f"Auth verification failed: signature recovery mismatch")
            return False

        # Clean up used challenge
        del _auth_challenges[nonce]

        logger.info(f"Auth verification successful for {address}")
        return True

    except ImportError:
        logger.error("eth_account package required for signature verification")
        return False
    except Exception as e:
        logger.error(f"Auth verification error: {e}")
        return False


def generate_solana_auth_challenge(address: str, domain: str = "app.suwappu.com") -> Dict[str, str]:
    """
    Generate a Sign-In-With-Solana style message for Phantom/Solana wallets.

    Mirrors generate_auth_challenge but for ed25519 wallets: the address is a
    base58 pubkey (CASE-SENSITIVE — never lowercase it) and there is no EVM chain
    id. The wallet signs the returned ``challenge`` text with signMessage.
    """
    nonce = secrets.token_urlsafe(32)
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(minutes=10)

    challenge = f"""{domain} wants you to sign in with your Solana account:
{address}

Sign in to Suwappu

URI: https://{domain}
Version: 1
Nonce: {nonce}
Issued At: {issued_at.isoformat()}Z
Expiration Time: {expires_at.isoformat()}Z"""

    # Store with the EXACT-case address + a chain marker so verify uses the right path.
    _auth_challenges[nonce] = {
        "address": address,
        "challenge": challenge,
        "expires_at": expires_at,
        "chain": "solana",
    }

    return {
        "challenge": challenge,
        "nonce": nonce,
        "expiresAt": expires_at.isoformat() + "Z",
    }


def verify_solana_auth_signature(address: str, signature: str, nonce: str) -> bool:
    """
    Verify a Solana (ed25519) wallet signature against a stored challenge.

    ``signature`` is base58-encoded (Phantom's signMessage output, base58'd by the
    client). ``address`` is the base58 pubkey. Uses PyNaCl (a dep of `solana`) for
    the ed25519 check. Never lowercases the address (base58 is case-sensitive).
    """
    challenge_data = _auth_challenges.get(nonce)
    if not challenge_data:
        logger.warning("Solana auth verification failed: nonce not found")
        return False

    if datetime.now(timezone.utc) > challenge_data["expires_at"]:
        del _auth_challenges[nonce]
        logger.warning("Solana auth verification failed: challenge expired")
        return False

    if challenge_data.get("chain") != "solana" or challenge_data["address"] != address:
        logger.warning("Solana auth verification failed: address/chain mismatch")
        return False

    try:
        import base58
        from nacl.signing import VerifyKey
        from nacl.exceptions import BadSignatureError

        pubkey_bytes = base58.b58decode(address)
        if len(pubkey_bytes) != 32:
            logger.warning("Solana auth verification failed: bad pubkey length")
            return False

        sig_bytes = base58.b58decode(signature)
        message = challenge_data["challenge"].encode("utf-8")

        try:
            VerifyKey(pubkey_bytes).verify(message, sig_bytes)
        except BadSignatureError:
            logger.warning("Solana auth verification failed: signature mismatch")
            return False

        # Clean up used challenge
        del _auth_challenges[nonce]
        logger.info(f"Solana auth verification successful for {address[:8]}...")
        return True

    except ImportError:
        logger.error("base58 + pynacl required for Solana signature verification")
        return False
    except Exception as e:
        logger.error(f"Solana auth verification error: {e}")
        return False


def cleanup_expired_challenges() -> int:
    """
    Remove expired auth challenges from storage.

    Returns:
        Number of challenges removed
    """
    now = datetime.now(timezone.utc)
    expired = [nonce for nonce, data in _auth_challenges.items() if now > data["expires_at"]]
    for nonce in expired:
        del _auth_challenges[nonce]
    return len(expired)


class TurnkeyAPIError(Exception):
    """Raised when Turnkey API returns an error."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(f"Turnkey API error {status_code}: {message}")


class TurnkeyActivityError(Exception):
    """Raised when a Turnkey activity fails."""

    def __init__(self, activity_id: str, message: str):
        self.activity_id = activity_id
        self.message = message
        super().__init__(f"Turnkey activity {activity_id} failed: {message}")


# === Global client instance ===

_turnkey_client: Optional[TurnkeyClient] = None


def get_turnkey_client() -> TurnkeyClient:
    """
    Get the configured Turnkey client instance.

    Returns:
        TurnkeyClient instance

    Raises:
        ValueError: If Turnkey is not configured
    """
    global _turnkey_client

    if _turnkey_client is not None:
        return _turnkey_client

    from bot.config.settings import settings

    if not settings.turnkey_organization_id:
        raise ValueError("Turnkey not configured: missing turnkey_organization_id")

    if not settings.turnkey_api_public_key or not settings.turnkey_api_private_key:
        raise ValueError("Turnkey not configured: missing API keys")

    _turnkey_client = TurnkeyClient(
        organization_id=settings.turnkey_organization_id,
        api_public_key=settings.turnkey_api_public_key,
        api_private_key=settings.turnkey_api_private_key,
        base_url=settings.turnkey_base_url,
    )

    return _turnkey_client


def reset_turnkey_client() -> None:
    """Reset the Turnkey client (useful for testing)."""
    global _turnkey_client
    _turnkey_client = None


def is_turnkey_configured() -> bool:
    """Check if Turnkey is configured and available."""
    from bot.config.settings import settings

    return bool(
        settings.wallet_provider == "turnkey"
        and settings.turnkey_organization_id
        and settings.turnkey_api_public_key
        and settings.turnkey_api_private_key
    )

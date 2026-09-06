"""
Turnkey wallet infrastructure client.

Provides TEE-backed wallet creation, signing, and management via Turnkey's API.
All private keys stay in Turnkey's secure enclaves - they never touch our servers.
"""

import asyncio
import json
import re
import time
import logging

from bot.utils.turnkey_hpke import (
    PRODUCTION_SIGNER_SIGN_PUBLIC_KEY,
    TurnkeyBundleError,
    decrypt_export_bundle,
    generate_target_keypair,
)
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

    # Turnkey signer-enclave key that signs export bundles. Overridable for tests
    # (a self-signed bundle) — never override this in production.
    export_signer_public_key_hex: str = PRODUCTION_SIGNER_SIGN_PUBLIC_KEY

    async def export_wallet(
        self,
        wallet_id: str,
        organization_id: Optional[str] = None,
        chain_type: str = "evm",
        expected_address: Optional[str] = None,
    ) -> str:
        """
        Export a wallet's mnemonic from Turnkey via ACTIVITY_TYPE_EXPORT_WALLET and
        derive the private key.

        Turnkey has no plaintext export. The activity REQUIRES a P-256
        ``targetPublicKey``; the response is an HPKE bundle encrypted to it and
        signed by Turnkey's signer enclave. Sending only ``walletId`` (as this
        method used to) is rejected with ``400 invalid request`` — production
        logged that for every wallet created since 2026-08-31, so no backup key
        was ever stored. The ephemeral target key lives only in this call.

        Args:
            wallet_id: Turnkey wallet ID to export
            organization_id: Organization that owns the wallet (sub-org for user wallets)
            chain_type: "evm" or "solana" — selects the derivation path and the
                key encoding the fallback signer expects.
            expected_address: The wallet's on-record address. When given, the
                derived key MUST reproduce it or the export is rejected, so a
                wrong path can never be stored as a "backup".

        Returns:
            EVM: hex private key (no 0x). Solana: base58 64-byte keypair.
        """
        org_id = organization_id or self._org_id
        target = generate_target_keypair()
        params = {
            "walletId": wallet_id,
            "targetPublicKey": target.public_uncompressed_hex,
        }

        result = await self._submit_activity(
            "ACTIVITY_TYPE_EXPORT_WALLET",
            params,
            organization_id=org_id,
        )

        export_result = result.get("exportWalletResult", {}) or {}
        bundle = export_result.get("exportBundle", "")
        if not bundle:
            raise TurnkeyActivityError("export_wallet", "Turnkey export returned no exportBundle")

        try:
            plaintext = decrypt_export_bundle(
                bundle,
                target.private_hex,
                org_id,
                expected_signer_public_hex=self.export_signer_public_key_hex,
            )
        except TurnkeyBundleError as exc:
            raise TurnkeyActivityError("export_wallet", f"Export bundle rejected: {exc}") from exc

        mnemonic = plaintext.decode("utf-8", errors="strict").strip()
        if not mnemonic:
            raise TurnkeyActivityError(
                "export_wallet", "Turnkey export bundle decrypted to nothing"
            )

        # Derive the account key for the wallet's chain and prove it matches.
        return self.derive_backup_key(mnemonic, chain_type, expected_address)

    @staticmethod
    def derive_backup_key(
        mnemonic: str, chain_type: str = "evm", expected_address: Optional[str] = None
    ) -> str:
        """Turn an exported wallet mnemonic into the fallback-signer key.

        EVM:    BIP-44 m/44'/60'/0'/0/0 (eth_account) → hex secp256k1 key.
        Solana: SLIP-0010 ed25519 m/44'/501'/0'/0' — the path Turnkey uses when
                it creates the account (see create_wallet) → base58 64-byte
                keypair, which is what turnkey_fallback's Keypair.from_bytes
                loads. The previous code derived the EVM key for every wallet,
                so a Solana wallet's "backup" could never have signed anything.
        """
        kind = (chain_type or "evm").lower()
        if kind == "solana":
            import base58
            from eth_account.hdaccount.mnemonic import Mnemonic
            from solders.keypair import Keypair

            from bot.utils.slip10 import derive_ed25519_seed

            seed = Mnemonic.to_seed(mnemonic.strip())
            keypair = Keypair.from_seed(derive_ed25519_seed(seed, "m/44'/501'/0'/0'"))
            derived = str(keypair.pubkey())
            if expected_address and derived != expected_address:
                raise TurnkeyActivityError(
                    "export_wallet",
                    f"Derived Solana address {derived[:8]}… does not match wallet"
                    f" {expected_address[:8]}…; refusing to store a mismatched backup",
                )
            return base58.b58encode(bytes(keypair)).decode("ascii")

        key_hex = TurnkeyClient._derive_key_from_mnemonic(mnemonic)
        if expected_address:
            from eth_account import Account

            derived = Account.from_key("0x" + key_hex).address
            if derived.lower() != expected_address.lower():
                raise TurnkeyActivityError(
                    "export_wallet",
                    f"Derived EVM address {derived[:10]}… does not match wallet"
                    f" {expected_address[:10]}…; refusing to store a mismatched backup",
                )
        return key_hex

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

import secrets  # noqa: E402
from datetime import datetime, timezone, timedelta  # noqa: E402

# Store for auth challenges (in production, use Redis/DB)
_auth_challenges: Dict[str, Dict[str, Any]] = {}

# EIP-1271: isValidSignature(bytes32,bytes) returns this selector when the
# smart account accepts the signature.
_EIP1271_SELECTOR = "1626ba7e"
_EIP1271_MAGIC_VALUE = "1626ba7e"

# ERC-6492 wraps a counterfactual (not-yet-deployed) account signature and
# terminates it with this 32-byte magic suffix.
_ERC6492_MAGIC_SUFFIX = bytes.fromhex("6492" * 16)

# Chains probed for a smart-account signature when the client never told us
# which network it signed on (older Terminal/webapp builds). A smart account's
# EIP-1271 check is chain-bound, so at most one of these can succeed.
_SMART_WALLET_FALLBACK_CHAINS = ("ethereum", "base", "arbitrum", "optimism", "polygon")


def _normalize_chain_id(chain_id: Any) -> int:
    """Coerce a client-supplied chain id to a sane positive int (default 1)."""
    try:
        value = int(chain_id)
    except (TypeError, ValueError):
        return 1
    if value <= 0 or value > 2**53:
        return 1
    return value


def _chain_names_for_id(chain_id: Optional[int]) -> List[str]:
    """Map an EVM chain id to the rpc_manager chain name(s) to probe."""
    if chain_id:
        try:
            from bot.config.chains import get_chain_by_id

            chain = get_chain_by_id(chain_id)
            if chain is not None and chain.name:
                return [chain.name]
        except Exception as exc:  # pragma: no cover - config import guard
            logger.warning(f"Chain lookup failed for id {chain_id}: {exc}")
    return list(_SMART_WALLET_FALLBACK_CHAINS)


def _unwrap_erc6492_signature(signature: bytes) -> bytes:
    """Return the inner signature of an ERC-6492 payload (or the input as-is).

    An ERC-6492 signature is ``abi.encode(factory, factoryCalldata, signature)``
    followed by the magic suffix. Once the account is deployed the inner
    signature validates through plain EIP-1271, which is the case we can check
    without deploying anything.
    """
    if len(signature) <= 32 or signature[-32:] != _ERC6492_MAGIC_SUFFIX:
        return signature
    try:
        from eth_abi import decode as abi_decode

        _factory, _factory_calldata, inner = abi_decode(
            ["address", "bytes", "bytes"], signature[:-32]
        )
        return inner
    except Exception as exc:
        logger.warning(f"ERC-6492 unwrap failed: {exc}")
        return signature


def _encode_is_valid_signature_call(message_hash: bytes, signature: bytes) -> str:
    """ABI-encode isValidSignature(bytes32 hash, bytes signature)."""
    padding = (32 - len(signature) % 32) % 32
    data = (
        bytes.fromhex(_EIP1271_SELECTOR)
        + message_hash
        + (0x40).to_bytes(32, "big")
        + len(signature).to_bytes(32, "big")
        + signature
        + b"\x00" * padding
    )
    return "0x" + data.hex()


async def _eth_call(rpc_url: str, to: str, data: str) -> Optional[str]:
    """Single eth_call against an RPC endpoint. Returns the hex result or None."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "eth_call",
        "params": [{"to": to, "data": data}, "latest"],
    }
    try:
        session = await get_http_session()
        async with session.post(
            rpc_url, json=payload, timeout=aiohttp.ClientTimeout(total=8)
        ) as resp:
            if resp.status != 200:
                return None
            body = await resp.json()
    except Exception as exc:
        logger.warning(f"eth_call failed: {exc}")
        return None

    if not isinstance(body, dict) or body.get("error"):
        return None
    result = body.get("result")
    return result if isinstance(result, str) else None


async def _verify_smart_wallet_signature(
    address: str, message: str, signature: str, chain_id: Optional[int] = None
) -> bool:
    """Verify an EIP-1271 (smart contract account) signature over a SIWE message.

    Coinbase Smart Wallet, Safe, Argent and every passkey/4337 account return a
    signature that is NOT a 65-byte ECDSA tuple, so `Account.recover_message`
    cannot validate them — the account contract itself is the verifier. We ask
    it directly via `isValidSignature`, which is what the wallet expects.
    """
    try:
        from eth_account.messages import encode_defunct, _hash_eip191_message
        from eth_utils import to_checksum_address
    except ImportError:
        logger.error("eth_account/eth_utils required for EIP-1271 verification")
        return False

    try:
        message_hash = _hash_eip191_message(encode_defunct(text=message))
        raw = signature.strip()
        sig_bytes = bytes.fromhex(raw[2:] if raw.startswith("0x") else raw)
        checksum_address = to_checksum_address(address)
    except Exception as exc:
        logger.warning(f"EIP-1271 verification failed: malformed input ({exc})")
        return False

    # Try the payload as sent, plus the unwrapped ERC-6492 inner signature.
    candidates = [sig_bytes]
    inner = _unwrap_erc6492_signature(sig_bytes)
    if inner != sig_bytes:
        candidates.append(inner)

    from bot.services.rpc_manager import rpc_manager

    async def probe(chain_name: str) -> bool:
        try:
            rpc_url = rpc_manager.get_rpc_url(chain_name)
        except Exception as exc:
            logger.warning(f"No RPC available for {chain_name}: {exc}")
            return False
        if not rpc_url:
            return False

        for candidate in candidates:
            data = _encode_is_valid_signature_call(message_hash, candidate)
            result = await _eth_call(rpc_url, checksum_address, data)
            if result and result[2:10].lower() == _EIP1271_MAGIC_VALUE:
                logger.info(f"EIP-1271 verification succeeded for {address} on {chain_name}")
                return True
        return False

    # Probe the candidate chains in parallel: a sign-in must not wait out a
    # serial timeout per chain. At most one chain can accept the signature
    # anyway, since the account hashes block.chainid into what it verifies.
    chains = _chain_names_for_id(chain_id)
    results = await asyncio.gather(*(probe(chain) for chain in chains), return_exceptions=True)
    for result in results:
        if result is True:
            return True

    logger.warning(f"EIP-1271 verification failed for {address}")
    return False


def generate_auth_challenge(
    address: str,
    domain: str = "terminal.suwappu.bot",
    uri: Optional[str] = None,
    chain_id: Optional[int] = None,
) -> Dict[str, str]:
    """
    Generate an EIP-4361 style sign-in message for wallet authentication.

    Args:
        address: The wallet address requesting authentication
        domain: The domain for the sign-in message
        chain_id: EVM chain the wallet is connected to. Smart accounts
            (EIP-1271) bind their signature to ``block.chainid``, so the
            verifier must check the signature on this same chain — we store it
            alongside the challenge instead of guessing later. When a client
            does not send one, we record None and the verifier probes the
            major chains instead.

    Returns:
        Dict with 'challenge', 'nonce', and 'expiresAt' fields
    """
    # EIP-4361 requires an alphanumeric nonce. token_urlsafe() may emit '-'/'_'.
    nonce = secrets.token_hex(16)
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(minutes=10)
    sign_in_uri = uri or f"https://{domain}"
    issued_at_rfc3339 = issued_at.isoformat().replace("+00:00", "Z")
    expires_at_rfc3339 = expires_at.isoformat().replace("+00:00", "Z")
    # The chain id printed in the message is cosmetic (a smart account hashes
    # block.chainid at verify time, not this text), so an unusable value just
    # falls back to 1 — but only a client-supplied one narrows the verify probe.
    message_chain_id = _normalize_chain_id(chain_id)
    stored_chain_id = message_chain_id if chain_id is not None else None

    # EIP-4361 SIWE-style message
    challenge = f"""{domain} wants you to sign in with your Ethereum account:
{address}

Sign in to Suwappu

URI: {sign_in_uri}
Version: 1
Chain ID: {message_chain_id}
Nonce: {nonce}
Issued At: {issued_at_rfc3339}
Expiration Time: {expires_at_rfc3339}"""

    # Store challenge for verification
    _auth_challenges[nonce] = {
        "address": address.lower(),
        "challenge": challenge,
        "expires_at": expires_at,
        "chain_id": stored_chain_id,
    }

    return {
        "challenge": challenge,
        "nonce": nonce,
        "expiresAt": expires_at_rfc3339,
    }


def _lookup_evm_challenge(address: str, nonce: str) -> Optional[Dict[str, Any]]:
    """Fetch + validate a stored EVM challenge WITHOUT consuming it.

    Returns the challenge record, or None when the nonce is unknown, expired or
    bound to a different address. Expired records are dropped on the way out.
    """
    challenge_data = _auth_challenges.get(nonce)
    if not challenge_data:
        logger.warning("Auth verification failed: nonce not found")
        return None

    if datetime.now(timezone.utc) > challenge_data["expires_at"]:
        del _auth_challenges[nonce]
        logger.warning("Auth verification failed: challenge expired")
        return None

    if challenge_data.get("chain") == "solana":
        logger.warning("Auth verification failed: challenge is not an EVM challenge")
        return None

    if challenge_data["address"] != address.lower():
        logger.warning("Auth verification failed: address mismatch")
        return None

    return challenge_data


async def verify_wallet_auth_signature(address: str, signature: str, nonce: str) -> bool:
    """Verify an EVM wallet signature, EOA or smart account.

    Tries plain ECDSA recovery first (MetaMask, Ledger, Rainbow, …). If the
    signature is not a 65-byte ECDSA tuple — every ERC-4337 / passkey / Safe
    account — falls back to asking the account contract itself via EIP-1271.
    Consumes the challenge on success so a signature is single-use.
    """
    challenge_data = _lookup_evm_challenge(address, nonce)
    if challenge_data is None:
        return False

    if verify_auth_signature(address, signature, nonce):
        return True

    # The challenge survives a failed ECDSA attempt (verify_auth_signature only
    # consumes it on success), so the smart-account path can still use it.
    if nonce not in _auth_challenges:
        return False

    is_valid = await _verify_smart_wallet_signature(
        address=address,
        message=challenge_data["challenge"],
        signature=signature,
        chain_id=challenge_data.get("chain_id"),
    )
    if is_valid:
        _auth_challenges.pop(nonce, None)
        logger.info(f"Smart-account auth verification successful for {address}")
    return is_valid


def verify_auth_signature(address: str, signature: str, nonce: str) -> bool:
    """
    Verify an EOA (65-byte ECDSA) wallet signature against a stored challenge.

    Smart-contract accounts are handled by verify_wallet_auth_signature().

    Args:
        address: The wallet address that signed
        signature: The hex-encoded signature
        nonce: The nonce from the original challenge

    Returns:
        True if signature is valid, False otherwise
    """
    challenge_data = _lookup_evm_challenge(address, nonce)
    if challenge_data is None:
        return False

    # Verify signature using eth_account
    try:
        from eth_account.messages import encode_defunct
        from eth_account import Account

        message = encode_defunct(text=challenge_data["challenge"])
        recovered_address = Account.recover_message(message, signature=signature)

        if recovered_address.lower() != address.lower():
            logger.warning("Auth verification failed: signature recovery mismatch")
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


def generate_solana_auth_challenge(
    address: str,
    domain: str = "terminal.suwappu.bot",
    uri: Optional[str] = None,
) -> Dict[str, str]:
    """
    Generate a Sign-In-With-Solana style message for Phantom/Solana wallets.

    Mirrors generate_auth_challenge but for ed25519 wallets: the address is a
    base58 pubkey (CASE-SENSITIVE — never lowercase it) and there is no EVM chain
    id. The wallet signs the returned ``challenge`` text with signMessage.
    """
    # SIWS requires a nonce of at least eight alphanumeric characters.
    nonce = secrets.token_hex(16)
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(minutes=10)
    sign_in_uri = uri or f"https://{domain}"
    issued_at_rfc3339 = issued_at.isoformat().replace("+00:00", "Z")
    expires_at_rfc3339 = expires_at.isoformat().replace("+00:00", "Z")

    challenge = f"""{domain} wants you to sign in with your Solana account:
{address}

Sign in to Suwappu

URI: {sign_in_uri}
Version: 1
Nonce: {nonce}
Issued At: {issued_at_rfc3339}
Expiration Time: {expires_at_rfc3339}"""

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
        "expiresAt": expires_at_rfc3339,
    }


def verify_solana_auth_signature(address: str, signature: str, nonce: str) -> bool:
    """
    Verify a Solana (ed25519) wallet signature against a stored challenge.

    ``signature`` is base58-encoded (Phantom's signMessage output, base58'd by the
    client). ``address`` is the base58 pubkey. Never lowercases the address
    (base58 is case-sensitive).
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
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

        pubkey_bytes = base58.b58decode(address)
        if len(pubkey_bytes) != 32:
            logger.warning("Solana auth verification failed: bad pubkey length")
            return False

        sig_bytes = base58.b58decode(signature)
        message = challenge_data["challenge"].encode("utf-8")

        try:
            Ed25519PublicKey.from_public_bytes(pubkey_bytes).verify(sig_bytes, message)
        except (InvalidSignature, ValueError):
            logger.warning("Solana auth verification failed: signature mismatch")
            return False

        # Clean up used challenge
        del _auth_challenges[nonce]
        logger.info(f"Solana auth verification successful for {address[:8]}...")
        return True

    except ImportError:
        logger.error("base58 + cryptography required for Solana signature verification")
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

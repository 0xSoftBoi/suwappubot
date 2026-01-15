"""
Turnkey wallet infrastructure client.

Provides TEE-backed wallet creation, signing, and management via Turnkey's API.
All private keys stay in Turnkey's secure enclaves - they never touch our servers.
"""

import json
import time
import hashlib
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
import aiohttp

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
        self._api_public_key = api_public_key
        self._api_private_key = api_private_key
        self._base_url = base_url.rstrip("/")
        
        # Import ecdsa for signing
        try:
            from ecdsa import SigningKey, NIST256p
            self._signing_key = SigningKey.from_string(
                bytes.fromhex(api_private_key),
                curve=NIST256p
            )
        except ImportError:
            raise ImportError("ecdsa package required. Install with: pip install ecdsa")
    
    def _create_stamp(self, body: str) -> str:
        """
        Create a cryptographic stamp for API request authentication.
        
        Turnkey uses a custom authentication scheme where each request
        is signed with the API key pair. The stamp is base64-encoded JSON
        with hex-encoded signature.
        """
        from ecdsa.util import sigencode_der
        import base64
        
        # Create hash of request body
        body_hash = hashlib.sha256(body.encode()).digest()
        
        # Sign the hash with P-256 (DER encoded)
        signature = self._signing_key.sign_digest(
            body_hash,
            sigencode=sigencode_der
        )
        
        # Encode signature as hex (Turnkey's required format)
        signature_hex = signature.hex()
        
        stamp_obj = {
            "publicKey": self._api_public_key,
            "signature": signature_hex,
            "scheme": "SIGNATURE_SCHEME_TK_API_P256",
        }
        
        # Base64 encode the JSON stamp
        stamp_json = json.dumps(stamp_obj, separators=(',', ':'))
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
        body_str = json.dumps(body, separators=(',', ':')) if body else "{}"
        
        stamp = self._create_stamp(body_str)
        
        headers = {
            "Content-Type": "application/json",
            "X-Stamp": stamp,  # Already base64-encoded
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method,
                url,
                data=body_str,
                headers=headers,
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
        
        # Convert activity type to endpoint path (e.g., ACTIVITY_TYPE_CREATE_WALLET -> create_wallet)
        endpoint_name = activity_type.replace("ACTIVITY_TYPE_", "").lower()
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
                }
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
        params = {
            "subOrganizationName": name,
            "rootUsers": [],  # API-only sub-org, no interactive users
        }
        
        if root_user_email:
            params["rootUsers"] = [{
                "userName": name,
                "userEmail": root_user_email,
                "apiKeys": [],
                "authenticators": [],
            }]
        
        result = await self._submit_activity(
            "ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V4",
            params,
        )
        
        sub_org = result.get("createSubOrganizationResultV4", {})
        
        return TurnkeySubOrganization(
            sub_org_id=sub_org.get("subOrganizationId", ""),
            sub_org_name=name,
            root_user_id=sub_org.get("rootUserIds", [None])[0] if sub_org.get("rootUserIds") else None,
        )
    
    async def get_sub_organization(self, sub_org_id: str) -> Dict[str, Any]:
        """Get sub-organization details."""
        return await self._request(
            "POST",
            "/public/v1/query/get_organization",
            {"organizationId": sub_org_id}
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
            "accounts": [{
                "curve": curve,
                "pathFormat": "PATH_FORMAT_BIP32",
                "path": "m/44'/60'/0'/0/0" if chain_type.lower() == "evm" else "m/44'/501'/0'/0'",
                "addressFormat": address_format,
            }],
        }
        
        result = await self._submit_activity(
            "ACTIVITY_TYPE_CREATE_WALLET",
            params,
            organization_id=organization_id,
        )
        
        wallet_result = result.get("createWalletResult", {})
        
        return TurnkeyWallet(
            wallet_id=wallet_result.get("walletId", ""),
            wallet_name=wallet_name,
            accounts=wallet_result.get("addresses", []),
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
            }
        )
    
    async def list_wallets(
        self,
        organization_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List all wallets in an organization."""
        org_id = organization_id or self._org_id
        
        result = await self._request(
            "POST",
            "/public/v1/query/list_wallets",
            {"organizationId": org_id}
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
    
    # === Import/Export ===
    
    async def import_private_key(
        self,
        private_key: str,
        key_name: str,
        curve: str,
        organization_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Import an existing private key into Turnkey.
        
        Note: This should be done via secure iframe in production.
        For server-side import, use encrypted bundle approach.
        
        Args:
            private_key: Hex-encoded private key
            key_name: Name for the imported key
            curve: CURVE_SECP256K1 or CURVE_ED25519
            organization_id: Target organization
            
        Returns:
            Import result with new wallet/account IDs
        """
        params = {
            "privateKeyName": key_name,
            "encryptedBundle": private_key,  # Simplified - production should use encryption
            "curve": curve,
            "addressFormats": [
                "ADDRESS_FORMAT_ETHEREUM" if curve == "CURVE_SECP256K1" else "ADDRESS_FORMAT_SOLANA"
            ],
        }
        
        result = await self._submit_activity(
            "ACTIVITY_TYPE_IMPORT_PRIVATE_KEY",
            params,
            organization_id=organization_id,
        )
        
        return result.get("importPrivateKeyResult", {})
    
    # === Policies (optional) ===
    
    async def create_policy(
        self,
        policy_name: str,
        effect: str,
        consensus: str,
        condition: str,
        organization_id: Optional[str] = None,
    ) -> str:
        """
        Create a policy in Turnkey.
        
        Args:
            policy_name: Name for the policy
            effect: EFFECT_ALLOW or EFFECT_DENY
            consensus: Consensus requirement
            condition: Policy condition expression
            organization_id: Target organization
            
        Returns:
            Policy ID
        """
        params = {
            "policyName": policy_name,
            "effect": effect,
            "consensus": consensus,
            "condition": condition,
        }
        
        result = await self._submit_activity(
            "ACTIVITY_TYPE_CREATE_POLICY_V3",
            params,
            organization_id=organization_id,
        )
        
        return result.get("createPolicyResult", {}).get("policyId", "")


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
        settings.wallet_provider == "turnkey" and
        settings.turnkey_organization_id and
        settings.turnkey_api_public_key and
        settings.turnkey_api_private_key
    )


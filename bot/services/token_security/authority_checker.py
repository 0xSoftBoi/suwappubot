"""Authority checker for Solana SPL tokens.

Checks token mint and freeze authorities to assess rug risk:

1. Mint Authority - Can create new tokens (inflation risk)
   - Should be revoked (set to null) for safe tokens
   - If active, issuer can dilute your holdings

2. Freeze Authority - Can freeze token accounts
   - Should be revoked for safe tokens
   - If active, your tokens can be made untransferable

A token with both authorities revoked is considered "renounced" and safer.
"""

import logging
import base64
from typing import Optional, Dict, Any
from dataclasses import dataclass
from datetime import datetime, timezone

from bot.services.rpc_manager import rpc_manager
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# SPL Token programs
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

# Mint account data layout offsets
# SPL Token Mint Layout:
#   0-4: mintAuthorityOption (4 bytes, COption)
#   4-36: mintAuthority (32 bytes, Pubkey)
#   36-44: supply (8 bytes, u64)
#   44-45: decimals (1 byte, u8)
#   45-46: isInitialized (1 byte, bool)
#   46-50: freezeAuthorityOption (4 bytes, COption)
#   50-82: freezeAuthority (32 bytes, Pubkey)

MINT_AUTHORITY_OPTION_OFFSET = 0
MINT_AUTHORITY_OFFSET = 4
SUPPLY_OFFSET = 36
DECIMALS_OFFSET = 44
FREEZE_AUTHORITY_OPTION_OFFSET = 46
FREEZE_AUTHORITY_OFFSET = 50


@dataclass
class AuthorityResult:
    """Result of authority check."""

    token_mint: str
    checked_at: datetime

    # Mint authority
    has_mint_authority: bool = False
    mint_authority: Optional[str] = None
    mint_authority_is_multisig: bool = False

    # Freeze authority
    has_freeze_authority: bool = False
    freeze_authority: Optional[str] = None
    freeze_authority_is_multisig: bool = False

    # Token info
    decimals: int = 9
    supply: int = 0
    is_token_2022: bool = False

    # Overall assessment
    is_renounced: bool = False  # Both authorities revoked
    risk_level: str = "unknown"  # low, medium, high

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "token_mint": self.token_mint,
            "has_mint_authority": self.has_mint_authority,
            "mint_authority": self.mint_authority,
            "has_freeze_authority": self.has_freeze_authority,
            "freeze_authority": self.freeze_authority,
            "is_renounced": self.is_renounced,
            "risk_level": self.risk_level,
            "decimals": self.decimals,
            "supply": self.supply,
        }


class AuthorityCheckerError(Exception):
    """Exception for authority checker errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class AuthorityChecker:
    """Checks token mint and freeze authorities on Solana.

    Usage:
        checker = authority_checker  # Global instance

        result = await checker.check_authorities(token_mint)
        if result.is_renounced:
            print("Token is renounced - safer")
        if result.has_mint_authority:
            print(f"Warning: mint authority active: {result.mint_authority}")
    """

    def __init__(self):
        self._cache: Dict[str, tuple[AuthorityResult, datetime]] = {}
        self._cache_ttl = 600  # 10 minutes (authorities rarely change)

    async def check_authorities(
        self,
        token_mint: str,
        use_cache: bool = True,
    ) -> AuthorityResult:
        """
        Check mint and freeze authorities for a token.

        Args:
            token_mint: Token mint address
            use_cache: Use cached results if available

        Returns:
            AuthorityResult with authority details
        """
        # Check cache
        if use_cache and token_mint in self._cache:
            result, cached_at = self._cache[token_mint]
            if (datetime.now(timezone.utc) - cached_at).total_seconds() < self._cache_ttl:
                return result

        result = AuthorityResult(
            token_mint=token_mint,
            checked_at=datetime.now(timezone.utc),
        )

        try:
            await api_limiter.wait_and_acquire("solana")
            session = await get_session()
            rpc_url = rpc_manager.get_rpc_url("solana")

            # Get mint account info
            async with session.post(
                rpc_url,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "getAccountInfo",
                    "params": [token_mint, {"encoding": "base64"}],
                },
            ) as response:
                if response.status != 200:
                    raise AuthorityCheckerError(f"RPC error: HTTP {response.status}")

                data = await response.json()
                account = data.get("result", {}).get("value")

                if not account:
                    raise AuthorityCheckerError("Token mint account not found")

                owner = account.get("owner", "")
                account_data = account.get("data", [])

                if not account_data or len(account_data) < 1:
                    raise AuthorityCheckerError("Invalid account data")

                # Check if Token-2022
                result.is_token_2022 = owner == TOKEN_2022_PROGRAM

                # Decode base64 account data
                raw_data = base64.b64decode(account_data[0])

                # Parse authorities from mint data
                self._parse_mint_data(raw_data, result)

            # Determine risk level
            self._calculate_risk(result)

            # Cache result
            self._cache[token_mint] = (result, datetime.now(timezone.utc))

        except AuthorityCheckerError:
            raise
        except Exception as e:
            logger.error(f"Authority check error for {token_mint}: {e}")
            raise AuthorityCheckerError(str(e))

        return result

    def _parse_mint_data(self, data: bytes, result: AuthorityResult):
        """Parse mint account data to extract authorities."""
        if len(data) < 82:
            raise AuthorityCheckerError(f"Mint data too short: {len(data)} bytes")

        # Parse mint authority
        # COption<Pubkey>: first 4 bytes indicate Some(1) or None(0)
        mint_auth_option = int.from_bytes(
            data[MINT_AUTHORITY_OPTION_OFFSET : MINT_AUTHORITY_OPTION_OFFSET + 4],  # noqa: E203
            "little",  # noqa: E203
        )

        if mint_auth_option == 1:
            # Mint authority is set
            result.has_mint_authority = True
            mint_auth_bytes = data[MINT_AUTHORITY_OFFSET : MINT_AUTHORITY_OFFSET + 32]  # noqa: E203
            result.mint_authority = self._bytes_to_base58(mint_auth_bytes)
        else:
            result.has_mint_authority = False
            result.mint_authority = None

        # Parse supply (u64, little-endian)
        result.supply = int.from_bytes(
            data[SUPPLY_OFFSET : SUPPLY_OFFSET + 8], "little"  # noqa: E203
        )  # noqa: E203

        # Parse decimals
        result.decimals = data[DECIMALS_OFFSET]

        # Parse freeze authority
        freeze_auth_option = int.from_bytes(
            data[FREEZE_AUTHORITY_OPTION_OFFSET : FREEZE_AUTHORITY_OPTION_OFFSET + 4],  # noqa: E203
            "little",  # noqa: E203
        )

        if freeze_auth_option == 1:
            result.has_freeze_authority = True
            freeze_auth_bytes = data[
                FREEZE_AUTHORITY_OFFSET : FREEZE_AUTHORITY_OFFSET + 32  # noqa: E203
            ]  # noqa: E203
            result.freeze_authority = self._bytes_to_base58(freeze_auth_bytes)
        else:
            result.has_freeze_authority = False
            result.freeze_authority = None

        # Token is renounced if both authorities are revoked
        result.is_renounced = not result.has_mint_authority and not result.has_freeze_authority

    def _bytes_to_base58(self, data: bytes) -> str:
        """Convert bytes to base58 string (Solana address format)."""
        # Base58 alphabet (Bitcoin/Solana variant)
        ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

        # Convert bytes to integer
        num = int.from_bytes(data, "big")

        # Convert to base58
        result = ""
        while num > 0:
            num, remainder = divmod(num, 58)
            result = ALPHABET[remainder] + result

        # Add leading zeros
        for byte in data:
            if byte == 0:
                result = "1" + result
            else:
                break

        return result or "1"

    def _calculate_risk(self, result: AuthorityResult):
        """Calculate risk level based on authorities."""
        if result.is_renounced:
            result.risk_level = "low"
        elif result.has_mint_authority and result.has_freeze_authority:
            result.risk_level = "high"
        elif result.has_mint_authority:
            result.risk_level = "high"  # Mint authority is worse
        elif result.has_freeze_authority:
            result.risk_level = "medium"
        else:
            result.risk_level = "low"

    async def is_renounced(self, token_mint: str) -> bool:
        """Quick check if token is renounced (both authorities revoked)."""
        result = await self.check_authorities(token_mint)
        return result.is_renounced

    async def check_multiple(
        self,
        token_mints: list[str],
    ) -> Dict[str, AuthorityResult]:
        """Check authorities for multiple tokens in parallel."""
        results = {}

        tasks = [self.check_authorities(mint, use_cache=True) for mint in token_mints]

        completed = await asyncio.gather(*tasks, return_exceptions=True)

        for mint, result in zip(token_mints, completed):
            if isinstance(result, Exception):
                results[mint] = AuthorityResult(
                    token_mint=mint,
                    checked_at=datetime.now(timezone.utc),
                    risk_level="unknown",
                )
            else:
                results[mint] = result

        return results

    def clear_cache(self, token_mint: Optional[str] = None):
        """Clear authority cache."""
        if token_mint:
            self._cache.pop(token_mint, None)
        else:
            self._cache.clear()


# Need asyncio for check_multiple
import asyncio  # noqa: E402

# Global instance
authority_checker = AuthorityChecker()

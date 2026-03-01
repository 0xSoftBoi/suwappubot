"""TON wallet creation and management.

Uses tonsdk for key generation and address derivation.
TON wallets use the v4r2 smart contract (most widely supported).
"""

import logging
import base64
from typing import Optional, Tuple

import aiohttp

from bot.config.settings import settings

logger = logging.getLogger(__name__)

# TON Center API (Toncenter)
TON_API_BASE = "https://toncenter.com/api/v2"


def generate_keypair() -> Tuple[bytes, bytes]:
    """Generate a new TON keypair.

    Returns:
        Tuple of (private_key_bytes, public_key_bytes)
    """
    try:
        from tonsdk.crypto import mnemonic_new, mnemonic_to_wallet_key

        mnemonic = mnemonic_new()
        pub_key, priv_key = mnemonic_to_wallet_key(mnemonic)
        return priv_key, pub_key
    except ImportError:
        # Fallback: use nacl directly
        from nacl.signing import SigningKey

        sk = SigningKey.generate()
        return bytes(sk), bytes(sk.verify_key)


def derive_address(public_key: bytes, workchain: int = 0) -> str:
    """Derive a TON wallet address from a public key.

    Uses the WalletV4R2 contract for maximum compatibility.

    Returns:
        Base64url-encoded bounceable address (EQ... format)
    """
    try:
        from tonsdk.contract.wallet import WalletVersionEnum, Wallets

        _mnemonics, _pub, _priv, wallet = Wallets.from_key_pair(
            WalletVersionEnum.v4r2,
            public_key,
            b"",  # private key not needed for address derivation
            workchain=workchain,
        )
        # Get the raw address and convert to user-friendly format
        raw_addr = wallet.address.to_string(True, True, True)
        return raw_addr
    except ImportError:
        logger.warning("tonsdk not installed, cannot derive TON address")
        # Return a placeholder - will fail on actual usage
        return base64.urlsafe_b64encode(public_key[:32]).decode().rstrip("=")


async def get_balance(address: str) -> float:
    """Get TON balance for an address.

    Returns balance in TON (not nanotons).
    """
    api_key = getattr(settings, "ton_api_key", None)
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{TON_API_BASE}/getAddressBalance",
                params={"address": address},
                headers=headers,
            ) as resp:
                if resp.status != 200:
                    logger.error("TON balance check failed: %d", resp.status)
                    return 0.0

                data = await resp.json()
                if not data.get("ok"):
                    return 0.0

                # Balance is in nanotons (10^-9)
                balance_nano = int(data.get("result", "0"))
                return balance_nano / 1e9

    except Exception as e:
        logger.error("TON balance error for %s: %s", address, e)
        return 0.0


async def get_jetton_balances(address: str) -> list:
    """Get Jetton (TON token) balances for an address.

    Returns list of dicts with token info and balances.
    """
    api_key = getattr(settings, "ton_api_key", None)
    headers = {}
    if api_key:
        headers["X-API-Key"] = api_key

    try:
        async with aiohttp.ClientSession() as session:
            # Use TON API v2 for Jetton balances
            async with session.get(
                f"{TON_API_BASE}/getJettonWallets",
                params={"owner_address": address, "limit": 50},
                headers=headers,
            ) as resp:
                if resp.status != 200:
                    return []

                data = await resp.json()
                if not data.get("ok"):
                    return []

                jettons = []
                for wallet in data.get("result", []):
                    balance = int(wallet.get("balance", "0"))
                    if balance > 0:
                        jettons.append({
                            "jetton_address": wallet.get("jetton"),
                            "balance_raw": balance,
                            "wallet_address": wallet.get("address"),
                        })

                return jettons

    except Exception as e:
        logger.error("TON Jetton balance error for %s: %s", address, e)
        return []

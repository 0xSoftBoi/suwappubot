"""Polymarket CLOB **V2** order building and EIP-712 signing.

Why this module exists
----------------------
``py-clob-client==0.34.6`` is the newest release on PyPI (uploaded 2026-02-19)
and its ``config.py`` still hardcodes the pre-migration contracts::

    exchange  0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E   (USDC.e collateral)
    neg-risk  0xC5d563A36AE78145C45a50134d48A1215220f80a

Polymarket migrated to **CLOB V2** on 2026-04-28 — pUSD collateral, a new order
struct and EIP-712 domain v2 — with no V1 backward compatibility. So every order
the SDK signs is bound to a deprecated exchange and is rejected.

Scope: this module replaces ONLY order construction + signing. The SDK's L2 auth
(``signing/hmac.py``) is correct and is reused as-is via
:func:`build_l2_headers`, and API-credential derivation still goes through the
SDK. Read-only market data is unaffected.

Ground truth (verified 2026-07-26, first-party):
  * docs.polymarket.com/resources/contracts — exchange addresses
  * Polymarket/ctf-exchange-v2 ``src/exchange/mixins/Hashing.sol``
        DOMAIN_NAME = "Polymarket CTF Exchange", DOMAIN_VERSION = "2"
  * Polymarket/ctf-exchange-v2 ``src/exchange/libraries/Structs.sol``
        ORDER_TYPEHASH = 0xbb86318a2138f5fa8ae32fbe8e659f8fcf13cc6ae4014a707893055433818589

Mirrors ``api-ts/src/lib/polymarket-eip712.ts`` — keep the two in step.
"""

import logging
import secrets
import time
from dataclasses import dataclass
from typing import Optional

from eth_account import Account
from eth_account.messages import encode_typed_data

logger = logging.getLogger(__name__)

POLYGON_CHAIN_ID = 137

# Live CLOB V2 exchanges. Neg-risk (multi-outcome) markets are matched by a
# SEPARATE deployment of the same contract code, so only verifyingContract
# differs — the domain name/version are identical.
CTF_EXCHANGE = "0xE111180000d2663C0091e4f400237545B87B996B"
NEG_RISK_CTF_EXCHANGE = "0xe2222d279d744050d28e00520010520000310F59"

# The deprecated USDC.e-era deployments py-clob-client still ships. Never sign
# against these; asserted in tests so they cannot creep back in.
DEPRECATED_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"
DEPRECATED_NEG_RISK_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a"

DOMAIN_NAME = "Polymarket CTF Exchange"
DOMAIN_VERSION = "2"

ZERO_BYTES32 = "0x" + "00" * 32

# v2 dropped taker/expiration/nonce/feeRateBps and added timestamp (ms),
# metadata and builder. Field ORDER IS PART OF THE TYPE HASH — do not reorder.
ORDER_TYPE = [
    {"name": "salt", "type": "uint256"},
    {"name": "maker", "type": "address"},
    {"name": "signer", "type": "address"},
    {"name": "tokenId", "type": "uint256"},
    {"name": "makerAmount", "type": "uint256"},
    {"name": "takerAmount", "type": "uint256"},
    {"name": "side", "type": "uint8"},
    {"name": "signatureType", "type": "uint8"},
    {"name": "timestamp", "type": "uint256"},
    {"name": "metadata", "type": "bytes32"},
    {"name": "builder", "type": "bytes32"},
]

# Collateral (pUSD) and outcome-share tokens are both 6dp.
DECIMALS = 6
_SCALE = 10**DECIMALS

SIDE_BUY = 0
SIDE_SELL = 1


@dataclass
class SignedV2Order:
    """A CLOB V2 order plus its EIP-712 signature."""

    order: dict
    signature: str
    neg_risk: bool

    def to_request_body(self, owner: str, order_type: str = "GTC") -> dict:
        """Serialize for ``POST /order``.

        Serializes exactly the struct that was signed (plus the signature) — any
        extra or missing field makes the server recover a different hash and
        reject the order.
        """
        o = self.order
        return {
            "order": {
                "salt": str(o["salt"]),
                "maker": o["maker"],
                "signer": o["signer"],
                "tokenId": str(o["tokenId"]),
                "makerAmount": str(o["makerAmount"]),
                "takerAmount": str(o["takerAmount"]),
                "side": "BUY" if o["side"] == SIDE_BUY else "SELL",
                "signatureType": o["signatureType"],
                "timestamp": str(o["timestamp"]),
                "metadata": o["metadata"],
                "builder": o["builder"],
                "signature": self.signature,
            },
            "owner": owner,
            "orderType": order_type,
        }


def domain_for(neg_risk: bool) -> dict:
    """EIP-712 domain, selecting the neg-risk exchange when applicable."""
    return {
        "name": DOMAIN_NAME,
        "version": DOMAIN_VERSION,
        "chainId": POLYGON_CHAIN_ID,
        "verifyingContract": NEG_RISK_CTF_EXCHANGE if neg_risk else CTF_EXCHANGE,
    }


def compute_amounts(side: str, size: float, price: float) -> tuple[int, int]:
    """Return ``(makerAmount, takerAmount)`` in 6dp base units.

    ``size`` is the number of outcome shares; ``price`` is per-share in pUSD (0..1).

    BUY  — maker gives pUSD, taker gives shares.
    SELL — maker gives shares, taker gives pUSD.

    Rounded (not truncated) so float representation cannot silently drop a base
    unit; the SAME integers are signed and POSTed.
    """
    shares_base = int(round(size * _SCALE))
    usd_base = int(round(size * price * _SCALE))
    if side.upper() == "BUY":
        return usd_base, shares_base
    return shares_base, usd_base


def build_order(
    *,
    token_id: str,
    side: str,
    size: float,
    price: float,
    maker: str,
    signer: Optional[str] = None,
    signature_type: int = 0,
    builder_code: str = ZERO_BYTES32,
    salt: Optional[int] = None,
    timestamp_ms: Optional[int] = None,
) -> dict:
    """Build the unsigned CLOB V2 order struct."""
    if side.upper() not in ("BUY", "SELL"):
        raise ValueError("side must be BUY or SELL")
    if size <= 0:
        raise ValueError("size must be positive")
    if not 0 < price < 1:
        # Outcome-token prices are probabilities; anything outside (0,1) is a bug
        # upstream and the exchange would reject it anyway.
        raise ValueError("price must be between 0 and 1 (exclusive)")

    maker_amount, taker_amount = compute_amounts(side, size, price)
    return {
        "salt": salt if salt is not None else secrets.randbits(64),
        "maker": maker,
        "signer": signer or maker,
        "tokenId": int(token_id),
        "makerAmount": maker_amount,
        "takerAmount": taker_amount,
        "side": SIDE_BUY if side.upper() == "BUY" else SIDE_SELL,
        "signatureType": signature_type,
        "timestamp": timestamp_ms if timestamp_ms is not None else int(time.time() * 1000),
        "metadata": ZERO_BYTES32,
        "builder": builder_code,
    }


def build_typed_data(order: dict, neg_risk: bool) -> dict:
    """Full EIP-712 payload for an order."""
    return {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "Order": ORDER_TYPE,
        },
        "primaryType": "Order",
        "domain": domain_for(neg_risk),
        "message": order,
    }


def sign_order(order: dict, private_key: str, neg_risk: bool) -> SignedV2Order:
    """EIP-712-sign an order against the correct exchange for its market.

    ``neg_risk`` MUST reflect the market (CLOB ``GET /neg-risk?token_id=``).
    Getting it wrong yields a valid-looking signature bound to the wrong
    contract, and the order is rejected.
    """
    typed = build_typed_data(order, neg_risk)
    pk = private_key if private_key.startswith("0x") else "0x" + private_key
    signed = Account.sign_message(encode_typed_data(full_message=typed), private_key=pk)
    return SignedV2Order(order=order, signature=signed.signature.hex(), neg_risk=neg_risk)


def build_l2_headers(
    api_key: str,
    api_secret: str,
    passphrase: str,
    address: str,
    method: str,
    path: str,
    body: Optional[str] = None,
) -> dict:
    """CLOB L2 auth headers.

    Delegates the signature to py-clob-client's ``build_hmac_signature``, which
    is correct (base64url-decodes the secret, base64url-encodes the digest with
    padding) — only the SDK's *order signing* is stale, not its auth. Note L2
    headers carry no POLY_NONCE; that is L1-only.
    """
    from py_clob_client.signing.hmac import build_hmac_signature

    timestamp = str(int(time.time()))
    signature = build_hmac_signature(api_secret, timestamp, method.upper(), path, body)
    return {
        "POLY_ADDRESS": address,
        "POLY_SIGNATURE": signature,
        "POLY_TIMESTAMP": timestamp,
        "POLY_API_KEY": api_key,
        "POLY_PASSPHRASE": passphrase,
        "Content-Type": "application/json",
    }

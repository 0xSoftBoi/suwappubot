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

import base64
import hashlib
import hmac
import logging
import secrets
import time
from dataclasses import dataclass
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
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


# Mirrors py-clob-client's ``order_builder.builder.ROUNDING_CONFIG``
# (order_builder/builder.py). Keyed by the market's CLOB tick size (fetched from
# ``GET /tick-size?token_id=``): (price_decimals, size_decimals, amount_decimals).
# amount_decimals is always price_decimals + size_decimals — the granularity the
# maker/taker leg must land on for the exchange to accept the order at that tick.
TICK_ROUNDING: dict[str, tuple[int, int, int]] = {
    "0.1": (1, 2, 3),
    "0.01": (2, 2, 4),
    "0.001": (3, 2, 5),
    "0.0001": (4, 2, 6),
}
DEFAULT_TICK_SIZE = "0.01"


def round_price_to_tick(price: float, tick_size: str = DEFAULT_TICK_SIZE) -> Decimal:
    """Round ``price`` to the market's tick precision, ``ROUND_HALF_UP``.

    Same rounding :func:`compute_amounts` applies internally — exposed so
    callers (e.g. ``PolymarketClient.place_order``) can derive ``size`` from
    the price the exchange will actually book, instead of the raw quoted
    price. Deriving ``size = amount / raw_price`` and only rounding the price
    afterwards inside ``compute_amounts`` can make
    ``floor(size) * rounded_price`` exceed the requested notional — the price
    used to size the order and the price used to charge for it must be the
    same number.
    """
    if tick_size not in TICK_ROUNDING:
        raise ValueError(f"unsupported tick size: {tick_size!r}")
    price_dp, _size_dp, _amount_dp = TICK_ROUNDING[tick_size]
    price_quantum = Decimal(1).scaleb(-price_dp)
    return Decimal(str(price)).quantize(price_quantum, rounding=ROUND_HALF_UP)


def compute_amounts(
    side: str, size: float, price: float, tick_size: str = DEFAULT_TICK_SIZE
) -> tuple[int, int]:
    """Return ``(makerAmount, takerAmount)`` in 6dp base units.

    ``size`` is the number of outcome shares; ``price`` is per-share in pUSD (0..1).
    ``tick_size`` is the market's CLOB tick (``GET /tick-size?token_id=``) — it sets
    how many decimal places the price and the resulting notional may carry. Getting
    this wrong either has the exchange reject the order (price not on tick) or, on a
    market with a wider tick than assumed, mis-states the notional.

    BUY  — maker gives pUSD, taker gives shares.
    SELL — maker gives shares, taker gives pUSD.

    Uses ``Decimal`` throughout (never binary ``float`` arithmetic) so there is no
    float-epsilon noise to round away — mirrors py-clob-client's algorithm
    (``get_order_amounts``) but does not need its float-noise cleanup dance because
    Decimal built from ``str(size)``/``str(price)`` is exact.

    Rounding is one-directional and never favors the user at the exchange's expense:
      * the SHARE leg is always floored to ``size_decimals`` (2dp) — never receive/give
        more shares than requested;
      * the PRICE is rounded to the nearest tick (``ROUND_HALF_UP``) — this must match
        an actual orderbook price, which is already tick-aligned in practice;
      * the notional leg (price * floored size) is computed in exact Decimal and then
        floored to ``amount_decimals`` — since ``amount_decimals`` always equals
        ``price_decimals + size_decimals``, the product of two already-tick-aligned
        Decimals is exact at that precision, so this floor is a no-op in the normal
        case and only a safety net.
    """
    if tick_size not in TICK_ROUNDING:
        raise ValueError(f"unsupported tick size: {tick_size!r}")
    price_dp, size_dp, amount_dp = TICK_ROUNDING[tick_size]

    d_size = Decimal(str(size))

    raw_price = round_price_to_tick(price, tick_size)
    if raw_price <= 0:
        # A price this close to 0 rounds down to a zero-value leg at this
        # tick size — e.g. SELL @ 0.004 with tick 0.01 rounds to 0.00, which
        # would silently produce takerAmount=0 (give shares away for free).
        # py_clob_client's own order builder rejects this the same way.
        raise ValueError(
            f"price {price} rounds to {raw_price} at tick size {tick_size!r}; "
            "refusing to build a zero-price order"
        )

    size_quantum = Decimal(1).scaleb(-size_dp)
    raw_size = d_size.quantize(size_quantum, rounding=ROUND_DOWN)

    amount_quantum = Decimal(1).scaleb(-amount_dp)
    raw_amount = (raw_size * raw_price).quantize(amount_quantum, rounding=ROUND_DOWN)

    shares_base = int((raw_size * _SCALE).to_integral_value(rounding=ROUND_HALF_UP))
    amount_base = int((raw_amount * _SCALE).to_integral_value(rounding=ROUND_HALF_UP))

    if side.upper() == "BUY":
        return amount_base, shares_base
    return shares_base, amount_base


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
    tick_size: str = DEFAULT_TICK_SIZE,
) -> dict:
    """Build the unsigned CLOB V2 order struct.

    ``salt`` should be a deterministic value derived from the caller's own order
    identifier when one is available (e.g. the DB row id created before placing
    the order), rather than left random. A random salt means a retried
    place-order call (timeout, transient error) produces a DIFFERENT order hash
    and signature each time, so the CLOB sees it as a brand-new order rather
    than a safe-to-dedupe replay of the same intent. Defaults to a random value
    when the caller has no stable identifier to derive from.
    """
    if side.upper() not in ("BUY", "SELL"):
        raise ValueError("side must be BUY or SELL")
    if size <= 0:
        raise ValueError("size must be positive")
    if not 0 < price < 1:
        # Outcome-token prices are probabilities; anything outside (0,1) is a bug
        # upstream and the exchange would reject it anyway.
        raise ValueError("price must be between 0 and 1 (exclusive)")
    if tick_size not in TICK_ROUNDING:
        raise ValueError(f"unsupported tick size: {tick_size!r}")

    # py_clob_client-style price bounds: a price within one tick of 0 or 1
    # rounds to a degenerate 0- or full-value leg (see compute_amounts), so
    # reject it up front with a clear message rather than let it fall through
    # to a confusing zero-amount order or an exchange rejection.
    tick = Decimal(tick_size)
    d_price = Decimal(str(price))
    if d_price < tick or d_price > 1 - tick:
        raise ValueError(
            f"price {price} is outside the tradable range for tick size "
            f"{tick_size!r} ({tick_size} <= price <= {1 - tick}); a price this "
            "close to 0 or 1 would round to a degenerate order leg"
        )

    maker_amount, taker_amount = compute_amounts(side, size, price, tick_size=tick_size)
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
    # hexbytes>=1.0's .hex() dropped the "0x" prefix it used to emit; the CLOB
    # expects a 0x-prefixed 65-byte (130 hex char) signature string, so a bare
    # hex() here silently produces a signature the server can't parse.
    if hasattr(signed.signature, "to_0x_hex"):
        signature = signed.signature.to_0x_hex()
    else:  # pragma: no cover - older hexbytes fallback
        signature = "0x" + signed.signature.hex()
    if not (signature.startswith("0x") and len(signature) == 132):
        # A bare `assert` here is stripped when Python runs with `-O`, which
        # would silently let a malformed signature (unparseable or worse,
        # mis-parsed) reach the CLOB. Raise explicitly so this check always runs.
        raise ValueError(
            f"malformed signature: expected 0x-prefixed 65-byte hex string, got "
            f"{len(signature)} chars"
        )
    return SignedV2Order(order=order, signature=signature, neg_risk=neg_risk)


def build_hmac_signature(
    secret: str, timestamp: str, method: str, path: str, body: Optional[str] = None
) -> str:
    """CLOB L2 HMAC signature, built LOCALLY rather than delegating to
    py-clob-client's ``build_hmac_signature``.

    That SDK function does ``str(body).replace("'", '"')`` on the message — a
    hack to normalize a Python dict-repr's single quotes into JSON double quotes
    for other-language parity. Our ``body`` is already the exact JSON string
    that goes over the wire (``json.dumps(..., separators=(",", ":"))`` in
    :meth:`PolymarketClient.place_order`); blindly running ``.replace`` on it
    would corrupt the message — and therefore the signature — if any
    already-JSON-encoded field value ever contained a literal apostrophe.
    Signing the literal payload string, byte for byte, is what the CLOB
    actually verifies.

    Matches ``api-ts/src/services/PolymarketService.ts``'s
    ``buildClobHmacSignature`` (identical message construction, no quote
    rewrite) — both are pinned against the SAME fixture vectors, generated by
    running Polymarket's own ``py_clob_client.signing.hmac.build_hmac_signature``
    (see ``api-ts/src/__tests__/polymarketClobAuth.test.ts``).

    Still base64url-decodes the secret and base64url-encodes the digest WITH
    padding, exactly like the SDK.
    """
    message = str(timestamp) + str(method).upper() + str(path)
    if body:
        message += body
    mac = hmac.new(base64.urlsafe_b64decode(secret), message.encode("utf-8"), hashlib.sha256)
    return base64.urlsafe_b64encode(mac.digest()).decode("utf-8")


def build_l2_headers(
    api_key: str,
    api_secret: str,
    passphrase: str,
    address: str,
    method: str,
    path: str,
    body: Optional[str] = None,
) -> dict:
    """CLOB L2 auth headers. Note L2 headers carry no POLY_NONCE; that is L1-only."""
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

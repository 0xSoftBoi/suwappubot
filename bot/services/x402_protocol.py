"""x402 v2 protocol layer for the Python stack, on the official ``x402`` SDK.

MONEY-PATH. This module decides whether a signed x402 payment is real money.

api-ts speaks x402 v2 on ``@x402/core`` (``X402ResourceService.ts``). This is the
Python counterpart, built on the official ``x402`` PyPI package
(``x402.server.x402ResourceServer`` + ``x402.http.HTTPFacilitatorClient``), so both
stacks share one wire format:

* v2 payloads (``PAYMENT-SIGNATURE`` header: base64 JSON with ``accepted`` +
  ``payload``) and v1 payloads (``X-PAYMENT``: top-level ``scheme``/``network``).
* CAIP-2 network ids (``eip155:8453``) everywhere on the wire, while the rest of
  the Python codebase keeps using short chain names (``base``). Use
  :func:`normalize_network` at every boundary; v1 short names stay readable.

Only the ``exact`` scheme (one EIP-3009 transfer) is settled here.
``batch-settlement`` vouchers are claimed by api-ts's channel manager — they are
cumulative off-chain promises, not a settled transfer, so crediting one from the
Python side would double-count. They are rejected explicitly.

SECURITY invariants (mirror api-ts ``crossCheckSignedRequirements``):

1. Requirements are SERVER-AUTHORITATIVE. They are built from our own expected
   amount/asset/recipient; the client-signed ``accepted`` block is only compared
   against them, never trusted as the source of what to charge.
2. A payment is creditable only after ``settle`` returns success with a
   transaction hash. ``verify`` alone moves no funds.
3. The settlement tx hash and payer are returned so callers can run the same
   replay ledger (``consumed_payments``) and sender-binding checks as the
   tx-hash path.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal, InvalidOperation
from typing import Any, Optional, Union

from bot.config.settings import settings

logger = logging.getLogger(__name__)

EXACT_SCHEME = "exact"
BATCH_SETTLEMENT_SCHEME = "batch-settlement"
EVM_NAMESPACE = "eip155"
_CANONICAL_CAIP2 = re.compile(r"eip155:([1-9][0-9]{0,18})")

# ---------------------------------------------------------------------------
# Network ids: CAIP-2 <-> internal short names
# ---------------------------------------------------------------------------


def _chain_id_index() -> tuple[dict[str, int], dict[int, str]]:
    """(short name -> EVM chain id, chain id -> short name) from bot.config.chains.

    Built lazily so importing this module never pulls the chain registry at boot.
    """
    from bot.config.chains import CHAINS

    by_name: dict[str, int] = {}
    by_id: dict[int, str] = {}
    for name, cfg in CHAINS.items():
        cid = getattr(cfg, "chain_id", None)
        if isinstance(cid, int) and not isinstance(cid, bool):
            by_name[name] = cid
            by_id.setdefault(cid, name)
    return by_name, by_id


def _v1_sdk_aliases() -> dict[str, int]:
    """x402 v1 legacy network names (e.g. ``avalanche-fuji``) -> chain id."""
    try:
        from x402.mechanisms.evm.v1.constants import V1_NETWORK_CHAIN_IDS

        return dict(V1_NETWORK_CHAIN_IDS)
    except Exception:  # pragma: no cover - SDK layout drift must not break verify
        return {}


def normalize_network(value: Optional[str]) -> Optional[str]:
    """Map a CAIP-2 id or a v1 short name to our internal short chain name.

    ``"eip155:8453"`` -> ``"base"``; ``"base"``/``"BASE"`` -> ``"base"``;
    ``"avalanche-fuji"`` (x402 v1 SDK alias) -> its CHAINS name if we support it.
    Returns None for anything we do not support (unknown chain id, non-EVM
    CAIP-2 namespace, garbage) so callers fail closed.
    """
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    by_name, by_id = _chain_id_index()

    if ":" in raw:
        # STRICT canonical form only: exactly "eip155:<chainId>" with no sign,
        # whitespace, underscores or leading zeros. int() alone accepted
        # "eip155:08453", "eip155:+8453", "EIP155:8_453"… — each a distinct
        # replay-ledger key downstream for the SAME chain (double redeem).
        m = _CANONICAL_CAIP2.fullmatch(raw)
        if not m:
            return None
        return by_id.get(int(m.group(1)))

    lowered = raw.lower()
    if lowered in by_name:
        return lowered
    # Non-EVM names in CHAINS (tempo is EVM; solana/tron are not) are not x402 rails.
    alias_id = _v1_sdk_aliases().get(lowered)
    if alias_id is not None:
        return by_id.get(alias_id)
    return None


def to_caip2(chain: Optional[str]) -> Optional[str]:
    """Internal short name (or an existing CAIP-2 id) -> ``eip155:<chainId>``."""
    short = normalize_network(chain)
    if not short:
        return None
    by_name, _ = _chain_id_index()
    cid = by_name.get(short)
    return f"{EVM_NAMESPACE}:{cid}" if cid is not None else None


def to_atomic_amount(amount: Union[str, float, Decimal], decimals: int) -> str:
    """Human token amount -> integer atomic units as a string (rounded UP).

    Rounding up means a sub-unit price can never be under-charged.
    """
    try:
        d = Decimal(str(amount))
    except (InvalidOperation, ValueError) as e:
        raise ValueError(f"Invalid amount: {amount!r}") from e
    if d <= 0:
        raise ValueError(f"Amount must be positive: {amount!r}")
    atomic = (d * (Decimal(10) ** decimals)).to_integral_value(rounding=ROUND_CEILING)
    return str(int(atomic))


# ---------------------------------------------------------------------------
# Payload decoding + requirement building
# ---------------------------------------------------------------------------


def decode_payment_payload(raw: Union[str, bytes, dict[str, Any]]):
    """Decode a ``PAYMENT-SIGNATURE`` / ``X-PAYMENT`` value into an SDK model.

    Accepts the base64 header value, raw JSON text/bytes, or an already-parsed
    dict. Returns ``PaymentPayload`` (v2) or ``PaymentPayloadV1``.
    Raises ValueError on anything malformed.
    """
    from x402.http.utils import decode_payment_signature_header
    from x402.schemas.helpers import parse_payment_payload

    try:
        if isinstance(raw, dict):
            return parse_payment_payload(raw)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        text = raw.strip()
        if not text:
            raise ValueError("empty payment payload")
        if text.startswith("{"):
            data = json.loads(text)
            if not isinstance(data, dict):
                raise ValueError("payment payload must be a JSON object")
            return parse_payment_payload(data)
        return decode_payment_signature_header(text)
    except ValueError:
        raise
    except Exception as e:  # pydantic ValidationError, binascii.Error, ...
        raise ValueError(f"Malformed x402 payment payload: {e}") from e


def payload_version(payload: Any) -> int:
    return int(getattr(payload, "x402_version", 2) or 2)


def payload_scheme(payload: Any) -> str:
    if payload_version(payload) == 1:
        return payload.scheme
    return payload.accepted.scheme


def payload_network(payload: Any) -> str:
    if payload_version(payload) == 1:
        return payload.network
    return payload.accepted.network


def payload_payer(raw_or_payload: Any) -> Optional[str]:
    """The signer (``authorization.from``) of an ``exact`` EVM payload, or None.

    Read BEFORE settlement so callers can reject an unbound payer without
    moving funds first. Covers EIP-3009 (``authorization``) and Permit2
    (``permit2Authorization``) payload shapes.
    """
    try:
        payload = raw_or_payload
        if not hasattr(payload, "x402_version"):
            payload = decode_payment_payload(raw_or_payload)
        inner = payload.payload or {}
        for key in ("authorization", "permit2Authorization"):
            auth = inner.get(key)
            if isinstance(auth, dict) and isinstance(auth.get("from"), str) and auth["from"]:
                return auth["from"]
    except Exception:
        return None
    return None


@dataclass(frozen=True)
class ExpectedPayment:
    """What WE require — the server-authoritative side of the comparison."""

    chain: str  # internal short name, already normalized
    asset: str  # token contract address
    amount_atomic: str  # integer string, smallest unit
    pay_to: str
    eip712_name: Optional[str] = None
    eip712_version: Optional[str] = None
    resource: str = "suwappu://internal/x402"
    description: str = "Suwappu payment"
    max_timeout_seconds: int = 300


def build_requirements(expected: ExpectedPayment, version: int):
    """Build SDK requirements (v2 CAIP-2 or v1 short-name) from our expectation."""
    from x402.schemas import PaymentRequirements
    from x402.schemas.v1 import PaymentRequirementsV1

    extra: dict[str, Any] = {}
    if expected.eip712_name and expected.eip712_version:
        # EIP-3009 domain the facilitator uses to recover the signer. A wrong
        # domain recovers the wrong address and settlement fails closed.
        extra = {"name": expected.eip712_name, "version": expected.eip712_version}

    if version == 1:
        return PaymentRequirementsV1(
            scheme=EXACT_SCHEME,
            network=expected.chain,
            max_amount_required=expected.amount_atomic,
            resource=expected.resource,
            description=expected.description,
            pay_to=expected.pay_to,
            max_timeout_seconds=expected.max_timeout_seconds,
            asset=expected.asset,
            extra=extra or None,
        )

    caip2 = to_caip2(expected.chain)
    if not caip2:
        raise ValueError(f"Chain {expected.chain!r} has no CAIP-2 id")
    return PaymentRequirements(
        scheme=EXACT_SCHEME,
        network=caip2,
        asset=expected.asset,
        amount=expected.amount_atomic,
        pay_to=expected.pay_to,
        max_timeout_seconds=expected.max_timeout_seconds,
        extra=extra,
    )


def cross_check_signed_requirements(payload: Any, expected: ExpectedPayment) -> Optional[str]:
    """Compare the client-signed side against ours. Returns an error or None.

    Mirrors api-ts ``crossCheckSignedRequirements``: a client must not be able to
    pick a cheaper asset, a lower amount, another recipient, or another chain by
    editing ``accepted``. The facilitator also checks the signature against the
    requirements we pass, so this is defense in depth that fails fast with a
    clear reason.
    """
    scheme = payload_scheme(payload)
    if scheme == BATCH_SETTLEMENT_SCHEME:
        return (
            "batch-settlement vouchers are settled by the api-ts channel manager, "
            "not the internal verifier"
        )
    if scheme != EXACT_SCHEME:
        return f"Unsupported x402 scheme {scheme!r}"

    if normalize_network(payload_network(payload)) != expected.chain:
        return (
            f"Network mismatch: expected {to_caip2(expected.chain)}, "
            f"got {payload_network(payload)}"
        )

    if payload_version(payload) == 1:
        # v1 has no signed `accepted` block; the authorization itself is checked
        # by the facilitator against the requirements we build.
        return None

    acc = payload.accepted
    if (acc.asset or "").lower() != expected.asset.lower():
        return f"Asset mismatch: expected {expected.asset}, got {acc.asset}"
    if (acc.pay_to or "").lower() != expected.pay_to.lower():
        return f"Recipient mismatch: expected {expected.pay_to}, got {acc.pay_to}"
    try:
        if int(acc.amount) != int(expected.amount_atomic):
            return f"Amount mismatch: expected {expected.amount_atomic}, got {acc.amount}"
    except (TypeError, ValueError):
        return f"Invalid signed amount: {acc.amount!r}"
    return None


# ---------------------------------------------------------------------------
# Resource server (facilitator-backed verify + settle)
# ---------------------------------------------------------------------------


@dataclass
class SettlementResult:
    success: bool
    error: Optional[str] = None
    payer: Optional[str] = None
    tx_hash: Optional[str] = None
    network: Optional[str] = None  # CAIP-2 (v2) or short name (v1), as settled
    x402_version: int = 2


def _facilitator_config():
    from x402.http import FacilitatorConfig
    from x402.http.facilitator_client_base import CreateHeadersAuthProvider

    url = (getattr(settings, "x402_facilitator_url", None) or "").strip()
    api_key = getattr(settings, "x402_facilitator_api_key", None)
    auth = None
    if api_key:
        token = api_key.get_secret_value() if hasattr(api_key, "get_secret_value") else str(api_key)
        if token:
            hdr = {"Authorization": f"Bearer {token}"}
            auth = CreateHeadersAuthProvider(
                lambda: {"verify": hdr, "settle": hdr, "supported": hdr}
            )
    kwargs: dict[str, Any] = {"auth_provider": auth}
    if url:
        kwargs["url"] = url
    return FacilitatorConfig(**kwargs)


class X402ResourceServerService:
    """Lazy, process-wide ``x402ResourceServer`` for the exact EVM scheme.

    ``initialize()`` fetches the facilitator's ``/supported`` (a blocking HTTP
    call), so it runs in a worker thread on first use and is retried on the next
    call if it failed — an unreachable facilitator must never crash boot.
    """

    def __init__(self) -> None:
        self._server = None
        # Created on first use, not at import, so it binds to the serving loop.
        self._lock: Optional[asyncio.Lock] = None

    def enabled(self) -> bool:
        return bool(getattr(settings, "x402_facilitator_enabled", False))

    async def _get_server(self):
        if self._server is not None:
            return self._server
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            if self._server is not None:
                return self._server
            from x402.http import HTTPFacilitatorClient
            from x402.mechanisms.evm.exact import ExactEvmServerScheme
            from x402.server import x402ResourceServer

            server = x402ResourceServer(HTTPFacilitatorClient(_facilitator_config()))
            # Pattern registration: every EVM chain the facilitator supports. Which
            # chains we actually accept is enforced by ExpectedPayment, not here.
            server.register(f"{EVM_NAMESPACE}:*", ExactEvmServerScheme())
            await asyncio.to_thread(server.initialize)
            self._server = server
            return server

    async def settle_exact(self, raw_payload: Any, expected: ExpectedPayment) -> SettlementResult:
        """Verify then settle a signed ``exact`` payment against ``expected``.

        Never raises for normal failures; returns ``SettlementResult(success=False)``.
        """
        try:
            payload = decode_payment_payload(raw_payload)
        except ValueError as e:
            return SettlementResult(False, error=str(e))

        version = payload_version(payload)
        mismatch = cross_check_signed_requirements(payload, expected)
        if mismatch:
            return SettlementResult(False, error=mismatch, x402_version=version)

        if not self.enabled():
            return SettlementResult(
                False,
                error="x402 facilitator disabled (X402_FACILITATOR_ENABLED=false)",
                x402_version=version,
            )

        try:
            requirements = build_requirements(expected, version)
        except Exception as e:
            return SettlementResult(False, error=f"Bad requirements: {e}", x402_version=version)

        try:
            server = await self._get_server()
        except Exception as e:
            logger.error(f"[x402] facilitator init failed: {e}")
            return SettlementResult(
                False, error=f"Facilitator unavailable: {e}", x402_version=version
            )

        try:
            verified = await server.verify_payment(payload, requirements)
        except Exception as e:
            logger.warning(f"[x402] verify raised: {e}")
            return SettlementResult(False, error=f"Verify failed: {e}", x402_version=version)
        if not verified.is_valid:
            reason = verified.verify.invalid_message or verified.invalid_reason or "invalid"
            return SettlementResult(
                False,
                error=f"Payment invalid: {reason}",
                payer=verified.verify.payer,
                x402_version=version,
            )

        try:
            settled = await server.settle_payment(payload, requirements)
        except Exception as e:
            # The facilitator may have BROADCAST before failing (read timeout,
            # 5xx after submit). Log the authorization so ops can reconcile via
            # the token's authorizationState(signer, nonce).
            auth = (payload.payload or {}).get("authorization") or {}
            logger.error(
                f"[x402] settle raised (funds may have moved — reconcile): {e} "
                f"signer={auth.get('from')} nonce={auth.get('nonce')} "
                f"network={payload_network(payload)} asset={expected.asset}"
            )
            return SettlementResult(
                False,
                error=f"Settlement failed: {e}",
                payer=verified.verify.payer,
                x402_version=version,
            )

        if not settled.success or not settled.transaction:
            reason = settled.error_message or settled.error_reason or "settlement failed"
            return SettlementResult(
                False,
                error=f"Settlement failed: {reason}",
                payer=settled.payer or verified.verify.payer,
                x402_version=version,
            )

        return SettlementResult(
            True,
            payer=settled.payer or verified.verify.payer,
            tx_hash=settled.transaction,
            network=settled.network,
            x402_version=version,
        )


x402_resource_server = X402ResourceServerService()

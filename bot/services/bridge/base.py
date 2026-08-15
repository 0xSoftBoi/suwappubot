"""Shared abstraction for cross-chain bridge providers.

Every bridge provider (NEAR Intents, Allbridge, Symbiosis, Arbitrum native
bridge, and any future addition) implements the `BridgeProvider` ABC defined
here so bot/services/router.py and bot/services/bridge/registry.py can treat
them uniformly instead of duck-typing each one.
"""

import abc
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional, Union


@dataclass
class BridgeQuote:
    """A quote from a bridge provider.

    Amounts (`from_amount`, `to_amount`, `to_amount_min`) are ALWAYS kept as
    raw-unit strings exactly as returned/derived — never float-cast except for
    human-display math done by the caller (matching the existing
    CCTPQuote.to_amount_human convention).
    """

    provider: str
    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_min: str

    gas_cost_usd: float
    fee_cost_usd: float
    estimated_time: int  # seconds

    # Execution details. For settlement="tx" this is the tx to sign/send.
    # For settlement="deposit_address" this is typically empty ({}) and the
    # caller should send funds to `deposit_address` instead.
    transaction_request: Dict[str, Any] = field(default_factory=dict)
    raw_response: Dict[str, Any] = field(default_factory=dict)

    # "tx" = we build+sign a transaction directly (on-chain contract call).
    # "deposit_address" = user sends funds to a generated address; a solver/
    #   relayer fills the order off of that deposit (e.g. NEAR Intents 1-Click).
    # "canonical" = official L1<->L2 bridge contract (e.g. Arbitrum GatewayRouter).
    settlement: str = "tx"
    deposit_address: Optional[str] = None

    # "liquidity" = pooled-liquidity bridge (e.g. Allbridge, Stargate).
    # "canonical" = official rollup bridge, no third-party trust.
    # "solver" = intent/solver-filled (e.g. NEAR Intents, Symbiosis relayers).
    # "attested" = cryptographic attestation (e.g. Suwappu Lattice Bridge's
    #   post-quantum ML-DSA-65 signature chain over the LTP gateway) rather
    #   than pooled-liquidity or solver trust. See docs/pq-settlement-profile.md.
    trust_model: str = "liquidity"

    # Machine-readable settlement-security capability, e.g.
    # "pq-mldsa65-attested" for the Suwappu Lattice Bridge. None for legacy
    # providers that don't report one. Never expose raw PQ keys/signatures
    # here -- this is a capability label only (docs/pq-settlement-profile.md
    # "Route contract").
    settlement_security: Optional[str] = None


class BridgeError(Exception):
    """Base exception for bridge provider errors.

    Matches the existing CCTPError/LayerZeroError convention: carries an
    optional `data` dict with provider-specific error context.
    """

    def __init__(self, message: str, data: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.data = data or {}


class BridgeQuoteError(BridgeError):
    """Raised when a provider fails to produce a quote."""


class BridgeUnsupportedRouteError(BridgeError):
    """Raised when a route is not supported by a provider."""


_EVM_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_SUI_ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
_BASE58_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]+$")

_ZERO_ADDRESSES = {
    "0x0000000000000000000000000000000000000000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000",
    "0x00000000000000000000000000000000000000000000000000000000000000",
}


def validate_address_for_chain(address: Optional[str], chain: str) -> bool:
    """Validate that `address` is a plausible, non-zero address for `chain`'s format.

    This is a FORMAT check only (length/charset/prefix), not a full checksum or
    on-chain existence check. It exists to catch the money-path failure mode of
    silently sending funds to an address encoded for the wrong chain (e.g. an
    EVM address passed as a Tron/Solana/Stellar/Sui destination). Callers MUST
    treat a False return as "do not build/quote this route."
    """
    if not address or not isinstance(address, str):
        return False
    address = address.strip()
    if not address:
        return False

    chain = chain.lower()

    if address.lower() in _ZERO_ADDRESSES:
        return False
    # Any all-zero-after-prefix address, regardless of length, is rejected.
    if re.fullmatch(r"0x0+", address.lower()):
        return False

    if chain == "solana":
        if not (32 <= len(address) <= 44):
            return False
        return bool(_BASE58_RE.fullmatch(address))

    if chain == "tron":
        if not address.startswith("T") or len(address) != 34:
            return False
        return bool(_BASE58_RE.fullmatch(address))

    if chain == "stellar":
        if not address.startswith("G") or len(address) != 56:
            return False
        return bool(re.fullmatch(r"[A-Z2-7]+", address))

    if chain == "sui":
        return bool(_SUI_ADDR_RE.fullmatch(address))

    # Default: EVM-format chains (ethereum, arbitrum, polygon, base, optimism,
    # bsc, avalanche, and any future EVM chain not special-cased above).
    return bool(_EVM_ADDR_RE.fullmatch(address))


def normalize_amount(value: Union[int, str]) -> str:
    """Normalize a raw-unit amount to a plain integer string.

    Accepts only `int` or `str`. Rejects `float` outright — `str(990000.0)`
    corrupts raw-unit strings, and float precision loss above 2**53 silently
    truncates 18-decimal token amounts. Raises `ValueError` on anything that
    isn't a clean non-negative integer (no decimal point, no exponent, no
    float instance), so callers fail closed instead of emitting a corrupted
    amount string into a BridgeQuote.
    """
    if isinstance(value, bool):
        raise ValueError(f"Boolean is not a valid amount: {value!r}")
    if isinstance(value, int):
        if value < 0:
            raise ValueError(f"Negative amount not allowed: {value!r}")
        return str(value)
    if isinstance(value, str):
        stripped = value.strip()
        if "." in stripped or "e" in stripped.lower():
            # Reject fractional/scientific-notation strings up front — Decimal
            # equality is value-based (Decimal("990000.0") == Decimal("990000")
            # is True), so a shape check on the literal string is required to
            # catch a float-shaped raw-unit amount like "990000.0".
            raise ValueError(f"Non-integer raw-unit amount not allowed: {value!r}")
        try:
            dec = Decimal(stripped)
        except InvalidOperation:
            raise ValueError(f"Unparseable amount: {value!r}")
        if dec != dec.to_integral_value():
            raise ValueError(f"Non-integer raw-unit amount not allowed: {value!r}")
        if dec < 0:
            raise ValueError(f"Negative amount not allowed: {value!r}")
        return str(int(dec))
    raise ValueError(f"Amount must be int or str, got {type(value).__name__}: {value!r}")


class BridgeProvider(abc.ABC):
    """Abstract base class every bridge provider must implement."""

    @property
    @abc.abstractmethod
    def name(self) -> str:
        """Short machine-readable provider identifier (e.g. 'near_intents')."""
        raise NotImplementedError

    @property
    @abc.abstractmethod
    def enabled(self) -> bool:
        """Whether this provider is usable right now.

        Must return False when a required API key/setting is absent so the
        registry can skip it without attempting a network call.
        """
        raise NotImplementedError

    @abc.abstractmethod
    def is_supported_route(
        self, from_chain: str, to_chain: str, token: Optional[str] = None
    ) -> bool:
        """Cheap, synchronous check for whether this provider can quote the route."""
        raise NotImplementedError

    @abc.abstractmethod
    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        from_amount: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage_bps: int = 50,
    ) -> Optional[BridgeQuote]:
        """Fetch a quote for the given route, or None if unavailable.

        `slippage_bps` is basis points (1 bps = 0.01%); the historical default
        of 50 bps = 0.5%. Callers must pass `slippage_bps > 0` — providers
        should reject `slippage_bps <= 0` rather than silently treating it as
        "no slippage protection."
        """
        raise NotImplementedError

    @abc.abstractmethod
    async def get_status(self, tracking_id: str) -> Dict[str, Any]:
        """Fetch the status of an in-flight bridge transfer."""
        raise NotImplementedError

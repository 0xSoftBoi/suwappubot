"""Relay (relay.link) cross-chain intents API client.

Relay is a solver/relayer network offering fast (~1-6s), cheap (~1bp at size)
cross-chain swaps and bridges across 60+ chains including every chain we
support plus Solana, Bitcoin, TON, Tron, XRP, and HyperLiquid.

Key facts (measured live, see docs/research/relay/04-live-api-probe.md):
- Base URL https://api.relay.link. `/quote` is deprecated; use `POST /quote/v2`.
- No API key required for quotes. `x-api-key` raises rate limits. Sending
  `referrer` WITHOUT a key 401s (`UNAUTHORIZED_QUOTE`) — only send it together
  with a key. `appFees` works fine unauthenticated.
- ERC-20 flows return an `approve` step then a `deposit` step; native flows are
  a single `deposit` step with `value` set. Execute steps in order.
- Status is polled via `GET /intents/status/v3?requestId=0x...`.
"""

import logging
import time
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field

from bot.config.chains import get_chain_by_name, ChainType
from bot.config.settings import settings
from bot.utils.http_client import get_session
from bot.utils.rate_limiter import api_limiter

logger = logging.getLogger(__name__)

# Relay API
RELAY_API_URL = "https://api.relay.link"

# Relay's Solana chain id (not a standard EVM chain id — Relay-specific).
SOLANA_RELAY_CHAIN_ID = 792703809

# Native token sentinel addresses used by Relay.
EVM_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000"
SOLANA_NATIVE_ADDRESS = "11111111111111111111111111111111"

# Static chain-name -> Relay chain-id fallback for the chains we support today.
# Used until the first successful `refresh_chains()` (or if it ever fails —
# refresh_chains() never raises, so a Relay outage degrades to this map rather
# than breaking quotes). EVM chain ids are numerically identical to our own
# `ChainConfig.chain_id`; Solana is Relay-specific.
RELAY_CHAIN_IDS: Dict[str, int] = {
    "ethereum": 1,
    "bsc": 56,
    "polygon": 137,
    "arbitrum": 42161,
    "optimism": 10,
    "base": 8453,
    "avalanche": 43114,
    "linea": 59144,
    "mantle": 5000,
    "gnosis": 100,
    "scroll": 534352,
    "zksync": 324,
    "solana": SOLANA_RELAY_CHAIN_ID,
}


@dataclass
class RelayStatus:
    """Status of a Relay intent, polled via GET /intents/status."""

    request_id: str
    status: str  # PENDING, FILLED, FAILED, REFUNDED
    tx_hashes: List[str]
    raw: Dict[str, Any]


@dataclass
class RelayQuote:
    """A quote from Relay's POST /quote/v2, with normalized signable steps."""

    request_id: str
    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount: str
    to_amount: str
    to_amount_min: str
    from_amount_human: float
    to_amount_human: float
    gas_cost_usd: float
    relayer_fee_usd: float
    app_fee_usd: float
    total_cost_usd: float
    price_impact_pct: float
    estimated_fill_time: int  # seconds
    # Ordered, normalized txs: {step_id, to, data, value, chainId, gas,
    # maxFeePerGas, maxPriorityFeePerGas, check_endpoint}. Execute in order.
    steps: List[Dict[str, Any]] = field(default_factory=list)
    raw_quote: Dict[str, Any] = field(default_factory=dict)


class RelayError(Exception):
    """Exception for Relay API errors."""

    def __init__(self, message: str, data: Optional[Dict] = None):
        super().__init__(message)
        self.data = data or {}


class RelayAPI:
    """Client for Relay (relay.link) cross-chain intents."""

    def __init__(self):
        self.api_url = RELAY_API_URL
        self._chains_cache: Dict[str, Dict[str, Any]] = {}
        self._chains_cache_ts: float = 0.0
        self._chains_cache_ttl_sec: float = 3600.0

    async def refresh_chains(self) -> None:
        """Refresh chain metadata from GET /chains, cached for 1 hour.

        Never raises — a failed refresh just means callers keep using the last
        good cache (or the static RELAY_CHAIN_IDS fallback), so a Relay outage
        never blocks a quote from any other provider.
        """
        try:
            await api_limiter.wait_and_acquire("relay")
            session = await get_session()
            async with session.get(f"{self.api_url}/chains") as response:
                if response.status != 200:
                    logger.warning(f"Relay /chains returned {response.status}; keeping old cache")
                    self._backoff_chains_refresh()
                    return
                data = await response.json()
            chains = data.get("chains") if isinstance(data, dict) else data
            if not isinstance(chains, list):
                self._backoff_chains_refresh()
                return
            cache = {}
            for c in chains:
                name = c.get("name")
                if name:
                    cache[name.lower()] = c
            self._chains_cache = cache
            self._chains_cache_ts = time.time()
        except Exception as e:  # noqa: BLE001 - must never block a quote
            logger.warning(f"Relay refresh_chains failed (non-fatal): {e}")
            self._backoff_chains_refresh()

    def _backoff_chains_refresh(self, seconds: float = 300.0) -> None:
        """After a failed refresh, do not retry on every quote: that would
        re-fetch ~150 KB and burn a rate-limit token per quote while Relay is
        degraded. Retry after `seconds` instead (shorter than the 1h TTL)."""
        self._chains_cache_ts = time.time() - self._chains_cache_ttl_sec + seconds

    async def _ensure_chains_fresh(self) -> None:
        if time.time() - self._chains_cache_ts > self._chains_cache_ttl_sec:
            await self.refresh_chains()

    def get_chain_id(self, chain: str) -> Optional[int]:
        """Resolve a chain name to its Relay chain id."""
        chain_l = chain.lower()
        cached = self._chains_cache.get(chain_l)
        if cached is not None:
            return cached.get("id")
        if chain_l in RELAY_CHAIN_IDS:
            return RELAY_CHAIN_IDS[chain_l]
        chain_cfg = get_chain_by_name(chain_l)
        if chain_cfg and chain_cfg.chain_type == ChainType.EVM:
            return int(chain_cfg.chain_id)
        return None

    def is_supported_route(self, from_chain: str, to_chain: str) -> bool:
        """Both chains known to Relay and deposit-enabled. Same-chain is allowed
        (Relay does same-chain swaps too) — callers decide whether to route
        same-chain swaps through Relay."""
        from_id = self.get_chain_id(from_chain)
        to_id = self.get_chain_id(to_chain)
        if from_id is None or to_id is None:
            return False

        from_cached = self._chains_cache.get(from_chain.lower())
        if from_cached and (
            from_cached.get("disabled") or not from_cached.get("depositEnabled", True)
        ):
            return False
        to_cached = self._chains_cache.get(to_chain.lower())
        if to_cached and (to_cached.get("disabled") or not to_cached.get("depositEnabled", True)):
            return False
        return True

    @staticmethod
    def _normalize_steps(raw_steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Normalize Relay's `steps[]` to a flat, ordered list of signable txs.

        Fails loudly on malformed steps (mirrors AcrossAPI._normalize_tx) and
        rejects `kind == "signature"` steps rather than silently skipping them
        — we don't have an off-chain signature flow wired up yet.
        """
        steps: List[Dict[str, Any]] = []
        for step in raw_steps or []:
            kind = step.get("kind")
            step_id = step.get("id", "unknown")
            if kind == "signature":
                raise RelayError(f"signature steps not supported (step id={step_id!r})")
            items = step.get("items") or []
            if not items:
                raise RelayError(f"Malformed Relay step (no items): {step}")
            for item in items:
                tx = item.get("data") or {}
                if not tx.get("to") or not tx.get("data"):
                    raise RelayError(f"Malformed transaction in Relay response: {tx}")
                check = item.get("check") or {}
                gas = tx.get("gas")
                try:
                    value = int(tx.get("value", 0) or 0)
                    chain_id = int(tx.get("chainId", 0) or 0)
                    gas_int = int(gas) if gas not in (None, "") else None
                except (TypeError, ValueError) as e:
                    raise RelayError(f"Non-numeric field in Relay step {step_id!r}: {e}")
                if chain_id <= 0:
                    # Never let a missing chainId be "filled in" downstream.
                    raise RelayError(f"Relay step {step_id!r} has no chainId: {tx}")
                if value < 0:
                    raise RelayError(f"Relay step {step_id!r} has negative value: {tx}")
                steps.append(
                    {
                        "step_id": step_id,
                        "to": tx["to"],
                        "data": tx["data"],
                        "value": value,
                        "chainId": chain_id,
                        "gas": gas_int,
                        "maxFeePerGas": tx.get("maxFeePerGas"),
                        "maxPriorityFeePerGas": tx.get("maxPriorityFeePerGas"),
                        "check_endpoint": check.get("endpoint"),
                    }
                )
        return steps

    def _parse_quote(
        self,
        data: Dict[str, Any],
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
    ) -> RelayQuote:
        fees = data.get("fees") or {}
        details = data.get("details") or {}
        currency_in = details.get("currencyIn") or {}
        currency_out = details.get("currencyOut") or {}

        def _usd(fee_key: str) -> float:
            try:
                return float((fees.get(fee_key) or {}).get("amountUsd", 0) or 0)
            except (TypeError, ValueError):
                return 0.0

        gas_cost_usd = _usd("gas")
        relayer_fee_usd = _usd("relayer")
        app_fee_usd = _usd("app")

        try:
            price_impact_pct = float((details.get("totalImpact") or {}).get("percent", 0) or 0)
        except (TypeError, ValueError):
            price_impact_pct = 0.0

        steps = self._normalize_steps(data.get("steps") or [])

        # The guaranteed minimum is a money-path field: require it, never
        # substitute the expected amount for it.
        minimum_amount = currency_out.get("minimumAmount")
        if minimum_amount in (None, ""):
            raise RelayError("Relay quote has no currencyOut.minimumAmount")
        try:
            if int(minimum_amount) <= 0:
                raise RelayError(f"Relay quote minimumAmount must be positive: {minimum_amount}")
        except (TypeError, ValueError):
            raise RelayError(f"Relay quote minimumAmount is not numeric: {minimum_amount!r}")

        return RelayQuote(
            request_id=data.get("requestId", ""),
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=str(currency_in.get("amount", "0")),
            to_amount=str(currency_out.get("amount", "0")),
            to_amount_min=str(minimum_amount),
            from_amount_human=float(currency_in.get("amountFormatted", 0) or 0),
            to_amount_human=float(currency_out.get("amountFormatted", 0) or 0),
            gas_cost_usd=gas_cost_usd,
            relayer_fee_usd=relayer_fee_usd,
            app_fee_usd=app_fee_usd,
            # Relay's currencyOut is ALREADY net of relayer + app fees (verified
            # on the live fixture: 25.0 - 0.02539 - 0.075 = 24.89961). Only the
            # origin gas is an additional cost the user pays; relayer/app fees
            # are display-only so quote ranking does not deduct them twice.
            total_cost_usd=gas_cost_usd,
            price_impact_pct=price_impact_pct,
            estimated_fill_time=int(details.get("timeEstimate", 0) or 0),
            steps=steps,
            raw_quote=data,
        )

    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token_address: str,
        to_token_address: str,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str] = None,
        slippage_bps: Optional[int] = None,
    ) -> RelayQuote:
        """Get a quote from Relay's POST /quote/v2.

        Args:
            from_chain / to_chain: chain names (our config's chain names).
            from_token_address / to_token_address: on-chain token addresses
                (native = 0x000...000 on EVM, 111...111 on Solana).
            amount_raw: input amount in smallest units (string).
            from_address: sender / quoting user address.
            to_address: recipient (defaults to sender).
            slippage_bps: optional slippage tolerance in bps.
        """
        await self._ensure_chains_fresh()

        from_chain_id = self.get_chain_id(from_chain)
        to_chain_id = self.get_chain_id(to_chain)
        if from_chain_id is None or to_chain_id is None:
            raise RelayError(f"Relay does not support route {from_chain} -> {to_chain}")

        recipient = to_address or from_address

        body: Dict[str, Any] = {
            "user": from_address,
            "originChainId": from_chain_id,
            "destinationChainId": to_chain_id,
            "originCurrency": from_token_address,
            "destinationCurrency": to_token_address,
            "amount": str(amount_raw),
            "tradeType": "EXACT_INPUT",
            "recipient": recipient,
        }
        if slippage_bps is not None:
            body["slippageTolerance"] = str(int(slippage_bps))

        headers: Dict[str, str] = {}
        api_key = settings.relay_api_key
        if api_key:
            headers["x-api-key"] = api_key
            # Only send `referrer` together with a key — Relay 401s
            # (UNAUTHORIZED_QUOTE) on `referrer` without a key.
            body["referrer"] = "suwappu"

        app_fee_recipient = settings.relay_app_fee_recipient
        app_fee_bps = settings.relay_app_fee_bps or 0
        if app_fee_recipient and app_fee_bps > 0:
            body["appFees"] = [{"recipient": app_fee_recipient, "fee": str(int(app_fee_bps))}]

        await api_limiter.wait_and_acquire("relay")
        session = await get_session()

        async with session.post(f"{self.api_url}/quote/v2", json=body, headers=headers) as response:
            if response.status != 200:
                error_text = await response.text()
                raise RelayError(f"Relay quote error ({response.status}): {error_text}")
            data = await response.json()

        return self._parse_quote(data, from_chain, to_chain, from_token_address, to_token_address)

    # Statuses that mean "still in flight" on /intents/status/v3 — everything
    # not explicitly success/failure/refund maps to PENDING too (treat unknown
    # as pending, per the live probe).
    _PENDING_STATUSES = {"waiting", "depositing", "pending", "submitted", "delayed"}

    async def get_status(self, request_id: str) -> RelayStatus:
        """Poll GET /intents/status/v3?requestId=... for an intent's fill status.

        429 (keyless quotes are capped at 50 req/min) is surfaced as a
        RelayError rather than retried — callers (the tx poller) already
        re-poll on their own schedule, so retrying here would just add a
        second, uncoordinated retry loop on top of that.
        """
        await api_limiter.wait_and_acquire("relay")
        session = await get_session()

        async with session.get(
            f"{self.api_url}/intents/status/v3", params={"requestId": request_id}
        ) as response:
            if response.status == 429:
                raise RelayError("Relay status rate-limited (429)")
            if response.status != 200:
                return RelayStatus(request_id=request_id, status="PENDING", tx_hashes=[], raw={})
            data = await response.json()

        raw_status = str(data.get("status") or "unknown").lower()
        if raw_status == "success":
            status = "FILLED"
        elif raw_status == "failure":
            status = "FAILED"
        elif raw_status == "refund":
            status = "REFUNDED"
        else:
            # Covers waiting/depositing/pending/submitted/delayed/unknown/anything new.
            status = "PENDING"

        tx_hashes = data.get("txHashes") or data.get("inTxHashes") or []
        return RelayStatus(request_id=request_id, status=status, tx_hashes=tx_hashes, raw=data)


# Global instance
relay_api = RelayAPI()

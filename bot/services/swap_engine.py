"""Swap engine with multi-aggregator best-quote comparison.

Eligible providers are raced in parallel — the best output amount wins.

Providers:
- Jupiter + Jito: Solana swaps with MEV protection
- SunSwap V2: TRON on-chain DEX
- OKX DEX: Multi-chain aggregator (TRON, EVM, Solana) — 400+ DEXes
- 0x Cross-Chain: Bridge + destination swap into Robinhood Chain
- Li.Fi: Cross-chain & EVM aggregator
- LayerZero/Stargate: Same-token cross-chain bridges
- CoW Protocol: MEV-protected EVM batch auctions
- Socket: Super-aggregated cross-chain routing
- Circle CCTP: Native USDC bridging
- Across Protocol: Fast EVM bridges
- Wormhole: Solana <-> EVM bridging
- Chainlink CCIP: Cross-chain messaging
"""

import asyncio
import json
import logging
from typing import Optional, List
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from web3 import Web3
import aiohttp
import base64

from bot.config.settings import settings
from bot.services.rpc_manager import rpc_manager
from bot.services.spending_limits import spending_limit_service
from bot.services.compliance import compliance_service, flashbots_relay
from bot.utils.cache import quote_cache
from bot.utils.performance import track_time, MetricNames
from bot.config.chains import ChainType, apply_min_gas_price, get_chain_by_name
from bot.config.tokens import get_token_address, get_token_decimals, NATIVE_TOKEN_ADDRESS
from bot.services.lifi_api import LiFiAPI
from bot.services.jupiter_api import JupiterAPI
from bot.services.layerzero_api import LayerZeroAPI
from bot.services.ccip_api import ChainlinkCCIPAPI
from bot.services.cctp_api import CircleCCTPAPI
from bot.services.bridge.usdt0_api import usdt0_api
from bot.services.across_api import AcrossAPI
from bot.services.wormhole_api import WormholeAPI
from bot.services.cow_api import cow_api
from bot.services.socket_api import socket_api, SocketError
from bot.services.jito_api import jito_api, TipPriority
from bot.services.sunswap_api import SunSwapAPI
from bot.services.tempo_dex_api import tempo_dex_api
from bot.services.tempo_fee_sponsor import tempo_fee_sponsor
from bot.services.okx_dex_api import OKXDEXAPI, OKX_CHAIN_IDS
from bot.services.oneinch_api import (
    OneInchAPI,
    ONEINCH_CHAIN_IDS,
    ONEINCH_NATIVE_TOKEN,
)
from bot.services.zerox_api import ZeroXAPI, ZEROX_CHAIN_IDS, ZEROX_NATIVE_TOKEN
from bot.services.kyberswap_api import (
    KyberSwapAPI,
    KYBERSWAP_CHAIN_SLUGS,
    KYBERSWAP_NATIVE_TOKEN,
)
from bot.services.propamm_api import PropAMMAPI, PropAMMError, PROPAMM_NATIVE_TOKEN
from bot.utils.http_client import get_session as get_http_session
from bot.services.token_security.simulation import simulation_service
from bot.services.x402_service import x402_service
from bot.services.wallet import WalletService
from bot.models.subscription import SubscriptionTier
from bot.models.user import Wallet
from bot.models.swap import SwapTransaction, SwapStatus
from bot.utils.quote_validator import quote_validator
from bot.utils.exceptions import SwapError
from bot.services.event_bus import event_bus
from database.db import get_session, run_in_db

logger = logging.getLogger(__name__)

# Providers that execute_swap can actually execute. This must stay in sync with
# the dispatch chain in execute_swap -- one entry per `elif quote.provider ==`
# branch. It is an allowlist rather than a denylist on purpose: `quote.provider`
# arrives from the caller on the internal/webapp execute paths, and the dispatch
# previously ended in `else: _execute_lifi_swap`, so any unknown value was
# quietly executed by the Li.Fi executor against a foreign quote.
#
# Deliberately ABSENT: near_intents, allbridge, symbiosis, arbitrum_native.
# Those are quote-only today -- bot/services/bridge/registry.py can surface them
# for route comparison, but none has an executor here, so they must fail loudly
# rather than be mis-executed. Add a name here only together with a real
# `_execute_<provider>_swap` branch below.
#
# usdt0 IS executable (_execute_usdt0_swap), but note it stays unreachable in
# practice until USDT0_BRIDGE_ENABLED is flipped: _is_usdt0_route gates on the
# provider's own `enabled` flag, so no usdt0 quote is produced while it is off.
EXECUTABLE_PROVIDERS = frozenset(
    {
        "usdt0",
        "tempo_dex",
        "cow",
        "socket",
        "jito",
        "jupiter",
        "ccip",
        "layerzero",
        "cctp",
        "across",
        "wormhole",
        "sunswap",
        "okx_dex",
        "1inch",
        "0x",
        "0x_crosschain",
        "kyberswap",
        "propamm_titan",
        "avnu",
        "goatswap",
        "juiceswap",
        "lifi",
    }
)

# Try to import C++ core for performance
try:
    import suwappu_core

    USE_CPP_CORE = True
    logger.info("Using C++ core for high-performance math operations")
except ImportError:
    USE_CPP_CORE = False
    logger.info("C++ core not available, using Python fallback")


# Max ERC-20 approval value (2**256 - 1). Used when approval_mode == "unlimited".
MAX_UINT256 = 2**256 - 1

# Tokens whose `approve()` reverts when changing a NON-zero allowance directly to
# another non-zero value (the classic USDT mainnet pattern: require allowance to be
# reset to 0 first). In "exact" approval mode we may re-approve from a leftover
# non-zero allowance, so for these tokens we must send a 0-approval first. Keys are
# lowercased token contract addresses. In "unlimited" mode the first approval is
# from a (near-)zero allowance to max-uint, so this never triggers.
RESET_REQUIRED_TOKENS = {
    "0xdac17f958d2ee523a2206206994597c13d831ec7",  # USDT (Ethereum mainnet)
}

# Hardcoded gas limits for PropAMMRouter swaps — estimation is only a
# pre-flight check because the executed branch can be heavier than the
# estimated one (in-tx re-quote + possible Uniswap V3 fallback). Tiers are
# set from measured mainnet usage of the router (150 recent txs, 2026-08-15):
#   swapV1 (all venues):        p50 441k / p90 619k / max 690k -> 900k limit
#   swapViaVenue(WithFee)V1:    p50 216k / p90 271k / max 396k -> 550k limit
PROPAMM_SWAP_GAS_LIMIT = 900_000
PROPAMM_PINNED_SWAP_GAS_LIMIT = 550_000
# Expected (p50) usage of the pinned-venue path we execute by default — used
# for the quote's USD gas figure so the race compares expected cost, matching
# the semantics of KyberSwap/0x's gasUsd (estimated usage, not the limit).
PROPAMM_EXPECTED_SWAP_GAS = 250_000

# Minimal inline ABI for the Titan Builder PropAMMRouter proxy (verified
# on-chain — see bot/services/propamm_api.py module docstring). No calldata
# comes back from the quote RPC, so execution builds it directly against
# this ABI rather than re-fetching a build/route call like KyberSwap does.
PROPAMM_ROUTER_ABI = [
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountIn", "type": "uint256"},
            {"name": "amountOutMin", "type": "uint256"},
            {"name": "recipient", "type": "address"},
            {"name": "deadline", "type": "uint256"},
        ],
        "name": "swapV1",
        "outputs": [
            {"name": "amountOut", "type": "uint256"},
            {"name": "executedVenue", "type": "address"},
        ],
        "type": "function",
        "stateMutability": "payable",
    },
    {
        "inputs": [
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountIn", "type": "uint256"},
            {"name": "amountOutMin", "type": "uint256"},
            {"name": "recipient", "type": "address"},
            {"name": "deadline", "type": "uint256"},
            {
                "name": "fee",
                "type": "tuple",
                "components": [
                    {"name": "bps", "type": "uint16"},
                    {"name": "recipient", "type": "address"},
                ],
            },
        ],
        "name": "swapWithFeeV1",
        "outputs": [
            {"name": "amountOut", "type": "uint256"},
            {"name": "executedVenue", "type": "address"},
        ],
        "type": "function",
        "stateMutability": "payable",
    },
    {
        "inputs": [
            {"name": "venue", "type": "address"},
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountIn", "type": "uint256"},
            {"name": "amountOutMin", "type": "uint256"},
            {"name": "recipient", "type": "address"},
            {"name": "deadline", "type": "uint256"},
        ],
        "name": "swapViaVenueV1",
        "outputs": [
            {"name": "amountOut", "type": "uint256"},
            {"name": "executedVenue", "type": "address"},
        ],
        "type": "function",
        "stateMutability": "payable",
    },
    {
        "inputs": [
            {"name": "venue", "type": "address"},
            {"name": "tokenIn", "type": "address"},
            {"name": "tokenOut", "type": "address"},
            {"name": "amountIn", "type": "uint256"},
            {"name": "amountOutMin", "type": "uint256"},
            {"name": "recipient", "type": "address"},
            {"name": "deadline", "type": "uint256"},
            {
                "name": "fee",
                "type": "tuple",
                "components": [
                    {"name": "bps", "type": "uint16"},
                    {"name": "recipient", "type": "address"},
                ],
            },
        ],
        "name": "swapViaVenueWithFeeV1",
        "outputs": [{"name": "amountOut", "type": "uint256"}],
        "type": "function",
        "stateMutability": "payable",
    },
]


@dataclass
class SwapQuote:
    """Unified swap quote from any provider."""

    provider: str  # "cow", "socket", "jito", "lifi", "jupiter", "layerzero", "ccip", etc.
    from_chain: str
    to_chain: str
    from_token: str
    to_token: str
    from_amount: str
    from_amount_human: float
    to_amount: str
    to_amount_human: float
    to_amount_min: str
    gas_cost_usd: float
    fee_cost_usd: float
    total_cost_usd: float
    estimated_time: int  # seconds
    price_impact: float
    exchange_rate: float
    raw_quote: dict  # Original quote data for execution
    timestamp: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )  # When quote was created
    expires_in: int = 30  # Quote expires in seconds
    # Platform fee (bps) applied to this quote, so the execution call can
    # re-send the SAME fee param and actually collect it (quote/exec must agree).
    platform_fee_bps: Optional[int] = None
    # Whether gas_cost_usd is a REAL figure from the provider (Li.Fi's
    # gasCosts[].amountUSD, KyberSwap's routeSummary.gasUsd, CoW's genuine
    # $0 — it's gasless) rather than the "1 gwei * $2000 ETH" display
    # heuristic several adapters use as a rough UI estimate (OKX/1inch/0x —
    # and it's missing cheap-L2s like arbitrum/base/optimism from the
    # "cheap chain" discount list, so it can be wildly wrong there). Net-of-
    # gas ranking in `_rank_quotes` only ever nets gas when EVERY raced
    # quote's figure is trusted; a single untrusted (or "0.0 = unknown")
    # quote falls the WHOLE race back to gross-output ranking, since an
    # untrusted 0.0 would otherwise look like free gas and win unfairly.
    gas_cost_trusted: bool = False
    # Whether estimated_time is a REAL provider-reported figure (Li.Fi's
    # estimate.executionDuration, Across's estimatedFillTimeSec, Socket's
    # serviceTime) rather than a hardcoded constant several bridge adapters
    # use as a placeholder (CCTP 120s/20s, CCIP 900s, LayerZero 120s, USDT0
    # 120s, CoW 60s, wormhole 300s — none of these reflect real network
    # conditions). `_apply_speed_tiebreak` only compares estimated_time
    # between quotes when BOTH sides are time_trusted — otherwise a
    # hardcoded number could win or lose a tiebreak on pure coincidence.
    time_trusted: bool = False
    # Execution-savings receipt (see `_select_runner_up` / `_compute_price_improvement_usd`).
    # Populated once, at race resolution, on the WINNING quote only.
    # `runner_up_provider` is the provider of the second-ranked quote in the
    # same race (None when only one quote raced). `price_improvement_usd` is
    # the USD value of (winner.to_amount_human - runner_up.to_amount_human)
    # for the same to_token, clamped to >=0 — a net-of-gas ranking can pick a
    # lower-gross winner, and that's never shown as a negative "savings".
    runner_up_provider: Optional[str] = None
    price_improvement_usd: Optional[float] = None


@dataclass
class _QuoteFlight:
    """One provider race shared by callers asking for the exact same quote."""

    task: asyncio.Task
    waiters: int = 0


# ---------------------------------------------------------------------------
# Quote ranking helpers (pure, synchronous, no network) — kept module-level
# so they're trivially unit-testable without spinning up SwapEngine or a live
# quote race. Used by SwapEngine.get_quote() at the top of the file.
# ---------------------------------------------------------------------------

# Nested USD-value keys different aggregator raw responses use for the
# destination amount. Checked one level deep too (e.g. raw_quote["okx_quote"]).
_OUTPUT_USD_KEYS = ("toAmountUSD", "amountOutUsd", "outputUsd", "to_amount_usd")


def _extract_output_usd_price(quote: "SwapQuote") -> Optional[float]:
    """Best-effort implied USD price of `quote`'s output token.

    Derived entirely from the provider's own raw response — never a network
    call — so quote ranking stays synchronous. Returns None when no USD
    figure can be found (caller must fall back to gross-amount ranking).
    """
    if not quote.to_amount_human or quote.to_amount_human <= 0:
        return None
    raw = quote.raw_quote
    if not isinstance(raw, dict):
        return None

    usd_value = None
    if quote.provider == "lifi":
        usd_value = (raw.get("estimate") or {}).get("toAmountUSD")
    elif quote.provider == "kyberswap":
        usd_value = (raw.get("kyberswap_quote") or {}).get("routeSummary", {}).get("amountOutUsd")
    else:
        # Generic scan: top level, then one level into any nested dict
        # (several adapters wrap the provider's raw response under a
        # "<provider>_quote" key, e.g. raw_quote["okx_quote"]).
        for key in _OUTPUT_USD_KEYS:
            if key in raw:
                usd_value = raw[key]
                break
        if usd_value is None:
            for nested in raw.values():
                if isinstance(nested, dict):
                    for key in _OUTPUT_USD_KEYS:
                        if key in nested:
                            usd_value = nested[key]
                            break
                if usd_value is not None:
                    break

    if usd_value is None:
        return None
    try:
        usd_value = float(usd_value)
    except (TypeError, ValueError):
        return None
    if usd_value <= 0:
        return None
    return usd_value / quote.to_amount_human


def _quote_net_score(quote: "SwapQuote", out_price: Optional[float]) -> float:
    """Net-of-gas score for ranking. Falls back to gross to_amount_human
    when no USD price for the output token is available."""
    if not out_price:
        return quote.to_amount_human
    gas = quote.gas_cost_usd or 0.0
    return quote.to_amount_human - (gas / out_price)


def _derive_median_output_price(quotes: List["SwapQuote"]) -> Optional[float]:
    """Median implied output-token USD price across every quote that exposes
    one — not just the first (`asyncio.wait` returns a *set*, so "first" is
    non-deterministic and a single bogus-but-positive provider USD field
    could otherwise unilaterally flip the winner).

    Quotes are visited in provider-name order for determinism, though the
    result itself is order-independent (it's a median of the collected
    values). Outliers more than 2x above or below the raw median are
    discarded before taking the final median, so one adapter's bad USD
    figure can't drag the whole race's price estimate off a cliff.

    A price derived from a SINGLE source is never trusted (returns None) —
    with only one data point there's nothing to median against or discard
    as an outlier, so one adapter's figure (honest or not) could otherwise
    single-handedly decide the race.
    """
    candidates = []
    for q in sorted(quotes, key=lambda q: q.provider):
        try:
            price = _extract_output_usd_price(q)
        except Exception:
            price = None
        if price:
            candidates.append(price)

    if len(candidates) < 2:
        return None

    def _median(values: List[float]) -> float:
        values = sorted(values)
        n = len(values)
        mid = n // 2
        return values[mid] if n % 2 else (values[mid - 1] + values[mid]) / 2

    raw_median = _median(candidates)
    if raw_median <= 0:
        return None

    filtered = [p for p in candidates if 0.5 * raw_median <= p <= 2.0 * raw_median]
    if not filtered:
        return None
    return _median(filtered)


def _extract_input_usd_value(quote: "SwapQuote") -> Optional[float]:
    """Best-effort REAL USD value of `quote`'s INPUT (from_amount_human),
    read directly from the provider's raw response — never a network call.
    Currently only Li.Fi's estimate exposes this (`fromAmountUSD`)."""
    raw = quote.raw_quote
    if not isinstance(raw, dict):
        return None
    if quote.provider == "lifi":
        val = (raw.get("estimate") or {}).get("fromAmountUSD")
        if val is None:
            return None
        try:
            v = float(val)
        except (TypeError, ValueError):
            return None
        return v if v > 0 else None
    return None


def _oracle_input_usd_value(
    quotes: List["SwapQuote"], input_price_usd: Optional[float] = None
) -> Optional[float]:
    """`input_price_usd` (typically the price service's cached quote for
    from_token — INDEPENDENT of anything any raced provider reported) x the
    shared input amount every quote in the race was given. None when the
    caller didn't supply a price."""
    if not quotes or not input_price_usd or input_price_usd <= 0:
        return None
    from_amount_human = quotes[0].from_amount_human
    if not from_amount_human or from_amount_human <= 0:
        return None
    return input_price_usd * from_amount_human


def _provider_input_usd_value(quotes: List["SwapQuote"]) -> Optional[float]:
    """First provider-reported input USD value found in the race (currently
    only Li.Fi's fromAmountUSD). NOT independent — a provider validating its
    own output price against its own reported input value proves nothing —
    so this must only ever be used as a last resort when no oracle price
    exists (see `_derive_input_usd_value`)."""
    for q in quotes:
        v = _extract_input_usd_value(q)
        if v:
            return v
    return None


def _derive_input_usd_value(
    quotes: List["SwapQuote"], input_price_usd: Optional[float] = None
) -> Optional[float]:
    """Real USD value of the swap's INPUT amount — shared across the whole
    race, since every raced quote was given the SAME user-specified
    from_amount_human. INDEPENDENT oracle only (`input_price_usd` x the
    shared input amount) — a provider-self-reported figure (Li.Fi's
    fromAmountUSD) is deliberately NOT used as a fallback: two providers
    reporting coherently-wrong USD figures would then pass the output
    cross-check on their own numbers. With no oracle this returns None and
    ranking takes the strict 5%-gas-clamp branch instead, which rejects
    that case outright. The provider figure is still consulted by
    `_input_usd_sources_disagree` as a red flag when both exist.
    """
    return _oracle_input_usd_value(quotes, input_price_usd)


def _input_usd_sources_disagree(
    quotes: List["SwapQuote"], input_price_usd: Optional[float] = None
) -> bool:
    """True when an INDEPENDENT oracle price and a provider-self-reported
    input USD value both exist for this race but disagree by more than
    25%. A provider's own fromAmountUSD "validating" its own toAmountUSD
    isn't independent verification (see `_provider_input_usd_value`) — but
    when we ALSO have an independent oracle and it disagrees with what the
    provider claims, that's real signal the provider figure (and therefore
    anything derived from trusting it) shouldn't be relied on this race.
    """
    oracle = _oracle_input_usd_value(quotes, input_price_usd)
    provider = _provider_input_usd_value(quotes)
    if oracle is None or provider is None:
        return False
    if oracle <= 0:
        return False
    return abs(oracle - provider) / oracle > 0.25


def _rank_quotes(quotes: List["SwapQuote"], input_price_usd: Optional[float] = None) -> "SwapQuote":
    """Pick the best quote. See `_rank_quotes_with_price` for the full
    net-of-gas ranking logic and its gross-ranking fallback conditions."""
    best, _out_price = _rank_quotes_with_price(quotes, input_price_usd)
    return best


def _rank_quotes_with_price(
    quotes: List["SwapQuote"],
    input_price_usd: Optional[float] = None,
) -> tuple["SwapQuote", Optional[float]]:
    """Pick the best quote by net-of-gas value, and return the USD price (if
    any) actually used to net it — so callers (telemetry) can report the
    exact same figure the ranking decision was made with.

    Net-of-gas ranking only applies when ALL of the following hold, and
    falls back to gross to_amount_human ranking (returning out_price=None)
    the instant any of them doesn't — this can never raise, so it can't
    crash the money path:
      1. Every raced quote's `gas_cost_trusted` is True (a single untrusted
         heuristic-gas quote — or a genuine-but-unlabeled 0.0 "unknown" —
         would otherwise look artificially cheap and win unfairly).
      2. A median USD price for the output token can be derived across the
         race (see `_derive_median_output_price`).
      3. An INDEPENDENT oracle input price and a provider-self-reported one
         don't disagree by more than 25% (see `_input_usd_sources_disagree`
         — a provider "validating" its own output price against its own
         reported input value isn't independent verification at all, so
         this only fires when we have a real, separate oracle to check it
         against).
      4. No quote's trusted gas is UNBOUNDED/absurd relative to the trade:
         gas_cost_usd must not exceed 50% of the swap's known input USD
         value (or, lacking that, 50% of that quote's own implied output
         USD) — protects against e.g. a corrupted eth_gasPrice read
         producing a huge-but-"trusted" dollar figure that would otherwise
         steer ranking on a bogus number.
      5. A price SANITY CROSS-CHECK passes: the implied output USD value
         (to_amount_human * out_price) for every quote is within ~25% of
         the swap's known input USD value (see `_derive_input_usd_value` —
         prefers the independent oracle, provider-reported figure only as
         a last resort). This validates out_price directly against a real
         number instead of proxying via a gas-fraction clamp, which used to
         reject perfectly legitimate gas-heavy trades (e.g. a small swap on
         an expensive chain, where gas can honestly be >5% of output)
         purely because the deduction looked "too big" — not because the
         price was actually wrong. When no input-side USD figure is
         available at all, falls back to the coarser "gas eats <=5% of
         output" clamp as a guard of last resort.

    Wormhole returns an optimistic 1:1 placeholder quote (no real fee
    netting), so it's excluded from the race unless it's the only quote
    available. (CCTP's 1:1 is genuine — native USDC, zero fee — so it stays.)
    """
    ranked = [q for q in quotes if q.provider != "wormhole"] or quotes
    if len(ranked) == 1:
        return ranked[0], None

    if not all(q.gas_cost_trusted for q in ranked):
        return max(ranked, key=lambda q: q.to_amount_human), None

    out_price = _derive_median_output_price(ranked)
    if out_price is None:
        return max(ranked, key=lambda q: q.to_amount_human), None

    if _input_usd_sources_disagree(ranked, input_price_usd):
        return max(ranked, key=lambda q: q.to_amount_human), None

    input_usd = _derive_input_usd_value(ranked, input_price_usd)

    # Absurd/unbounded trusted-gas guard — independent of the price
    # cross-check below, since a wildly wrong gas figure is a red flag on
    # its own regardless of whether out_price itself later checks out.
    for q in ranked:
        gas = q.gas_cost_usd or 0.0
        if gas <= 0:
            continue
        trade_value = input_usd if input_usd is not None else (q.to_amount_human * out_price)
        if trade_value and trade_value > 0 and gas > 0.5 * trade_value:
            return max(ranked, key=lambda q: q.to_amount_human), None

    if input_usd is not None:
        for q in ranked:
            implied_output_usd = q.to_amount_human * out_price
            if implied_output_usd <= 0:
                return max(ranked, key=lambda q: q.to_amount_human), None
            deviation = abs(implied_output_usd - input_usd) / input_usd
            if deviation > 0.25:
                return max(ranked, key=lambda q: q.to_amount_human), None
    else:
        # No input-side USD figure at all — fall back to the coarser clamp.
        for q in ranked:
            gas = q.gas_cost_usd or 0.0
            if q.to_amount_human > 0 and (gas / out_price) > 0.05 * q.to_amount_human:
                return max(ranked, key=lambda q: q.to_amount_human), None

    return max(ranked, key=lambda q: _quote_net_score(q, out_price)), out_price


def _apply_speed_tiebreak(
    quotes: List["SwapQuote"],
    best: "SwapQuote",
    out_price: Optional[float],
    from_chain: str,
    to_chain: str,
) -> tuple["SwapQuote", Optional[dict]]:
    """Cross-chain-only speed tiebreaker.

    A bridge quote that's within 10bps of the winner's (net-of-gas, or
    gross when no price was derivable — same basis `_rank_quotes_with_price`
    picked `best` on) score AND completes in under HALF the winner's
    estimated_time is, in practice, the better choice for the user — a
    near-equal-value route that lands in half the time beats a marginal
    value edge on a cross-chain bridge, where wait times run minutes.

    Never applies same-chain (from_chain == to_chain): same-chain fills are
    seconds either way, so speed differences there are noise, not signal.
    Never resurrects wormhole: its optimistic 1:1 quote + hardcoded 300s
    estimate are excluded from consideration exactly like
    `_rank_quotes_with_price` excludes them from selection (unless wormhole
    is the ONLY quote in the race, in which case there's nothing to
    tiebreak against anyway).

    Requires `time_trusted` on BOTH the winner and the candidate: several
    adapters (CCTP, CCIP, LayerZero, USDT0, CoW) hardcode estimated_time
    rather than reporting a real one — trusting those would let a
    hardcoded 20s CCTP estimate "beat" a genuinely-fast provider, or a
    hardcoded 900s CCIP estimate look artificially slow. Only Li.Fi
    (executionDuration), Across (estimatedFillTimeSec), and Socket
    (serviceTime) are provider-reported.

    Deterministic: among multiple qualifying candidates, the fastest wins;
    ties broken by provider name (asyncio.wait() returns a set, so quote
    order isn't stable across runs).

    Pure + synchronous — no network, no `self` — so it's unit-testable in
    isolation and can never affect anything but which SwapQuote is returned.

    Returns (winner, tiebreak_info). `tiebreak_info` is None when the
    tiebreaker didn't change the winner, or a dict (for telemetry) when it
    did: {from_provider, from_estimated_time, to_provider, to_estimated_time,
    delta_bps}.
    """
    if from_chain.lower() == to_chain.lower():
        return best, None

    ranked = [q for q in quotes if q.provider != "wormhole"] or quotes
    if len(ranked) <= 1:
        return best, None

    # winner_score can legitimately be negative (a quote whose gas exceeds
    # its own output nets negative) — `not winner_score` only catches
    # exactly 0, so a negative score fell through and then FLIPPED THE
    # COMPARISON DIRECTION below (dividing by a negative number inverts
    # which side of the inequality is "better"), letting a strictly WORSE
    # quote pass the "within 10bps" gate. Bail out on any non-positive
    # score instead — there's no sane bps comparison to make against it.
    winner_score = _quote_net_score(best, out_price)
    if winner_score <= 0:
        return best, None

    if not getattr(best, "time_trusted", False):
        return best, None

    candidates = []
    for q in ranked:
        if q is best or q.provider == best.provider:
            continue
        if not getattr(q, "time_trusted", False):
            continue
        if q.estimated_time is None or q.estimated_time >= (best.estimated_time / 2):
            continue
        score = _quote_net_score(q, out_price)
        # Directional by construction: `diff` must be non-negative (the
        # candidate can't score BETTER than the winner `_rank_quotes_with_price`
        # already picked as the max) and within 10bps (0.001) of winner_score.
        # Computing delta_bps via a plain (winner-score)/winner_score ratio
        # without this explicit bound was the sign-inversion bug above.
        diff = winner_score - score
        if 0 <= diff <= 0.001 * winner_score:
            delta_bps = (diff / winner_score) * 10_000
            candidates.append((q, delta_bps))

    if not candidates:
        return best, None

    candidates.sort(key=lambda pair: (pair[0].estimated_time, pair[0].provider))
    fastest, delta_bps = candidates[0]

    tiebreak_info = {
        "from_provider": best.provider,
        "from_estimated_time": best.estimated_time,
        "to_provider": fastest.provider,
        "to_estimated_time": fastest.estimated_time,
        "delta_bps": round(delta_bps, 2),
    }
    return fastest, tiebreak_info


def _select_runner_up(
    quotes: List["SwapQuote"],
    best: "SwapQuote",
    out_price_used: Optional[float],
) -> Optional["SwapQuote"]:
    """Pick the second-ranked quote from the same race `best` was chosen from.

    Mirrors `_rank_quotes_with_price`'s own selection basis rather than
    re-deriving it: net-of-gas score (`_quote_net_score`) when ranking used
    one (`out_price_used` is not None), gross `to_amount_human` otherwise —
    so "runner-up" always means "second by the exact criterion that decided
    the race", never a different metric.

    Returns None when there's nothing to compare against: an empty/singleton
    race, or every other quote sharing the winner's provider name (can't
    happen in a real race, but keeps this total rather than raising).

    Pure + synchronous — no network, no `self` — unit-testable in isolation,
    same as `_apply_speed_tiebreak`.
    """
    ranked = [q for q in quotes if q.provider != "wormhole"] or quotes
    others = [q for q in ranked if q.provider != best.provider]
    if not others:
        return None
    if out_price_used is not None:
        return max(others, key=lambda q: _quote_net_score(q, out_price_used))
    return max(others, key=lambda q: q.to_amount_human)


async def _compute_price_improvement_usd(
    winner: "SwapQuote", runner_up: Optional["SwapQuote"]
) -> float:
    """USD value of the winner's edge over the runner-up, for telemetry.

    Values (winner.to_amount_human - runner_up.to_amount_human) — both
    quotes are for the same to_token, since they raced the same swap — using
    a stablecoin's 1:1 par when to_token is one (exact, no price lookup) and
    `price_service` otherwise, matching the pattern `_estimate_swap_usd` uses
    elsewhere in this module.

    Returns 0.0 (never negative) when: there's no runner-up, the delta is
    <=0 (net-of-gas ranking can legitimately pick a lower-GROSS winner — that
    is not a savings and must never render as one), or no USD price for
    to_token can be found. Never raises — this is telemetry, not the money
    path, and a pricing hiccup here must not touch swap execution.
    """
    if runner_up is None:
        return 0.0

    delta_human = winner.to_amount_human - runner_up.to_amount_human
    if delta_human <= 0:
        return 0.0

    try:
        from bot.config.tokens import get_token_by_symbol

        cfg = get_token_by_symbol(winner.to_token)
        if cfg and getattr(cfg, "is_stablecoin", False):
            return delta_human

        from bot.services.price_service import price_service

        price = await asyncio.wait_for(price_service.get_price(winner.to_token), timeout=5)
    except Exception:
        return 0.0

    if not price:
        return 0.0
    return float(price) * delta_human


def _parse_int(value, default: int = 0) -> int:
    """Parse an integer value that may be hex string or int."""
    if value is None:
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        # Use C++ core if available for faster parsing
        if USE_CPP_CORE:
            return suwappu_core.parse_int(value, default)
        value = value.strip()
        if value.startswith("0x") or value.startswith("0X"):
            return int(value, 16)
        return int(value)
    return default


# On-chain decimals cache for raw-address destination tokens (paste-to-trade).
# Keyed by (chain_name, address) — decimals are intrinsic to the token, so this
# never needs invalidation.
_ONCHAIN_DECIMALS_CACHE: dict[tuple[str, str], int] = {}


class SwapEngine:
    """Engine for executing swaps via multiple providers with intelligent routing.

    Supports:
    - CoW Protocol: MEV-protected batch auctions with P2P matching
    - Socket: Super-aggregated routing across all bridges + DEXes
    - Jito: Solana MEV protection via bundle submission
    - SunSwap V2: TRON on-chain DEX swaps
    - Li.Fi: Cross-chain aggregator
    - Jupiter: Solana DEX aggregator
    - Circle CCTP: Native USDC bridging (zero fee)
    - Across: Fast EVM bridges
    - Wormhole: Solana <-> EVM bridging
    - LayerZero/Stargate: Same-token bridges
    - Chainlink CCIP: Cross-chain messaging
    """

    def __init__(self):
        # New high-value providers
        self.cow = cow_api
        self.socket = socket_api
        self.jito = jito_api

        # Existing providers
        self.lifi = LiFiAPI()
        self.jupiter = JupiterAPI()
        self.layerzero = LayerZeroAPI()
        self.ccip = ChainlinkCCIPAPI()
        self.cctp = CircleCCTPAPI()
        self.across = AcrossAPI()
        self.wormhole = WormholeAPI()
        self.sunswap = SunSwapAPI()
        self.okx_dex = OKXDEXAPI()
        self.oneinch = OneInchAPI()
        self.zerox = ZeroXAPI()
        self.kyberswap = KyberSwapAPI()
        self.propamm_titan = PropAMMAPI()
        self.wallet_service = WalletService()
        self._wallet_locks: dict[int, asyncio.Lock] = {}  # Per-wallet locks
        self._wallet_locks_max = 1000  # Cap to prevent unbounded growth
        # MONEY-PATH: exact-request singleflight only.  This is deliberately
        # separate from quote_cache: it changes no TTL/freshness behavior and
        # only coalesces callers while the *same* provider race is in progress.
        self._quote_flights: dict[tuple, _QuoteFlight] = {}

        # Surface optional-provider config at startup so a silently-disabled
        # aggregator is loud, not invisible (OKX never races + never errors when
        # its creds are unset — that should be visible in the logs).
        try:
            okx_state = (
                "configured"
                if getattr(self.okx_dex, "is_configured", False)
                else "OFF (creds unset)"
            )
            oneinch_state = (
                "configured"
                if getattr(self.oneinch, "is_configured", False)
                else "OFF (creds unset)"
            )
            zerox_state = (
                "configured" if getattr(self.zerox, "is_configured", False) else "OFF (creds unset)"
            )
            kyber_state = (
                "ON"
                if getattr(self.kyberswap, "is_configured", False)
                else "OFF (KYBERSWAP_ENABLED unset)"
            )
            propamm_state = (
                "ON"
                if getattr(self.propamm_titan, "is_configured", False)
                else "OFF (PROPAMM_ENABLED unset)"
            )
            logger.info(
                "Swap aggregators ready — LiFi/CoW/Jupiter active; OKX=%s; 1inch=%s; 0x=%s; KyberSwap=%s; PropAMM(Titan)=%s",
                okx_state,
                oneinch_state,
                zerox_state,
                kyber_state,
                propamm_state,
            )
        except Exception as e:
            logger.warning(f"Failed to log aggregator readiness state: {e}")

    async def _get_wallet_for_signing(self, wallet_data) -> Wallet:
        """Get Wallet model object for signing operations."""
        # Already a Wallet object
        if isinstance(wallet_data, Wallet):
            return wallet_data

        wallet_id = wallet_data.get("id") or wallet_data.get("wallet_id")
        if wallet_id:

            def _get_by_id():
                with get_session() as session:
                    return session.query(Wallet).filter(Wallet.id == wallet_id).first()

            wallet = await run_in_db(_get_by_id)
            if wallet:
                return wallet
        # Fallback: lookup by address
        address = wallet_data.get("address")
        if address:

            def _get_by_addr():
                with get_session() as session:
                    return session.query(Wallet).filter(Wallet.address == address).first()

            return await run_in_db(_get_by_addr)
        return None

    def _is_solana_only_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Solana-to-Solana swap (use Jupiter)."""
        return from_chain == "solana" and to_chain == "solana"

    def _is_tron_only_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a TRON-to-TRON swap (use SunSwap V2)."""
        return from_chain.lower() == "tron" and to_chain.lower() == "tron"

    def _is_tempo_only_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Tempo-to-Tempo swap (use Tempo Enshrined DEX)."""
        return from_chain.lower() == "tempo" and to_chain.lower() == "tempo"

    def _is_tron_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        """Check if TRON is involved in a cross-chain swap (not yet supported)."""
        chains = (from_chain.lower(), to_chain.lower())
        return "tron" in chains and chains[0] != chains[1]

    def _is_starknet_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Starknet-to-Starknet swap (use AVNU)."""
        return from_chain.lower() == "starknet" and to_chain.lower() == "starknet"

    def _is_starknet_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        """Check if Starknet is involved in a cross-chain swap (not yet supported)."""
        chains = (from_chain.lower(), to_chain.lower())
        return "starknet" in chains and chains[0] != chains[1]

    def _is_goat_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a GOAT-to-GOAT swap (use GOATSwap directly)."""
        return from_chain.lower() == "goat" and to_chain.lower() == "goat"

    def _is_goat_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        """Check if GOAT is involved in a cross-chain swap (not yet supported)."""
        chains = (from_chain.lower(), to_chain.lower())
        return "goat" in chains and chains[0] != chains[1]

    def _is_citrea_swap(self, from_chain: str, to_chain: str) -> bool:
        """Check if this is a Citrea-to-Citrea swap (use JuiceSwap directly)."""
        return from_chain.lower() == "citrea" and to_chain.lower() == "citrea"

    def _is_citrea_cross_chain(self, from_chain: str, to_chain: str) -> bool:
        """Check if Citrea is involved in a cross-chain swap (not yet supported)."""
        chains = (from_chain.lower(), to_chain.lower())
        return "citrea" in chains and chains[0] != chains[1]

    def _is_ccip_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Check if this route can use Chainlink CCIP (same token cross-chain EVM)."""
        # CCIP is for same-token transfers across EVM chains
        if from_token != to_token:
            return False

        # Check if CCIP supports this route
        return self.ccip.is_supported_route(from_chain, to_chain, from_token)

    def _is_layerzero_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Check if this route can use LayerZero/Stargate (same stablecoin cross-chain)."""
        # LayerZero is good for same-token cross-chain transfers
        if from_token != to_token:
            return False
        return self.layerzero.is_supported_route(from_chain, to_chain, from_token)

    def _is_usdt0_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """USDT0 (LayerZero OFT canonical USDT): 1:1 mint/burn, no AMM slippage.

        Same-token only. Gated on the provider's own `enabled` flag (default
        False) and on both legs having a verified OFT address configured, so an
        unconfigured chain is never offered. Plasma and HyperEVM have no native
        USDT deployment, so this is the only non-wrapped path to them.
        """
        if from_token != to_token:
            return False
        if not usdt0_api.enabled:
            return False
        return usdt0_api.is_supported_route(from_chain, to_chain, from_token)

    def _is_cctp_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Circle CCTP: zero-fee native USDC cross-chain (same token).

        FUND-LOSS GUARD — do not remove this gate without wiring a completion
        relayer first. `_execute_cctp_swap` below only does approve+burn on the
        source chain; nothing in this codebase polls the Circle attestation or
        submits `receiveMessage` on the destination chain for this generic
        rail (cctp_relayer.py only completes bot/services/cctp_hypercore.py's
        separate HyperCore-funding burns). Offering this route today means a
        user's USDC is burned on the source chain and never minted anywhere —
        permanent fund loss. Gated behind `settings.cctp_generic_rail_enabled`
        (default False) until a real completion relayer exists and is
        verified end-to-end for this rail.
        """
        if not getattr(settings, "cctp_generic_rail_enabled", False):
            return False
        if from_token != to_token:
            return False
        return self.cctp.is_supported_route(from_chain, to_chain, from_token)

    def _is_across_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Across: fast intent-based same-token cross-chain on supported EVM chains."""
        if from_token != to_token:
            return False
        return self.across.is_supported_route(from_chain, to_chain, from_token)

    def _is_0x_robinhood_cross_chain_route(self, from_chain: str, to_chain: str) -> bool:
        """0x bridge+swap fallback for Robinhood funding, scoped deliberately.

        Cross-Chain API supports many networks, but this integration exists to
        close the launch-token funding gap on Robinhood. Keeping the eligibility
        narrow avoids changing routing behavior for unrelated bridge flows.
        """
        source = from_chain.lower()
        destination = to_chain.lower()
        return (
            self.zerox.is_configured
            and source != destination
            and destination == "robinhood"
            and source in ZEROX_CHAIN_IDS
            and destination in ZEROX_CHAIN_IDS
        )

    def _is_wormhole_route(
        self, from_chain: str, to_chain: str, from_token: str, to_token: str
    ) -> bool:
        """Wormhole: same-token cross-chain incl. Solana<->EVM.

        Solana->EVM execution is not yet implemented (see #250 and
        _execute_wormhole_swap), so we do not offer that direction here — it
        would only be rejected at execution time.
        """
        if from_token != to_token:
            return False
        if from_chain.lower() == "solana":
            return False
        return self.wormhole.is_supported_route(from_chain, to_chain, from_token)

    def _is_cow_route(self, from_chain: str, to_chain: str) -> bool:
        """CoW Protocol: gasless, MEV-protected same-chain EVM swaps."""
        return from_chain.lower() == to_chain.lower() and self.cow.is_supported_chain(from_chain)

    def _is_socket_route(self, from_chain: str, to_chain: str) -> bool:
        """Socket/Bungee: super-aggregator across many EVM chains (same- or cross-chain)."""
        return self.socket.is_supported_chain(from_chain) and self.socket.is_supported_chain(
            to_chain
        )

    def _get_token_amount_raw(self, amount: float, token_symbol: str, chain_name: str) -> str:
        """Convert human-readable amount to raw amount string."""
        decimals = get_token_decimals(token_symbol, chain_name)
        # Use C++ core if available for faster conversion
        if USE_CPP_CORE:
            return suwappu_core.to_raw_amount(amount, decimals)
        raw = int(amount * (10**decimals))
        return str(raw)

    def _get_token_amount_human(self, amount_raw: str, token_symbol: str, chain_name: str) -> float:
        """Convert raw amount to human-readable float."""
        decimals = get_token_decimals(token_symbol, chain_name)
        # Use C++ core if available for faster conversion
        if USE_CPP_CORE:
            return suwappu_core.to_human_amount(amount_raw, decimals)
        return int(amount_raw) / (10**decimals)

    @staticmethod
    def _looks_like_raw_token(token: str) -> bool:
        """True when ``token`` is a raw contract address, not a registry symbol.

        Mirrors the passthrough rule in tokens.get_token_address: a 0x-hex
        address (>=42 chars) or a >=32-char base58 mint. For these, the registry
        decimals lookup falls back to 18, which mis-scales the human display of
        any token with different decimals (e.g. 6-dp USDC) — see
        _correct_destination_decimals.
        """
        if not token:
            return False
        return (token.startswith("0x") and len(token) >= 42) or len(token) >= 32

    async def _resolve_onchain_decimals(self, address: str, chain_name: str) -> Optional[int]:
        """Read a token's real decimals on-chain (cached). None on any failure.

        Used to correct the displayed receive-amount when a token is bought by
        raw address (paste-to-trade) and its decimals aren't in the registry.
        """
        key = (chain_name.lower(), address.lower())
        if key in _ONCHAIN_DECIMALS_CACHE:
            return _ONCHAIN_DECIMALS_CACHE[key]
        try:
            cfg = get_chain_by_name(chain_name)
            if cfg is None:
                return None
            if cfg.chain_type == ChainType.EVM:

                def _read() -> int:
                    w3 = rpc_manager.get_web3(chain_name)
                    contract = w3.eth.contract(
                        address=Web3.to_checksum_address(address),
                        abi=[
                            {
                                "constant": True,
                                "inputs": [],
                                "name": "decimals",
                                "outputs": [{"name": "", "type": "uint8"}],
                                "stateMutability": "view",
                                "type": "function",
                            }
                        ],
                    )
                    return int(contract.functions.decimals().call())

                dec = await asyncio.to_thread(_read)
            elif cfg.chain_type == ChainType.SOLANA:
                dec = await self._solana_mint_decimals(address)
            else:
                return None
            if dec is not None and 0 <= dec <= 36:
                _ONCHAIN_DECIMALS_CACHE[key] = dec
                return dec
        except Exception as e:
            logger.debug(f"on-chain decimals read failed for {address}@{chain_name}: {e}")
        return None

    async def _solana_mint_decimals(self, mint: str) -> Optional[int]:
        """Read an SPL mint's decimals via getTokenSupply. None on failure."""
        try:
            url = rpc_manager.get_rpc_url("solana")
            payload = {"jsonrpc": "2.0", "id": 1, "method": "getTokenSupply", "params": [mint]}
            session = await get_http_session()
            async with session.post(
                url, json=payload, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                data = await resp.json()
            return int(data["result"]["value"]["decimals"])
        except Exception as e:
            logger.debug(f"solana mint decimals read failed for {mint}: {e}")
            return None

    async def _correct_destination_decimals(
        self, quote, to_token: str, to_chain: str, amount: float
    ):
        """Fix the displayed receive-amount for a token bought by raw address.

        Providers convert the raw output amount to human using the registry
        decimals, which default to 18 for a raw address — so a 6-dp token shows
        a wildly wrong "you receive" figure (execution is unaffected; it uses the
        raw amounts). When the destination is a raw address, read its true
        decimals on-chain and rescale to_amount_human + exchange_rate. Ranking is
        unaffected (all providers mis-scaled identically), so correcting the
        chosen quote is sufficient. Never raises — display-only best effort.
        """
        try:
            if not self._looks_like_raw_token(to_token):
                return quote
            real = await self._resolve_onchain_decimals(to_token, to_chain)
            if real is None:
                return quote
            assumed = get_token_decimals(to_token, to_chain)
            if real == assumed:
                return quote
            corrected = int(quote.to_amount) / (10**real)
            quote.to_amount_human = corrected
            if amount and amount > 0:
                quote.exchange_rate = corrected / amount
            logger.info(
                f"Corrected receive-amount decimals for {to_token[:10]}… on "
                f"{to_chain}: {assumed} -> {real}"
            )
        except Exception as e:
            logger.debug(f"destination decimals correction skipped: {e}")
        return quote

    def _approval_amount(self, swap_amount: int) -> int:
        """Resolve the ERC-20 approval amount per the configured approval policy.

        - "unlimited" (default): max uint256, so the router is approved once and
          subsequent swaps skip the approval tx (fewer txs, but the full balance
          stays exposed to the router forever).
        - "exact": approve only the amount this swap will pull (token base units),
          so no standing allowance survives the swap.

        ``swap_amount`` MUST be the exact base-unit value the router will transfer
        from the user (i.e. the same value the allowance check compares against).
        """
        if str(getattr(settings, "approval_mode", "unlimited")).lower() == "exact":
            return int(swap_amount)
        return MAX_UINT256

    @staticmethod
    def _assert_fresh_min_out_acceptable(
        approved_quote: "SwapQuote",
        fresh_to_amount_min: str,
        provider_name: str,
        fresh_is_synthetic: bool = False,
    ) -> None:
        """Abort the swap if the execution-time re-quote's min-out is worse than
        what the user actually approved on the displayed/confirmed quote.

        The executors below always re-quote at execution time (routes/prices move
        between quote and broadcast), but that re-quote must not silently
        authorize a worse minimum than the one the user saw and confirmed —
        otherwise a stale or manipulated re-quote could sign a transaction that
        accepts materially less output than what was approved.

        ``fresh_is_synthetic`` flags that the *fresh* min-out was derived
        client-side from a float slippage tolerance rather than returned by
        the provider (e.g. 0x omitted minBuyAmount this time). If the
        *approved* quote carried a real provider-computed minimum, comparing
        it against a client-side estimate is not like-for-like -- our
        fallback formula may not match the provider's true minimum-output
        guarantee, so a numeric pass here would not mean what the user
        actually approved. Fail closed and require a real provider min
        instead of silently accepting the substitution.
        """
        approved_is_synthetic = bool((approved_quote.raw_quote or {}).get("min_out_synthetic"))
        if fresh_is_synthetic and not approved_is_synthetic:
            raise SwapError(
                f"{provider_name}: execution re-quote did not return a provider-computed "
                "minimum output, only a client-side estimate -- refusing to substitute an "
                "estimate for the provider-verified minimum you approved. Please retry."
            )

        try:
            approved_min = int(approved_quote.to_amount_min)
            fresh_min = int(fresh_to_amount_min)
        except (TypeError, ValueError):
            # Can't compare -- fail closed rather than sign against an
            # unverifiable min-out.
            raise SwapError(
                f"{provider_name}: could not validate re-quoted min-out against "
                "the approved quote -- aborting for safety."
            )
        if fresh_min < approved_min:
            raise SwapError(
                f"{provider_name}: execution re-quote min-out ({fresh_min}) is "
                f"worse than the approved min-out ({approved_min}). Aborting to "
                "protect against slippage/price movement beyond what you approved. "
                "Please request a fresh quote and try again."
            )

    async def _send_reset_approval_if_needed(
        self,
        *,
        web3,
        token_contract,
        token_addr: str,
        spender: str,
        current_allowance: int,
        sender: str,
        chain_id: int,
        gas_price: int,
        nonce: int,
        wallet,
    ) -> int:
        """For USDT-style reset-required tokens in 'exact' mode, approve 0 first.

        Some tokens (USDT mainnet) revert ``approve`` when moving a NON-zero
        allowance directly to another non-zero value. This only matters in
        'exact' mode, where a re-approval can start from a leftover non-zero
        allowance. Sends a 0-approval tx (waiting for the receipt) and returns
        the next nonce to use. No-op (returns the same nonce) otherwise.
        """
        if str(getattr(settings, "approval_mode", "unlimited")).lower() != "exact":
            return nonce
        if current_allowance <= 0:
            return nonce
        if token_addr.lower() not in RESET_REQUIRED_TOKENS:
            return nonce

        reset_data = token_contract.functions.approve(spender, 0).build_transaction(
            {
                "from": sender,
                "nonce": nonce,
                "chainId": chain_id,
                "gasPrice": gas_price,
                "gas": 100_000,
            }
        )
        reset_tx = {
            "to": token_addr,
            "data": reset_data["data"],
            "value": 0,
            "gas": reset_data.get("gas", 60000),
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": chain_id,
        }
        signed_reset = await self.wallet_service.sign_evm_transaction(wallet, reset_tx)
        reset_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_reset.replace("0x", "")))
        )
        logger.info(f"Reset-required token allowance zeroed first: {reset_hash.hex()}")
        await asyncio.to_thread(
            lambda: web3.eth.wait_for_transaction_receipt(reset_hash, timeout=120)
        )
        return nonce + 1

    async def _gather_quotes(self, tasks: list) -> list:
        """Run quote tasks in parallel, return successful SwapQuote results."""
        results = await asyncio.gather(*tasks, return_exceptions=True)
        quotes = []
        for r in results:
            if isinstance(r, SwapQuote):
                quotes.append(r)
            elif isinstance(r, Exception):
                logger.warning(f"Quote provider failed: {r}")
        return quotes

    @staticmethod
    def _extract_quotes(done_set) -> list:
        """Extract successful SwapQuote results from asyncio.wait done-set."""
        results = []
        for t in done_set:
            if t.cancelled():
                continue
            exc = t.exception()
            if exc:
                logger.warning(f"Quote provider failed: {exc}")
                continue
            r = t.result()
            if isinstance(r, SwapQuote):
                results.append(r)
        return results

    @staticmethod
    async def _real_gas_cost_usd(from_chain: str, estimated_gas) -> tuple[float, bool]:
        """Best-effort REAL USD gas cost for a same-chain EVM aggregator quote
        (OKX/1inch/0x — they all return raw gas UNITS in `estimated_gas`, but
        the adapters historically converted them with a hardcoded "1 gwei *
        $2000 ETH" heuristic that's wrong on every non-Ethereum chain and
        stale the moment ETH moves). Multiplies real gas units x a live gas
        price (`gas_tracker`, itself cached ~15s — same cache the /gas
        command uses, so this never adds an RPC round trip when a fresh
        entry exists) x the chain's native token USD price (`price_service`,
        cached ~30s).

        Returns (cost_usd, trusted). `trusted` is True ONLY when every input
        was real: gas units parsed, the RPC gas-price lookup succeeded, AND
        the native-token price cache/fetch hit. On ANY failure this returns
        (0.0, False) so the caller keeps its own heuristic estimate and the
        quote stays untrusted for net-of-gas ranking purposes. Never raises.
        """
        try:
            gas_units = float(estimated_gas)
            if gas_units <= 0:
                return 0.0, False

            chain = get_chain_by_name(from_chain)
            if not chain or chain.chain_type != ChainType.EVM:
                return 0.0, False

            from bot.services.gas_tracker import gas_tracker
            from bot.services.price_service import price_service

            gas_price = await gas_tracker.get_evm_gas_price(from_chain)
            if not gas_price or not gas_price.standard or gas_price.standard <= 0:
                return 0.0, False

            native_price = await price_service.get_price(chain.native_token)
            if not native_price or native_price <= 0:
                return 0.0, False

            cost_usd = gas_units * gas_price.standard * 1e-9 * native_price
            return cost_usd, True
        except Exception as e:
            logger.debug(f"Real gas cost unavailable for {from_chain} (using heuristic): {e}")
            return 0.0, False

    @staticmethod
    async def _prewarm_gas_and_price(from_chain: str) -> None:
        """Fire-and-forget cache warm for `_real_gas_cost_usd`'s two lookups.

        Started concurrently with (not before) the OKX/1inch/0x racers, so
        it costs nothing if it loses the race with them, but on a cold
        cache it gives `gas_tracker`'s and `price_service`'s own caches (15s
        / 30s TTL respectively) a real chance to be warm by the time those
        adapters call `_real_gas_cost_usd` themselves — instead of 1-3
        separate racers each independently triggering their own cold RPC
        call inside the timed race. Never raises; a failure here just means
        the racers fall through to their own (still-safe, still-timed-out)
        cold path.
        """
        try:
            chain = get_chain_by_name(from_chain)
            if not chain or chain.chain_type != ChainType.EVM:
                return

            from bot.services.gas_tracker import gas_tracker
            from bot.services.price_service import price_service

            await asyncio.gather(
                gas_tracker.get_evm_gas_price(from_chain),
                price_service.get_price(chain.native_token),
                return_exceptions=True,
            )
        except Exception:
            pass

    @track_time(MetricNames.SWAP_QUOTE)
    async def get_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
        platform_fee_bps: Optional[int] = None,
        user_id: Optional[int] = None,
    ) -> SwapQuote:
        """Get a quote, sharing an identical provider race already in flight.

        The key contains every input that can affect quote contents or
        execution-bound calldata.  Values are intentionally not normalized:
        only byte-for-byte-equivalent requests share work, which keeps this a
        latency optimization rather than a routing/fee semantic change.

        A waiting caller is shielded from cancelling the shared task.  If the
        last waiter leaves, however, the provider race is cancelled and fully
        collected so a cancelled request cannot leave orphan network work.
        """
        key = (
            from_chain,
            to_chain,
            from_token,
            to_token,
            amount,
            from_address,
            to_address,
            slippage,
            platform_fee_bps,
            user_id,
        )

        # There is no await between lookup/create/increment, so this registry
        # transition is atomic within the asyncio event loop.  Avoiding an
        # asyncio.Lock also keeps the engine usable across independent test
        # loops; each flight is removed before its waiters finish.
        flights = getattr(self, "_quote_flights", None)
        if flights is None:
            flights = self._quote_flights = {}
        flight = flights.get(key)
        if flight is None or flight.task.done():
            flight = _QuoteFlight(
                task=asyncio.create_task(
                    self._get_quote_impl(
                        from_chain=from_chain,
                        to_chain=to_chain,
                        from_token=from_token,
                        to_token=to_token,
                        amount=amount,
                        from_address=from_address,
                        to_address=to_address,
                        slippage=slippage,
                        platform_fee_bps=platform_fee_bps,
                        user_id=user_id,
                    )
                )
            )
            flights[key] = flight
        flight.waiters += 1

        cancel_flight = False
        try:
            return await asyncio.shield(flight.task)
        finally:
            flight.waiters -= 1
            if flight.waiters == 0 and flights.get(key) is flight:
                flights.pop(key, None)
                cancel_flight = not flight.task.done()

            if cancel_flight:
                flight.task.cancel()
                await asyncio.gather(flight.task, return_exceptions=True)

    async def _get_quote_impl(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
        platform_fee_bps: Optional[int] = None,
        user_id: Optional[int] = None,
    ) -> SwapQuote:
        """
        Get the best swap quote by racing all eligible providers in parallel.

        Args:
            from_chain: Source chain name
            to_chain: Destination chain name
            from_token: Source token symbol (e.g., "USDT")
            to_token: Destination token symbol
            amount: Amount to swap (human-readable)
            from_address: Sender wallet address
            to_address: Receiver wallet address (defaults to from_address)
            slippage: Slippage tolerance as percentage
            platform_fee_bps: Platform fee in basis points to collect on-chain.
                Takes precedence over user_id. Applied to fee-capable providers.
            user_id: When platform_fee_bps is not given, resolve the fee from this
                user's subscription tier so paid tiers get their discount on
                automated paths (copy, orders, etc.), not the flat default.

        Returns:
            SwapQuote with best output amount from all providers
        """
        # Resolve the platform fee so EVERY swap path collects — not just the
        # manual handler. Precedence: explicit platform_fee_bps > user's tier
        # (via user_id) > flat default. The snipe path does NOT route through
        # here (it has its own Jupiter calls), so it is not covered by this.
        # On-chain collection is still gated per-provider on a configured
        # collector, so this is a no-op until collectors are set.
        if platform_fee_bps is None:
            from bot.services.fee_service import fee_service

            tier = None
            if user_id is not None:
                try:
                    from bot.services.x402_service import x402_service

                    tier = await x402_service.get_tier(user_id)
                except Exception as e:
                    # tier lookup failure → flat default, never block the quote
                    logger.warning(
                        f"x402 tier lookup failed for user_id={user_id}; "
                        f"falling back to flat default fee: {e}"
                    )
                    tier = None
            platform_fee_bps = fee_service.get_fee_bps(tier)

        # Check quote cache — keyed on platform_fee_bps so quotes for different
        # tiers (different fee) never collide.
        # Recipient is execution-bound input: aggregators may bake it into
        # calldata. Two otherwise-identical quotes for different recipients
        # must therefore never share a cached quote.
        cache_key = f"quote:{from_chain}:{to_chain}:{from_token}:{to_token}:{amount}:{slippage}:{from_address or 'none'}:to{to_address or 'none'}:fee{platform_fee_bps or 0}"
        cached = await quote_cache.get(cache_key)
        if cached is not None:
            return cached

        if self._is_tron_cross_chain(from_chain, to_chain):
            raise SwapError(
                "Cross-chain swaps from/to TRON are not yet supported. Phase 2 will add TRON bridging."
            )

        if self._is_starknet_cross_chain(from_chain, to_chain):
            raise SwapError(
                "Cross-chain swaps from/to Starknet are not yet supported. "
                "Phase 2 will add BTC/EVM bridging to Starknet."
            )

        if self._is_goat_cross_chain(from_chain, to_chain):
            raise SwapError(
                "Cross-chain swaps from/to GOAT Network are not yet supported "
                "(bridge via Symbiosis coming)."
            )

        if self._is_citrea_cross_chain(from_chain, to_chain):
            raise SwapError(
                "Cross-chain swaps from/to Citrea are not yet supported. "
                "Bridge BTC in via /btc (Lightning → Citrea cBTC)."
            )

        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)
        slippage_bps = int(slippage * 100)

        # Build list of eligible quote fetchers to race in parallel
        tasks = []
        # Comparison-only quotes — never eligible to be selected as `best`
        # (see the CoW counterfactual block below). Kept separate from
        # `tasks` so they can't affect route selection or timing decisions.
        counterfactual_tasks = []

        # Fire off a cache warm for OKX/1inch/0x's real-gas computation
        # (gas_tracker + price_service) at the earliest possible moment —
        # scheduled now, before those adapters' own HTTP calls even start,
        # so by the time they call _real_gas_cost_usd the cache has the
        # best chance of already being warm. Same-chain-EVM only (that's
        # all _real_gas_cost_usd is ever used for); no-op otherwise.
        # Fire-and-forget: never awaited here, so it can't add latency to
        # the race even in the worst case.
        # Gated on a consumer actually existing, and the task reference is
        # retained so loop shutdown doesn't warn about a pending orphan.
        if from_chain.lower() == to_chain.lower() and (
            self.okx_dex.is_configured or self.oneinch.is_configured or self.zerox.is_configured
        ):
            self._prewarm_task = asyncio.ensure_future(self._prewarm_gas_and_price(from_chain))

        if self._is_tempo_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_tempo_dex_quote(from_token, to_token, amount, amount_raw, slippage)
            )

        if self._is_solana_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_jupiter_quote(
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage_bps,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        if self._is_tron_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_sunswap_quote(from_token, to_token, amount, amount_raw, slippage_bps)
            )

        # Starknet-only swaps route EXCLUSIVELY through AVNU — no EVM aggregator
        # (LiFi/1inch/0x/Kyber/OKX/CoW/Socket) understands Starknet calldata.
        if self._is_starknet_swap(from_chain, to_chain):
            tasks.append(
                self._get_avnu_quote(
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage_bps,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # GOAT-only swaps route EXCLUSIVELY through GOATSwap (direct Uniswap V3
        # fork). GOAT (chain id 2345) is absent from EVERY aggregator chain map
        # (LiFi/1inch/0x/Kyber/OKX/CoW/Socket) — keep it out of those paths.
        if self._is_goat_swap(from_chain, to_chain):
            tasks.append(
                self._get_goatswap_quote(
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    slippage_bps,
                )
            )

        # Citrea-only swaps route EXCLUSIVELY through JuiceSwap (direct Uniswap
        # V3 fork). Citrea (chain id 4114) is absent from EVERY aggregator chain
        # map (LiFi/1inch/0x/Kyber/OKX/CoW/Socket) — keep it out of those paths.
        if self._is_citrea_swap(from_chain, to_chain):
            tasks.append(
                self._get_juiceswap_quote(
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    slippage_bps,
                )
            )

        # OKX DEX covers TRON, EVM, and Solana (same-chain only) — add if configured
        # (GOAT/Citrea excluded: not in OKX_CHAIN_IDS, routed via UniV3 forks above)
        if (
            self.okx_dex.is_configured
            and from_chain.lower() == to_chain.lower()
            and not self._is_starknet_swap(from_chain, to_chain)
            and not self._is_goat_swap(from_chain, to_chain)
            and not self._is_citrea_swap(from_chain, to_chain)
        ):
            tasks.append(
                self._get_okx_dex_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # 1inch (EVM same-chain only) — add if configured
        # (GOAT is intentionally absent from ONEINCH_CHAIN_IDS — GOATSwap only)
        if (
            self.oneinch.is_configured
            and from_chain.lower() == to_chain.lower()
            and ONEINCH_CHAIN_IDS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_1inch_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # 0x Swap API v2 (EVM same-chain only) — add if configured
        # (GOAT is intentionally absent from ZEROX_CHAIN_IDS — GOATSwap only)
        if (
            self.zerox.is_configured
            and from_chain.lower() == to_chain.lower()
            and ZEROX_CHAIN_IDS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_0x_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # KyberSwap (EVM same-chain only) — add if enabled (no key, gated on flag)
        # (GOAT is intentionally absent from KYBERSWAP_CHAIN_SLUGS — GOATSwap only)
        if (
            self.kyberswap.is_configured
            and from_chain.lower() == to_chain.lower()
            and KYBERSWAP_CHAIN_SLUGS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_kyberswap_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # PropAMM via Titan Builder (Ethereum mainnet same-chain only) — add if
        # enabled (no key, gated on flag, like KyberSwap above).
        if (
            self.propamm_titan.is_configured
            and from_chain.lower() == "ethereum"
            and to_chain.lower() == "ethereum"
        ):
            tasks.append(
                self._get_propamm_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    slippage_bps,
                    platform_fee_bps=platform_fee_bps,
                )
            )

        # EVM routing: Li.Fi + LayerZero (not for Solana-only, TRON-only, Tempo-only,
        # Starknet, GOAT, or Citrea — Li.Fi has no chain id for GOAT/Citrea; the
        # direct UniV3-fork venues handle them)
        if (
            not self._is_solana_only_swap(from_chain, to_chain)
            and not self._is_tron_only_swap(from_chain, to_chain)
            and not self._is_tempo_only_swap(from_chain, to_chain)
            and not self._is_starknet_swap(from_chain, to_chain)
            and not self._is_goat_swap(from_chain, to_chain)
            and not self._is_citrea_swap(from_chain, to_chain)
        ):
            if self._is_layerzero_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_layerzero_quote(
                        from_chain, to_chain, from_token, amount, amount_raw, from_address, slippage
                    )
                )
            # USDT0: 1:1 OFT mint/burn for USDT, and the only non-wrapped path
            # to Plasma/HyperEVM. No-ops while USDT0_BRIDGE_ENABLED is False.
            if self._is_usdt0_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_usdt0_quote(
                        from_chain, to_chain, from_token, amount, amount_raw, from_address, slippage
                    )
                )
            tasks.append(
                self._get_lifi_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    to_address,
                    slippage,
                    platform_fee_bps=platform_fee_bps,
                )
            )

            # Robinhood funding fallback: 0x Cross-Chain can combine an
            # origin swap, Relay/Across bridge, and destination swap in one
            # route.  This is especially important for fresh launch tokens
            # that 0x indexes before a generic bridge aggregator does.
            if self._is_0x_robinhood_cross_chain_route(from_chain, to_chain):
                tasks.append(
                    self._get_0x_cross_chain_quote(
                        from_chain,
                        to_chain,
                        from_token,
                        to_token,
                        amount,
                        amount_raw,
                        from_address,
                        to_address,
                        slippage,
                        platform_fee_bps=platform_fee_bps,
                    )
                )

            # Additional providers — raced in parallel; best price wins.
            # CCTP: preferred for native USDC (zero fee).
            if self._is_cctp_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_cctp_quote(
                        from_chain, to_chain, from_token, amount, amount_raw, slippage
                    )
                )
            # CCIP: same-token cross-chain EVM (#257 — was only in get_all_quotes).
            if self._is_ccip_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_ccip_quote(
                        from_chain, to_chain, from_token, amount, from_address, to_address
                    )
                )
            # Across: fast intent-based cross-chain.
            if self._is_across_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_across_quote(
                        from_chain,
                        to_chain,
                        from_token,
                        amount,
                        amount_raw,
                        from_address,
                        to_address,
                    )
                )
            # Wormhole: cross-chain incl. EVM->Solana (Solana->EVM gated, see #250).
            if self._is_wormhole_route(from_chain, to_chain, from_token, to_token):
                tasks.append(
                    self._get_wormhole_quote(from_chain, to_chain, from_token, amount, amount_raw)
                )
            # Whether we're charging a platform fee on this swap. CoW and Socket
            # don't carry our fee param, so if they were raced fee-free they'd win
            # on output and we'd route AROUND the fee (collect nothing). Exclude
            # them from the race whenever a fee is being charged; they still serve
            # fee-free swaps (fee off / no collector configured).
            charge_platform_fee = bool(platform_fee_bps and settings.fee_collector_address)

            # CoW: gasless, MEV-protected same-chain EVM swaps.
            if self._is_cow_route(from_chain, to_chain) and not charge_platform_fee:
                tasks.append(
                    self._get_cow_quote(
                        from_chain,
                        from_token,
                        to_token,
                        amount,
                        amount_raw,
                        from_address,
                        to_address,
                    )
                )
            elif self._is_cow_route(from_chain, to_chain) and charge_platform_fee:
                # CoW can't carry our fee, so it's excluded from selection —
                # but we still fetch it comparison-only, to see whether the
                # intent-based route would have beaten our fee-charging
                # route and by how much (telemetry below deducts the fee
                # from its output for a fair, apples-to-apples comparison).
                counterfactual_tasks.append(
                    self._get_cow_quote(
                        from_chain,
                        from_token,
                        to_token,
                        amount,
                        amount_raw,
                        from_address,
                        to_address,
                    )
                )
            # Socket: super-aggregator fallback across many EVM chains.
            if self._is_socket_route(from_chain, to_chain) and not charge_platform_fee:
                tasks.append(
                    self._get_socket_quote(
                        from_chain,
                        to_chain,
                        from_token,
                        to_token,
                        amount,
                        amount_raw,
                        from_address,
                        to_address,
                    )
                )

        # Adaptive timeout: 3s fast path, extend to 8s total if no fast results
        FAST_TIMEOUT = 3.0
        EXTENDED_TIMEOUT = 5.0  # additional seconds (8s total)
        # Grace window: only fires when exactly ONE quote is in hand at the
        # 3s mark (≥2 quotes already gives us something real to compare, so
        # we don't wait at all — see the `elif pending:` cancel-now branch
        # below). Loops on return_when=FIRST_COMPLETED against a monotonic
        # deadline rather than one `ALL_COMPLETED`-style wait, and keeps
        # looping past a completion that ISN'T a real SwapQuote (a failed
        # provider finishing first would otherwise end the grace window
        # having gained nothing) — it only exits early once an actual quote
        # lands, or the deadline passes, whichever is first. Worst case
        # stays 8s total (the no-quotes extended path is unchanged).
        GRACE_TIMEOUT = 0.75

        wrapped_tasks = [asyncio.ensure_future(t) for t in tasks]
        # Counterfactual (comparison-only) tasks race alongside the real ones
        # so they get the same wall-clock budget for free, but are collected
        # separately and can never end up in `quotes`/`best`.
        cf_wrapped = [asyncio.ensure_future(t) for t in counterfactual_tasks]
        quotes = []
        cf_quotes = []

        try:
            if wrapped_tasks:
                done, pending = await asyncio.wait(wrapped_tasks, timeout=FAST_TIMEOUT)
                quotes = self._extract_quotes(done)

                if not quotes and pending:
                    logger.info(
                        "No quotes in %.0fs fast path, extending to %.0fs for %d pending providers",
                        FAST_TIMEOUT,
                        FAST_TIMEOUT + EXTENDED_TIMEOUT,
                        len(pending),
                    )
                    done2, still_pending = await asyncio.wait(pending, timeout=EXTENDED_TIMEOUT)
                    quotes = self._extract_quotes(done2)
                    # Cancel and await remaining tasks to prevent connection leaks
                    for t in still_pending:
                        t.cancel()
                    if still_pending:
                        await asyncio.gather(*still_pending, return_exceptions=True)
                elif len(quotes) == 1 and pending:
                    logger.info(
                        "1 quote in %.0fs fast path, granting up to %.2fs grace "
                        "(exits early once a real quote lands) for %d pending providers",
                        FAST_TIMEOUT,
                        GRACE_TIMEOUT,
                        len(pending),
                    )
                    loop = asyncio.get_running_loop()
                    deadline = loop.time() + GRACE_TIMEOUT
                    still_pending = pending
                    while still_pending:
                        remaining = deadline - loop.time()
                        if remaining <= 0:
                            break
                        done3, still_pending = await asyncio.wait(
                            still_pending, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
                        )
                        new_quotes = self._extract_quotes(done3)
                        quotes.extend(new_quotes)
                        if new_quotes:
                            # A real quote landed — stop waiting on the rest
                            # even if there's grace time left.
                            break
                    for t in still_pending:
                        t.cancel()
                    if still_pending:
                        await asyncio.gather(*still_pending, return_exceptions=True)
                elif pending:
                    # ≥2 quotes already in hand — no grace window, cancel now.
                    for t in pending:
                        t.cancel()
                    await asyncio.gather(*pending, return_exceptions=True)

            if not quotes:
                raise SwapError("No provider returned a valid quote. Please try again.")

            # Best-effort input-side USD price for the R2 price sanity
            # cross-check in `_rank_quotes_with_price` (see its docstring).
            # price_service caches ~30s, so this is usually a cache hit and
            # adds no real latency; only fetched when ranking will actually
            # run (single-quote races short-circuit before using it).
            # Failure here must never block quoting — falls back to the
            # coarser 5% clamp inside the ranker.
            input_price_usd = None
            if len(quotes) > 1:
                try:
                    from bot.services.price_service import price_service

                    input_price_usd = await price_service.get_price(from_token)
                except Exception:
                    input_price_usd = None

            best, out_price_used = _rank_quotes_with_price(quotes, input_price_usd)

            # Cross-chain speed tiebreaker: prefer a near-equal-value (within
            # 10bps) bridge that lands in under half the winner's time. Never
            # touches same-chain swaps or resurrects wormhole — see
            # `_apply_speed_tiebreak`'s docstring.
            best, tiebreak_info = _apply_speed_tiebreak(
                quotes, best, out_price_used, from_chain, to_chain
            )

            # Fix the displayed receive-amount when buying a token by raw address
            # (its real decimals aren't in the registry). Done after ranking — all
            # providers mis-scaled identically, so the winner is unchanged — and
            # before caching so every consumer sees the corrected figure.
            best = await self._correct_destination_decimals(best, to_token, to_chain, amount)

            # Execution-savings receipt: how much better `best` was than the
            # runner-up in this race. Best-effort only — never allowed to
            # affect route selection or fail the quote. See
            # `_select_runner_up` / `_compute_price_improvement_usd`.
            try:
                runner_up = _select_runner_up(quotes, best, out_price_used)
                best.runner_up_provider = runner_up.provider if runner_up else None
                best.price_improvement_usd = await _compute_price_improvement_usd(best, runner_up)
            except Exception:
                logger.debug("execution-savings computation failed, leaving fields None", exc_info=True)
        finally:
            # A singleflight can cancel this race when its last waiter leaves.
            # Collect the real provider tasks as well as the comparison-only
            # tasks so cancellation never leaks provider requests.  On the
            # normal path these tasks are already done/cancelled, making this
            # cleanup behavior-only with no effect on route selection.
            for t in wrapped_tasks:
                if not t.done():
                    t.cancel()
            if wrapped_tasks:
                await asyncio.gather(*wrapped_tasks, return_exceptions=True)

            # Always cancel + collect counterfactual tasks, even when the try
            # block above raised (e.g. "no provider returned a valid quote")
            # or was itself cancelled by the caller — otherwise a failed or
            # cancelled race would leak the in-flight CoW request. Cancel()
            # is called on EVERY cf task synchronously, before any `await`,
            # so a cancellation landing on this coroutine mid-finally can't
            # skip it (an `await asyncio.wait(...)` first, as this used to
            # do, could raise CancelledError before the pending tasks were
            # ever told to cancel). Already-completed tasks are unaffected
            # by cancel() — their real results still come through below.
            # Failures are ignored — this is telemetry, never allowed to
            # affect the money path.
            if cf_wrapped:
                for t in cf_wrapped:
                    t.cancel()
                await asyncio.gather(*cf_wrapped, return_exceptions=True)
                cf_quotes = self._extract_quotes(cf_wrapped)

        if cf_quotes:
            # Deduct our platform fee from CoW's output for a fair,
            # apples-to-apples comparison — CoW can't carry the fee param,
            # so its raw quote is otherwise an unfair (fee-free) baseline.
            fee_frac = (platform_fee_bps or 0) / 10_000.0
            cf_quotes = [
                replace(q, to_amount_human=q.to_amount_human * (1 - fee_frac)) for q in cf_quotes
            ]

        if len(quotes) > 1 or cf_quotes:
            self._log_route_telemetry(
                from_chain,
                to_chain,
                from_token,
                to_token,
                amount,
                quotes,
                cf_quotes,
                best,
                out_price_used,
                tiebreak_info,
            )

        await quote_cache.set(cache_key, best)
        return best

    @staticmethod
    def _log_route_telemetry(
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        quotes: List["SwapQuote"],
        cf_quotes: List["SwapQuote"],
        best: "SwapQuote",
        out_price: Optional[float],
        tiebreak_info: Optional[dict] = None,
    ) -> None:
        """One structured log line comparing every raced provider (plus any
        comparison-only counterfactual quotes) against the winner. Never
        raises — telemetry must not be able to break the quote path.

        `out_price` is passed in from `_rank_quotes_with_price` rather than
        recomputed here, so telemetry reports the exact price (or lack of
        one, when the race fell back to gross ranking) the winner was
        actually picked with — not a possibly-different recomputation.
        `tiebreak_info` (from `_apply_speed_tiebreak`) is only present (not
        `None`) when the cross-chain speed tiebreaker actually changed the
        winner — surfaced as `tiebreak_applied` so cross-chain race analysis
        can see exactly when/why speed overrode the value-maximizing pick.
        """
        try:
            winner_score = _quote_net_score(best, out_price)

            def _entry(q: "SwapQuote", counterfactual: bool) -> dict:
                score = _quote_net_score(q, out_price)
                delta_bps = (
                    ((winner_score - score) / winner_score) * 10_000 if winner_score else 0.0
                )
                entry = {
                    "provider": q.provider,
                    "to_amount_human": q.to_amount_human,
                    "gas_cost_usd": q.gas_cost_usd,
                    "fee_cost_usd": q.fee_cost_usd,
                    "estimated_time": q.estimated_time,
                    "delta_bps": round(delta_bps, 2),
                }
                if counterfactual:
                    entry["counterfactual"] = True
                return entry

            providers = [_entry(q, counterfactual=False) for q in quotes]
            providers.extend(_entry(q, counterfactual=True) for q in cf_quotes)

            logger.info(
                "route_comparison from_chain=%s to_chain=%s from_token=%s to_token=%s "
                "amount=%s winner=%s tiebreak_applied=%s providers=%s",
                from_chain,
                to_chain,
                from_token,
                to_token,
                amount,
                best.provider,
                json.dumps(tiebreak_info) if tiebreak_info else None,
                json.dumps(providers),
            )
        except Exception as e:
            logger.debug(f"Route telemetry failed (non-fatal): {e}")

    async def _get_lifi_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from Li.Fi for cross-chain or EVM swaps."""
        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if not from_token_address or not to_token_address:
            raise SwapError(
                f"Token not supported: {from_token} on {from_chain} or {to_token} on {to_chain}"
            )

        # Li.Fi collects the integrator fee via its FeeCollection contract and
        # forwards it to the registered integrator wallet (set up at portal.li.fi).
        # Gate on fee_collector_address (our "fees are live" signal) like the other
        # aggregators — otherwise we'd degrade the user's quote for a fee nobody
        # collects. When live, pass the tier-correct rate so on-chain == displayed.
        lifi_fee = (
            (platform_fee_bps / 10_000.0)
            if (platform_fee_bps and settings.fee_collector_address)
            else 0.0
        )

        quote = await self.lifi.get_quote(
            integrator=settings.lifi_integrator_id,
            fee=lifi_fee,
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token_address,
            to_token=to_token_address,
            from_amount=amount_raw,
            from_address=from_address,
            to_address=to_address,
            slippage=slippage,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        to_amount_min_human = self._get_token_amount_human(quote.to_amount_min, to_token, to_chain)

        # Calculate exchange rate
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        return SwapQuote(
            provider="lifi",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.to_amount_min,
            gas_cost_usd=quote.gas_cost_usd,
            fee_cost_usd=quote.fee_cost_usd,
            total_cost_usd=quote.gas_cost_usd + quote.fee_cost_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,  # Li.Fi doesn't always provide this
            exchange_rate=exchange_rate,
            raw_quote=quote.raw_response,
            gas_cost_trusted=True,  # real gasCosts[].amountUSD from Li.Fi's own estimate
            time_trusted=True,  # real estimate.executionDuration from Li.Fi
        )

    async def build_external_evm_swap(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        slippage: float,
    ):
        """Build the unsigned EVM transaction(s) for a NON-CUSTODIAL swap.

        The connected external wallet (MetaMask / WalletConnect / etc.) signs and
        broadcasts the transaction client-side — the server never holds a private
        key for it. We fetch a Li.Fi quote (the one same-chain EVM provider that
        returns ready-to-sign ``transactionRequest`` calldata at quote time) and
        surface it plus an ERC-20 approval tx when the sell token needs one.

        Returns ``(quote, payload)`` where ``payload`` is a JSON-serialisable dict
        with ``chainId``, the unsigned ``tx``, an optional ``approval`` tx, and the
        ``spender`` the approval targets. Numeric tx fields are hex quantity
        strings so they feed straight into ``wallet_sendTransaction``.
        """
        if not from_address or not from_address.startswith("0x") or len(from_address) != 42:
            raise SwapError("A connected EVM wallet address is required.")

        if from_chain.lower() != to_chain.lower():
            # Cross-chain needs the bridge step-runner (multiple txs across chains),
            # which can't be expressed as a single client-signed tx yet.
            raise SwapError("External wallets support same-chain EVM swaps for now.")

        chain = get_chain_by_name(from_chain)
        if not chain or chain.chain_type != ChainType.EVM:
            raise SwapError("External-wallet swaps are only supported on EVM chains.")

        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)

        quote = await self._get_lifi_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            amount=amount,
            amount_raw=amount_raw,
            from_address=from_address,
            to_address=from_address,
            slippage=slippage,
        )

        tx_request = quote.raw_quote.get("transactionRequest") or {}
        to_target = tx_request.get("to")
        call_data = tx_request.get("data")
        if not to_target or not call_data:
            raise SwapError("This route can't be signed by an external wallet yet.")

        web3 = self.wallet_service._get_web3(from_chain)
        try:
            sender = Web3.to_checksum_address(from_address)
            swap_target = Web3.to_checksum_address(to_target)
        except (TypeError, ValueError) as exc:
            raise SwapError("Li.Fi returned an invalid transaction target.") from exc

        swap_tx = {
            "to": swap_target,
            "data": call_data,
            "value": hex(_parse_int(tx_request.get("value"), 0)),
            "gas": hex(_parse_int(tx_request.get("gasLimit"), 500_000)),
            "chainId": chain.chain_id,
        }

        # ERC-20 approval: skip for native sells (ETH/BNB/etc.). We read the live
        # allowance with the user's address as owner — a pure view call, no key
        # needed — and only return an approval tx when it's short. NOTE: 'exact'
        # approval_mode on a reset-required token (e.g. USDT) would need a zero-out
        # approval first; the default 'unlimited' mode approves max once and is safe.
        approval = None
        spender = None
        from_token_address = get_token_address(from_token, from_chain)
        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            # Li.Fi explicitly tells us which contract is allowed to pull the
            # sell token. It is NOT guaranteed to equal transactionRequest.to;
            # approving the swap tx target can waste gas or leave allowance on
            # the wrong contract. Fail closed if an ERC-20 route omits it.
            approval_target = (quote.raw_quote.get("estimate") or {}).get("approvalAddress")
            if not approval_target:
                raise SwapError("Li.Fi did not provide an ERC-20 approval target.")
            try:
                spender = Web3.to_checksum_address(approval_target)
            except (TypeError, ValueError) as exc:
                raise SwapError("Li.Fi returned an invalid ERC-20 approval target.") from exc

            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            amount_needed = int(amount_raw)
            try:
                current_allowance = await asyncio.to_thread(
                    lambda: token_contract.functions.allowance(sender, spender).call()
                )
            except Exception as exc:  # RPC hiccup — fail safe by requesting approval
                logger.warning(f"external swap allowance read failed ({exc}); requesting approval")
                current_allowance = 0

            if current_allowance < amount_needed:
                approve_amount = self._approval_amount(amount_needed)
                approve_data = token_contract.encode_abi("approve", args=[spender, approve_amount])
                approval = {
                    "to": token_addr,
                    "data": approve_data,
                    "value": "0x0",
                    "chainId": chain.chain_id,
                }

        payload = {
            "chainId": chain.chain_id,
            "tx": swap_tx,
            "approval": approval,
            "spender": spender or swap_target,
        }
        return quote, payload

    async def build_external_solana_swap(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        slippage: float,
        priority_level: str = "medium",
        max_lamports: int = 1_000_000,
        jito_tip_lamports: Optional[int] = None,
        compute_unit_price_micro_lamports: Optional[int] = None,
    ):
        """Build the unsigned Solana transaction for a NON-CUSTODIAL swap.

        Phantom (or any Solana wallet) signs + sends the returned base64
        ``VersionedTransaction`` client-side — the server never holds the key.
        Jupiter builds the serialized swap tx for the connected pubkey at build
        time; there's no ERC-20-style approval step on Solana. Returns
        ``(quote, payload)`` with ``swapTransaction`` (base64) + ``chain``.

        ``priority_level``/``max_lamports`` set the Solana priority fee baked into
        the tx (landing speed under congestion). They flow from the caller's
        speed tier; the server holds the policy so caps can be tuned without a
        client deploy. When ``jito_tip_lamports`` is set, Jupiter bakes a Jito tip
        instead — the returned ``payload["jito"]`` is True and the client must
        submit the signed tx to the Jito block engine (POST /swap/submit-jito) for
        MEV-protected bundle landing rather than broadcasting via a normal RPC.
        ``compute_unit_price_micro_lamports`` (the client's live network estimate,
        e.g. from Helius) sets the exact per-CU priority price for the non-Jito
        path; it takes precedence over ``priority_level``/``max_lamports``.
        """
        try:
            import base58

            if len(base58.b58decode(from_address)) != 32:
                raise ValueError
        except Exception:
            raise SwapError("A connected Solana wallet address is required.")

        amount_raw = self._get_token_amount_raw(amount, from_token, "solana")
        slippage_bps = int(slippage * 100)

        quote = await self._get_jupiter_quote(
            from_token=from_token,
            to_token=to_token,
            amount=amount,
            amount_raw=amount_raw,
            from_address=from_address,
            slippage_bps=slippage_bps,
        )

        # Mirror _execute_jupiter_swap: only attach a feeAccount when the quote
        # itself reserved a platformFee, else Jupiter /swap rejects it.
        jup_fee_account = (
            self._jupiter_fee_account(quote.from_token, quote.to_token)
            if isinstance(quote.raw_quote, dict) and quote.raw_quote.get("platformFee")
            else None
        )
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=quote.raw_quote,
            user_public_key=from_address,
            fee_account=jup_fee_account,
            priority_level=priority_level,
            max_lamports=max_lamports,
            jito_tip_lamports=jito_tip_lamports,
            compute_unit_price_micro_lamports=compute_unit_price_micro_lamports,
        )
        if not swap_tx.swap_transaction:
            raise SwapError("Jupiter did not return a swap transaction.")

        payload = {
            "chain": "solana",
            "swapTransaction": swap_tx.swap_transaction,
            "lastValidBlockHeight": swap_tx.last_valid_block_height,
            "jito": bool(jito_tip_lamports),
        }
        return quote, payload

    @staticmethod
    def _jupiter_referral_accounts() -> dict:
        """Map of mint -> Jupiter referral token account.

        Built from JUPITER_REFERRAL_ACCOUNTS (JSON: {mint: tokenAccount}) merged
        with the legacy single jupiter_referral_account/jupiter_referral_fee_mint
        pair. Supporting multiple mints lets us collect on every Solana pair —
        wSOL for SOL-paired trades (the bulk) AND USDC for USDC-paired trades.
        """
        accounts: dict = {}
        raw = getattr(settings, "jupiter_referral_accounts", None)
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    accounts.update({str(k): str(v) for k, v in parsed.items() if k and v})
            except (ValueError, TypeError):
                logger.warning("Invalid JUPITER_REFERRAL_ACCOUNTS JSON; ignoring")
        acct = settings.jupiter_referral_account
        mint = settings.jupiter_referral_fee_mint
        if acct and mint:
            accounts.setdefault(mint, acct)
        return accounts

    def _jupiter_fee_account(self, from_token: str, to_token: str) -> Optional[str]:
        """Return the Jupiter referral feeAccount IFF it can legally receive the
        fee for this pair.

        Jupiter requires the feeAccount's mint to equal the swap's input OR output
        mint (ExactIn). Referral token accounts are mint-specific, so we keep one
        per fee mint and pick the account matching whichever side of the pair is a
        configured fee mint. If neither side matches, we return None and take no
        fee — the swap still succeeds (rather than Jupiter rejecting it). The same
        predicate is used at quote and execution time so they always agree.
        """
        accounts = self._jupiter_referral_accounts()
        if not accounts:
            return None
        from_addr = get_token_address(from_token, "solana")
        to_addr = get_token_address(to_token, "solana")
        for addr in (from_addr, to_addr):
            if addr and addr in accounts:
                return accounts[addr]
        return None

    async def _get_jupiter_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage_bps: int,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from Jupiter for Solana swaps."""
        from_token_address = get_token_address(from_token, "solana")
        to_token_address = get_token_address(to_token, "solana")

        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported on Solana: {from_token} or {to_token}")

        # Only reserve a platform fee in the quote when a referral feeAccount can
        # actually receive it for THIS pair (mint must match input/output) —
        # otherwise the fee would be uncollectable and /swap would later fail.
        effective_fee_bps = (
            platform_fee_bps if self._jupiter_fee_account(from_token, to_token) else None
        )

        quote = await self.jupiter.get_quote(
            input_mint=from_token_address,
            output_mint=to_token_address,
            amount=amount_raw,
            slippage_bps=slippage_bps,
            platform_fee_bps=effective_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.out_amount, to_token, "solana")

        # Calculate exchange rate
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        return SwapQuote(
            provider="jupiter",
            from_chain="solana",
            to_chain="solana",
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.out_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.other_amount_threshold,
            gas_cost_usd=0.001,  # Approximate Solana tx fee
            fee_cost_usd=0,
            total_cost_usd=0.001,
            estimated_time=30,  # Solana is fast
            price_impact=quote.price_impact_pct,
            exchange_rate=exchange_rate,
            raw_quote=quote.raw_response,
            platform_fee_bps=effective_fee_bps,
        )

    async def _get_sunswap_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get quote from SunSwap V2 for TRON on-chain swaps."""
        from_token_address = get_token_address(from_token, "tron")
        to_token_address = get_token_address(to_token, "tron")

        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported on TRON: {from_token} or {to_token}")

        quote = await self.sunswap.get_quote(
            from_token=from_token_address,
            to_token=to_token_address,
            amount_raw=amount_raw,
            slippage_bps=slippage_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.amount_out, to_token, "tron")
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        return SwapQuote(
            provider="sunswap",
            from_chain="tron",
            to_chain="tron",
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.amount_out,
            to_amount_human=to_amount_human,
            to_amount_min=quote.amount_out_min,
            gas_cost_usd=6.0,  # ~20 TRX energy cost for swap
            fee_cost_usd=0,
            total_cost_usd=6.0,
            estimated_time=6,  # TRON block time ~3s, 2 confirmations
            price_impact=quote.price_impact,
            exchange_rate=exchange_rate,
            raw_quote=quote.raw_response,
        )

    async def _get_avnu_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage_bps: int,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from AVNU for Starknet same-chain swaps."""
        from bot.services.avnu_api import avnu_api

        from_token_address = get_token_address(from_token, "starknet")
        to_token_address = get_token_address(to_token, "starknet")

        if not from_token_address or not to_token_address:
            raise SwapError(f"Token not supported on Starknet: {from_token} or {to_token}")

        # AVNU collects the integrator fee on-chain only when a recipient is
        # configured — otherwise pass no fee (don't degrade the quote for a fee
        # nobody collects).
        effective_fee_bps = platform_fee_bps if settings.avnu_fee_recipient else None

        quote = await avnu_api.get_quote(
            sell_token_address=from_token_address,
            buy_token_address=to_token_address,
            sell_amount=int(amount_raw),
            taker_address=from_address,
            integrator_fee_bps=effective_fee_bps,
        )

        if quote.buy_amount <= 0:
            raise SwapError(
                f"AVNU returned a zero buy amount for {from_token}→{to_token} — "
                "refusing to quote (min-out would be 0 = unlimited slippage)"
            )

        to_amount_human = self._get_token_amount_human(str(quote.buy_amount), to_token, "starknet")
        exchange_rate = to_amount_human / amount if amount > 0 else 0
        min_out = int(quote.buy_amount * (10_000 - slippage_bps) / 10_000)

        # Stash the user's slippage on the raw quote so execution uses the exact
        # tolerance from quote time instead of lossily re-deriving it from min_out.
        quote.raw_response["suwappu_slippage_bps"] = slippage_bps

        return SwapQuote(
            provider="avnu",
            from_chain="starknet",
            to_chain="starknet",
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=str(quote.buy_amount),
            to_amount_human=to_amount_human,
            to_amount_min=str(min_out),
            gas_cost_usd=quote.gas_fees_in_usd,
            fee_cost_usd=0,
            total_cost_usd=quote.gas_fees_in_usd,
            estimated_time=30,  # Starknet block time
            price_impact=0.0,
            exchange_rate=exchange_rate,
            raw_quote=quote.raw_response,
            platform_fee_bps=effective_fee_bps,
        )

    async def _get_goatswap_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get quote from GOATSwap (direct Uniswap V3 fork) for GOAT-only swaps."""
        from bot.services.goatswap_api import goatswap_api

        return await self._get_univ3_fork_quote(
            goatswap_api, from_token, to_token, amount, amount_raw, slippage_bps
        )

    async def _get_juiceswap_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get quote from JuiceSwap (direct Uniswap V3 fork) for Citrea-only swaps."""
        from bot.services.univ3_fork_api import juiceswap_api

        return await self._get_univ3_fork_quote(
            juiceswap_api, from_token, to_token, amount, amount_raw, slippage_bps
        )

    async def _get_univ3_fork_quote(
        self,
        venue_api,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
    ) -> SwapQuote:
        """Get a quote from a direct UniV3-fork venue (GOATSwap / JuiceSwap).

        Native BTC input ("BTC") is handled via the venue's wrapped-native token
        + msg.value; native output is rejected by the venue API (v1 — receive
        the wrapped-native token instead).
        """
        from bot.services.univ3_fork_api import compute_min_out

        venue = venue_api.venue
        chain_name = venue.chain_name

        from_token_address = get_token_address(from_token, chain_name)
        to_token_address = get_token_address(to_token, chain_name)

        if not from_token_address or not to_token_address:
            raise SwapError(
                f"Token not supported on {venue.display_name}'s chain "
                f"({chain_name}): {from_token} or {to_token}"
            )

        gs_quote = await venue_api.get_quote(
            token_in=from_token_address,
            token_out=to_token_address,
            amount_in=int(amount_raw),
        )

        if gs_quote.amount_out <= 0:
            raise SwapError(
                f"{venue.display_name} returned a zero output for "
                f"{from_token}→{to_token} — refusing to quote"
            )

        min_out = compute_min_out(gs_quote.amount_out, slippage_bps)
        to_amount_human = self._get_token_amount_human(
            str(gs_quote.amount_out), to_token, chain_name
        )
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Honest gas estimate: 300k gas * live gas price * cached BTC price
        # (both GOAT and Citrea gas are BTC-denominated, 18 decimals). The gas
        # price is one cheap eth_gasPrice on the same RPC the quote just used;
        # the BTC price comes ONLY from the price cache — no extra HTTP fetch at
        # quote time. If either is unavailable we report 0.0 and the UI shows
        # "varies" instead of a fabricated number. The venue's gas headroom
        # (Citrea L1 fee surcharge, +15%) is included in the display estimate.
        gas_cost_usd = 0.0
        try:
            from bot.services.rpc_manager import rpc_manager
            from bot.utils.cache import price_cache

            btc_price = await price_cache.get("price_BTC") or await price_cache.get("price_WBTC")
            if btc_price:
                web3 = rpc_manager.get_web3(chain_name)
                gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                gas_units = venue_api.apply_gas_headroom(300_000)
                gas_cost_usd = gas_units * gas_price / 1e18 * float(btc_price)
        except Exception as e:
            logger.debug(
                f"{venue.display_name} gas cost estimate unavailable (will display 'varies'): {e}"
            )

        raw = dict(gs_quote.raw_response)
        raw.update(
            {
                "token_in": gs_quote.token_in,
                "token_out": gs_quote.token_out,
                "amount_in": gs_quote.amount_in,
                "fee_tier": gs_quote.fee_tier,
                "native_in": gs_quote.native_in,
                "suwappu_slippage_bps": slippage_bps,
            }
        )

        return SwapQuote(
            provider=venue.name,
            from_chain=chain_name,
            to_chain=chain_name,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=str(gs_quote.amount_out),
            to_amount_human=to_amount_human,
            to_amount_min=str(min_out),
            gas_cost_usd=gas_cost_usd,  # 0.0 = unknown (no cached BTC price) → UI shows "varies"
            fee_cost_usd=0,
            total_cost_usd=gas_cost_usd,
            estimated_time=5,  # both GOAT and Citrea have ~2-5s blocks
            price_impact=0.0,
            exchange_rate=exchange_rate,
            raw_quote=raw,
        )

    async def _get_tempo_dex_quote(
        self,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage: float = 0.5,
    ) -> SwapQuote:
        """Get quote from Tempo Enshrined DEX for same-chain stablecoin swaps."""
        if not tempo_dex_api.is_supported_pair(from_token, to_token):
            raise SwapError(f"Tempo DEX does not support pair: {from_token}/{to_token}")

        quote = await tempo_dex_api.get_quote(
            token_in=from_token,
            token_out=to_token,
            amount_in=int(amount_raw),
        )

        to_amount_human = quote.amount_out_human
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Apply slippage to the min-out. The enshrined DEX barely moves on
        # stablecoin pairs, but `quote.amount_out` is the live quote — without a
        # tolerance any micro price drift between quote and execution reverts the
        # swap. Use the smaller of the caller's slippage and the Tempo default.
        slippage_pct = min(slippage, settings.tempo_swap_slippage_pct)
        min_amount_out = int(quote.amount_out * (1 - slippage_pct / 100))

        return SwapQuote(
            provider="tempo_dex",
            from_chain="tempo",
            to_chain="tempo",
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=str(quote.amount_out),
            to_amount_human=to_amount_human,
            to_amount_min=str(min_amount_out),
            gas_cost_usd=0.01,  # Tempo payment lane has near-zero gas
            fee_cost_usd=0,
            total_cost_usd=0.01,
            estimated_time=2,  # Tempo block time ~2s
            price_impact=quote.price_impact,
            exchange_rate=exchange_rate,
            raw_quote={
                "token_in": quote.token_in_address,
                "token_out": quote.token_out_address,
                "amount_in": quote.amount_in,
                "amount_out": quote.amount_out,
            },
        )

    async def _get_okx_dex_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from OKX DEX Aggregator (TRON, EVM, Solana)."""
        chain_id = OKX_CHAIN_IDS.get(from_chain.lower())
        if not chain_id:
            raise SwapError(f"OKX DEX does not support chain: {from_chain}")

        # Same-chain only for now
        if from_chain.lower() != to_chain.lower():
            raise SwapError("OKX DEX only supports same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if not from_token_address or not to_token_address:
            raise SwapError(
                f"Token not supported: {from_token} on {from_chain} or {to_token} on {to_chain}"
            )

        # Use lightweight /quote endpoint (tx data fetched at execution time)
        quote = await self.okx_dex.get_quote(
            chain_id=chain_id,
            from_token=from_token_address,
            to_token=to_token_address,
            amount=amount_raw,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Estimate gas cost in USD (rough: gas units * gas price) — kept as
        # the fallback whenever the real computation below can't complete.
        gas_cost_usd = 0.0
        try:
            gas_cost_usd = float(quote.estimated_gas) * 1e-9 * 2000  # Very rough ETH estimate
            if from_chain.lower() in ("bsc", "polygon", "fantom", "gnosis"):
                gas_cost_usd *= 0.01  # Much cheaper chains
            elif from_chain.lower() == "tron":
                gas_cost_usd = 6.0  # Flat estimate for TRON energy
            elif from_chain.lower() == "solana":
                gas_cost_usd = 0.001
        except (ValueError, TypeError):
            pass

        # Real gas cost (live RPC gas price x cached native-token USD price)
        # — replaces the heuristic above and marks the quote gas_cost_trusted
        # ONLY when every input was real. Same-chain-only + EVM-only, so this
        # is a no-op (untrusted) for OKX's TRON/Solana routes.
        gas_cost_trusted = False
        real_gas_usd, real_trusted = await self._real_gas_cost_usd(from_chain, quote.estimated_gas)
        if real_trusted:
            gas_cost_usd = real_gas_usd
            gas_cost_trusted = True

        return SwapQuote(
            provider="okx_dex",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.to_amount_min,
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=0,
            total_cost_usd=gas_cost_usd,
            estimated_time=15,  # OKX quotes are fast
            price_impact=quote.price_impact,
            exchange_rate=exchange_rate,
            raw_quote={
                "okx_quote": quote.raw_response,
                "tx_data": quote.tx_data,
                "chain_id": chain_id,
                "slippage": slippage,
            },
            platform_fee_bps=platform_fee_bps,
            gas_cost_trusted=gas_cost_trusted,
        )

    @staticmethod
    def _to_1inch_token(address: str) -> str:
        """Map this codebase's native sentinel (0x000…0) to 1inch's (0xEeee…EEeE)."""
        if not address or address == NATIVE_TOKEN_ADDRESS:
            return ONEINCH_NATIVE_TOKEN
        return address

    async def _get_1inch_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from the 1inch Aggregation Protocol (EVM same-chain)."""
        chain_id = ONEINCH_CHAIN_IDS.get(from_chain.lower())
        if not chain_id:
            raise SwapError(f"1inch does not support chain: {from_chain}")

        if from_chain.lower() != to_chain.lower():
            raise SwapError("1inch only supports same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if from_token_address is None or to_token_address is None:
            raise SwapError(f"Token not supported: {from_token} or {to_token} on {from_chain}")

        quote = await self.oneinch.get_quote(
            chain_id=chain_id,
            from_token=self._to_1inch_token(from_token_address),
            to_token=self._to_1inch_token(to_token_address),
            amount=amount_raw,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Rough gas estimate in USD (1inch returns gas units when includeGas=true)
        # — fallback whenever the real computation below can't complete.
        gas_cost_usd = 0.0
        try:
            gas_cost_usd = float(quote.estimated_gas) * 1e-9 * 2000  # rough ETH estimate
            if from_chain.lower() in ("bsc", "polygon", "fantom", "gnosis"):
                gas_cost_usd *= 0.01
        except (ValueError, TypeError):
            pass

        # Real gas cost (live RPC gas price x cached native-token USD price) —
        # replaces the heuristic and marks gas_cost_trusted only when real.
        gas_cost_trusted = False
        real_gas_usd, real_trusted = await self._real_gas_cost_usd(from_chain, quote.estimated_gas)
        if real_trusted:
            gas_cost_usd = real_gas_usd
            gas_cost_trusted = True

        return SwapQuote(
            provider="1inch",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.to_amount_min,
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=0,
            total_cost_usd=gas_cost_usd,
            estimated_time=15,
            price_impact=quote.price_impact if hasattr(quote, "price_impact") else 0.0,
            exchange_rate=exchange_rate,
            platform_fee_bps=platform_fee_bps,
            raw_quote={
                "oneinch_quote": quote.raw_response,
                "tx_data": quote.tx_data,
                "chain_id": chain_id,
                "slippage": slippage,
            },
            gas_cost_trusted=gas_cost_trusted,
        )

    @staticmethod
    def _to_0x_token(address: str) -> str:
        """Map this codebase's native sentinel (0x000…0) to 0x's (0xEeee…EEeE)."""
        if not address or address == NATIVE_TOKEN_ADDRESS:
            return ZEROX_NATIVE_TOKEN
        return address

    async def _get_0x_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from the 0x Swap API v2 (EVM same-chain)."""
        chain_id = ZEROX_CHAIN_IDS.get(from_chain.lower())
        if not chain_id:
            raise SwapError(f"0x does not support chain: {from_chain}")

        if from_chain.lower() != to_chain.lower():
            raise SwapError("0x only supports same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if from_token_address is None or to_token_address is None:
            raise SwapError(f"Token not supported: {from_token} or {to_token} on {from_chain}")

        quote = await self.zerox.get_quote(
            chain_id=chain_id,
            from_token=self._to_0x_token(from_token_address),
            to_token=self._to_0x_token(to_token_address),
            amount=amount_raw,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Rough gas estimate in USD (0x returns gas units in the response) —
        # fallback whenever the real computation below can't complete.
        gas_cost_usd = 0.0
        try:
            gas_cost_usd = float(quote.estimated_gas) * 1e-9 * 2000  # rough ETH estimate
            if from_chain.lower() in ("bsc", "polygon", "fantom", "gnosis"):
                gas_cost_usd *= 0.01
        except (ValueError, TypeError):
            pass

        # Real gas cost (live RPC gas price x cached native-token USD price) —
        # replaces the heuristic and marks gas_cost_trusted only when real.
        gas_cost_trusted = False
        real_gas_usd, real_trusted = await self._real_gas_cost_usd(from_chain, quote.estimated_gas)
        if real_trusted:
            gas_cost_usd = real_gas_usd
            gas_cost_trusted = True

        return SwapQuote(
            provider="0x",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.to_amount_min,
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=0,
            total_cost_usd=gas_cost_usd,
            estimated_time=15,
            price_impact=quote.price_impact if hasattr(quote, "price_impact") else 0.0,
            exchange_rate=exchange_rate,
            platform_fee_bps=platform_fee_bps,
            raw_quote={
                "zerox_quote": quote.raw_response,
                "tx_data": quote.tx_data,
                "chain_id": chain_id,
                "slippage": slippage,
                "min_out_synthetic": getattr(quote, "min_out_synthetic", False),
            },
            gas_cost_trusted=gas_cost_trusted,
        )

    async def _get_0x_cross_chain_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get a 0x bridge+destination-swap quote into Robinhood Chain."""
        origin_chain_id = ZEROX_CHAIN_IDS.get(from_chain.lower())
        destination_chain_id = ZEROX_CHAIN_IDS.get(to_chain.lower())
        if not origin_chain_id or not destination_chain_id:
            raise SwapError(f"0x Cross-Chain does not support {from_chain} -> {to_chain}")
        if from_chain.lower() == to_chain.lower() or to_chain.lower() != "robinhood":
            raise SwapError("0x Cross-Chain fallback is restricted to Robinhood funding")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)
        if from_token_address is None or to_token_address is None:
            raise SwapError(
                f"Token not supported: {from_token} on {from_chain} or {to_token} on {to_chain}"
            )

        recipient = to_address or from_address
        quote = await self.zerox.get_cross_chain_quote(
            origin_chain_id=origin_chain_id,
            destination_chain_id=destination_chain_id,
            from_token=self._to_0x_token(from_token_address),
            to_token=self._to_0x_token(to_token_address),
            amount=amount_raw,
            origin_address=from_address,
            destination_address=recipient,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # Use the same real-gas estimator as 0x same-chain quotes. The API's
        # gasLimit is for the origin transaction; bridge/provider fees remain
        # reflected in the quoted output amount.
        gas_cost_usd, gas_cost_trusted = await self._real_gas_cost_usd(
            from_chain, quote.estimated_gas
        )

        return SwapQuote(
            provider="0x_crosschain",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.to_amount_min,
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=0.0,
            total_cost_usd=gas_cost_usd,
            estimated_time=quote.estimated_time or 60,
            price_impact=0.0,
            exchange_rate=exchange_rate,
            platform_fee_bps=platform_fee_bps,
            raw_quote={
                "zerox_crosschain_quote": quote.raw_response,
                "quote_id": quote.quote_id,
                "origin_chain_id": origin_chain_id,
                "destination_chain_id": destination_chain_id,
                "to_address": recipient,
                "slippage": slippage,
                "min_out_synthetic": getattr(quote, "min_out_synthetic", False),
            },
            gas_cost_trusted=gas_cost_trusted,
        )

    @staticmethod
    def _to_kyber_token(address: str) -> str:
        """Map this codebase's native sentinel (0x000…0) to KyberSwap's (0xEeee…EEeE)."""
        if not address or address == NATIVE_TOKEN_ADDRESS:
            return KYBERSWAP_NATIVE_TOKEN
        return address

    async def _get_kyberswap_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get quote from the KyberSwap Aggregator (EVM same-chain)."""
        chain_slug = KYBERSWAP_CHAIN_SLUGS.get(from_chain.lower())
        if not chain_slug:
            raise SwapError(f"KyberSwap does not support chain: {from_chain}")

        if from_chain.lower() != to_chain.lower():
            raise SwapError("KyberSwap only supports same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)

        if from_token_address is None or to_token_address is None:
            raise SwapError(f"Token not supported: {from_token} or {to_token} on {from_chain}")

        quote = await self.kyberswap.get_quote(
            chain_slug=chain_slug,
            from_token=self._to_kyber_token(from_token_address),
            to_token=self._to_kyber_token(to_token_address),
            amount=amount_raw,
            slippage=slippage,
            platform_fee_bps=platform_fee_bps,
        )

        to_amount_human = self._get_token_amount_human(quote.to_amount, to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0

        # KyberSwap returns gasUsd directly — no heuristic needed.
        gas_cost_usd = quote.gas_usd

        return SwapQuote(
            provider="kyberswap",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=quote.to_amount_min,
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=0,
            total_cost_usd=gas_cost_usd,
            estimated_time=15,
            price_impact=0.0,
            exchange_rate=exchange_rate,
            platform_fee_bps=platform_fee_bps,
            raw_quote={
                "kyberswap_quote": quote.raw_response,
                "chain_slug": chain_slug,
                "slippage": slippage,
            },
            gas_cost_trusted=True,  # real routeSummary.gasUsd from KyberSwap
        )

    @staticmethod
    def _to_propamm_token(address: str) -> str:
        """Map this codebase's native sentinel (0x000…0) to the standard
        native sentinel (0xEeee…EEeE) PropAMM/Titan execution expects.

        NOTE: PropAMMAPI.get_quote() further remaps that sentinel to WETH
        internally for the quote RPC only — Titan's titan_getPammQuote
        indexes pairs by WETH and returns "unknown pair" for the sentinel
        (verified live). Execution still uses the sentinel, per the docs.
        """
        if not address or address.lower() == NATIVE_TOKEN_ADDRESS.lower():
            return PROPAMM_NATIVE_TOKEN
        return address

    @staticmethod
    def _propamm_effective_fee_bps(platform_fee_bps: Optional[int]) -> int:
        """Effective on-chain FrontendFee bps for a PropAMM swap: 0 when no
        fee is configured or no collector is set, otherwise the platform fee
        clamped to the router's MAX_FEE_BPS (100 = 1%, reverts FeeBpsTooHigh
        above). Clamping (rather than dropping the fee) keeps the quote race
        and execution honest with each other: we race net of what we will
        actually charge.
        """
        collector = settings.fee_collector_address
        try:
            if not platform_fee_bps or not collector or int(collector, 16) == 0:
                return 0
        except ValueError:
            return 0
        bps = int(platform_fee_bps)
        if bps <= 0:
            return 0
        if bps > 100:
            logger.warning(
                f"PropAMM (Titan) platform fee {bps} bps exceeds the router's 100 bps "
                "FrontendFee cap; clamping to 100"
            )
            return 100
        return bps

    async def _get_propamm_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        slippage_bps: int,
        platform_fee_bps: Optional[int] = None,
    ) -> SwapQuote:
        """Get a quote for PropAMM liquidity via the Titan Builder (Ethereum
        mainnet, same-chain only).

        Titan's PropAMMRouter re-quotes all whitelisted pAMM venues + Uniswap
        V3 in-tx and routes to the best, falling back to Uniswap V3
        transparently — so this is effectively "best pAMM OR UniV3" behind a
        single execution path. No API key; gated on `propamm_titan.is_configured`.
        """
        if from_chain.lower() != "ethereum" or to_chain.lower() != "ethereum":
            raise SwapError("PropAMM (Titan) only supports Ethereum mainnet same-chain swaps")

        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)
        if from_token_address is None or to_token_address is None:
            raise SwapError(f"Token not supported: {from_token} or {to_token} on {from_chain}")

        try:
            pamm_quote = await self.propamm_titan.get_quote(
                token_in=self._to_propamm_token(from_token_address),
                token_out=self._to_propamm_token(to_token_address),
                amount_in=amount_raw,
            )
        except PropAMMError as e:
            # Venue-unavailable (RPC error / transport failure) — a skipped
            # quote, never a user-facing crash. Surfaced as SwapError so the
            # race just drops this provider like any other failed racer.
            raise SwapError(f"PropAMM (Titan) quote failed: {e}")

        if pamm_quote is None:
            raise SwapError(f"PropAMM (Titan) has no route for {from_token}→{to_token}")

        # titan_getPammQuote knows nothing about our platform fee, so its
        # amountOut is GROSS. Every other venue races net of the platform fee
        # (KyberSwap chargeFeeBy, 0x swapFeeBps, 1inch fee) — net the quote
        # here too, by the same effective bps execution will actually charge
        # via swapWithFeeV1 (which skims the fee from the output token).
        effective_fee_bps = self._propamm_effective_fee_bps(platform_fee_bps)
        net_to_amount = int(pamm_quote.to_amount) * (10_000 - effective_fee_bps) // 10_000

        to_amount_human = self._get_token_amount_human(str(net_to_amount), to_token, to_chain)
        exchange_rate = to_amount_human / amount if amount > 0 else 0
        # Integer floor division on purpose: float math at wei magnitudes can
        # round the minimum UP, the unsafe direction for the user.
        min_out = net_to_amount * (10_000 - slippage_bps) // 10_000

        # No gas figure comes back from titan_getPammQuote. Price the
        # EXPECTED usage of the pinned-venue path we execute by default
        # (measured mainnet p50 — see PROPAMM_EXPECTED_SWAP_GAS), matching
        # the estimated-usage semantics of KyberSwap/0x's gasUsd so the race
        # compares like with like; the tx itself reserves the tiered hard
        # limit. `trusted` is True only when gas price and native price were
        # both live — otherwise (0.0, False) keeps this quote out of
        # net-of-gas ranking.
        gas_cost_usd, gas_trusted = await self._real_gas_cost_usd(
            from_chain, PROPAMM_EXPECTED_SWAP_GAS
        )

        return SwapQuote(
            provider="propamm_titan",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=str(net_to_amount),
            to_amount_human=to_amount_human,
            to_amount_min=str(min_out),
            gas_cost_usd=gas_cost_usd,
            fee_cost_usd=0,
            total_cost_usd=gas_cost_usd,
            estimated_time=15,
            price_impact=0.0,
            exchange_rate=exchange_rate,
            platform_fee_bps=platform_fee_bps,
            raw_quote={
                "propamm_quote": pamm_quote.raw_response,
                "pamm": pamm_quote.pamm,
                # Compliance screening reads raw_quote["router"], and this is
                # also the address funds are actually sent/approved to — pin
                # it to our configured router, NOT the Titan-reported one
                # (which is informational and caller-influenceable on the
                # webapp execute path).
                "router": settings.propamm_router_address,
                "titan_router": pamm_quote.router,
                "block_number": pamm_quote.block_number,
                "slippage_bps": slippage_bps,
                "gross_to_amount": pamm_quote.to_amount,
                "effective_fee_bps": effective_fee_bps,
            },
            gas_cost_trusted=gas_trusted,
        )

    async def _get_usdt0_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
        to_address: Optional[str] = None,
    ) -> SwapQuote:
        """Adapt a USDT0 BridgeQuote into a SwapQuote.

        Note the unit change at this boundary: swap_engine speaks slippage in
        PERCENT (0.5 == 0.5%) while BridgeProvider speaks basis points, so the
        conversion is explicit here. `round()` not `int()` — truncation would
        turn a sub-1% slippage into 0 bps, and the provider rejects 0.
        """
        bridge_quote = await usdt0_api.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            from_amount=amount_raw,
            from_address=from_address,
            to_address=to_address or from_address,
            slippage_bps=max(1, round(slippage * 100)),
        )
        if bridge_quote is None:
            # Fails closed for an unconfigured chain, a quoteSend RPC failure,
            # a fee above the ceiling, or an invalid recipient. Raise rather
            # than return None so the race logs it instead of dropping it
            # silently (get_quote filters on isinstance(r, SwapQuote)).
            raise SwapError(f"USDT0 could not quote {from_chain}->{to_chain} {token}")

        tx = bridge_quote.transaction_request or {}
        to_amount_human = self._get_token_amount_human(bridge_quote.to_amount, token, to_chain)

        return SwapQuote(
            provider="usdt0",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=bridge_quote.to_amount,
            to_amount_human=to_amount_human,
            to_amount_min=bridge_quote.to_amount_min,
            # The LayerZero messaging fee is paid in native currency as tx
            # `value`, exactly like gas — the provider reports it as
            # gas_cost_usd so router.py's net_output_usd ranks this route
            # honestly rather than treating USDT0 as free.
            gas_cost_usd=bridge_quote.gas_cost_usd,
            fee_cost_usd=bridge_quote.fee_cost_usd,
            total_cost_usd=bridge_quote.gas_cost_usd + bridge_quote.fee_cost_usd,
            estimated_time=bridge_quote.estimated_time,
            price_impact=0.0,
            # 1:1 mint/burn rail.
            exchange_rate=1.0,
            # Carry everything _execute_usdt0_swap needs, so execution never
            # re-quotes (a re-quote could return a different fee/minAmountLD
            # than the one the user was shown and agreed to).
            raw_quote={
                **(bridge_quote.raw_response or {}),
                "send_to": tx.get("to"),
                "send_data": tx.get("data"),
                "send_value": tx.get("value"),
                "approval_tx": tx.get("approval_tx"),
            },
        )

    async def _get_layerzero_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        slippage: float,
    ) -> SwapQuote:
        """Get quote from LayerZero/Stargate V2 for cross-chain stablecoin transfers."""
        quote = await self.layerzero.get_quote(
            src_chain=from_chain,
            dst_chain=to_chain,
            token_symbol=token,
            amount=amount_raw,
            from_address=from_address,
            slippage=slippage,
        )

        to_amount_human = self._get_token_amount_human(quote.amount_out, token, to_chain)

        return SwapQuote(
            provider="layerzero",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=amount_raw,
            from_amount_human=amount,
            to_amount=quote.amount_out,
            to_amount_human=to_amount_human,
            to_amount_min=quote.amount_out_min,
            gas_cost_usd=quote.native_fee_usd,
            fee_cost_usd=0,
            total_cost_usd=quote.native_fee_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,
            exchange_rate=1.0,
            raw_quote=quote.raw_data,
            # Real only when native_fee came from a live quoteSend() call AND
            # native_fee_usd was priced via price_service (see
            # layerzero_api.get_quote) — never the hardcoded/estimate paths.
            gas_cost_trusted=getattr(quote, "fee_trusted", False),
        )

    async def _get_ccip_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        from_address: str,
        to_address: Optional[str] = None,
    ) -> SwapQuote:
        """Get quote from Chainlink CCIP for cross-chain token transfers."""
        quote = await self.ccip.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            token=token,
            amount=amount,
            from_address=from_address,
            to_address=to_address,
        )

        # Include router info in raw_quote for execution
        raw_data = quote.raw_data.copy()
        raw_data["router_address"] = quote.router_address
        raw_data["destination_chain_selector"] = quote.destination_chain_selector
        raw_data["fee_token"] = quote.fee_token

        return SwapQuote(
            provider="ccip",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=quote.from_amount,
            from_amount_human=quote.from_amount_human,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,  # CCIP is 1:1
            gas_cost_usd=quote.fee_usd,
            fee_cost_usd=0,
            total_cost_usd=quote.fee_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,  # 1:1 transfer
            exchange_rate=1.0,
            raw_quote=raw_data,
        )

    @staticmethod
    def _rate(to_amount_human: float, amount: float) -> float:
        return (to_amount_human / amount) if amount else 0.0

    async def _get_cctp_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
        slippage: float,
    ) -> SwapQuote:
        """Circle CCTP quote (zero-fee 1:1 native USDC bridging)."""
        quote = await self.cctp.get_quote(
            from_chain=from_chain, to_chain=to_chain, amount=amount_raw, slippage=slippage
        )
        raw = dict(quote.raw_data or {})
        raw.update(
            {
                "token_messenger": quote.token_messenger,
                "message_transmitter": quote.message_transmitter,
                "destination_domain": quote.destination_domain,
                "usdc_address": quote.usdc_address,
            }
        )
        return SwapQuote(
            provider="cctp",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=quote.from_amount,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,  # 1:1
            gas_cost_usd=quote.gas_cost_usd,
            fee_cost_usd=quote.bridge_fee_usd,
            total_cost_usd=quote.total_cost_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,
            exchange_rate=1.0,
            raw_quote=raw,
        )

    async def _get_across_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
    ) -> SwapQuote:
        """Across Protocol quote (intent-based cross-chain)."""
        quote = await self.across.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            token=token,
            amount=amount_raw,
            from_address=from_address,
            to_address=to_address,
        )
        # Persist the intended recipient so execution deposits to it rather than
        # defaulting to the sender wallet (the SwapQuote itself carries no
        # recipient field). None means "same as sender", the prior behavior.
        raw_quote = dict(quote.raw_quote or {})
        if to_address:
            raw_quote["recipient"] = to_address
        return SwapQuote(
            provider="across",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=quote.from_amount,
            from_amount_human=quote.from_amount_human,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,
            gas_cost_usd=quote.gas_cost_usd,
            fee_cost_usd=quote.relay_fee_usd,
            total_cost_usd=quote.total_cost_usd,
            estimated_time=quote.estimated_fill_time,
            price_impact=0,
            exchange_rate=self._rate(quote.to_amount_human, amount),
            raw_quote=raw_quote,
            time_trusted=True,  # real estimatedFillTimeSec from Across's own API
        )

    async def _get_wormhole_quote(
        self,
        from_chain: str,
        to_chain: str,
        token: str,
        amount: float,
        amount_raw: str,
    ) -> SwapQuote:
        """Wormhole quote (cross-chain incl. EVM->Solana)."""
        quote = await self.wormhole.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            token=token,
            amount=amount_raw,
        )
        return SwapQuote(
            provider="wormhole",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=token,
            to_token=token,
            from_amount=quote.from_amount,
            from_amount_human=quote.from_amount_human,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,
            gas_cost_usd=quote.gas_cost_usd,
            fee_cost_usd=quote.relayer_fee_usd,
            total_cost_usd=quote.total_cost_usd,
            estimated_time=quote.estimated_time,
            price_impact=0,
            exchange_rate=self._rate(quote.to_amount_human, amount),
            raw_quote=quote.raw_data,
        )

    async def _get_cow_quote(
        self,
        from_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
    ) -> SwapQuote:
        """CoW Protocol quote (gasless, MEV-protected, same-chain EVM)."""
        # CoW expects token *addresses* (it calls Web3.to_checksum_address
        # internally); resolve the symbols first, same as _get_lifi_quote.
        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, from_chain)
        quote = await self.cow.get_quote(
            chain=from_chain,
            from_token=from_token_address,
            to_token=to_token_address,
            amount=amount_raw,
            from_address=from_address,
            receiver=to_address,
        )
        return SwapQuote(
            provider="cow",
            from_chain=from_chain,
            to_chain=from_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=quote.from_amount,
            from_amount_human=amount,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            to_amount_min=quote.to_amount,
            gas_cost_usd=0.0,  # CoW is gasless (fee taken from sell token)
            fee_cost_usd=0.0,
            total_cost_usd=0.0,
            estimated_time=60,
            price_impact=0,
            exchange_rate=self._rate(quote.to_amount_human, amount),
            raw_quote=quote.raw_quote,
            gas_cost_trusted=True,  # genuinely gasless, not "0.0 = unknown"
        )

    async def _get_socket_quote(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        amount_raw: str,
        from_address: str,
        to_address: Optional[str],
    ) -> SwapQuote:
        """Socket/Bungee super-aggregator quote (best route across bridges+DEXes)."""
        # Socket passes from/to token straight through as address query params,
        # so resolve the symbols to addresses first (per-chain), like _get_lifi_quote.
        from_token_address = get_token_address(from_token, from_chain)
        to_token_address = get_token_address(to_token, to_chain)
        quote = await self.socket.get_quote(
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token_address,
            to_token=to_token_address,
            from_amount=amount_raw,
            from_address=from_address,
            to_address=to_address,
        )
        route = quote.best_route
        if route is None:
            raise SocketError("Socket returned no viable route")
        raw = {
            "routeId": route.route_id,
            "bridgeName": route.bridge_name,
            **(route.raw_route or {}),
        }
        return SwapQuote(
            provider="socket",
            from_chain=from_chain,
            to_chain=to_chain,
            from_token=from_token,
            to_token=to_token,
            from_amount=route.from_amount,
            from_amount_human=amount,
            to_amount=route.to_amount,
            to_amount_human=route.to_amount_human,
            to_amount_min=route.to_amount,
            gas_cost_usd=route.gas_usd,
            fee_cost_usd=route.service_fee_usd,
            total_cost_usd=route.total_fee_usd,
            estimated_time=route.estimated_time_seconds,
            price_impact=0,
            exchange_rate=self._rate(route.to_amount_human, amount),
            raw_quote=raw,
            # Real provider-reported figures (route_data["totalGasFeesInUsd"]
            # and ["serviceTime"] from Socket's own /quote response), same
            # trust class as Li.Fi/KyberSwap — not heuristics.
            gas_cost_trusted=True,
            time_trusted=True,
        )

    async def get_all_quotes(
        self,
        from_chain: str,
        to_chain: str,
        from_token: str,
        to_token: str,
        amount: float,
        from_address: str,
        to_address: Optional[str] = None,
        slippage: float = 0.5,
    ) -> List[SwapQuote]:
        """
        Get quotes from all available providers for comparison.

        Returns:
            List of SwapQuotes sorted by best output amount
        """
        amount_raw = self._get_token_amount_raw(amount, from_token, from_chain)
        slippage_bps = int(slippage * 100)
        tasks = []

        # Always try Li.Fi for EVM
        if not self._is_solana_only_swap(from_chain, to_chain) and not self._is_tron_only_swap(
            from_chain, to_chain
        ):
            tasks.append(
                self._get_lifi_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    to_address,
                    slippage,
                )
            )

        # LayerZero for same-token cross-chain
        if self._is_layerzero_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_layerzero_quote(
                    from_chain, to_chain, from_token, amount, amount_raw, from_address, slippage
                )
            )

        # USDT0 (LayerZero OFT) for same-token USDT cross-chain
        if self._is_usdt0_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_usdt0_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                    to_address,
                )
            )

        # CCIP for same-token cross-chain EVM
        if self._is_ccip_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_ccip_quote(
                    from_chain, to_chain, from_token, amount, from_address, to_address
                )
            )

        # CCTP — zero-fee native USDC
        if self._is_cctp_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_cctp_quote(from_chain, to_chain, from_token, amount, amount_raw, slippage)
            )

        # Across — fast intent-based cross-chain
        if self._is_across_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_across_quote(
                    from_chain, to_chain, from_token, amount, amount_raw, from_address, to_address
                )
            )

        # Wormhole — cross-chain incl. EVM->Solana (Solana->EVM gated, #250)
        if self._is_wormhole_route(from_chain, to_chain, from_token, to_token):
            tasks.append(
                self._get_wormhole_quote(from_chain, to_chain, from_token, amount, amount_raw)
            )

        # CoW — gasless, MEV-protected same-chain EVM
        if self._is_cow_route(from_chain, to_chain):
            tasks.append(
                self._get_cow_quote(
                    from_chain, from_token, to_token, amount, amount_raw, from_address, to_address
                )
            )

        # Socket — super-aggregator across many EVM chains
        if self._is_socket_route(from_chain, to_chain):
            tasks.append(
                self._get_socket_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    to_address,
                )
            )

        # Jupiter for Solana
        if self._is_solana_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_jupiter_quote(
                    from_token, to_token, amount, amount_raw, from_address, slippage_bps
                )
            )

        # SunSwap for TRON
        if self._is_tron_only_swap(from_chain, to_chain):
            tasks.append(
                self._get_sunswap_quote(from_token, to_token, amount, amount_raw, slippage_bps)
            )

        # OKX DEX for all chains
        if self.okx_dex.is_configured and from_chain.lower() == to_chain.lower():
            tasks.append(
                self._get_okx_dex_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                )
            )

        # 1inch (EVM same-chain only)
        if (
            self.oneinch.is_configured
            and from_chain.lower() == to_chain.lower()
            and ONEINCH_CHAIN_IDS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_1inch_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                )
            )

        # 0x Swap API v2 (EVM same-chain only)
        if (
            self.zerox.is_configured
            and from_chain.lower() == to_chain.lower()
            and ZEROX_CHAIN_IDS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_0x_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                )
            )

        # KyberSwap (EVM same-chain only)
        if (
            self.kyberswap.is_configured
            and from_chain.lower() == to_chain.lower()
            and KYBERSWAP_CHAIN_SLUGS.get(from_chain.lower())
        ):
            tasks.append(
                self._get_kyberswap_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    from_address,
                    slippage,
                )
            )

        # PropAMM via Titan Builder (Ethereum mainnet same-chain only)
        if (
            self.propamm_titan.is_configured
            and from_chain.lower() == "ethereum"
            and to_chain.lower() == "ethereum"
        ):
            tasks.append(
                self._get_propamm_quote(
                    from_chain,
                    to_chain,
                    from_token,
                    to_token,
                    amount,
                    amount_raw,
                    slippage_bps,
                )
            )

        quotes = await self._gather_quotes([asyncio.wait_for(t, timeout=8.0) for t in tasks])

        quotes.sort(key=lambda q: q.to_amount_human, reverse=True)
        return quotes

    @track_time(MetricNames.SWAP_EXECUTE)
    async def execute_swap(
        self,
        quote: SwapQuote,
        wallet_id: int,
        user_id: int,
        idempotency_key: Optional[str] = None,
        automated: bool = False,
    ) -> SwapTransaction:
        """
        Execute a swap based on a quote.

        Args:
            quote: SwapQuote from get_quote
            wallet_id: User's wallet ID to execute from
            user_id: Database user ID

        Returns:
            SwapTransaction record

        Raises:
            SwapError: If validation fails or swap execution fails
        """
        # Hard backstop BEFORE any provider dispatch: the provider must have a
        # real executor. `quote.provider` is caller-supplied on the internal and
        # webapp execute paths (api/routes/internal.py and api/main.py both do
        # `qd.get("provider", "lifi")`), and the dispatch below used to end in
        # `else: _execute_lifi_swap` — so an unrecognised string was handed to
        # the Li.Fi executor, which would fetch and sign a Li.Fi transaction
        # against a quote that did not come from Li.Fi. The same fall-through
        # silently mis-executed our own quote-only bridge providers
        # (near_intents / allbridge / symbiosis / arbitrum_native / usdt0).
        # Rejected here, before locks, DB rows or any fund movement.
        if quote.provider not in EXECUTABLE_PROVIDERS:
            raise SwapError(
                f"No executor is wired for provider '{quote.provider}' -- refusing to execute. "
                "Executing it through another provider's executor would sign a transaction "
                "that does not match this quote."
            )

        # Hard backstop BEFORE any provider dispatch: GOAT must NEVER execute via
        # the Li.Fi/EVM aggregator path — no aggregator supports chain id 2345.
        # Checked up-front so a mis-built quote fails before locks/DB/funds.
        if "goat" in (quote.from_chain.lower(), quote.to_chain.lower()):
            if quote.provider != "goatswap":
                raise SwapError(
                    f"GOAT swaps must route via GOATSwap (got provider '{quote.provider}')"
                )

        # Same hard backstop for Citrea: chain id 4114 is absent from every
        # aggregator — only the direct JuiceSwap path may execute.
        if "citrea" in (quote.from_chain.lower(), quote.to_chain.lower()):
            if quote.provider != "juiceswap":
                raise SwapError(
                    f"Citrea swaps must route via JuiceSwap (got provider '{quote.provider}')"
                )

        # Same hard backstop for Tempo: chain id 4217 is absent from every
        # external aggregator — same-chain Tempo swaps must execute on the
        # protocol-level enshrined DEX. Without this guard a tempo quote would
        # fall through to the Li.Fi/EVM path (which can't build a Tempo tx).
        if self._is_tempo_only_swap(quote.from_chain, quote.to_chain):
            if quote.provider != "tempo_dex":
                raise SwapError(
                    f"Tempo swaps must route via the enshrined DEX "
                    f"(got provider '{quote.provider}')"
                )

        # Prevent concurrent swaps from same wallet (with bounded growth)
        if wallet_id not in self._wallet_locks:
            if len(self._wallet_locks) >= self._wallet_locks_max:
                # Evict unlocked entries to prevent unbounded memory growth
                to_remove = [k for k, v in self._wallet_locks.items() if not v.locked()]
                for k in to_remove[: len(to_remove) // 2]:
                    del self._wallet_locks[k]
            self._wallet_locks[wallet_id] = asyncio.Lock()

        async with self._wallet_locks[wallet_id]:
            # Idempotency: if we already created/submitted this attempt, return it
            if idempotency_key:

                def _check_idempotency():
                    with get_session() as session:
                        existing = (
                            session.query(SwapTransaction)
                            .filter(SwapTransaction.idempotency_key == idempotency_key)
                            .first()
                        )
                        if existing and existing.status not in [
                            SwapStatus.FAILED.value,
                            SwapStatus.CANCELLED.value,
                        ]:
                            return existing
                        return None

                existing = await run_in_db(_check_idempotency)
                if existing:
                    return existing

            # Validate quote freshness first — reject a stale quote before doing
            # any DB work or moving funds (fail-fast).
            quote_validator.validate_quote_freshness(quote)

            # Get wallet data within session
            def _get_wallet():
                with get_session() as session:
                    wallet_obj = session.query(Wallet).filter(Wallet.id == wallet_id).first()
                    if not wallet_obj:
                        return None
                    return {
                        "id": wallet_obj.id,
                        "wallet_id": wallet_obj.id,
                        "user_id": wallet_obj.user_id,
                        "address": wallet_obj.address,
                        "chain_type": wallet_obj.chain_type,
                        "encrypted_private_key": wallet_obj.encrypted_private_key,
                    }

            wallet = await run_in_db(_get_wallet)
            if not wallet:
                raise SwapError("Wallet not found")

            # Authentication binding: the wallet must belong to the caller's
            # user_id before any funds move. Without this, a caller could supply
            # a wallet_id from one user and a user_id from another (e.g. via the
            # internal /agent/execute-swap endpoint) to swap on someone else's wallet.
            if wallet["user_id"] != user_id:
                raise SwapError(f"Wallet {wallet_id} does not belong to user {user_id}")

            wallet_address = wallet["address"]
            wallet_chain_type = wallet["chain_type"]
            wallet_encrypted_key = wallet["encrypted_private_key"]

            # Spending limits: enforced here at the engine — the single choke
            # point every swap entry path (Telegram, WhatsApp, agent API,
            # orders, copy trading) funnels through. Price lookups are
            # best-effort: an unknown price must not brick all swaps, so the
            # check is skipped (and logged) when the USD value is unknowable.
            from_amount_usd = await spending_limit_service.usd_value(
                quote.from_token, quote.from_amount_human
            )
            to_amount_usd = await spending_limit_service.usd_value(
                quote.to_token, quote.to_amount_human
            )
            if from_amount_usd is not None:
                allowed, reason = await run_in_db(
                    lambda: spending_limit_service.check(user_id, from_amount_usd)
                )
                if not allowed:
                    raise SwapError(f"🚫 {reason}")
            else:
                logger.warning(
                    f"Skipping spending-limit check for user {user_id}: "
                    f"no USD price for {quote.from_token}"
                )

            # Compliance screening (UBS × Nethermind PoC model): screen the
            # addresses this swap will touch — recipient, router/bridge contract
            # and token contracts — against the allow/block lists before any
            # funds move. No-op unless compliance_mode is monitor/enforce, and
            # only EVM (0x…) addresses are screened. See
            # docs/architecture/compliance-screening.md.
            if compliance_service.enabled:
                raw_q = quote.raw_quote or {}
                recipient = (
                    raw_q.get("recipient")
                    or raw_q.get("receiver")
                    or raw_q.get("toAddress")
                    or wallet_address
                )
                router = (
                    raw_q.get("router_address")
                    or raw_q.get("router")
                    or raw_q.get("to")
                    or getattr(quote, "router_address", None)
                )
                compliance_result = compliance_service.screen(
                    recipient=recipient,
                    router=router,
                    tokens=[quote.from_token, quote.to_token],
                    chain=quote.from_chain,
                )
                if not compliance_result.allowed:
                    raise SwapError(f"🚫 {compliance_result.reason}")

            # Validate balance
            await quote_validator.validate_balance(
                wallet_id=wallet_id,
                quote=quote,
                wallet_service=self.wallet_service,
            )

            # Gas check removed — providers (Li.Fi, Stargate) handle gas
            # in cross-chain routes. On-chain failures are caught below.

            # Create transaction record
            def _create_swap_record():
                with get_session() as session:
                    swap_tx = SwapTransaction(
                        user_id=user_id,
                        from_chain=quote.from_chain,
                        from_token=quote.from_token,
                        from_amount=quote.from_amount,
                        from_amount_usd=from_amount_usd,
                        to_chain=quote.to_chain,
                        to_token=quote.to_token,
                        to_amount=quote.to_amount,
                        to_amount_usd=to_amount_usd,
                        status=SwapStatus.EXECUTING.value,
                        route_provider=quote.provider,
                        route_data=(
                            json.dumps({"quote_id": quote.raw_quote.get("quote_id")})
                            if quote.provider == "0x_crosschain"
                            else None
                        ),
                        gas_fee=quote.gas_cost_usd,
                        bridge_fee=quote.fee_cost_usd,
                        idempotency_key=idempotency_key,
                    )
                    session.add(swap_tx)
                    session.flush()
                    return swap_tx.id

            swap_id = await run_in_db(_create_swap_record)

            # Create a simple wallet data object for signing
            wallet_data = {
                "address": wallet_address,
                "encrypted_private_key": wallet_encrypted_key,
                "chain_type": wallet_chain_type,
            }

            # Phase 2: Deep State Simulation (Solana Anti-Honeypot)
            if quote.from_chain == "solana" and quote.to_chain == "solana":
                tier = await x402_service.get_tier(user_id)
                if tier in [
                    SubscriptionTier.PRO,
                    SubscriptionTier.PREMIUM,
                    SubscriptionTier.ENTERPRISE,
                ]:
                    logger.info(f"Running Deep Simulation for user {user_id} on {quote.to_token}")

                    # We simulate with a small amount of SOL for the safety test
                    # Usually 0.1 SOL is enough to trigger most tax/revert logic
                    sim_amount = min(0.1, quote.from_amount_human)

                    sim_res = await simulation_service.simulate_swap_cycle(
                        token_mint=get_token_address(
                            quote.to_token, "solana"
                        ),  # Address from quote
                        amount_sol=sim_amount,
                        user_pubkey=wallet_address,
                    )

                    if not sim_res["is_safe"]:
                        error_msg = f"Deep Simulation Blocked: {sim_res.get('reason')} - {sim_res.get('error')}"
                        logger.warning(error_msg)

                        def _mark_sim_failed():
                            with get_session() as session:
                                db_tx = (
                                    session.query(SwapTransaction)
                                    .filter(SwapTransaction.id == swap_id)
                                    .first()
                                )
                                db_tx.status = SwapStatus.FAILED.value
                                db_tx.error_message = error_msg

                        await run_in_db(_mark_sim_failed)

                        raise SwapError(
                            f"⚠️ Safety simulation FAILED: {sim_res.get('reason')}. Trade blocked to protect your funds."
                        )

                    logger.info(
                        f"Deep Simulation PASSED for {quote.to_token}. Proceeding with trade."
                    )

            try:
                # Route to appropriate execution method based on provider
                if quote.provider == "tempo_dex":
                    tx_hash = await self._execute_tempo_dex_swap(quote, wallet, user_id, automated)
                elif quote.provider == "cow":
                    tx_hash = await self._execute_cow_swap(quote, wallet)
                elif quote.provider == "socket":
                    tx_hash = await self._execute_socket_swap(quote, wallet)
                elif quote.provider == "jito":
                    tx_hash = await self._execute_jito_swap(quote, wallet)
                elif quote.provider == "jupiter":
                    tx_hash = await self._execute_jupiter_swap(quote, wallet)
                elif quote.provider == "ccip":
                    tx_hash = await self._execute_ccip_swap(quote, wallet)
                elif quote.provider == "layerzero":
                    tx_hash = await self._execute_layerzero_swap(quote, wallet)
                elif quote.provider == "usdt0":
                    tx_hash = await self._execute_usdt0_swap(quote, wallet)
                elif quote.provider == "cctp":
                    tx_hash = await self._execute_cctp_swap(quote, wallet)
                elif quote.provider == "across":
                    tx_hash = await self._execute_across_swap(quote, wallet)
                elif quote.provider == "wormhole":
                    tx_hash = await self._execute_wormhole_swap(quote, wallet)
                elif quote.provider == "sunswap":
                    tx_hash = await self._execute_sunswap_swap(quote, wallet)
                elif quote.provider == "okx_dex":
                    tx_hash = await self._execute_okx_dex_swap(quote, wallet)
                elif quote.provider == "1inch":
                    tx_hash = await self._execute_1inch_swap(quote, wallet)
                elif quote.provider == "0x":
                    tx_hash = await self._execute_0x_swap(quote, wallet)
                elif quote.provider == "0x_crosschain":
                    tx_hash = await self._execute_0x_cross_chain_swap(
                        quote, wallet, swap_id=swap_id
                    )
                elif quote.provider == "kyberswap":
                    tx_hash = await self._execute_kyberswap_swap(quote, wallet)
                elif quote.provider == "propamm_titan":
                    tx_hash = await self._execute_propamm_swap(quote, wallet)
                elif quote.provider == "avnu":
                    tx_hash = await self._execute_avnu_swap(quote, wallet)
                elif quote.provider == "goatswap":
                    tx_hash = await self._execute_goatswap_swap(quote, wallet)
                elif quote.provider == "juiceswap":
                    tx_hash = await self._execute_juiceswap_swap(quote, wallet)
                elif quote.provider == "tempo_dex":
                    tx_hash = await self._execute_tempo_dex_swap(quote, wallet, user_id)
                # (GOAT/Citrea guards live at the top of execute_swap — any
                # goat/citrea quote reaching this dispatch is guaranteed
                # provider == "goatswap"/"juiceswap")
                elif "starknet" in (quote.from_chain.lower(), quote.to_chain.lower()):
                    # Hard guard: Starknet must NEVER fall into the Li.Fi/EVM path.
                    raise SwapError(
                        f"Starknet swaps must route via AVNU (got provider '{quote.provider}')"
                    )
                elif quote.provider == "lifi":
                    tx_hash = await self._execute_lifi_swap(quote, wallet)
                else:
                    # FAIL CLOSED. This used to be `else: _execute_lifi_swap`,
                    # which handed ANY unrecognised provider to the Li.Fi
                    # executor -- it would re-fetch a Li.Fi transaction and
                    # sign it against a quote that came from somewhere else
                    # entirely. That matters because `provider` is
                    # caller-supplied on the internal/webapp execute paths
                    # (api/routes/internal.py and api/main.py both do
                    # `qd.get("provider", "lifi")`), so an unknown string from
                    # a client reached the Li.Fi path silently.
                    #
                    # It also silently mis-executed our own quote-only
                    # providers: the bridge registry can surface near_intents /
                    # allbridge / symbiosis / arbitrum_native / usdt0 quotes,
                    # and none of those had an execution branch.
                    raise SwapError(
                        f"No executor is wired for provider '{quote.provider}' -- refusing to "
                        "execute. This quote cannot be signed safely by another provider's "
                        "executor; the route should not have been offered."
                    )

                # Persist tx_hash to the database record
                def _update_tx_hash():
                    with get_session() as session:
                        db_tx = (
                            session.query(SwapTransaction)
                            .filter(SwapTransaction.id == swap_id)
                            .first()
                        )
                        if db_tx:
                            db_tx.tx_hash = tx_hash
                            db_tx.status = SwapStatus.SUBMITTED.value
                            if quote.provider == "0x_crosschain":
                                # Merge into the existing route_data instead
                                # of replacing it wholesale -- it may already
                                # carry intended_nonce (and other keys) from
                                # _persist_0x_crosschain_route_data, written
                                # BEFORE broadcast so it survives even if the
                                # process dies before this write runs. A
                                # bare replace here would silently drop that.
                                # TODO(recovery): reconcile FAILED 0x-crosschain
                                # rows with intended_nonce and no tx_hash.
                                try:
                                    existing = json.loads(db_tx.route_data or "{}")
                                except (TypeError, ValueError, json.JSONDecodeError):
                                    existing = {}
                                existing["quote_id"] = quote.raw_quote.get("quote_id")
                                db_tx.route_data = json.dumps(existing)

                await run_in_db(_update_tx_hash)

                # Record the outflow so spending-limit windows survive restarts.
                # Best-effort: the swap is already submitted, so a tracking
                # failure must not surface as a swap failure.
                if from_amount_usd is not None:
                    try:
                        await run_in_db(
                            lambda: spending_limit_service.record(
                                user_id, from_amount_usd, swap_id=swap_id
                            )
                        )
                    except Exception as e:
                        logger.warning(f"Failed to record spend event for swap {swap_id}: {e}")

                # Invalidate balance cache so user sees updated balance
                try:
                    from bot.utils.cache import balance_cache

                    await balance_cache.delete(f"bal:{wallet_address}:{wallet_chain_type}")
                except Exception as e:
                    logger.debug(f"Failed to invalidate balance cache: {e}")

                # Publish swap.submitted event
                await event_bus.publish(
                    "swap.submitted",
                    {
                        "userId": user_id,
                        "swapId": swap_id,
                        "txHash": tx_hash,
                        "fromChain": quote.from_chain,
                        "toChain": quote.to_chain,
                        "provider": quote.provider,
                    },
                )

                try:
                    from bot.services.copy_service import copy_service

                    await copy_service.handle_swap_submitted(swap_id)
                except Exception as e:
                    logger.warning(f"Copy-trading hook failed for swap {swap_id}: {e}")

                # Update the user's average-cost spot basis for the Positions /
                # PnL view. Best-effort — the swap already succeeded, so a
                # settlement error must never propagate.
                try:
                    await self._settle_user_position(user_id, quote)
                except Exception as e:
                    logger.warning(f"User-position settlement failed for swap {swap_id}: {e}")

                # Clean up local references
                wallet_encrypted_key = None

                # Re-fetch the updated record to return
                def _refetch():
                    with get_session() as session:
                        return (
                            session.query(SwapTransaction)
                            .filter(SwapTransaction.id == swap_id)
                            .first()
                        )

                swap_tx = await run_in_db(_refetch)

                return swap_tx

            except Exception as e:
                logger.error(f"Swap execution failed: {e}", exc_info=True)

                # Classify the failure cause for analytics (best-effort — never
                # let diagnosis raise over the original error).
                try:
                    from bot.services.error_guidance import classify_swap_failure

                    error_category = classify_swap_failure(
                        e,
                        {
                            "from_chain": quote.from_chain,
                            "to_chain": quote.to_chain,
                            "from_token": quote.from_token,
                            "is_cross_chain": quote.from_chain != quote.to_chain,
                        },
                    ).category
                except Exception:  # pragma: no cover - defensive
                    error_category = "unknown"

                # Mark as failed
                def _mark_failed():
                    with get_session() as session:
                        db_tx = (
                            session.query(SwapTransaction)
                            .filter(SwapTransaction.id == swap_id)
                            .first()
                        )
                        if db_tx:
                            db_tx.status = SwapStatus.FAILED.value
                            db_tx.error_message = str(e)
                            db_tx.error_category = error_category

                await run_in_db(_mark_failed)

                # Publish swap.failed event
                await event_bus.publish(
                    "swap.failed",
                    {
                        "userId": user_id,
                        "swapId": swap_id,
                        "error": str(e),
                        "fromChain": quote.from_chain,
                        "toChain": quote.to_chain,
                        "fromToken": quote.from_token,
                        "toToken": quote.to_token,
                    },
                )

                # Clean up local references
                wallet_encrypted_key = None

                raise SwapError(f"Swap execution failed: {repr(e)}")

    async def _execute_lifi_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Li.Fi."""
        tx_request = quote.raw_quote.get("transactionRequest", {})

        if not tx_request:
            raise SwapError("No transaction request in quote")

        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = get_chain_by_name(quote.from_chain)

        if chain.chain_type == ChainType.SOLANA:
            # Solana transaction via Li.Fi
            tx_data = tx_request.get("data")
            if not tx_data:
                raise SwapError("No transaction data")

            tx_bytes = base64.b64decode(tx_data)
            signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

            # Submit to Solana
            session = await get_http_session()
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [
                    base64.b64encode(signed_tx).decode(),
                    {"encoding": "base64", "skipPreflight": False},
                ],
            }
            async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                result = await resp.json()
                if "error" in result:
                    raise SwapError(f"Transaction failed: {result['error']}")
                return result["result"]
        elif chain.chain_type == ChainType.TRON:
            # TRON transaction via Li.Fi
            tx_hash = await self.wallet_service.sign_and_broadcast_tron_transaction(
                wallet, tx_request
            )
            return tx_hash
        else:
            last_error = None
            for attempt in range(3):
                web3 = self.wallet_service._get_web3(quote.from_chain)
                try:
                    return await self._execute_lifi_evm_swap(
                        quote=quote,
                        wallet_data=wallet_data,
                        wallet=wallet,
                        chain=chain,
                        web3=web3,
                        tx_request=tx_request,
                    )
                except Exception as e:
                    last_error = e
                    if not self._is_retryable_rpc_error(e) or attempt == 2:
                        raise
                    self._report_web3_failure(quote.from_chain, web3, e)
                    await asyncio.sleep(0.25 * (attempt + 1))

            raise last_error

    async def _execute_lifi_evm_swap(
        self,
        quote: SwapQuote,
        wallet_data: dict,
        wallet: Wallet,
        chain,
        web3: Web3,
        tx_request: dict,
    ) -> str:
        """Execute an EVM Li.Fi route with a selected Web3 provider."""
        sender = Web3.to_checksum_address(wallet_data["address"])
        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))

        # ERC20 approval: if swapping a token (not native), approve the LiFi contract
        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        spender = Web3.to_checksum_address(tx_request.get("to"))

        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            # Check native balance before attempting approval — need ETH for gas
            native_balance_wei = await asyncio.to_thread(lambda: web3.eth.get_balance(sender))
            # Floor to the chain's network minimum (Rootstock: 60M wei / 0.06 gwei)
            gas_price = apply_min_gas_price(
                quote.from_chain, await asyncio.to_thread(lambda: web3.eth.gas_price)
            )
            # Approval costs ~50k gas; swap ~200k gas; require enough for both
            min_gas_wei = gas_price * 300_000
            if native_balance_wei < min_gas_wei:
                native_symbol = chain.native_token if chain else "ETH"
                min_eth = min_gas_wei / 1e18
                raise SwapError(
                    f"Insufficient gas. You need at least {min_eth:.5f} {native_symbol} "
                    f"on {quote.from_chain.title()} to cover transaction fees. "
                    f"Send some {native_symbol} to your wallet first."
                )

            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            amount_needed = int(quote.from_amount)
            current_allowance = await asyncio.to_thread(
                lambda: token_contract.functions.allowance(sender, spender).call()
            )

            if current_allowance < amount_needed:
                # 'exact' mode on a reset-required token (USDT mainnet): zero the
                # allowance first, since approve() reverts non-zero -> non-zero.
                nonce = await self._send_reset_approval_if_needed(
                    web3=web3,
                    token_contract=token_contract,
                    token_addr=token_addr,
                    spender=spender,
                    current_allowance=current_allowance,
                    sender=sender,
                    chain_id=chain.chain_id,
                    gas_price=gas_price,
                    nonce=nonce,
                    wallet=wallet,
                )
                max_approval = self._approval_amount(amount_needed)
                # Pass gas explicitly to skip eth_estimateGas simulation
                approve_data = token_contract.functions.approve(
                    spender, max_approval
                ).build_transaction(
                    {
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": gas_price,
                        "gas": 100_000,
                    }
                )
                approve_tx = {
                    "to": token_addr,
                    "data": approve_data["data"],
                    "value": 0,
                    "gas": approve_data.get("gas", 60000),
                    "gasPrice": approve_data["gasPrice"],
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }
                signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
                approve_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approve.replace("0x", ""))
                    )
                )
                logger.info(f"LiFi approval tx: {approve_hash.hex()}")
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                )
                nonce += 1

        # Re-fetch nonce to account for any approval tx or pending txs
        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))

        # Build swap transaction - parse hex values from Li.Fi
        tx = {
            "to": spender,
            "data": tx_request.get("data"),
            "value": _parse_int(tx_request.get("value"), 0),
            "gas": _parse_int(tx_request.get("gasLimit"), 500000),
            # Floor to the chain's network minimum (Rootstock has no EIP-1559 and
            # rejects gasPrice below 60M wei; LiFi-provided gasPrice is floored too)
            "gasPrice": apply_min_gas_price(
                quote.from_chain,
                _parse_int(
                    tx_request.get("gasPrice"),
                    await asyncio.to_thread(lambda: web3.eth.gas_price),
                ),
            ),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        # Sign and send (routes privately via Flashbots relay when configured;
        # falls back to public RPC on any relay error).
        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        return await self._broadcast_evm_tx(web3, signed_tx_hex, chain)

    async def _broadcast_evm_tx(self, web3: Web3, signed_tx_hex: str, chain) -> str:
        """Broadcast a signed EVM tx, routing privately when configured.

        Compliant routing (UBS × Nethermind PoC, stage 2): when
        ``compliance_routing_enabled`` and the chain has a Flashbots-compatible
        relay, submit the tx privately to block builders via
        ``eth_sendPrivateTransaction``. Any relay error falls back to the public
        ``send_raw_transaction`` path, so routing can never break a swap.

        Returns the 0x-prefixed transaction hash.
        """
        raw_bytes = bytes.fromhex(signed_tx_hex.replace("0x", ""))
        chain_id = getattr(chain, "chain_id", None)

        if isinstance(chain_id, int) and flashbots_relay.should_route(chain_id):
            try:
                current_block = await asyncio.to_thread(lambda: web3.eth.block_number)
            except Exception:
                current_block = None
            result = await flashbots_relay.send_private_transaction(
                signed_tx_hex, chain_id, current_block
            )
            if result.submitted and result.tx_hash:
                return result.tx_hash
            logger.warning(
                "Private routing unavailable (%s); falling back to public RPC",
                result.error,
            )

        tx_hash = await asyncio.to_thread(lambda: web3.eth.send_raw_transaction(raw_bytes))
        return tx_hash.hex()

    @staticmethod
    def _is_retryable_rpc_error(error: Exception) -> bool:
        message = str(error).lower()
        return (
            "429" in message
            or "too many requests" in message
            or "rate limit" in message
            or "timeout" in message
        )

    @staticmethod
    def _report_web3_failure(chain_name: str, web3: Web3, error: Exception) -> None:
        provider = getattr(web3, "provider", None)
        url = getattr(provider, "endpoint_uri", None)
        if url:
            rpc_manager.report_failure(chain_name, url, str(error)[:120])

    async def _execute_jupiter_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Jupiter."""
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        # Attach feeAccount ONLY when the quote response itself reserved a
        # platformFee — otherwise Jupiter rejects a /swap that carries a
        # feeAccount with no matching reserved fee. Gating on the quoteResponse
        # (ground truth) keeps quote and execution in lockstep regardless of how
        # the quote was produced (direct, rehydrated, snipe, get_all_quotes).
        jup_fee_account = (
            self._jupiter_fee_account(quote.from_token, quote.to_token)
            if isinstance(quote.raw_quote, dict) and quote.raw_quote.get("platformFee")
            else None
        )
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=quote.raw_quote,
            user_public_key=wallet_data["address"],
            fee_account=jup_fee_account,
        )

        # Decode and sign transaction
        tx_bytes = base64.b64decode(swap_tx.swap_transaction)
        signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

        # Submit to Solana
        session = await get_http_session()
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "sendTransaction",
            "params": [
                base64.b64encode(signed_tx).decode(),
                {"encoding": "base64", "skipPreflight": False},
            ],
        }
        async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
            result = await resp.json()
            if "error" in result:
                raise SwapError(f"Transaction failed: {result['error']}")
            return result["result"]

    async def _execute_cow_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via CoW Protocol (MEV-protected batch auction).

        CoW swaps are gasless for the user - they sign an order and CoW submits it.
        Orders may be matched P2P (zero fees) or via solvers (protocol fee from output).
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = quote.from_chain

        # Get the order data from the raw quote
        raw_quote = quote.raw_quote
        cow_quote_data = raw_quote.get("quote", {})

        # Build order data for signing
        order_data = self.cow.build_order_data(
            cow_api.CoWQuote(
                quote_id=raw_quote.get("id", ""),
                from_token=get_token_address(quote.from_token, chain),
                to_token=get_token_address(quote.to_token, chain),
                from_amount=cow_quote_data.get("sellAmount", quote.from_amount),
                to_amount=cow_quote_data.get("buyAmount", quote.to_amount),
                to_amount_human=quote.to_amount_human,
                fee_amount=cow_quote_data.get("feeAmount", "0"),
                fee_amount_human=0,
                valid_to=cow_quote_data.get("validTo", 0),
                kind=cow_quote_data.get("kind", "sell"),
                sell_token_balance=cow_quote_data.get("sellTokenBalance", "erc20"),
                buy_token_balance=cow_quote_data.get("buyTokenBalance", "erc20"),
                partially_fillable=cow_quote_data.get("partiallyFillable", False),
                receiver=wallet_data["address"],
                app_data=self.cow.app_data,
                raw_quote=raw_quote,
            )
        )

        # Get typed data for EIP-712 signing
        typed_data = self.cow.get_order_typed_data(chain, order_data)

        # Sign the order using EIP-712 via wallet service
        signature = await self.wallet_service.sign_typed_data(wallet, typed_data)

        # Submit the order to CoW
        cow_order = await self.cow.submit_order(
            chain=chain,
            quote=cow_api.CoWQuote(
                quote_id=raw_quote.get("id", ""),
                from_token=get_token_address(quote.from_token, chain),
                to_token=get_token_address(quote.to_token, chain),
                from_amount=cow_quote_data.get("sellAmount", quote.from_amount),
                to_amount=cow_quote_data.get("buyAmount", quote.to_amount),
                to_amount_human=quote.to_amount_human,
                fee_amount=cow_quote_data.get("feeAmount", "0"),
                fee_amount_human=0,
                valid_to=cow_quote_data.get("validTo", 0),
                kind=cow_quote_data.get("kind", "sell"),
                sell_token_balance=cow_quote_data.get("sellTokenBalance", "erc20"),
                buy_token_balance=cow_quote_data.get("buyTokenBalance", "erc20"),
                partially_fillable=cow_quote_data.get("partiallyFillable", False),
                receiver=wallet_data["address"],
                app_data=self.cow.app_data,
                raw_quote=raw_quote,
            ),
            signature=signature,
            from_address=wallet_data["address"],
        )

        logger.info(f"CoW order submitted: {cow_order.order_uid}")

        # Return the order UID as the "tx_hash" - it can be tracked via CoW API
        return cow_order.order_uid

    async def _execute_socket_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via Socket super-aggregator.

        Socket finds the absolute best route by comparing all bridges and DEXes.
        """
        from bot.services.socket_api import SocketRoute

        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        raw_route = quote.raw_quote

        # Create a SocketRoute from the raw data
        route = SocketRoute(
            route_id=raw_route.get("routeId", ""),
            from_chain_id=self.socket.get_chain_id(quote.from_chain),
            to_chain_id=self.socket.get_chain_id(quote.to_chain),
            from_token=get_token_address(quote.from_token, quote.from_chain),
            to_token=get_token_address(quote.to_token, quote.to_chain),
            from_amount=quote.from_amount,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            gas_usd=quote.gas_cost_usd,
            service_fee_usd=quote.fee_cost_usd,
            total_fee_usd=quote.total_cost_usd,
            estimated_time_seconds=quote.estimated_time,
            bridge_name=raw_route.get("bridgeName", ""),
            dex_names=[],
            steps=[],
            user_tx_count=1,
            raw_route=raw_route,
        )

        # Build the transaction
        socket_tx = await self.socket.build_tx(route)

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Check if approval is needed
        if socket_tx.approval_data:
            approval_target = socket_tx.approval_data.get("allowanceTarget", "")
            token_address = socket_tx.approval_data.get("approvalTokenAddress", "")

            if approval_target and token_address:
                # Build approval tx
                approval_tx_data = await self.socket.build_approval_tx(
                    chain=quote.from_chain,
                    token_address=token_address,
                    owner=wallet_data["address"],
                    spender=approval_target,
                    amount=quote.from_amount,
                )

                nonce = await asyncio.to_thread(
                    lambda: web3.eth.get_transaction_count(wallet_data["address"])
                )
                approval_tx = {
                    "to": Web3.to_checksum_address(approval_tx_data.get("to", token_address)),
                    "data": approval_tx_data.get("data", ""),
                    "value": 0,
                    "gas": 60000,
                    "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }

                signed_approval_hex = await self.wallet_service.sign_evm_transaction(
                    wallet, approval_tx
                )
                approval_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approval_hex.replace("0x", ""))
                    )
                )
                logger.info(f"Socket approval tx: {approval_hash.hex()}")

                # Wait for approval
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approval_hash, timeout=120)
                )

        # Execute the main transaction
        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        tx = {
            "to": Web3.to_checksum_address(socket_tx.to),
            "data": socket_tx.data,
            "value": int(socket_tx.value) if socket_tx.value else 0,
            "gas": int(socket_tx.gas_limit),
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"Socket swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _execute_jito_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a Solana swap via Jupiter with Jito MEV protection.

        Jito protects swaps from sandwich attacks by:
        1. Building a Jupiter swap transaction
        2. Adding a Jito tip instruction
        3. Submitting as a bundle to Jito block engine
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        raw_quote = quote.raw_quote
        jupiter_quote = raw_quote.get("jupiter_quote", {})
        jito_tip = raw_quote.get("jito_tip", TipPriority.MEDIUM.value)

        # Attach feeAccount only when the (jito-wrapped) jupiter quote reserved a
        # platformFee — same ground-truth gate as the standard path, so we never
        # send a feeAccount Jupiter would reject.
        jup_fee_account = (
            self._jupiter_fee_account(quote.from_token, quote.to_token)
            if isinstance(jupiter_quote, dict) and jupiter_quote.get("platformFee")
            else None
        )
        swap_tx = await self.jupiter.get_swap_transaction(
            quote_response=jupiter_quote,
            user_public_key=wallet_data["address"],
            fee_account=jup_fee_account,
        )

        try:
            # Decode and sign the transaction
            tx_bytes = base64.b64decode(swap_tx.swap_transaction)
            signed_tx_bytes = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)
            signed_tx_b64 = base64.b64encode(signed_tx_bytes).decode()

            # Submit to Jito
            bundle_id, tx_sig = await self.jito.submit_swap_bundle(
                swap_transaction=signed_tx_b64,
                tip_amount=jito_tip,
            )

            logger.info(f"Jito bundle submitted: {bundle_id}, signature: {tx_sig}")

            # Return the transaction signature
            return tx_sig if tx_sig else bundle_id

        except Exception as e:
            logger.warning(f"Jito submission failed, falling back to standard RPC: {e}")

            # Fallback to standard Jupiter execution
            tx_bytes = base64.b64decode(swap_tx.swap_transaction)
            signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

            session = await get_http_session()
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [
                    base64.b64encode(signed_tx).decode(),
                    {"encoding": "base64", "skipPreflight": False},
                ],
            }
            async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                result = await resp.json()
                if "error" in result:
                    raise SwapError(f"Transaction failed: {result['error']}")
                return result["result"]

    async def _execute_ccip_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a cross-chain transfer via Chainlink CCIP."""
        from bot.services.ccip_api import CCIPQuote

        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        # Reconstruct CCIPQuote from raw_quote data
        ccip_quote = CCIPQuote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            from_token=quote.from_token,
            to_token=quote.to_token,
            from_amount=quote.from_amount,
            from_amount_human=quote.from_amount_human,
            to_amount=quote.to_amount,
            to_amount_human=quote.to_amount_human,
            fee_token=quote.raw_quote.get("message", {}).get("feeToken", "NATIVE"),
            fee_amount=quote.raw_quote.get("fee", "0"),
            fee_amount_human=0,
            fee_usd=quote.gas_cost_usd,
            estimated_time=quote.estimated_time,
            router_address=quote.raw_quote.get("router_address", ""),
            destination_chain_selector=quote.raw_quote.get("destination_chain_selector", ""),
            raw_data=quote.raw_quote,
        )

        # Build transfer transaction
        transfer_data = await self.ccip.build_transfer_tx(
            quote=ccip_quote,
            from_address=wallet_data["address"],
        )

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # First, check if we need to approve the token
        token_address = transfer_data.token_address
        approval_tx = await self.ccip.get_approval_tx(
            chain=quote.from_chain,
            token=quote.from_token,
            owner=wallet_data["address"],
            amount=int(quote.from_amount),
        )

        if approval_tx:
            # Send approval transaction
            nonce = await asyncio.to_thread(
                lambda: web3.eth.get_transaction_count(wallet_data["address"])
            )
            approval_tx["nonce"] = nonce
            approval_tx["chainId"] = chain.chain_id
            approval_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)

            signed_approval_hex = await self.wallet_service.sign_evm_transaction(
                wallet, approval_tx
            )
            approval_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approval_hex.replace("0x", ""))
                )
            )

            # Wait for approval
            logger.info(f"CCIP approval tx: {approval_hash.hex()}")
            await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approval_hash, timeout=120)
            )

        # Build CCIP transfer transaction
        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )

        tx = {
            "to": Web3.to_checksum_address(transfer_data.router_address),
            "data": transfer_data.data,
            "value": int(transfer_data.value),
            "gas": transfer_data.gas_limit,
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        # Sign and send
        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"CCIP transfer tx: {tx_hash.hex()}")
        return tx_hash.hex()

    def _get_web3_with_fallback(self, chain_name: str) -> Web3:
        """Get a Web3 instance via RPCManager (health-tracked, auto-failover)."""
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(chain_name)

    async def _execute_goatswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a GOAT-only swap via GOATSwap SwapRouter02 (multicall style)."""
        from bot.services.goatswap_api import goatswap_api

        return await self._execute_univ3_fork_swap(quote, wallet_data, goatswap_api)

    async def _execute_juiceswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a Citrea-only swap via JuiceSwap SwapRouter (deadline-in-struct)."""
        from bot.services.univ3_fork_api import juiceswap_api

        return await self._execute_univ3_fork_swap(quote, wallet_data, juiceswap_api)

    async def _execute_univ3_fork_swap(self, quote: SwapQuote, wallet_data: dict, venue_api) -> str:
        """Execute a same-chain swap on a direct UniV3-fork venue.

        Steps:
        1. Rebuild the venue quote from stored raw_quote data (no re-quote).
        2. ERC20 input: approve the exact amount to the router, wait for receipt.
           Native BTC input: no approval — amount rides as msg.value (router
           wraps into the wrapped-native token itself).
        3. exactInputSingle per the venue's router style (GOATSwap: wrapped in
           multicall(deadline); JuiceSwap: deadline inside the params struct)
           with amountOutMinimum from the quoted min-out.

        Gas: on top of the usual 1.3x estimate buffer, the venue's
        gas_headroom_pct is applied (Citrea: +15% — the L1 fee surcharge is not
        included in eth_estimateGas).
        """
        from bot.services.univ3_fork_api import UniV3ForkQuote

        venue = venue_api.venue
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        sender = wallet_data["address"]
        chain = get_chain_by_name(venue.chain_name)
        web3 = self._get_web3_with_fallback(venue.chain_name)
        raw = quote.raw_quote or {}

        gs_quote = UniV3ForkQuote(
            token_in=raw["token_in"],
            token_out=raw["token_out"],
            amount_in=int(raw["amount_in"]),
            amount_out=int(quote.to_amount),
            fee_tier=int(raw["fee_tier"]),
            native_in=bool(raw.get("native_in")),
        )
        amount_out_min = int(quote.to_amount_min)

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)

        # Step 1: exact-amount ERC20 approval (skipped for native BTC input)
        if not gs_quote.native_in:
            approve_tx = venue_api.build_approve_tx(gs_quote.token_in, gs_quote.amount_in)
            approve_tx.update(
                {
                    "gas": venue_api.apply_gas_headroom(80_000),
                    "gasPrice": gas_price,
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }
            )
            signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approve.replace("0x", ""))
                )
            )
            logger.info(f"{venue.display_name} approval tx: {approve_hash.hex()}")
            receipt = await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
            )
            if receipt["status"] != 1:
                raise SwapError(
                    f"{venue.display_name} ERC20 approval failed (tx: {approve_hash.hex()})"
                )
            nonce += 1

        # Step 2: swap via the venue router (style-specific calldata)
        swap_tx = venue_api.build_swap_tx(
            quote=gs_quote,
            recipient=sender,
            amount_out_min=amount_out_min,
        )

        gas_estimate = 300_000
        try:
            gas_estimate = await asyncio.to_thread(
                lambda: web3.eth.estimate_gas(
                    {
                        "from": Web3.to_checksum_address(sender),
                        "to": swap_tx["to"],
                        "data": swap_tx["data"],
                        "value": swap_tx["value"],
                    }
                )
            )
            gas_estimate = int(gas_estimate * 1.3)
        except Exception as e:
            logger.warning(f"{venue.display_name} gas estimate failed, using default 300k: {e}")

        # Venue headroom on top (Citrea: L1 fee surcharge not in estimateGas)
        gas_estimate = venue_api.apply_gas_headroom(gas_estimate)

        swap_tx.update(
            {
                "gas": gas_estimate,
                "gasPrice": gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
        )

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, swap_tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(
            f"{venue.display_name} exactInputSingle: {tx_hash.hex()} "
            f"({quote.from_token}→{quote.to_token} fee tier {gs_quote.fee_tier}) — "
            f"fire-and-monitor: swap receipt NOT awaited here; final status comes "
            f"from the tx poller"
        )
        return tx_hash.hex()

    async def _execute_tempo_dex_swap(
        self,
        quote: SwapQuote,
        wallet_data: dict,
        user_id: Optional[int] = None,
        automated: bool = False,
    ) -> str:
        """Execute a same-chain stablecoin swap on Tempo's enshrined DEX.

        Steps:
        1. Rebuild the swap/approval calldata from stored raw_quote (no re-quote).
        2. Approve the exact input amount to the enshrined DEX, wait for receipt.
        3. Call swapExactAmountIn with a min-out that carries a small (10 bps)
           execution buffer below the quoted out — the enshrined stablecoin DEX
           has minimal slippage, but the quote stores min-out == quoted-out, so a
           tiny buffer avoids a revert (and wasted gas) if the price ticks between
           quote and execution.

        Tempo gas is paid in TIP-20 stablecoins via legacy gasPrice (no EIP-1559),
        which matches our EVM send path everywhere else.

        Gasless path: when fee sponsorship is enabled and this user is within the
        sponsorship limits, the whole approve+swap is submitted as ONE Tempo
        type-0x76 transaction co-signed by a sponsor (fee payer) so the user pays
        no gas — see _execute_sponsored_tempo_swap(). ANY failure there falls
        through to the normal user-paid path below; sponsorship never breaks a swap.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        sender = wallet_data["address"]
        chain = get_chain_by_name("tempo")
        web3 = self._get_web3_with_fallback("tempo")
        raw = quote.raw_quote or {}

        amount_in = int(raw["amount_in"])
        # 10 bps execution buffer below the quoted/stored min-out (see docstring).
        min_amount_out = int(int(quote.to_amount_min) * 9990 // 10000)

        # --- Gasless (fee-payer) path, best-effort ---------------------------
        # Works for Turnkey wallets (sign via enclave) and local-key wallets alike.
        if user_id is not None and tempo_fee_sponsor.enabled:
            decision = tempo_fee_sponsor.check_sponsorship(user_id, tx_type="swap")
            if decision.should_sponsor:
                # Automated swaps (DCA/limit/snipe) sign with the user's scoped,
                # on-chain-capped access key if they granted one — no root key,
                # no re-auth. Manual swaps keep root signing.
                access_key = None
                if automated:
                    from bot.services.tempo_keychain import tempo_keychain_service

                    access_key = tempo_keychain_service.get_active_key(user_id)
                try:
                    tx_hash = await self._execute_sponsored_tempo_swap(
                        wallet=wallet,
                        sender=sender,
                        token_in=quote.from_token,
                        token_out=quote.to_token,
                        amount_in=amount_in,
                        min_amount_out=min_amount_out,
                        web3=web3,
                        chain_id=chain.chain_id,
                        access_key=access_key,
                    )
                    # Tempo gas is sub-$0.001; record against the daily budget.
                    tempo_fee_sponsor.record_sponsored_tx(user_id, fee_usd=0.001)
                    return tx_hash
                except Exception as e:
                    logger.warning(
                        f"Tempo sponsored (gasless) swap failed; "
                        f"falling back to user-paid path: {e}"
                    )
            else:
                logger.debug(f"Tempo sponsorship declined for {user_id}: {decision.reason}")

        txs = tempo_dex_api.build_swap_tx(
            token_in=quote.from_token,
            token_out=quote.to_token,
            amount_in=amount_in,
            min_amount_out=min_amount_out,
            sender=sender,
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)

        async def _send_and_wait(tx: dict, gas: int, label: str) -> None:
            """Sign, broadcast, and confirm a single legacy-gas Tempo tx."""
            nonlocal nonce
            tx = dict(tx)
            tx.update(
                {
                    "to": Web3.to_checksum_address(tx["to"]),
                    "value": tx.get("value", 0),
                    "gas": gas,
                    "gasPrice": gas_price,
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }
            )
            signed = await self.wallet_service.sign_evm_transaction(wallet, tx)
            sent = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed.replace("0x", "")))
            )
            logger.info(f"Tempo {label} tx: {sent.hex()}")
            rcpt = await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(sent, timeout=120)
            )
            if rcpt["status"] != 1:
                raise SwapError(f"Tempo {label} failed (tx: {sent.hex()})")
            nonce += 1

        # Step 1: approval — gasless EIP-2612 permit (TIP-1004) when enabled and the
        # wallet can sign locally; otherwise a standard approve() tx. A permit folds
        # approval into the swap path and replaces the separate approve() send.
        token_in_addr = raw.get("token_in") or get_token_address(quote.from_token, "tempo")
        permit_used = False
        swap_source = txs
        if settings.tempo_use_permit and not wallet.is_turnkey_wallet and token_in_addr:
            owner_key = None
            try:
                from bot.services.tempo_tip20 import tempo_tip20

                owner_key = self.wallet_service.get_private_key(wallet)
                if not owner_key.startswith("0x"):
                    owner_key = "0x" + owner_key
                v, r, s, deadline = await tempo_tip20.build_permit_signature(
                    token_address=token_in_addr,
                    owner_key=owner_key,
                    spender=tempo_dex_api.dex_address,
                    value=amount_in,
                )
                permit_bundle = tempo_dex_api.build_permit_swap_tx(
                    token_in=quote.from_token,
                    token_out=quote.to_token,
                    amount_in=amount_in,
                    min_amount_out=min_amount_out,
                    sender=sender,
                    permit_v=v,
                    permit_r=r,
                    permit_s=s,
                    permit_deadline=deadline,
                )
                await _send_and_wait(permit_bundle["permit_tx"], 120_000, "permit")
                swap_source = permit_bundle
                permit_used = True
            except Exception as e:
                logger.warning(f"Tempo permit approval failed, falling back to approve(): {e}")
            finally:
                if owner_key:
                    owner_key = None  # scrub the raw key reference

        if not permit_used:
            await _send_and_wait(txs["approval_tx"], 80_000, "approval")

        # Step 2: swapExactAmountIn on the enshrined DEX.
        swap_tx = dict(swap_source["swap_tx"])
        gas_estimate = 250_000
        try:
            gas_estimate = await asyncio.to_thread(
                lambda: web3.eth.estimate_gas(
                    {
                        "from": Web3.to_checksum_address(sender),
                        "to": swap_tx["to"],
                        "data": swap_tx["data"],
                        "value": swap_tx["value"],
                    }
                )
            )
            gas_estimate = int(gas_estimate * 1.3)
        except Exception as e:
            logger.warning(f"Tempo DEX gas estimate failed, using default 250k: {e}")

        swap_tx.update(
            {
                "gas": gas_estimate,
                "gasPrice": gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
        )

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, swap_tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )
        logger.info(
            f"Tempo DEX swapExactAmountIn: {tx_hash.hex()} "
            f"({quote.from_token}→{quote.to_token}) — fire-and-monitor: swap receipt "
            f"NOT awaited here; final status comes from the tx poller"
        )
        return tx_hash.hex()

    async def _execute_sponsored_tempo_swap(
        self,
        *,
        wallet,
        sender: str,
        token_in: str,
        token_out: str,
        amount_in: int,
        min_amount_out: int,
        web3,
        chain_id: int,
        access_key=None,
    ) -> str:
        """Submit a gasless Tempo swap as ONE type-0x76 fee-payer transaction.

        When ``access_key`` (a TempoAccessKey) is given — the automated path — the
        sender slot is signed by the scoped, on-chain-capped access key
        (KeychainSignature) instead of the root wallet, so no root key or per-trade
        re-auth is needed. The sponsor still pays gas.

        approve(DEX, amount_in) + swapExactAmountIn are batched into a single
        Tempo Transaction:
          - the user (sender) signs the sender hash with fee_token omitted
            (``awaiting_fee_payer=True``),
          - a sponsor HotWallet counter-signs as fee payer, choosing the fee
            token (pathUSD) and paying gas,
          - the dual-signed tx is broadcast via ``eth_sendRawTransaction``.

        Uses the official ``pytempo`` SDK so the type-0x76 RLP layout and the
        domain-separated (0x76 sender / 0x78 fee-payer) secp256k1 signatures are
        not hand-rolled. Both signatures are produced through _tempo_signature(),
        which signs the pre-computed hash via Turnkey (enclave) for Turnkey wallets
        or a local key otherwise — so this works for production Turnkey users AND
        local-key dev. Raises on ANY failure so the caller falls back to the
        user-paid path — sponsorship must never break a swap.
        """
        import attrs
        from pytempo import TempoTransaction
        from pytempo.contracts import TIP20, StablecoinDEX, PATH_USD

        from bot.config.tokens import get_token_address
        from bot.models.custodial import HotWallet
        from bot.services.hot_wallet import hot_wallet_service
        from database.db import get_session

        addr_in = get_token_address(token_in, "tempo")
        addr_out = get_token_address(token_out, "tempo")
        if not addr_in or not addr_out:
            raise SwapError(f"Tempo token pair {token_in}/{token_out} not available")
        fee_token = get_token_address(tempo_fee_sponsor.fee_token, "tempo") or PATH_USD

        # Load the sponsor (fee payer) hot wallet by configured name. For a local-key
        # sponsor we pull the raw key here (off the event loop); a Turnkey sponsor
        # signs via the enclave and exposes no key.
        sponsor_name = tempo_fee_sponsor.sponsor_wallet_name

        def _load_sponsor():
            with get_session() as session:
                sw = (
                    session.query(HotWallet)
                    .filter(HotWallet.name == sponsor_name, HotWallet.is_active == True)
                    .first()
                )
                if not sw:
                    raise SwapError(f"Tempo fee-sponsor wallet '{sponsor_name}' not found/active")
                turnkey = sw.is_turnkey_wallet
                return (
                    sw.address,
                    turnkey,
                    (None if turnkey else hot_wallet_service.get_private_key(sw)),
                )

        sponsor_address, sponsor_turnkey, sponsor_key = await asyncio.to_thread(_load_sponsor)

        # Tempo T2: fee payer must not equal sender.
        if sponsor_address.lower() == sender.lower():
            raise SwapError("Tempo fee payer cannot equal sender")

        sender_turnkey = wallet.is_turnkey_wallet
        # Root key only needed when NOT using an access key (and not Turnkey).
        sender_key = (
            None
            if (sender_turnkey or access_key is not None)
            else self.wallet_service.get_private_key(wallet)
        )

        # nonce_key 0 == protocol nonce, which is the standard account nonce.
        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price) or 2_000_000_000

        calls = (
            TIP20(Web3.to_checksum_address(addr_in)).approve(
                spender=StablecoinDEX.ADDRESS, amount=amount_in
            ),
            StablecoinDEX.swap_exact_amount_in(
                token_in=Web3.to_checksum_address(addr_in),
                token_out=Web3.to_checksum_address(addr_out),
                amount_in=amount_in,
                min_amount_out=min_amount_out,
            ),
        )

        tx = TempoTransaction.create(
            chain_id=chain_id,
            gas_limit=400_000,  # approve+swap on precompiles; ample headroom
            max_fee_per_gas=gas_price * 2,
            max_priority_fee_per_gas=gas_price,
            nonce=nonce,
            awaiting_fee_payer=True,  # sender does NOT commit to a fee token
            calls=calls,
        )

        # 1) Sign the 0x76 sender hash. Automated path: the scoped access key signs
        #    (KeychainSignature) on behalf of the root. Else the root wallet signs.
        if access_key is not None:
            from bot.services.tempo_keychain import tempo_keychain_service

            tx = tempo_keychain_service.sign_swap_with_access_key(tx, sender, access_key)
        else:
            sender_sig = await self._tempo_signature(
                address=sender,
                is_turnkey=sender_turnkey,
                raw_key=sender_key,
                hash32=tx.get_signing_hash(for_fee_payer=False),
            )
            tx = attrs.evolve(tx, sender_signature=sender_sig, sender_address=sender)

        # 2) Set the fee token, then the sponsor counter-signs the 0x78 hash (which
        #    commits to fee_token + sender_address).
        tx = attrs.evolve(tx, fee_token=fee_token)
        fee_payer_sig = await self._tempo_signature(
            address=sponsor_address,
            is_turnkey=sponsor_turnkey,
            raw_key=sponsor_key,
            hash32=tx.get_signing_hash(for_fee_payer=True),
        )
        tx = attrs.evolve(tx, fee_payer_signature=fee_payer_sig)

        raw = tx.encode()
        tx_hash = await asyncio.to_thread(lambda: web3.eth.send_raw_transaction(raw).hex())
        logger.info(
            f"Tempo gasless swap (type-0x76, fee payer {sponsor_address[:10]}…): "
            f"{tx_hash} ({token_in}→{token_out}) — fire-and-monitor: receipt NOT "
            f"awaited here; final status comes from the tx poller"
        )
        return tx_hash

    async def _tempo_signature(self, *, address: str, is_turnkey: bool, raw_key, hash32: bytes):
        """Sign a 32-byte Tempo signing hash, returning a pytempo ``Signature``.

        Turnkey wallets sign inside the enclave (no key leaves Turnkey); local-key
        wallets sign with eth_account — both yield the same canonical Signature so
        the caller attaches it via ``attrs.evolve`` regardless of provider.
        """
        if is_turnkey:
            from bot.services.tempo_turnkey_signer import sign_tempo_hash

            return await sign_tempo_hash(address, hash32)

        from eth_account import Account
        from pytempo.models import Signature

        key = raw_key if raw_key.startswith("0x") else "0x" + raw_key
        signed = Account.from_key(key).unsafe_sign_hash(hash32)
        return Signature(r=signed.r, s=signed.s, v=signed.v)

    async def _execute_usdt0_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a USDT0 (LayerZero OFT) transfer.

        Uses the calldata built at quote time verbatim — it never re-quotes,
        because a fresh `quoteSend` could return a different fee or
        minAmountLD than the one the user was shown.

        The approve is conditional and that is not an optimisation: it was
        verified on-chain per chain via `approvalRequired()`. The satellite
        chains (arbitrum, plasma, hyperevm, ink, unichain, berachain, flare)
        are native mint/burn OFTs and need NO ERC20 approve; Ethereum is a
        lockbox holding canonical Tether USDT and REQUIRES one. Sending an
        approve where none is needed only wastes gas, but omitting it on
        Ethereum makes the send revert. The quote decides, not this method.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        raw = quote.raw_quote or {}
        send_to = raw.get("send_to")
        send_data = raw.get("send_data")
        send_value = raw.get("send_value")

        # Fail closed rather than substituting defaults: a zero/absent value
        # would under-pay the LayerZero fee and the message would never be
        # delivered, stranding the transfer mid-flight.
        if not send_to or not send_data or send_value is None:
            raise SwapError(
                "USDT0 quote is missing execution data (send_to/send_data/send_value); "
                "refusing to execute."
            )

        sender = wallet_data["address"]
        chain = get_chain_by_name(quote.from_chain)
        web3 = self._get_web3_with_fallback(quote.from_chain)

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)

        # Step 1: approve, ONLY when the quote says this chain needs one.
        approval = raw.get("approval_tx")
        if approval:
            approve_tx = {
                "to": Web3.to_checksum_address(approval["to"]),
                "data": approval["data"],
                "value": 0,
                "gas": 100_000,
                "gasPrice": gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
            signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approve.replace("0x", ""))
                )
            )
            logger.info(f"USDT0 approval tx: {approve_hash.hex()}")

            receipt = await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
            )
            if receipt["status"] != 1:
                # Abort before send: an OFT send against a failed approval
                # would revert on-chain and waste the gas already spent here.
                raise SwapError(f"USDT0 ERC20 approval failed (tx: {approve_hash.hex()})")
            nonce += 1

        # Step 2: send() on the OFT. `value` is the buffered LayerZero
        # messaging fee; surplus is refunded to the sender by LayerZero
        # (_refundAddress was set to the sender at quote time).
        gas_estimate = 350_000
        try:
            estimated = await asyncio.to_thread(
                lambda: web3.eth.estimate_gas(
                    {
                        "from": Web3.to_checksum_address(sender),
                        "to": Web3.to_checksum_address(send_to),
                        "data": send_data,
                        "value": int(send_value),
                    }
                )
            )
            gas_estimate = max(gas_estimate, int(estimated * 1.3))
        except Exception as e:
            logger.warning(f"USDT0 send gas estimate failed, using {gas_estimate}: {e}")

        send_tx = {
            "to": Web3.to_checksum_address(send_to),
            "data": send_data,
            "value": int(send_value),
            "gas": gas_estimate,
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_send = await self.wallet_service.sign_evm_transaction(wallet, send_tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_send.replace("0x", "")))
        )

        logger.info(
            f"USDT0 send: {tx_hash.hex()} "
            f"({quote.from_chain}→{quote.to_chain} {quote.from_token}, "
            f"eid {raw.get('eid_src')}→{raw.get('eid_dst')})"
        )
        return tx_hash.hex()

    async def _execute_layerzero_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a cross-chain transfer via LayerZero/Stargate V2.

        Steps:
        1. Rebuild tx from stored quote data (no extra RPC calls)
        2. Approve ERC20 spend to Stargate pool (wait for receipt)
        3. Call sendToken() on the Stargate pool contract
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        sender = wallet_data["address"]
        chain = get_chain_by_name(quote.from_chain)
        web3 = self._get_web3_with_fallback(quote.from_chain)

        # Rebuild LZ quote from stored raw_quote data (avoids extra RPC round-trip)
        raw = quote.raw_quote
        from bot.services.layerzero_api import LayerZeroQuote

        lz_quote = LayerZeroQuote(
            src_chain=quote.from_chain,
            dst_chain=quote.to_chain,
            token_symbol=quote.from_token,
            amount_in=quote.from_amount,
            amount_out=quote.to_amount,
            amount_out_min=quote.to_amount_min,
            native_fee=raw.get("native_fee", "0"),
            native_fee_usd=quote.gas_cost_usd,
            estimated_time=quote.estimated_time,
            pool_address=self.layerzero.get_pool_address(quote.from_chain, quote.from_token),
            dst_eid=self.layerzero.get_dst_eid(quote.to_chain),
            raw_data=raw,
        )

        tx_bundle = self.layerzero.build_send_transaction(
            quote=lz_quote,
            sender_address=sender,
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(Web3.to_checksum_address(sender))
        )
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)

        # Step 1: ERC20 approval (wait for confirmation before sendToken)
        if "approval_tx" in tx_bundle:
            approve_tx = {
                "to": Web3.to_checksum_address(tx_bundle["approval_tx"]["to"]),
                "data": tx_bundle["approval_tx"]["data"],
                "value": 0,
                "gas": 100_000,
                "gasPrice": gas_price,
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
            signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approve.replace("0x", ""))
                )
            )
            logger.info(f"Stargate approval tx: {approve_hash.hex()}")

            # Wait for approval to confirm (up to 60s)
            receipt = await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=60)
            )
            if receipt["status"] != 1:
                raise SwapError(f"ERC20 approval failed (tx: {approve_hash.hex()})")
            logger.info(f"Stargate approval confirmed in block {receipt['blockNumber']}")
            nonce += 1

        # Step 2: sendToken on Stargate pool
        send_tx_data = tx_bundle["send_tx"]

        # Estimate gas with fallback
        gas_estimate = 350_000
        try:
            gas_estimate = await asyncio.to_thread(
                lambda: web3.eth.estimate_gas(
                    {
                        "from": Web3.to_checksum_address(sender),
                        "to": Web3.to_checksum_address(send_tx_data["to"]),
                        "data": send_tx_data["data"],
                        "value": send_tx_data["value"],
                    }
                )
            )
            gas_estimate = int(gas_estimate * 1.3)  # 30% buffer for LZ overhead
        except Exception as e:
            logger.warning(f"Gas estimate failed, using default 350k: {e}")

        send_tx = {
            "to": Web3.to_checksum_address(send_tx_data["to"]),
            "data": send_tx_data["data"],
            "value": send_tx_data["value"],
            "gas": gas_estimate,
            "gasPrice": gas_price,
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, send_tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(
            f"Stargate V2 sendToken: {tx_hash.hex()} "
            f"({quote.from_chain}→{quote.to_chain} {quote.from_token})"
        )
        return tx_hash.hex()

    async def _execute_cctp_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a USDC transfer via Circle CCTP (cheapest for USDC).

        This does approve + depositForBurn on the source chain. The burn is
        recorded with bot/services/cctp_generic_relayer.py (record_burn)
        BEFORE the depositForBurn tx is broadcast -- status="pending_broadcast",
        keyed on the tx hash recovered locally from the signed payload (see
        below) -- so a crash or a client-side broadcast error AFTER the raw
        tx already propagated still leaves a DB row the relayer's reconciler
        can find via the source-chain receipt. If pre-recording fails, this
        aborts BEFORE broadcasting (the safe direction: nothing burned). If
        recording succeeds but the broadcast itself raises, the row is left
        in pending_broadcast for the relayer to resolve -- an unrecorded burn
        is unmintable, but a recorded-then-unresolved one is recoverable.

        Still guarded upstream by `_is_cctp_route`, gated behind
        `settings.cctp_generic_rail_enabled` (default False, see that
        field's docstring in bot/config/settings.py for the exact live-test
        bar to clear before flipping it) — the relayer is code-complete but
        NOT yet live-verified end-to-end (real burn -> real attestation ->
        real mint on a real destination chain). Do not flip the gate without
        that verification.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Step 1: Approve USDC for TokenMessenger
        cctp_quote = await self.cctp.get_quote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            amount=quote.from_amount,
        )

        approve_tx = self.cctp.build_approve_transaction(cctp_quote, wallet_data["address"])

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        approve_tx["gas"] = 60000
        approve_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)
        approve_tx["nonce"] = nonce
        approve_tx["chainId"] = chain.chain_id

        signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
        approve_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(
                bytes.fromhex(signed_approve_hex.replace("0x", ""))
            )
        )
        logger.info(f"CCTP approval tx: {approve_hash.hex()}")

        # Wait for approval confirmation and verify it actually succeeded --
        # a burn built against a reverted/never-applied approval would itself
        # revert on-chain, wasting the gas the user already spent on approve.
        approve_receipt = await asyncio.to_thread(
            lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
        )
        if approve_receipt.get("status") != 1:
            raise SwapError(
                f"CCTP USDC approval failed (tx: {approve_hash.hex()}); aborting before burn "
                "to avoid submitting a depositForBurn that can't possibly succeed."
            )

        # Step 2: Execute depositForBurn
        burn_tx = self.cctp.build_burn_transaction(
            cctp_quote, wallet_data["address"], wallet_data["address"]  # Same recipient
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        # V2 depositForBurn (7 args: adds destinationCaller/maxFee/minFinality
        # vs V1) does strictly more work than V1's 4-arg call, so a v1-sized
        # gas limit can be too low. Estimate live, with 200k kept only as the
        # floor/fallback if estimation itself fails.
        gas_estimate = 200000
        try:
            estimated = await asyncio.to_thread(
                lambda: web3.eth.estimate_gas(
                    {
                        "from": Web3.to_checksum_address(wallet_data["address"]),
                        "to": burn_tx["to"],
                        "data": burn_tx["data"],
                        "value": burn_tx["value"],
                    }
                )
            )
            gas_estimate = max(gas_estimate, int(estimated * 1.3))
        except Exception as e:
            logger.warning(f"CCTP burn gas estimate failed, using default {gas_estimate}: {e}")
        burn_tx["gas"] = gas_estimate
        burn_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)
        burn_tx["nonce"] = nonce
        burn_tx["chainId"] = chain.chain_id

        signed_burn_hex = await self.wallet_service.sign_evm_transaction(wallet, burn_tx)
        signed_raw_bytes = bytes.fromhex(signed_burn_hex.replace("0x", ""))

        # The tx hash is deterministic from the signed payload -- recover it
        # LOCALLY, before ever broadcasting. This is what makes pre-broadcast
        # recording possible: record_burn(status="pending_broadcast") below
        # persists a DB row keyed on this same hash BEFORE send_raw_transaction
        # runs, so a crash or a client-side error AFTER the raw tx already
        # propagated (a real failure mode on congested RPCs -- e.g. a read
        # timeout on send_raw_transaction/wait_for_receipt) still leaves a row
        # for the relayer's reconciler to find via get_transaction_receipt.
        # Recording strictly AFTER broadcasting (the previous behaviour) has
        # no such row for that window -- the burn is on-chain but nowhere in
        # the DB, i.e. permanently unmintable.
        burn_hex = Web3.keccak(signed_raw_bytes).hex()
        if not burn_hex.startswith("0x"):
            burn_hex = "0x" + burn_hex

        from bot.services.cctp_generic_relayer import cctp_generic_relayer

        try:
            cctp_generic_relayer.record_burn(
                user_id=wallet_data["user_id"],
                recipient_address=wallet_data["address"],
                from_chain=quote.from_chain,
                to_chain=quote.to_chain,
                burn_tx_hash=burn_hex,
                amount_raw=int(cctp_quote.from_amount),
                version=getattr(cctp_quote, "version", 2),
                status="pending_broadcast",
            )
        except Exception as e:  # noqa: BLE001 — safe direction: abort BEFORE broadcasting
            logger.error(
                "CCTP burn for %s could not be pre-recorded with the completion relayer -- "
                "aborting BEFORE broadcast (no funds burned). Error: %s",
                burn_hex,
                e,
            )
            raise SwapError(
                f"CCTP burn could not be prepared for completion tracking ({e}). "
                "Nothing was burned on-chain -- please retry."
            ) from e

        try:
            burn_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(signed_raw_bytes)
            )
        except Exception as e:
            # The raw tx may have propagated despite this exception (e.g. a
            # client-side read timeout on a congested RPC). We do NOT delete
            # or touch the pending_broadcast row here -- it stays exactly as
            # recorded, and cctp_generic_relayer._reconcile_pending_broadcasts
            # resolves it by checking get_transaction_receipt(burn_hex) on the
            # source chain: if it landed, it's promoted to "burned" and
            # relayed normally; if it never propagated, admins are alerted
            # after an hour with no receipt and the user can safely retry
            # (nothing was burned).
            logger.error(
                "CCTP burn %s broadcast raised (tx may still have propagated) -- left in "
                "pending_broadcast for the relayer's reconciler to resolve via on-chain "
                "receipt lookup. Error: %s",
                burn_hex,
                e,
            )
            raise SwapError(
                f"CCTP burn broadcast failed ({e}). If it actually landed on-chain (tx "
                f"{burn_hex}), it will still be detected and relayed automatically -- do "
                "NOT retry without checking that hash first."
            ) from e

        broadcast_hex = burn_hash.hex()
        if not broadcast_hex.startswith("0x"):
            broadcast_hex = "0x" + broadcast_hex
        if broadcast_hex.lower() != burn_hex.lower():
            # Should be mathematically impossible (same signed payload,
            # deterministic keccak) -- if it ever happens, the RPC's
            # send_raw_transaction returned something we didn't predict, so
            # trust the LOCAL hash for pending_broadcast bookkeeping and fail
            # loud rather than silently relaying under a hash the DB doesn't
            # have a row for.
            logger.error(
                "CCTP burn hash mismatch: locally-derived %s != RPC-returned %s -- "
                "recording under the locally-derived hash regardless (that's the row "
                "already persisted pre-broadcast).",
                burn_hex,
                broadcast_hex,
            )

        logger.info(f"CCTP burn tx: {burn_hex}")

        # Promote pending_broadcast -> burned now that we know the broadcast
        # itself returned successfully (no exception). Best-effort: even if
        # this fails, _reconcile_pending_broadcasts will promote it on the
        # next relayer pass once it observes the on-chain receipt.
        try:
            cctp_generic_relayer.mark_broadcast(burn_hex)
        except Exception as e:  # noqa: BLE001 — non-fatal; reconciler will catch it
            logger.warning(
                "CCTP burn %s broadcast succeeded but mark_broadcast failed (relayer's "
                "reconciler will promote it from pending_broadcast on the next pass): %s",
                burn_hex,
                e,
            )

        return burn_hex

    async def _execute_across_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a bridge via Across Protocol (cheap EVM bridges)."""
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Honor the recipient captured at quote time; fall back to the sender.
        recipient = (quote.raw_quote or {}).get("recipient") or wallet_data["address"]

        # Get fresh quote with deposit data (for the same recipient)
        across_quote = await self.across.get_quote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            token=quote.from_token,
            amount=quote.from_amount,
            from_address=wallet_data["address"],
            to_address=recipient,
        )

        # Check if token needs approval (not ETH)
        if (
            quote.from_token.upper() not in ["ETH", "WETH"]
            or self.across.get_token_address(quote.from_token, quote.from_chain)
            != "0x0000000000000000000000000000000000000000"
        ):
            # Approve token for SpokePool
            token_address = self.across.get_token_address(quote.from_token, quote.from_chain)

            erc20_approve_abi = [
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "stateMutability": "nonpayable",
                    "type": "function",
                }
            ]

            token_contract = web3.eth.contract(
                address=Web3.to_checksum_address(token_address), abi=erc20_approve_abi
            )

            approve_data = token_contract.encode_abi(
                "approve",
                args=[Web3.to_checksum_address(across_quote.spoke_pool), int(quote.from_amount)],
            )

            nonce = await asyncio.to_thread(
                lambda: web3.eth.get_transaction_count(wallet_data["address"])
            )
            approve_tx = {
                "to": Web3.to_checksum_address(token_address),
                "data": approve_data,
                "value": 0,
                "gas": 60000,
                "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
                "nonce": nonce,
                "chainId": chain.chain_id,
            }

            signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approve_hex.replace("0x", ""))
                )
            )
            logger.info(f"Across approval tx: {approve_hash.hex()}")

            # Wait for approval
            await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
            )

        # Build deposit transaction — deposit to the intended recipient.
        deposit_tx = self.across.build_deposit_calldata(
            across_quote,
            wallet_data["address"],
            to_address=recipient,
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        deposit_tx["gas"] = 300000
        deposit_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)
        deposit_tx["nonce"] = nonce
        deposit_tx["chainId"] = chain.chain_id

        signed_deposit_hex = await self.wallet_service.sign_evm_transaction(wallet, deposit_tx)
        deposit_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(
                bytes.fromhex(signed_deposit_hex.replace("0x", ""))
            )
        )

        logger.info(f"Across deposit tx: {deposit_hash.hex()}")
        return deposit_hash.hex()

    async def _execute_wormhole_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a bridge via Wormhole (Solana <-> EVM)."""
        is_solana_source = quote.from_chain.lower() == "solana"

        if is_solana_source:
            # Solana -> EVM: Not implemented yet (requires Solana signing)
            raise SwapError(
                "Solana to EVM bridging via Wormhole is not yet supported. "
                "Please bridge manually at portal.wormhole.com"
            )

        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        # EVM -> Solana or EVM -> EVM
        chain = get_chain_by_name(quote.from_chain)
        web3 = rpc_manager.get_web3(quote.from_chain)

        # Get Wormhole quote
        wormhole_quote = await self.wormhole.get_quote(
            from_chain=quote.from_chain,
            to_chain=quote.to_chain,
            token=quote.from_token,
            amount=quote.from_amount,
        )

        # Step 1: Approve token for Token Bridge
        token_address = self.wormhole.get_token_address(quote.from_token, quote.from_chain)
        token_bridge = self.wormhole.get_token_bridge(quote.from_chain)

        erc20_approve_abi = [
            {
                "inputs": [
                    {"name": "spender", "type": "address"},
                    {"name": "amount", "type": "uint256"},
                ],
                "name": "approve",
                "outputs": [{"name": "", "type": "bool"}],
                "stateMutability": "nonpayable",
                "type": "function",
            }
        ]

        token_contract = web3.eth.contract(
            address=Web3.to_checksum_address(token_address), abi=erc20_approve_abi
        )

        approve_data = token_contract.encode_abi(
            "approve", args=[Web3.to_checksum_address(token_bridge), int(quote.from_amount)]
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        approve_tx = {
            "to": Web3.to_checksum_address(token_address),
            "data": approve_data,
            "value": 0,
            "gas": 60000,
            "gasPrice": await asyncio.to_thread(lambda: web3.eth.gas_price),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_approve_hex = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
        approve_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(
                bytes.fromhex(signed_approve_hex.replace("0x", ""))
            )
        )
        logger.info(f"Wormhole approval tx: {approve_hash.hex()}")

        # Wait for approval
        await asyncio.to_thread(
            lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
        )

        # Step 2: Transfer tokens via Token Bridge
        transfer_tx = self.wormhole.build_transfer_calldata_evm(
            wormhole_quote,
            wallet_data["address"],
        )

        nonce = await asyncio.to_thread(
            lambda: web3.eth.get_transaction_count(wallet_data["address"])
        )
        transfer_tx["gas"] = 300000
        transfer_tx["gasPrice"] = await asyncio.to_thread(lambda: web3.eth.gas_price)
        transfer_tx["nonce"] = nonce
        transfer_tx["chainId"] = chain.chain_id

        signed_transfer_hex = await self.wallet_service.sign_evm_transaction(wallet, transfer_tx)
        transfer_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(
                bytes.fromhex(signed_transfer_hex.replace("0x", ""))
            )
        )

        logger.info(f"Wormhole transfer tx: {transfer_hash.hex()}")
        return transfer_hash.hex()

    async def _execute_sunswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via SunSwap V2 on TRON.

        Steps:
        1. Check & send TRC20 approval if needed (token -> token or token -> TRX)
        2. Build swap transaction via SunSwap V2 Router
        3. Sign and broadcast via TronGrid
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        from_address = wallet_data["address"]
        from_token_address = get_token_address(quote.from_token, "tron")
        private_key_hex = self.wallet_service.get_tron_private_key(wallet)

        raw = quote.raw_quote
        path = raw.get("path", [])
        amount_in = int(quote.from_amount)
        amount_out_min = int(quote.to_amount_min)

        # Step 1: TRC20 approval if swapping a token (not native TRX)
        is_from_native = from_token_address.lower() in ("native", "trx", "")
        if not is_from_native:
            current_allowance = await self.sunswap.get_allowance(
                token_address=from_token_address,
                owner_address=from_address,
            )
            if current_allowance < amount_in:
                logger.info(f"SunSwap: approving {from_token_address} for Router")
                approve_tx = await self.sunswap.build_approve_transaction(
                    token_address=from_token_address,
                    owner_address=from_address,
                )
                approve_hash = await self.sunswap.sign_and_broadcast(approve_tx, private_key_hex)
                logger.info(f"SunSwap approval tx: {approve_hash}")
                # Wait briefly for approval to propagate
                await asyncio.sleep(3)

        # Step 2: Build swap transaction
        swap_tx = await self.sunswap.build_swap_transaction(
            from_address=from_address,
            from_token=from_token_address,
            to_token=get_token_address(quote.to_token, "tron"),
            amount_in=amount_in,
            amount_out_min=amount_out_min,
            path=path,
        )

        # Step 3: Sign and broadcast
        tx_hash = await self.sunswap.sign_and_broadcast(swap_tx, private_key_hex)
        logger.info(f"SunSwap swap tx: {tx_hash} ({quote.from_token}→{quote.to_token})")

        return tx_hash

    async def _execute_avnu_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a Starknet swap via AVNU.

        Routing (Phase 2):
        - Wallet undeployed or no STRK for gas → SNIP-29 paymaster path
          (deploy_and_invoke when undeployed; gas sponsored or paid in a
          held gas token). ONLY pre-submission paymaster failures
          (PaymasterUnavailableError) fall back to the direct path below;
          once the paymaster tx may have been dispatched
          (PaymasterSubmittedError) we never re-execute.
        - Otherwise: ensure deployed, then sign+send approve+swap as a single
          v3 (STRK-fee) multicall — the approval is exact-amount, never infinite.

        Key-material note: _zeroize_str scrubs only the private-key STRING;
        the int copies of the key held inside starknet_py's KeyPair (Python
        ints are immutable) cannot be zeroized and live until GC.
        """
        from bot.services.avnu_api import avnu_api, AvnuQuote, _to_int
        from bot.services.starknet.client import get_starknet_account
        from bot.services.starknet.paymaster import (
            PaymasterSubmittedError,
            PaymasterUnavailableError,
        )
        from bot.services.wallet import _zeroize_str

        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        sell_token_address = get_token_address(quote.from_token, "starknet")
        buy_token_address = get_token_address(quote.to_token, "starknet")
        if not sell_token_address or not buy_token_address:
            raise SwapError(
                f"Token not supported on Starknet: {quote.from_token} or {quote.to_token}"
            )

        # The approve amount must be AVNU's own sellAmount (the value the route
        # was built for), not our pre-quote input — they can differ.
        sell_amount = _to_int(quote.raw_quote.get("sellAmount"))
        if sell_amount <= 0:
            raise SwapError("AVNU quote is missing sellAmount — re-quote and try again")

        avnu_quote = AvnuQuote(
            quote_id=quote.raw_quote.get("quoteId", ""),
            sell_token_address=sell_token_address,
            buy_token_address=buy_token_address,
            sell_amount=sell_amount,
            buy_amount=int(quote.to_amount),
            gas_fees_in_usd=quote.gas_cost_usd,
            integrator_fees_bps=quote.platform_fee_bps or 0,
            raw_response=quote.raw_quote,
        )
        if not avnu_quote.quote_id:
            raise SwapError("AVNU quote is missing quoteId — re-quote and try again")

        # Use the exact slippage the user quoted with (stashed at quote time);
        # only fall back to the lossy min-out derivation for stale quotes.
        slippage_bps = quote.raw_quote.get("suwappu_slippage_bps")
        if slippage_bps is not None:
            slippage = max(0.001, int(slippage_bps) / 10_000)
        else:
            to_amount = int(quote.to_amount)
            to_amount_min = int(quote.to_amount_min)
            slippage = max(0.001, 1 - (to_amount_min / to_amount)) if to_amount > 0 else 0.005

        # Decide whether the gasless paymaster path applies: wallet not yet
        # deployed, or deployed but holding no STRK to self-pay v3 fees.
        use_paymaster = False
        deployed = True
        if settings.starknet_paymaster_enabled:
            try:
                deployed = await self.wallet_service.is_starknet_deployed(wallet.address)
                if deployed:
                    strk_balance = await self.wallet_service.get_starknet_token_balance(
                        "STRK", wallet.address
                    )
                    use_paymaster = strk_balance <= 0
                else:
                    use_paymaster = True
            except Exception as e:
                logger.warning("Paymaster eligibility check failed: %s", str(e)[:200])

        private_key = self.wallet_service.get_private_key(wallet)
        try:
            account = await get_starknet_account(private_key, wallet.address)

            paymaster_error: Optional[Exception] = None
            tx_hash: Optional[str] = None
            if use_paymaster:
                try:
                    tx_hash = await self._execute_avnu_swap_via_paymaster(
                        account, wallet, avnu_quote, slippage, deployed
                    )
                except PaymasterUnavailableError as e:
                    # Tx definitely NOT submitted — safe to fall back.
                    paymaster_error = e
                    logger.warning(
                        "AVNU paymaster swap failed before submission (%s); "
                        "falling back to direct execution",
                        str(e)[:200],
                    )
                except PaymasterSubmittedError as e:
                    # The paymaster tx MAY have landed — NEVER fire the direct
                    # path (double-execution risk). Poll briefly, then tell the
                    # user to check their balance.
                    logger.warning(
                        "AVNU paymaster swap dispatched without a usable response "
                        "(%s); refusing direct fallback",
                        str(e)[:200],
                    )
                    for _ in range(3):
                        await asyncio.sleep(5)
                        try:
                            if not deployed and await self.wallet_service.is_starknet_deployed(
                                wallet.address
                            ):
                                break
                            await account.get_nonce()
                        except Exception:
                            pass
                    raise SwapError(
                        "Your swap was submitted via the gasless paymaster but we did "
                        "not receive a confirmation — it may still confirm on-chain. "
                        "Check your balance shortly before retrying."
                    ) from e

            if tx_hash is None:
                try:
                    # Counterfactual accounts must be deployed before their first invoke
                    await self.wallet_service.ensure_starknet_deployed(wallet)
                    tx_hash = await avnu_api.execute_swap(account, avnu_quote, slippage=slippage)
                except Exception as direct_error:
                    if paymaster_error is not None:
                        raise SwapError(
                            "Starknet swap failed via both the gasless paymaster "
                            f"({str(paymaster_error)[:150]}) and direct execution "
                            f"({str(direct_error)[:150]})"
                        ) from direct_error
                    raise
        finally:
            _zeroize_str(private_key)

        logger.info(f"AVNU swap tx: {tx_hash} ({quote.from_token}→{quote.to_token})")
        return tx_hash

    async def _execute_avnu_swap_via_paymaster(
        self,
        account,
        wallet,
        avnu_quote,
        slippage: float,
        deployed: bool,
    ) -> str:
        """Execute an AVNU swap through the SNIP-29 paymaster.

        Gas token: sponsored when an API key is configured; otherwise the
        first of STRK → ETH → USDC that the paymaster supports AND the wallet
        holds. The sell token itself is used only as a last resort (gas fees
        would eat into the exact-approved sell amount and could revert the
        swap). Undeployed wallets go through deploy_and_invoke with the Argent
        deployment data derived from the account's stark pubkey.
        """
        from bot.config import starknet_addresses as sn
        from bot.services.avnu_api import avnu_api
        from bot.services.starknet.paymaster import avnu_paymaster, build_argent_deployment

        gas_token = None
        if not settings.avnu_paymaster_api_key:
            supported = await avnu_paymaster.get_supported_tokens()
            supported_addrs = set()
            for t in supported:
                addr = t.get("token_address") or t.get("tokenAddress") or t.get("address")
                if addr:
                    supported_addrs.add(int(str(addr), 16))
            # Priority: STRK → ETH → USDC (supported by the paymaster AND held).
            for symbol, token_addr in (("STRK", sn.STRK), ("ETH", sn.ETH), ("USDC", sn.USDC)):
                if int(token_addr, 16) not in supported_addrs:
                    continue
                try:
                    balance = await self.wallet_service.get_starknet_token_balance(
                        symbol, wallet.address
                    )
                except Exception as e:
                    logger.warning(
                        "Gas-token balance check failed for %s: %s", symbol, str(e)[:100]
                    )
                    continue
                if balance > 0:
                    gas_token = token_addr
                    break
            if gas_token is None:
                if int(str(avnu_quote.sell_token_address), 16) in supported_addrs:
                    gas_token = avnu_quote.sell_token_address
                    logger.warning(
                        "Paymaster gas will be paid in the sell token %s (last resort) — "
                        "fees reduce the exact-approved sell amount and the swap may revert",
                        avnu_quote.sell_token_address,
                    )
                else:
                    raise SwapError(
                        "Paymaster accepts none of your STRK/ETH/USDC balances "
                        "nor the sell token as gas token"
                    )

        deployment = None
        if not deployed:
            deployment = build_argent_deployment(wallet.address, account.signer.public_key)

        calls = await avnu_api.prepare_swap_calls(
            taker_address=hex(account.address), quote=avnu_quote, slippage=slippage
        )
        tx_hash = await avnu_paymaster.execute_calls_via_paymaster(
            account, calls, gas_token=gas_token, deployment=deployment
        )
        logger.info("AVNU paymaster swap submitted: %s", tx_hash)
        return tx_hash

    async def _execute_okx_dex_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via OKX DEX Aggregator.

        OKX returns transaction calldata — we sign and broadcast like Li.Fi.
        Supports EVM, Solana, and TRON chains.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        raw = quote.raw_quote
        tx_data = raw.get("tx_data")
        if not tx_data:
            # Need to fetch swap data with tx calldata
            chain_id = raw.get("chain_id") or OKX_CHAIN_IDS.get(quote.from_chain.lower())
            from_token_address = get_token_address(quote.from_token, quote.from_chain)
            to_token_address = get_token_address(quote.to_token, quote.to_chain)

            swap_slippage = quote.raw_quote.get("slippage", 0.5) if quote.raw_quote else 0.5
            swap_result = await self.okx_dex.get_swap(
                chain_id=chain_id,
                from_token=from_token_address,
                to_token=to_token_address,
                amount=quote.from_amount,
                user_address=wallet_data["address"],
                slippage=swap_slippage,
                platform_fee_bps=quote.platform_fee_bps,
            )
            self._assert_fresh_min_out_acceptable(quote, swap_result.to_amount_min, "OKX DEX")
            tx_data = swap_result.tx_data

        if not tx_data:
            raise SwapError("OKX DEX did not return transaction data")

        chain = get_chain_by_name(quote.from_chain)

        if chain.chain_type == ChainType.SOLANA:
            # Solana: OKX returns base64-encoded transaction
            tx_bytes = base64.b64decode(tx_data.get("data", ""))
            signed_tx = await self.wallet_service.sign_solana_transaction(wallet, tx_bytes)

            session = await get_http_session()
            payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "sendTransaction",
                "params": [
                    base64.b64encode(signed_tx).decode(),
                    {"encoding": "base64", "skipPreflight": False},
                ],
            }
            async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
                result = await resp.json()
                if "error" in result:
                    raise SwapError(f"OKX DEX Solana tx failed: {result['error']}")
                return result["result"]

        elif chain.chain_type == ChainType.TRON:
            # TRON: sign and broadcast via TronGrid
            private_key_hex = self.wallet_service.get_tron_private_key(wallet)
            # OKX returns transaction data that needs to be broadcast
            tx_hash = await self.sunswap.sign_and_broadcast(tx_data, private_key_hex)
            logger.info(f"OKX DEX TRON swap tx: {tx_hash}")
            return tx_hash

        else:
            # EVM: standard tx signing
            web3 = self.wallet_service._get_web3(quote.from_chain)
            sender = Web3.to_checksum_address(wallet_data["address"])

            # Handle ERC20 approval if needed
            from_token_address = get_token_address(quote.from_token, quote.from_chain)
            spender = Web3.to_checksum_address(tx_data.get("to", ""))

            if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
                token_addr = Web3.to_checksum_address(from_token_address)
                erc20_abi = [
                    {
                        "inputs": [
                            {"name": "owner", "type": "address"},
                            {"name": "spender", "type": "address"},
                        ],
                        "name": "allowance",
                        "outputs": [{"name": "", "type": "uint256"}],
                        "type": "function",
                        "stateMutability": "view",
                    },
                    {
                        "inputs": [
                            {"name": "spender", "type": "address"},
                            {"name": "amount", "type": "uint256"},
                        ],
                        "name": "approve",
                        "outputs": [{"name": "", "type": "bool"}],
                        "type": "function",
                        "stateMutability": "nonpayable",
                    },
                ]
                token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
                amount_needed = int(quote.from_amount)
                current_allowance = await asyncio.to_thread(
                    lambda: token_contract.functions.allowance(sender, spender).call()
                )

                if current_allowance < amount_needed:
                    nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                    gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                    # 'exact' mode on a reset-required token (USDT mainnet): zero the
                    # allowance first, since approve() reverts non-zero -> non-zero.
                    nonce = await self._send_reset_approval_if_needed(
                        web3=web3,
                        token_contract=token_contract,
                        token_addr=token_addr,
                        spender=spender,
                        current_allowance=current_allowance,
                        sender=sender,
                        chain_id=chain.chain_id,
                        gas_price=gas_price,
                        nonce=nonce,
                        wallet=wallet,
                    )
                    max_approval = self._approval_amount(amount_needed)
                    approve_data = token_contract.functions.approve(
                        spender, max_approval
                    ).build_transaction(
                        {
                            "from": sender,
                            "nonce": nonce,
                            "chainId": chain.chain_id,
                            "gasPrice": gas_price,
                        }
                    )
                    approve_tx = {
                        "to": token_addr,
                        "data": approve_data["data"],
                        "value": 0,
                        "gas": approve_data.get("gas", 60000),
                        "gasPrice": approve_data["gasPrice"],
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                    }
                    signed_approve = await self.wallet_service.sign_evm_transaction(
                        wallet, approve_tx
                    )
                    approve_hash = await asyncio.to_thread(
                        lambda: web3.eth.send_raw_transaction(
                            bytes.fromhex(signed_approve.replace("0x", ""))
                        )
                    )
                    logger.info(f"OKX DEX approval tx: {approve_hash.hex()}")
                    await asyncio.to_thread(
                        lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                    )

            nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
            tx = {
                "to": spender,
                "data": tx_data.get("data", ""),
                "value": _parse_int(tx_data.get("value"), 0),
                "gas": _parse_int(tx_data.get("gas"), 500000),
                "gasPrice": _parse_int(
                    tx_data.get("gasPrice"), await asyncio.to_thread(lambda: web3.eth.gas_price)
                ),
                "nonce": nonce,
                "chainId": chain.chain_id,
            }

            signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
            tx_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_tx_hex.replace("0x", ""))
                )
            )

            logger.info(f"OKX DEX swap tx: {tx_hash.hex()}")
            return tx_hash.hex()

    async def _execute_1inch_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via the 1inch Aggregation Protocol (EVM-only).

        1inch returns ready-to-broadcast tx calldata ({to, data, value, gas, gasPrice});
        we handle ERC20 approval to the 1inch router, then sign and broadcast — the
        same flow as the OKX/Li.Fi EVM path.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain_id = quote.raw_quote.get("chain_id") or ONEINCH_CHAIN_IDS.get(
            quote.from_chain.lower()
        )
        if not chain_id:
            raise SwapError(f"1inch does not support chain: {quote.from_chain}")

        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        to_token_address = get_token_address(quote.to_token, quote.to_chain)

        # Always fetch fresh tx calldata at execution time (the race used /quote only).
        swap_slippage = quote.raw_quote.get("slippage", 0.5) if quote.raw_quote else 0.5
        swap_result = await self.oneinch.get_swap(
            chain_id=chain_id,
            from_token=self._to_1inch_token(from_token_address),
            to_token=self._to_1inch_token(to_token_address),
            amount=quote.from_amount,
            user_address=wallet_data["address"],
            slippage=swap_slippage,
            platform_fee_bps=quote.platform_fee_bps,
        )
        self._assert_fresh_min_out_acceptable(quote, swap_result.to_amount_min, "1inch")
        tx_data = swap_result.tx_data
        if not tx_data:
            raise SwapError("1inch did not return transaction data")

        chain = get_chain_by_name(quote.from_chain)
        web3 = self.wallet_service._get_web3(quote.from_chain)
        sender = Web3.to_checksum_address(wallet_data["address"])
        spender = Web3.to_checksum_address(tx_data.get("to", ""))

        # ERC20 approval to the 1inch router if spending a token (not native).
        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            amount_needed = int(quote.from_amount)
            current_allowance = await asyncio.to_thread(
                lambda: token_contract.functions.allowance(sender, spender).call()
            )

            if current_allowance < amount_needed:
                nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                # 'exact' mode on a reset-required token (USDT mainnet): zero the
                # allowance first, since approve() reverts non-zero -> non-zero.
                nonce = await self._send_reset_approval_if_needed(
                    web3=web3,
                    token_contract=token_contract,
                    token_addr=token_addr,
                    spender=spender,
                    current_allowance=current_allowance,
                    sender=sender,
                    chain_id=chain.chain_id,
                    gas_price=gas_price,
                    nonce=nonce,
                    wallet=wallet,
                )
                max_approval = self._approval_amount(amount_needed)
                approve_data = token_contract.functions.approve(
                    spender, max_approval
                ).build_transaction(
                    {
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": gas_price,
                    }
                )
                approve_tx = {
                    "to": token_addr,
                    "data": approve_data["data"],
                    "value": 0,
                    "gas": approve_data.get("gas", 60000),
                    "gasPrice": approve_data["gasPrice"],
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }
                signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
                approve_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approve.replace("0x", ""))
                    )
                )
                logger.info(f"1inch approval tx: {approve_hash.hex()}")
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        tx = {
            "to": spender,
            "data": tx_data.get("data", ""),
            "value": _parse_int(tx_data.get("value"), 0),
            "gas": _parse_int(tx_data.get("gas"), 500000),
            "gasPrice": _parse_int(
                tx_data.get("gasPrice"), await asyncio.to_thread(lambda: web3.eth.gas_price)
            ),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"1inch swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _execute_0x_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via the 0x Swap API v2 allowance-holder flow (EVM-only).

        0x returns ready-to-broadcast tx calldata in `transaction` ({to, data,
        value, gas}). CRITICAL: the ERC20 spender to approve is the
        AllowanceHolder contract at `issues.allowance.spender` — NOT
        transaction.to, which is the Settler execution contract. We approve the
        spender, then sign and broadcast the tx to transaction.to — the same
        EVM flow as the OKX / Li.Fi / 1inch path.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain_id = quote.raw_quote.get("chain_id") or ZEROX_CHAIN_IDS.get(quote.from_chain.lower())
        if not chain_id:
            raise SwapError(f"0x does not support chain: {quote.from_chain}")

        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        to_token_address = get_token_address(quote.to_token, quote.to_chain)

        # Always fetch fresh tx calldata at execution time (the race used /price only).
        swap_slippage = quote.raw_quote.get("slippage", 0.5) if quote.raw_quote else 0.5
        swap_result = await self.zerox.get_swap(
            chain_id=chain_id,
            from_token=self._to_0x_token(from_token_address),
            to_token=self._to_0x_token(to_token_address),
            amount=quote.from_amount,
            user_address=wallet_data["address"],
            slippage=swap_slippage,
            platform_fee_bps=quote.platform_fee_bps,
        )
        self._assert_fresh_min_out_acceptable(
            quote,
            swap_result.to_amount_min,
            "0x",
            fresh_is_synthetic=getattr(swap_result, "min_out_synthetic", False),
        )
        tx_data = swap_result.tx_data
        if not tx_data:
            raise SwapError("0x did not return transaction data")

        chain = get_chain_by_name(quote.from_chain)
        web3 = self.wallet_service._get_web3(quote.from_chain)
        sender = Web3.to_checksum_address(wallet_data["address"])

        # 0x v2: the tx target (Settler) is transaction.to; the ERC20 spender to
        # approve is the AllowanceHolder at issues.allowance.spender — these differ.
        tx_to = Web3.to_checksum_address(tx_data.get("to", ""))

        # ERC20 approval to the 0x AllowanceHolder spender if spending a token
        # (not native). 0x sets issues.allowance to null when no approval is
        # needed (already approved) — guard against that.
        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            issues = swap_result.raw_response.get("issues") or {}
            allowance_issue = issues.get("allowance") or {}
            spender_raw = allowance_issue.get("spender")

            if spender_raw:
                spender = Web3.to_checksum_address(spender_raw)
                token_addr = Web3.to_checksum_address(from_token_address)
                erc20_abi = [
                    {
                        "inputs": [
                            {"name": "owner", "type": "address"},
                            {"name": "spender", "type": "address"},
                        ],
                        "name": "allowance",
                        "outputs": [{"name": "", "type": "uint256"}],
                        "type": "function",
                        "stateMutability": "view",
                    },
                    {
                        "inputs": [
                            {"name": "spender", "type": "address"},
                            {"name": "amount", "type": "uint256"},
                        ],
                        "name": "approve",
                        "outputs": [{"name": "", "type": "bool"}],
                        "type": "function",
                        "stateMutability": "nonpayable",
                    },
                ]
                token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
                amount_needed = int(quote.from_amount)
                current_allowance = await asyncio.to_thread(
                    lambda: token_contract.functions.allowance(sender, spender).call()
                )

                if current_allowance < amount_needed:
                    nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                    gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                    # 'exact' mode on a reset-required token (USDT mainnet): zero the
                    # allowance first, since approve() reverts non-zero -> non-zero.
                    nonce = await self._send_reset_approval_if_needed(
                        web3=web3,
                        token_contract=token_contract,
                        token_addr=token_addr,
                        spender=spender,
                        current_allowance=current_allowance,
                        sender=sender,
                        chain_id=chain.chain_id,
                        gas_price=gas_price,
                        nonce=nonce,
                        wallet=wallet,
                    )
                    max_approval = self._approval_amount(amount_needed)
                    approve_data = token_contract.functions.approve(
                        spender, max_approval
                    ).build_transaction(
                        {
                            "from": sender,
                            "nonce": nonce,
                            "chainId": chain.chain_id,
                            "gasPrice": gas_price,
                        }
                    )
                    approve_tx = {
                        "to": token_addr,
                        "data": approve_data["data"],
                        "value": 0,
                        "gas": approve_data.get("gas", 60000),
                        "gasPrice": approve_data["gasPrice"],
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                    }
                    signed_approve = await self.wallet_service.sign_evm_transaction(
                        wallet, approve_tx
                    )
                    approve_hash = await asyncio.to_thread(
                        lambda: web3.eth.send_raw_transaction(
                            bytes.fromhex(signed_approve.replace("0x", ""))
                        )
                    )
                    logger.info(f"0x approval tx (spender={spender}): {approve_hash.hex()}")
                    await asyncio.to_thread(
                        lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                    )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        tx = {
            "to": tx_to,
            "data": tx_data.get("data", ""),
            "value": _parse_int(tx_data.get("value"), 0),
            "gas": _parse_int(tx_data.get("gas"), 500000),
            "gasPrice": _parse_int(
                tx_data.get("gasPrice"), await asyncio.to_thread(lambda: web3.eth.gas_price)
            ),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"0x swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _persist_0x_crosschain_route_data(
        self, swap_id: Optional[int], quote_id: str, nonce: Optional[int] = None
    ) -> None:
        """Persist the freshly re-quoted quote_id (and intended nonce, if
        known) to the swap record BEFORE the transaction is broadcast.

        Writing this only after send_raw_transaction (the previous
        behavior) leaves a window where the broadcast succeeds on-chain but
        the process dies, or the RPC call itself times out after actually
        relaying the tx, before that DB write ever runs -- the background
        poller then has no quote_id to look up destination-fill status
        with, and no nonce to reconcile against. Persisting first means the
        worst case is a record that thinks it's about to submit a tx that
        never actually broadcasts (safe: it just sits SUBMITTED/CONFIRMING
        and can be reconciled), never the reverse -- a broadcast tx with no
        record of how to track it.
        """
        if not swap_id:
            return

        def _work():
            with get_session() as session:
                db_tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_id).first()
                if not db_tx:
                    return
                data = {"quote_id": quote_id}
                if nonce is not None:
                    data["intended_nonce"] = nonce
                db_tx.route_data = json.dumps(data)

        await run_in_db(_work)

    async def _execute_0x_cross_chain_swap(
        self, quote: SwapQuote, wallet_data: dict, swap_id: Optional[int] = None
    ) -> str:
        """Execute a 0x bridge+swap route into Robinhood Chain (EVM-only).

        Cross-chain calldata is recipient-bound, so execution always re-quotes
        with the signer as BOTH origin and destination. This intentionally does
        not trust a recipient copied from the earlier display quote. The fresh
        min-out must also be at least the amount the user approved before any
        approval or swap transaction is signed.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        # Numeric chain ids in raw_quote can come from rehydrated API input, so
        # they are audit metadata only. Derive the executable route from the
        # canonical chain names and fail closed if stored metadata disagrees.
        origin_chain_id = ZEROX_CHAIN_IDS.get(quote.from_chain.lower())
        destination_chain_id = ZEROX_CHAIN_IDS.get(quote.to_chain.lower())
        if not origin_chain_id or not destination_chain_id:
            raise SwapError(
                f"0x Cross-Chain does not support {quote.from_chain} -> {quote.to_chain}"
            )
        raw_quote = quote.raw_quote or {}
        try:
            stored_origin_chain_id = raw_quote.get("origin_chain_id")
            stored_destination_chain_id = raw_quote.get("destination_chain_id")
            if (
                stored_origin_chain_id is not None
                and int(stored_origin_chain_id) != origin_chain_id
            ) or (
                stored_destination_chain_id is not None
                and int(stored_destination_chain_id) != destination_chain_id
            ):
                raise SwapError("0x Cross-Chain stored chain IDs do not match canonical route")
        except (TypeError, ValueError) as exc:
            raise SwapError("0x Cross-Chain stored chain IDs do not match canonical route") from exc
        if (
            quote.from_chain.lower() == quote.to_chain.lower()
            or quote.to_chain.lower() != "robinhood"
        ):
            raise SwapError("0x Cross-Chain execution is restricted to Robinhood funding")

        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        to_token_address = get_token_address(quote.to_token, quote.to_chain)
        if from_token_address is None or to_token_address is None:
            raise SwapError("0x Cross-Chain execution could not resolve token addresses")

        sender_address = wallet_data["address"]

        # The execution re-quote always sends to the signer (see docstring),
        # but if the earlier *display* quote recorded a different recipient,
        # that's a signal the wallet backing this execution no longer
        # matches what the user actually confirmed (e.g. a wallet swap
        # raced the confirmation). Silently redirecting funds to whichever
        # wallet happens to sign now — instead of the one the user saw —
        # is exactly the kind of mismatch that must abort, not proceed.
        display_to_address = raw_quote.get("to_address")
        if display_to_address:
            try:
                if Web3.to_checksum_address(display_to_address) != Web3.to_checksum_address(
                    sender_address
                ):
                    raise SwapError(
                        "0x Cross-Chain quote recipient does not match the signing wallet"
                    )
            except ValueError as exc:
                raise SwapError("0x Cross-Chain quote recipient address is invalid") from exc

        swap_slippage = raw_quote.get("slippage", 0.5)
        swap_result = await self.zerox.get_cross_chain_quote(
            origin_chain_id=origin_chain_id,
            destination_chain_id=destination_chain_id,
            from_token=self._to_0x_token(from_token_address),
            to_token=self._to_0x_token(to_token_address),
            amount=quote.from_amount,
            origin_address=sender_address,
            destination_address=sender_address,
            slippage=swap_slippage,
            platform_fee_bps=quote.platform_fee_bps,
        )

        if (
            swap_result.origin_chain_id != origin_chain_id
            or swap_result.destination_chain_id != destination_chain_id
        ):
            raise SwapError("0x Cross-Chain returned a route for the wrong chain pair")
        # The re-quote must sell the exact amount the user approved -- if 0x
        # silently substituted a different sell amount, signing against it
        # would move an amount the user never confirmed. `from_amount` is a
        # required field on the real ZeroXCrossChainQuote dataclass; the
        # getattr default only guards against incomplete test doubles.
        fresh_from_amount = getattr(swap_result, "from_amount", None)
        try:
            fresh_from_amount_matches = fresh_from_amount is None or int(fresh_from_amount) == int(
                quote.from_amount
            )
        except (TypeError, ValueError):
            fresh_from_amount_matches = False
        if not fresh_from_amount_matches:
            raise SwapError(
                "0x Cross-Chain execution re-quote sell amount "
                f"({fresh_from_amount}) does not match the approved amount "
                f"({quote.from_amount}) -- aborting for safety."
            )
        self._assert_fresh_min_out_acceptable(
            quote,
            swap_result.to_amount_min,
            "0x Cross-Chain",
            fresh_is_synthetic=getattr(swap_result, "min_out_synthetic", False),
        )

        tx_data = swap_result.tx_data
        if not tx_data:
            raise SwapError("0x Cross-Chain did not return transaction data")

        # Persist the exact submitted quote id after execute_swap receives the
        # tx hash so the background poller can disambiguate lifecycle status.
        quote.raw_quote["quote_id"] = swap_result.quote_id
        quote.raw_quote["zerox_crosschain_quote"] = swap_result.raw_response

        chain = get_chain_by_name(quote.from_chain)
        if chain is None or chain.chain_type != ChainType.EVM:
            raise SwapError("0x Cross-Chain execution requires an EVM origin chain")
        web3 = self.wallet_service._get_web3(quote.from_chain)
        sender = Web3.to_checksum_address(sender_address)
        tx_to = Web3.to_checksum_address(tx_data.get("to", ""))

        provider_gas_price = _parse_int(tx_data.get("gasPrice"), 0)
        if provider_gas_price <= 0:
            # 0x didn't return a gas price -- buffer the live RPC snapshot by
            # 1.3x so a stale/too-low read doesn't leave the origin leg of a
            # multi-step cross-chain route stuck unconfirmed while the rest
            # of the quote's validity window (min-out, bridge liquidity)
            # ticks away underneath it.
            live_gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
            provider_gas_price = int(live_gas_price * 1.3)

        # Cross-Chain uses the same 0x AllowanceHolder model as Swap API.
        # The approval spender comes from issues.allowance.spender and MUST NOT
        # be inferred from transaction.to (the execution target can differ).
        # This allowance read is moved up (ahead of the affordability check
        # below) so the check can account for the approve tx's own gas cost
        # -- without this, a wallet that can afford the swap tx alone but
        # not the approval tx that must precede it would pass the check and
        # then fail mid-execution with the approval already broadcast.
        needs_approval = False
        spender = None
        token_addr = None
        token_contract = None
        current_allowance = 0
        amount_needed = int(quote.from_amount)
        approval_gas_headroom_wei = 0
        if from_token_address != NATIVE_TOKEN_ADDRESS:
            routes = swap_result.raw_response.get("quotes") or []
            route_raw = routes[0] if routes else {}
            issues = route_raw.get("issues") or swap_result.raw_response.get("issues") or {}
            allowance_issue = issues.get("allowance") or {}
            spender_raw = allowance_issue.get("spender")

            if spender_raw:
                spender = Web3.to_checksum_address(spender_raw)
                token_addr = Web3.to_checksum_address(from_token_address)
                erc20_abi = [
                    {
                        "inputs": [
                            {"name": "owner", "type": "address"},
                            {"name": "spender", "type": "address"},
                        ],
                        "name": "allowance",
                        "outputs": [{"name": "", "type": "uint256"}],
                        "type": "function",
                        "stateMutability": "view",
                    },
                    {
                        "inputs": [
                            {"name": "spender", "type": "address"},
                            {"name": "amount", "type": "uint256"},
                        ],
                        "name": "approve",
                        "outputs": [{"name": "", "type": "bool"}],
                        "type": "function",
                        "stateMutability": "nonpayable",
                    },
                ]
                token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
                current_allowance = await asyncio.to_thread(
                    lambda: token_contract.functions.allowance(sender, spender).call()
                )

                if current_allowance < amount_needed:
                    needs_approval = True
                    # A standard ERC-20 approve() comfortably fits under
                    # 120000 gas on every EVM chain we support; reserve that
                    # at the same gas price as the swap tx. Reset-required
                    # tokens (USDT-style, only in "exact" approval mode)
                    # send a SECOND approve(0) tx first, so double the
                    # reserve when that reset will actually fire.
                    approval_gas_headroom_wei = 120000 * provider_gas_price
                    if (
                        str(getattr(settings, "approval_mode", "unlimited")).lower() == "exact"
                        and current_allowance > 0
                        and token_addr.lower() in RESET_REQUIRED_TOKENS
                    ):
                        approval_gas_headroom_wei *= 2

        # Fail closed (before signing ANYTHING, including the approval tx)
        # if the wallet can't actually cover value + gas at the quote's own
        # gas estimate, PLUS the approval tx's own gas if one will be sent.
        # Checking this only after the approval already broadcast (the
        # previous behavior) can leave the approval tx already spent with
        # no swap to show for it -- an irreversible partial state for no
        # benefit. This uses the quote's own gas estimate, not a
        # fully-assembled tx (nonce is irrelevant to affordability), so it
        # can run before any signing happens.
        required_wei = (
            _parse_int(tx_data.get("value"), 0)
            + (_parse_int(tx_data.get("gas"), 500000) * provider_gas_price)
            + approval_gas_headroom_wei
        )
        native_balance = await asyncio.to_thread(lambda: web3.eth.get_balance(sender))
        if native_balance < required_wei:
            raise SwapError(
                "Insufficient native balance to cover 0x Cross-Chain gas: have "
                f"{native_balance}, need {required_wei}"
            )

        if needs_approval:
            nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
            gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
            nonce = await self._send_reset_approval_if_needed(
                web3=web3,
                token_contract=token_contract,
                token_addr=token_addr,
                spender=spender,
                current_allowance=current_allowance,
                sender=sender,
                chain_id=chain.chain_id,
                gas_price=gas_price,
                nonce=nonce,
                wallet=wallet,
            )
            approve_data = token_contract.functions.approve(
                spender, self._approval_amount(amount_needed)
            ).build_transaction(
                {
                    "from": sender,
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                    "gasPrice": gas_price,
                }
            )
            approve_tx = {
                "to": token_addr,
                "data": approve_data["data"],
                "value": 0,
                "gas": approve_data.get("gas", 60000),
                "gasPrice": approve_data["gasPrice"],
                "nonce": nonce,
                "chainId": chain.chain_id,
            }
            signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
            approve_hash = await asyncio.to_thread(
                lambda: web3.eth.send_raw_transaction(
                    bytes.fromhex(signed_approve.replace("0x", ""))
                )
            )
            logger.info(
                "0x Cross-Chain approval tx (spender=%s): %s",
                spender,
                approve_hash.hex(),
            )
            await asyncio.to_thread(
                lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
            )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        tx = {
            "to": tx_to,
            "data": tx_data.get("data", ""),
            "value": _parse_int(tx_data.get("value"), 0),
            "gas": _parse_int(tx_data.get("gas"), 500000),
            "gasPrice": provider_gas_price,
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        # Persist the fresh quote_id + intended nonce BEFORE broadcasting.
        # See _persist_0x_crosschain_route_data docstring for why this must
        # not wait until after send_raw_transaction.
        await self._persist_0x_crosschain_route_data(swap_id, swap_result.quote_id, nonce)

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info("0x Cross-Chain swap tx: %s", tx_hash.hex())
        return tx_hash.hex()

    async def _execute_kyberswap_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap via the KyberSwap Aggregator (EVM-only).

        KyberSwap's router is a single contract: it is both the ERC20 spender to
        approve AND the tx `to` target (simpler than 0x's Settler/AllowanceHolder
        split). We re-fetch a fresh route + build tx calldata at execution time,
        approve the router for token sells, then sign and broadcast.
        """
        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        chain_slug = quote.raw_quote.get("chain_slug") or KYBERSWAP_CHAIN_SLUGS.get(
            quote.from_chain.lower()
        )
        if not chain_slug:
            raise SwapError(f"KyberSwap does not support chain: {quote.from_chain}")

        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        to_token_address = get_token_address(quote.to_token, quote.to_chain)

        # Re-fetch a fresh route + build tx calldata (routes expire).
        swap_slippage = quote.raw_quote.get("slippage", 0.5) if quote.raw_quote else 0.5
        swap_result = await self.kyberswap.get_swap(
            chain_slug=chain_slug,
            from_token=self._to_kyber_token(from_token_address),
            to_token=self._to_kyber_token(to_token_address),
            amount=quote.from_amount,
            user_address=wallet_data["address"],
            slippage=swap_slippage,
            platform_fee_bps=quote.platform_fee_bps,
        )
        self._assert_fresh_min_out_acceptable(quote, swap_result.to_amount_min, "KyberSwap")
        tx_data = swap_result.tx_data
        if not tx_data:
            raise SwapError("KyberSwap did not return transaction data")

        chain = get_chain_by_name(quote.from_chain)
        web3 = self.wallet_service._get_web3(quote.from_chain)
        sender = Web3.to_checksum_address(wallet_data["address"])
        # Single contract: router is both the spender and the tx target.
        router = Web3.to_checksum_address(tx_data.get("to", ""))

        # ERC20 approval to the KyberSwap router for token sells (not native).
        if from_token_address and from_token_address != NATIVE_TOKEN_ADDRESS:
            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            amount_needed = int(quote.from_amount)
            current_allowance = await asyncio.to_thread(
                lambda: token_contract.functions.allowance(sender, router).call()
            )

            if current_allowance < amount_needed:
                nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                # 'exact' mode on a reset-required token (USDT mainnet): zero the
                # allowance first, since approve() reverts non-zero -> non-zero.
                # The KyberSwap router is both spender and tx target.
                nonce = await self._send_reset_approval_if_needed(
                    web3=web3,
                    token_contract=token_contract,
                    token_addr=token_addr,
                    spender=router,
                    current_allowance=current_allowance,
                    sender=sender,
                    chain_id=chain.chain_id,
                    gas_price=gas_price,
                    nonce=nonce,
                    wallet=wallet,
                )
                max_approval = self._approval_amount(amount_needed)
                approve_data = token_contract.functions.approve(
                    router, max_approval
                ).build_transaction(
                    {
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": gas_price,
                    }
                )
                approve_tx = {
                    "to": token_addr,
                    "data": approve_data["data"],
                    "value": 0,
                    "gas": approve_data.get("gas", 60000),
                    "gasPrice": approve_data["gasPrice"],
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }
                signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
                approve_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approve.replace("0x", ""))
                    )
                )
                logger.info(f"KyberSwap approval tx (router={router}): {approve_hash.hex()}")
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        tx = {
            "to": router,
            "data": tx_data.get("data", ""),
            "value": _parse_int(tx_data.get("value"), 0),
            "gas": _parse_int(tx_data.get("gas"), 500000),
            "gasPrice": _parse_int(
                tx_data.get("gasPrice"), await asyncio.to_thread(lambda: web3.eth.gas_price)
            ),
            "nonce": nonce,
            "chainId": chain.chain_id,
        }

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"KyberSwap swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _execute_propamm_swap(self, quote: SwapQuote, wallet_data: dict) -> str:
        """Execute a swap against PropAMM liquidity via the Titan Builder
        PropAMMRouter (Ethereum mainnet, same-chain only).

        The router re-quotes all whitelisted pAMM venues + Uniswap V3 in-tx
        and routes to the best, falling back to Uniswap V3 transparently —
        so this is a single execution path for "best PropAMM OR UniV3". No
        calldata comes back from titan_getPammQuote (unlike KyberSwap's
        route/build), so the tx is built directly against PROPAMM_ROUTER_ABI.
        We re-quote fresh at execution time (Titan's quote can move between
        quote and broadcast), approve the router for token sells, then call
        swapV1/swapWithFeeV1.
        """
        # Kill switch covers execution too: quote.provider is caller-supplied
        # on the internal/webapp execute paths, and PropAMM needs no API key,
        # so without this check flipping PROPAMM_ENABLED=false would stop
        # quoting but not execution.
        if not self.propamm_titan.is_configured:
            raise SwapError("PropAMM (Titan) is disabled")

        wallet = await self._get_wallet_for_signing(wallet_data)
        if not wallet:
            raise SwapError("Wallet not found for signing")

        if quote.from_chain.lower() != "ethereum" or quote.to_chain.lower() != "ethereum":
            raise SwapError("PropAMM (Titan) only supports Ethereum mainnet same-chain swaps")

        from_token_address = get_token_address(quote.from_token, quote.from_chain)
        to_token_address = get_token_address(quote.to_token, quote.to_chain)
        if from_token_address is None or to_token_address is None:
            raise SwapError(f"Token not supported: {quote.from_token} or {quote.to_token}")

        # raw_quote is caller-influenceable on the webapp execute path —
        # validate and clamp rather than trusting it.
        try:
            slippage_bps = int((quote.raw_quote or {}).get("slippage_bps", 50))
        except (TypeError, ValueError):
            raise SwapError("PropAMM (Titan): invalid slippage_bps in quote")
        slippage_bps = max(0, min(slippage_bps, 5_000))

        effective_fee_bps = self._propamm_effective_fee_bps(quote.platform_fee_bps)
        use_fee = effective_fee_bps > 0

        try:
            fresh_quote = await self.propamm_titan.get_quote(
                token_in=self._to_propamm_token(from_token_address),
                token_out=self._to_propamm_token(to_token_address),
                amount_in=quote.from_amount,
            )
        except PropAMMError as e:
            raise SwapError(f"PropAMM (Titan) re-quote failed: {e}")

        if fresh_quote is None:
            raise SwapError("PropAMM (Titan) has no route for this pair at execution time")

        # On-chain semantics: with swapWithFeeV1, amountOutMin is the NET
        # minimum the recipient receives AFTER the fee (the contract grosses
        # it back up internally), so the fee haircut must be applied before
        # slippage. Integer floor division — float math at wei magnitudes can
        # round the minimum up, the unsafe direction.
        fresh_net = int(fresh_quote.to_amount) * (10_000 - effective_fee_bps) // 10_000
        fresh_min_out = str(fresh_net * (10_000 - slippage_bps) // 10_000)
        self._assert_fresh_min_out_acceptable(quote, fresh_min_out, "PropAMM (Titan)")

        chain = get_chain_by_name(quote.from_chain)
        web3 = self.wallet_service._get_web3(quote.from_chain)
        sender = Web3.to_checksum_address(wallet_data["address"])
        router = Web3.to_checksum_address(settings.propamm_router_address)

        is_native = from_token_address.lower() == NATIVE_TOKEN_ADDRESS.lower()
        # The router accepts the standard native sentinel as tokenIn (payable,
        # msg.value == amountIn) per the docs. NOTE: this differs from the
        # quote RPC, which rejects the sentinel and only indexes pairs by
        # WETH (verified live) — PropAMMAPI.get_quote() handles that remap
        # internally; execution uses the sentinel directly.
        swap_token_in = (
            Web3.to_checksum_address(PROPAMM_NATIVE_TOKEN)
            if is_native
            else Web3.to_checksum_address(from_token_address)
        )
        # tokenOut needs the same native-sentinel mapping as tokenIn: the
        # repo's native address (0x000…0) is not an ERC-20, and the router
        # handles ETH_SENTINEL as tokenOut by unwrapping and delivering
        # native ETH.
        swap_token_out = Web3.to_checksum_address(self._to_propamm_token(to_token_address))
        amount_in = int(quote.from_amount)

        # ERC20 approval to the router for token sells (not native).
        if not is_native:
            token_addr = Web3.to_checksum_address(from_token_address)
            erc20_abi = [
                {
                    "inputs": [
                        {"name": "owner", "type": "address"},
                        {"name": "spender", "type": "address"},
                    ],
                    "name": "allowance",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "type": "function",
                    "stateMutability": "view",
                },
                {
                    "inputs": [
                        {"name": "spender", "type": "address"},
                        {"name": "amount", "type": "uint256"},
                    ],
                    "name": "approve",
                    "outputs": [{"name": "", "type": "bool"}],
                    "type": "function",
                    "stateMutability": "nonpayable",
                },
            ]
            token_contract = web3.eth.contract(address=token_addr, abi=erc20_abi)
            current_allowance = await asyncio.to_thread(
                lambda: token_contract.functions.allowance(sender, router).call()
            )

            if current_allowance < amount_in:
                nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
                gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
                # 'exact' mode on a reset-required token (USDT mainnet): zero
                # the allowance first, since approve() reverts non-zero ->
                # non-zero. The PropAMM router is both spender and tx target.
                nonce = await self._send_reset_approval_if_needed(
                    web3=web3,
                    token_contract=token_contract,
                    token_addr=token_addr,
                    spender=router,
                    current_allowance=current_allowance,
                    sender=sender,
                    chain_id=chain.chain_id,
                    gas_price=gas_price,
                    nonce=nonce,
                    wallet=wallet,
                )
                max_approval = self._approval_amount(amount_in)
                approve_data = token_contract.functions.approve(
                    router, max_approval
                ).build_transaction(
                    {
                        "from": sender,
                        "nonce": nonce,
                        "chainId": chain.chain_id,
                        "gasPrice": gas_price,
                    }
                )
                approve_tx = {
                    "to": token_addr,
                    "data": approve_data["data"],
                    "value": 0,
                    "gas": approve_data.get("gas", 60000),
                    "gasPrice": approve_data["gasPrice"],
                    "nonce": nonce,
                    "chainId": chain.chain_id,
                }
                signed_approve = await self.wallet_service.sign_evm_transaction(wallet, approve_tx)
                approve_hash = await asyncio.to_thread(
                    lambda: web3.eth.send_raw_transaction(
                        bytes.fromhex(signed_approve.replace("0x", ""))
                    )
                )
                logger.info(f"PropAMM (Titan) approval tx (router={router}): {approve_hash.hex()}")
                await asyncio.to_thread(
                    lambda: web3.eth.wait_for_transaction_receipt(approve_hash, timeout=120)
                )

        router_contract = web3.eth.contract(address=router, abi=PROPAMM_ROUTER_ABI)
        deadline = int(datetime.now(timezone.utc).timestamp()) + 300
        amount_out_min = int(fresh_min_out)

        # Pin the venue from OUR OWN fresh re-quote when Titan reported one:
        # the pinned entrypoints cost roughly half the gas of the all-venues
        # requote (measured on mainnet: p50 216k vs 441k) and the Uniswap V3
        # fallback still applies if the pinned venue can't fill, so minOut
        # protection is unchanged. fresh_quote comes from our server-side
        # Titan call above — never from caller-supplied raw_quote — and a
        # stale/bogus venue can only revert UnknownVenue or fill via the
        # fallback, both bounded by amountOutMin.
        pinned_venue = None
        if fresh_quote.pamm:
            try:
                pinned_venue = Web3.to_checksum_address(fresh_quote.pamm)
            except (TypeError, ValueError):
                pinned_venue = None

        # Platform fee: the WithFee entrypoints when a fee is configured AND
        # collectable (mirrors the KyberSwap/0x fee gate — fee bps AND a real
        # collector address must both be set). The effective bps (clamped to
        # the router's 100 bps FrontendFee cap) was computed up front so the
        # fresh minimum-out above already reflects the same fee the contract
        # will charge.
        fee_tuple = (
            (effective_fee_bps, Web3.to_checksum_address(settings.fee_collector_address))
            if use_fee
            else None
        )
        if pinned_venue and use_fee:
            build_fn = router_contract.functions.swapViaVenueWithFeeV1(
                pinned_venue,
                swap_token_in,
                swap_token_out,
                amount_in,
                amount_out_min,
                sender,
                deadline,
                fee_tuple,
            )
        elif pinned_venue:
            build_fn = router_contract.functions.swapViaVenueV1(
                pinned_venue,
                swap_token_in,
                swap_token_out,
                amount_in,
                amount_out_min,
                sender,
                deadline,
            )
        elif use_fee:
            build_fn = router_contract.functions.swapWithFeeV1(
                swap_token_in,
                swap_token_out,
                amount_in,
                amount_out_min,
                sender,
                deadline,
                fee_tuple,
            )
        else:
            build_fn = router_contract.functions.swapV1(
                swap_token_in, swap_token_out, amount_in, amount_out_min, sender, deadline
            )

        nonce = await asyncio.to_thread(lambda: web3.eth.get_transaction_count(sender))
        gas_price = await asyncio.to_thread(lambda: web3.eth.gas_price)
        value = amount_in if is_native else 0

        tx_params = {
            "from": sender,
            "nonce": nonce,
            "chainId": chain.chain_id,
            "gasPrice": gas_price,
            "value": value,
        }

        # Do NOT trust node gas estimation for the gas limit: the router
        # re-quotes venues in-tx and can take a heavier branch at execution
        # than at estimation time (e.g. dropping into the Uniswap V3
        # fallback), so an estimate under-shoots and the swap runs out of gas.
        # The official propamm SDK hardcodes per-function limits; ours are
        # tiered by entrypoint from measured mainnet usage (see constants).
        # estimate_gas still runs as a pre-flight revert check.
        floor = PROPAMM_PINNED_SWAP_GAS_LIMIT if pinned_venue else PROPAMM_SWAP_GAS_LIMIT
        gas_limit = floor
        try:
            gas_estimate = await asyncio.to_thread(lambda: build_fn.estimate_gas(tx_params))
            gas_limit = max(int(gas_estimate * 1.3), floor)
        except Exception as e:
            logger.warning(
                f"PropAMM (Titan) pre-flight gas estimate failed, using hardcoded {floor}: {e}"
            )

        tx = build_fn.build_transaction({**tx_params, "gas": gas_limit})

        signed_tx_hex = await self.wallet_service.sign_evm_transaction(wallet, tx)
        tx_hash = await asyncio.to_thread(
            lambda: web3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex.replace("0x", "")))
        )

        logger.info(f"PropAMM (Titan) swap tx: {tx_hash.hex()}")
        return tx_hash.hex()

    async def _estimate_swap_usd(self, quote: SwapQuote) -> float:
        """Best-effort USD value of a swap. Prefer a stablecoin leg (exact);
        otherwise price the to-token, then the from-token. Returns 0.0 if it
        can't be valued (caller then skips settlement rather than record garbage).
        """
        from bot.config.tokens import get_token_by_symbol
        from bot.services.price_service import price_service

        def _is_stable(sym: str) -> bool:
            cfg = get_token_by_symbol(sym)
            return bool(cfg and getattr(cfg, "is_stablecoin", False))

        from_qty = float(quote.from_amount_human or 0)
        to_qty = float(quote.to_amount_human or 0)

        if _is_stable(quote.to_token) and to_qty > 0:
            return to_qty
        if _is_stable(quote.from_token) and from_qty > 0:
            return from_qty
        for sym, qty in ((quote.to_token, to_qty), (quote.from_token, from_qty)):
            if qty <= 0:
                continue
            try:
                price = await asyncio.wait_for(price_service.get_price(sym), timeout=5)
            except Exception:
                price = None
            if price:
                return float(price) * qty
        return 0.0

    async def _settle_user_position(self, user_id: int, quote: SwapQuote) -> None:
        """Update the user's average-cost spot basis after a successful swap.

        A swap disposes from_token (realize PnL vs avg cost) and acquires
        to_token (add to cost basis); both legs share one USD value (value is
        conserved across a swap). Mirrors the copy-trading _settle_pnl. Keyed by
        (user, token, chain) so cross-chain swaps settle each leg on its chain.
        """
        from bot.models.positions import UserPosition

        swap_usd = await self._estimate_swap_usd(quote)
        if swap_usd <= 0:
            return

        from_token, from_chain = quote.from_token, quote.from_chain
        to_token, to_chain = quote.to_token, quote.to_chain
        from_qty = float(quote.from_amount_human or 0)
        to_qty = float(quote.to_amount_human or 0)

        def _work():
            with get_session() as session:
                # SELL leg: realize PnL on the disposed token vs tracked basis.
                if from_qty > 0:
                    pos = (
                        session.query(UserPosition)
                        .filter(
                            UserPosition.user_id == user_id,
                            UserPosition.token == from_token,
                            UserPosition.chain == from_chain,
                        )
                        .first()
                    )
                    if pos and pos.qty > 0:
                        avg_cost = pos.cost_usd / pos.qty
                        qty_sold = min(from_qty, pos.qty)
                        cost_of_sold = avg_cost * qty_sold
                        proceeds = swap_usd * (qty_sold / from_qty)  # tracked portion
                        pos.realized_pnl_usd = (pos.realized_pnl_usd or 0.0) + (
                            proceeds - cost_of_sold
                        )
                        pos.qty -= qty_sold
                        pos.cost_usd = max(0.0, pos.cost_usd - cost_of_sold)
                        if pos.qty <= 1e-12:
                            # Keep the row (preserves realized PnL) but zero the holding.
                            pos.qty = 0.0
                            pos.cost_usd = 0.0

                # BUY leg: add the acquired token to cost basis.
                if to_qty > 0:
                    pos = (
                        session.query(UserPosition)
                        .filter(
                            UserPosition.user_id == user_id,
                            UserPosition.token == to_token,
                            UserPosition.chain == to_chain,
                        )
                        .first()
                    )
                    if not pos:
                        pos = UserPosition(
                            user_id=user_id,
                            token=to_token,
                            chain=to_chain,
                            qty=0.0,
                            cost_usd=0.0,
                            realized_pnl_usd=0.0,
                        )
                        session.add(pos)
                    pos.qty += to_qty
                    pos.cost_usd += swap_usd

                session.commit()

        await run_in_db(_work)

    async def check_status(self, swap_tx: SwapTransaction) -> SwapTransaction:
        """
        Check the status of a swap transaction.

        Updates the SwapTransaction record and returns it.
        """
        if not swap_tx.tx_hash:
            return swap_tx

        if swap_tx.route_provider == "jupiter":
            # Check Solana transaction status
            status = await self._check_solana_tx_status(swap_tx.tx_hash)
        elif swap_tx.route_provider == "sunswap":
            # Check TRON transaction status
            status = await self._check_tron_tx_status(swap_tx.tx_hash)
        elif swap_tx.route_provider == "0x_crosschain":
            status = await self._check_0x_cross_chain_status(swap_tx)
        else:
            # Check via Li.Fi status API
            if swap_tx.from_chain != swap_tx.to_chain:
                status = await self._check_lifi_status(swap_tx)
            else:
                # Same-chain EVM swap
                status = await self._check_evm_tx_status(swap_tx)

        # Update database
        def _update_status():
            with get_session() as session:
                tx = session.query(SwapTransaction).filter(SwapTransaction.id == swap_tx.id).first()
                tx.status = status
                if status == SwapStatus.COMPLETED.value:
                    from datetime import datetime, timezone

                    tx.completed_at = datetime.now(timezone.utc)

        await run_in_db(_update_status)

        swap_tx.status = status
        return swap_tx

    async def _check_solana_tx_status(self, tx_hash: str) -> str:
        """Check Solana transaction status."""
        session = await get_http_session()
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getTransaction",
            "params": [
                tx_hash,
                {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0},
            ],
        }
        async with session.post(rpc_manager.get_rpc_url("solana"), json=payload) as resp:
            result = await resp.json()

            if "error" in result:
                return SwapStatus.PENDING.value

            tx_data = result.get("result")
            if tx_data is None:
                return SwapStatus.PENDING.value

            if tx_data.get("meta", {}).get("err") is not None:
                return SwapStatus.FAILED.value

            return SwapStatus.COMPLETED.value

    async def _check_tron_tx_status(self, tx_hash: str) -> str:
        """Check TRON transaction status via TronGrid."""
        try:
            rpc_url = rpc_manager.get_rpc_url("tron") or "https://api.trongrid.io"
            headers = {"Content-Type": "application/json"}
            if hasattr(settings, "trongrid_api_key") and settings.trongrid_api_key:
                headers["TRON-PRO-API-KEY"] = settings.trongrid_api_key

            session = await get_http_session()
            async with session.post(
                f"{rpc_url}/wallet/gettransactioninfobyid",
                json={"value": tx_hash},
                headers=headers,
            ) as resp:
                data = await resp.json()

                if not data or not data.get("id"):
                    return SwapStatus.PENDING.value

                receipt = data.get("receipt", {})
                result = receipt.get("result", "")

                if result == "SUCCESS":
                    return SwapStatus.COMPLETED.value
                elif result in ("REVERT", "OUT_OF_ENERGY", "FAILED"):
                    return SwapStatus.FAILED.value
                else:
                    return SwapStatus.PENDING.value
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.debug(f"TRON status check transient error for {tx_hash}: {e}")
            return SwapStatus.PENDING.value
        except Exception as e:
            logger.error(f"TRON status check failed for {tx_hash}: {e}")
            return SwapStatus.FAILED.value

    async def _check_evm_tx_status(self, swap_tx: SwapTransaction) -> str:
        """Check EVM transaction status."""
        try:
            web3 = self.wallet_service._get_web3(swap_tx.from_chain)
            receipt = await asyncio.to_thread(
                lambda: web3.eth.get_transaction_receipt(swap_tx.tx_hash)
            )

            if receipt is None:
                return SwapStatus.PENDING.value

            if receipt["status"] == 1:
                return SwapStatus.COMPLETED.value
            else:
                return SwapStatus.FAILED.value
        except (ConnectionError, TimeoutError, OSError) as e:
            logger.debug(f"EVM status check transient error for {swap_tx.tx_hash}: {e}")
            return SwapStatus.PENDING.value
        except Exception as e:
            logger.error(f"EVM status check failed for {swap_tx.tx_hash}: {e}")
            return SwapStatus.FAILED.value

    async def _check_lifi_status(self, swap_tx: SwapTransaction) -> str:
        """Check cross-chain swap status via Li.Fi."""
        try:
            status = await self.lifi.get_status(
                tx_hash=swap_tx.tx_hash,
                from_chain=swap_tx.from_chain,
                to_chain=swap_tx.to_chain,
            )

            if status.status == "DONE":
                # Update destination tx hash
                if status.receiving_tx_hash:

                    def _update_dest_hash():
                        with get_session() as session:
                            tx = (
                                session.query(SwapTransaction)
                                .filter(SwapTransaction.id == swap_tx.id)
                                .first()
                            )
                            tx.destination_tx_hash = status.receiving_tx_hash

                    await run_in_db(_update_dest_hash)

                return SwapStatus.COMPLETED.value
            elif status.status == "FAILED":
                return SwapStatus.FAILED.value
            else:
                return SwapStatus.CONFIRMING.value
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.debug(f"Li.Fi status check transient error for {swap_tx.tx_hash}: {e}")
            return SwapStatus.CONFIRMING.value
        except Exception as e:
            logger.error(f"Li.Fi status check failed for {swap_tx.tx_hash}: {e}")
            return SwapStatus.FAILED.value

    async def _check_0x_cross_chain_status(self, swap_tx: SwapTransaction) -> str:
        """Check a 0x Cross-Chain route through destination settlement."""
        try:
            route_data = json.loads(swap_tx.route_data or "{}")
        except (TypeError, ValueError, json.JSONDecodeError):
            route_data = {}
        try:
            origin_chain_id = ZEROX_CHAIN_IDS.get(swap_tx.from_chain.lower())
            destination_chain_id = ZEROX_CHAIN_IDS.get(swap_tx.to_chain.lower())
            if not origin_chain_id or not destination_chain_id:
                raise SwapError("Stored 0x Cross-Chain swap has an unsupported chain")

            result = await self.zerox.get_cross_chain_status(
                origin_chain_id=origin_chain_id,
                origin_tx_hash=swap_tx.tx_hash,
                quote_id=route_data.get("quote_id"),
            )
            provider_status = result.get("status")

            if provider_status == "bridge_filled":
                destination_hash = None
                for tx in result.get("transactions") or []:
                    try:
                        tx_chain_id = int(tx.get("chainId"))
                    except (TypeError, ValueError):
                        continue
                    if tx_chain_id == destination_chain_id and tx.get("txHash"):
                        destination_hash = tx["txHash"]
                if destination_hash:

                    def _update_dest_hash():
                        with get_session() as session:
                            tx = (
                                session.query(SwapTransaction)
                                .filter(SwapTransaction.id == swap_tx.id)
                                .first()
                            )
                            if tx:
                                tx.destination_tx_hash = destination_hash

                    await run_in_db(_update_dest_hash)
                    swap_tx.destination_tx_hash = destination_hash
                return SwapStatus.COMPLETED.value

            if provider_status in ("origin_tx_reverted", "bridge_failed"):
                return SwapStatus.FAILED.value
            if provider_status in ("origin_tx_pending", "origin_tx_confirmed", "bridge_pending"):
                return SwapStatus.CONFIRMING.value
            # Unrecognized status string -- treat like an error below rather
            # than trusting an unknown value to mean "still going".
            return await self._resolve_0x_cross_chain_unknown(swap_tx, route_data)
        except Exception as e:
            # A bare "always keep CONFIRMING" here would let a persistent
            # 0x API outage strand a swap in limbo forever. Fall back to an
            # on-chain check of the origin tx and fail closed after too many
            # consecutive unresolved checks.
            logger.error(f"0x Cross-Chain status check failed for {swap_tx.tx_hash}: {e}")
            return await self._resolve_0x_cross_chain_unknown(swap_tx, route_data)

    # Keep this bound identical to the automated poller's
    # (tx_poller.TransactionPoller.ZEROX_UNRESOLVED_FAIL_AFTER) so a manual
    # refresh and the background poller agree on when a swap is stuck.
    ZEROX_UNRESOLVED_FAIL_AFTER = timedelta(hours=2)

    async def _resolve_0x_cross_chain_unknown(
        self, swap_tx: SwapTransaction, route_data: dict
    ) -> str:
        """0x's status API errored or returned an unrecognized status.

        A reverted origin tx is a definitive FAILED regardless of what the
        status API said. Otherwise this is a read-only, time-based check
        against the row's created_at -- NOT a consecutive-poll counter. This
        method backs the *manual* refresh path (user-triggered "check
        status"), so it must be side-effect-free with respect to the
        automated poller's own bookkeeping: a user mashing refresh must
        never move a swap closer to FAILED than the automated poller would
        on its own, and must never write to route_data here.
        """
        try:
            origin_receipt_status = await self._check_evm_tx_status(swap_tx)
            if origin_receipt_status == SwapStatus.FAILED.value:
                return SwapStatus.FAILED.value
        except Exception as receipt_err:
            logger.debug(f"0x Cross-Chain origin receipt fallback failed: {receipt_err}")

        created_at = swap_tx.created_at
        if created_at is None:
            return SwapStatus.CONFIRMING.value
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        elapsed = datetime.now(timezone.utc) - created_at
        if elapsed >= self.ZEROX_UNRESOLVED_FAIL_AFTER:
            logger.warning(
                f"0x Cross-Chain tx {swap_tx.id} unresolved for {elapsed} "
                f"(bound {self.ZEROX_UNRESOLVED_FAIL_AFTER}); marking FAILED."
            )
            return SwapStatus.FAILED.value
        return SwapStatus.CONFIRMING.value

    async def execute_multi_swap(
        self,
        quotes_with_wallets: List[tuple[SwapQuote, int]],
        user_id: int,
        attempt_id: str,
    ) -> List[SwapTransaction]:
        """
        Execute multiple swaps concurrently across different wallets.

        Args:
            quotes_with_wallets: List of (SwapQuote, wallet_id) tuples
            user_id: Database user ID
            attempt_id: Base attempt ID for idempotency

        Returns:
            List of SwapTransaction records
        """
        tasks = []
        for i, (quote, wallet_id) in enumerate(quotes_with_wallets):
            # Create a unique idempotency key for each wallet in the set
            idempotency_key = f"multi:{user_id}:{wallet_id}:{attempt_id}:{i}"
            # 0x Cross-Chain execution refreshes recipient-bound calldata and
            # its quote_id immediately before signing. The Telegram multi-wallet
            # path intentionally supplies the same display quote to every task,
            # so isolate both the dataclass and its mutable raw metadata before
            # concurrent execution. Otherwise wallet B can overwrite wallet A's
            # quote_id and make A's already-funded bridge impossible to track.
            execution_quote = quote
            if quote.provider == "0x_crosschain":
                execution_quote = replace(quote, raw_quote=dict(quote.raw_quote or {}))
            tasks.append(
                self.execute_swap(
                    quote=execution_quote,
                    wallet_id=wallet_id,
                    user_id=user_id,
                    idempotency_key=idempotency_key,
                )
            )

        # Execute all swaps in parallel
        # Note: exceptions are captured so one failure doesn't stop others
        results = await asyncio.gather(*tasks, return_exceptions=True)

        swap_transactions = []
        for res in results:
            if isinstance(res, SwapTransaction):
                swap_transactions.append(res)
            else:
                # Log the error but keep the successful ones
                logger.error(f"Multi-swap sub-task failed: {res}")

        return swap_transactions

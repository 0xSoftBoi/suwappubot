"""Auto gas top-up from the hot wallet — MONEY-PATH.

A Gekko user must never need to hold ETH: when a wallet action (send, earn
deposit/withdraw) needs Base gas the wallet can't cover, this service tops
the wallet up from the gas-payer hot wallet (same custodial pattern as
bot/services/paymaster.py's `sponsor_transaction`, reused rather than
reinvented — the differences here are the hard per-tx/day/lifetime/global
spend caps and the durable audit trail, since paymaster.py's sponsorship
config lives per-chain in the DB and this path is mobile-specific and always
Base today).

ORDERING / ANTI-GRIEFING (do this, and only this):
`ensure_gas()` MUST be called only after the caller has already validated
that the underlying action is real and funded — i.e. the user's token
balance covers the amount they're trying to move. Both call sites
(api/routes/mobile.py's `_send_usdc_base` and `_execute_earn_action`) do
this: the USDC/aToken balance and amount are checked BEFORE this module is
ever invoked. That means a top-up always accompanies genuine transfer
intent; a user cannot cheaply trigger repeated top-ups by polling a
balance-check endpoint alone, since no such endpoint calls this module. That
same balance check also feeds `has_verified_funds` (see the ELIGIBILITY GATE
section below) — callers pass `True` when it proves the wallet genuinely
holds/held real funds.

SPEND CONTROLS (all enforced here, before any transfer is made):
  * Per-transaction ceiling (`GAS_TOPUP_MAX_USD`, converted to wei via a
    genuinely synchronous live price lookup — see `_fetch_live_eth_price_usd`
    — with a conservative fixed-wei fallback, then clamped by an absolute
    backstop regardless of what the price lookup returns).
  * Per-user daily count + wei caps (`MAX_TOPUPS_PER_USER_PER_DAY`,
    `USER_DAILY_TOPUP_MULTIPLE`) — M1 fix: enforced via the SAME atomic
    `_daily_reserve` UPSERT as the IP/global caps (`scope=f"user:{user_id}"`),
    not a separate read-then-compare query — two concurrent requests can no
    longer each read the same stale count/total and both pass.
  * Per-IP daily count + wei caps (`MAX_TOPUPS_PER_IP_PER_DAY`,
    `IP_DAILY_TOPUP_MULTIPLE`) — a user_id is free to mint (a fresh mobile
    signup), a routable client IP is not; see `_daily_reserve`. M4 fix: an
    IPv6 address is normalized to its /64 network prefix before being used
    as a scope key (see `_normalize_ip_for_scope`) — the smallest block a
    single residential/mobile customer is normally delegated — so one real
    connection can't mint 2^64 distinct per-IP scopes.
  * Per-wallet LIFETIME ceiling (`WALLET_LIFETIME_TOPUP_CAP_WEI`, DESIGN
    CHANGE) — bounds total exposure to a single wallet across its entire
    existence, not just any one UTC day, via `_lifetime_reserve` (same
    atomic-UPSERT pattern, keyed by wallet_address, no day dimension).
  * Global daily circuit breaker (`GAS_TOPUP_GLOBAL_DAILY_CAP_WEI`, an
    ABSOLUTE wei constant) — trips a CRITICAL log and refuses ALL further
    top-ups for the rest of the UTC day once the network-wide total is hit.
    All three daily scopes (user/IP/global) share `_daily_reserve`, a single
    atomic UPSERT against the `gas_topup_daily_counters` table, so concurrent
    requests cannot each read the same stale total and collectively
    overshoot a cap.

ELIGIBILITY GATE (DESIGN CHANGE, anti-sybil — see `_wallet_is_eligible_for_topup`):
a wallet is eligible for auto top-up only if it has EITHER already been
observed holding real funds (`has_verified_funds=True`, passed by the
caller from the SAME balance check the ORDERING section above already
requires) OR is at least `GAS_TOPUP_MIN_ACCOUNT_AGE_SECONDS` old. Without
this, per-user/IP/global daily caps alone don't stop a sybil attacker: a
fresh, never-funded account could draw gas immediately, so minting accounts
(near-free) is all it takes to keep hitting the daily caps. This gate forces
each account to EITHER wait out the age window OR actually receive real
funds first.

H2 FIX — QUOTA REFUND ON PRE-BROADCAST FAILURE: every `_daily_reserve` /
`_lifetime_reserve` call above reserves quota BEFORE the hot wallet ever
broadcasts anything. If everything after that point fails WITHOUT a
broadcast attempt ever happening — no gas-payer wallet configured, the
`_record_topup_pending` audit-row insert itself fails, or the broadcast call
raises anything other than `PostBroadcastAmbiguous` (this deliberately
includes `HotWalletBusyError` from hot_wallet.py's cross-replica send lock,
which is EXPECTED under ordinary concurrent top-up traffic, not a hard
failure) — every reservation taken above is refunded via `_daily_release` /
`_lifetime_release` (see `_refund_reservations`). Genuinely zero ETH left
the hot wallet in all of these cases, so none of them may permanently
consume quota; without this, ordinary multi-replica concurrency alone could
trip the global breaker with nothing ever spent.

The ONE deliberate exception: `PostBroadcastAmbiguous` (a broadcast call
that raised AFTER the tx may already have been accepted/propagated by the
node — see that class's docstring in hot_wallet.py) NEVER refunds. Funds may
well have moved, so refunding here could let a retry double-spend the
quota for the same ETH — the conservative direction (a breaker that trips a
little earlier than the true spend requires) is safer than the alternative.
A confirmed-broadcast outcome (receipt timeout, on-chain revert) likewise
never refunds — real ETH already left the hot wallet in both cases.

Every exceeded cap raises `GasTopUpCapExceeded` with a stable, plain-language
message (never mentions "gas"/"ETH" internals beyond what's needed to be
actionable) that callers surface directly as the HTTP error detail — the
mobile client's copy layer maps details to user-facing text, so these
strings must stay stable. A failed/timed-out top-up attempt raises
`GasTopUpFailed`, which callers must treat as retryable and MUST NOT report
the original action as having succeeded. `GasTopUpBusy` (H3 fix) is raised
when the dedicated dispatch pool itself is saturated — also retryable, but
distinct so callers can map it to a fast 503 rather than a cap message.

AUDIT ROW LIFECYCLE (fixes a fail-open bug where a swallowed insert failure
made the daily caps silently infinite): a `gas_topups` row is inserted with
status="pending" BEFORE anything is broadcast from the hot wallet — see
`_record_topup_pending`, called from `ensure_gas` right after every cap
passes and right before `hot_wallet_service.send_native_token`. If that
insert itself fails, `ensure_gas` raises `GasTopUpFailed`, refunds every
reservation (H2), and refuses to spend. The row is then updated in place to
its final status (`_update_topup_status`) once the broadcast result
(success/ambiguous/failure) is known.

DISPATCH (H3 fix, avoids starving the API's shared thread pool AND avoids
the dedicated pool becoming its own bottleneck): ONLY `ensure_gas` itself is
dispatched onto this module's own small, bounded `_TOPUP_EXECUTOR` pool —
via `run_gas_sensitive()` (async callers, e.g. api/routes/mobile.py's earn
flow) or `run_gas_sensitive_sync()` (blocking-thread callers, e.g.
`_send_usdc_base`, which itself already runs on the API's SHARED
`asyncio.to_thread` pool for its fast build/sign/broadcast work and only
needs to hand the potentially-slow `ensure_gas` call to the dedicated pool).
Earlier, the entire multi-second `_send_usdc_base` call — including its fast
build/sign/broadcast path, not just the slow top-up branch — was dispatched
onto the dedicated 16-worker pool, so a burst of slow top-ups blocked EVERY
mobile send behind them, top-up or not. Both dispatch helpers acquire a
bounded, non-blocking semaphore slot BEFORE submitting to `_TOPUP_EXECUTOR`
and raise `GasTopUpBusy` immediately (mapped to HTTP 503 by callers) rather
than queuing unboundedly once all slots are busy — worst case per slot is
now ~1.5s price fetch + up to 30s cross-replica lock wait + 15s receipt wait,
still bounded, but no caller queues behind more than `_TOPUP_QUEUE_MAX` of
them.
"""

import asyncio
import functools
import ipaddress
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional, Tuple

from web3 import Web3

logger = logging.getLogger(__name__)


# ── spend controls (named constants — do not inline these) ─────────────────

# Hard per-transaction ceiling, target ~$0.50 of ETH. Computed from a live
# price via `_fetch_live_eth_price_usd` (a standalone, genuinely-sync fetch —
# see that function's docstring for why this does NOT reuse
# bot.services.price_service). Falls back to a conservative fixed wei
# ceiling if the price lookup fails for any reason.
GAS_TOPUP_MAX_USD = Decimal("0.50")
GAS_TOPUP_FALLBACK_MAX_WEI = 150_000_000_000_000  # ~0.00015 ETH
# Absolute backstop applied even to a successful live price lookup, so a
# corrupted/garbage-low price feed value can never inflate the effective
# ceiling above this.
GAS_TOPUP_ABSOLUTE_MAX_WEI = 500_000_000_000_000  # ~0.0005 ETH, ~$1.50 worst case

# Buffer applied to the actual shortfall (never a round send amount — it's
# always shortfall-derived) so gas price movement between this check and the
# original tx's broadcast doesn't leave the wallet short again immediately.
GAS_TOPUP_BUFFER_MULTIPLIER = Decimal("1.3")

# Per-user daily caps. A legitimate user needs at most one or two top-ups a
# day; 5 leaves headroom for retries across send + earn without meaningfully
# raising exposure, since the per-tx ceiling already bounds each one.
# M1 fix: enforced atomically via `_daily_reserve(scope=f"user:{user_id}")`.
MAX_TOPUPS_PER_USER_PER_DAY = 5
USER_DAILY_TOPUP_MULTIPLE = 5  # value cap = 5x the live per-tx ceiling (~$2.50/day/user)

# Per-IP daily caps (F6) — looser than the per-user cap since one IP can
# legitimately be many real users (NAT/shared wifi/corporate egress), but
# still bounds how many "fresh accounts, same source" a single attacker can
# turn into free top-ups before this cap (not just the per-user one, which a
# sybil attacker trivially resets by minting a new user_id) kicks in.
MAX_TOPUPS_PER_IP_PER_DAY = 20
IP_DAILY_TOPUP_MULTIPLE = 20  # value cap = 20x the live per-tx ceiling (~$10/day/IP)

# M4: an IPv6 address is normalized to this prefix length before being used
# as a per-IP scope key — see `_normalize_ip_for_scope`. /64 is the smallest
# block a single residential/mobile customer is normally delegated by an
# ISP, so collapsing to it (rather than the raw /128 address) stops one real
# connection from minting effectively unlimited distinct per-IP scopes.
IPV6_SCOPE_PREFIX_LENGTH = 64

# Global daily circuit breaker across ALL users combined — F5 fix: an
# ABSOLUTE wei constant, NOT `per_tx_ceiling * multiple`. Deriving the
# day-cap from the runtime per_tx_ceiling made the actual daily USD exposure
# slide with live ETH price noise (and, before the F5 price-path fix below,
# with a silently-broken price lookup that always fell back to a much lower
# undocumented figure). Sized for ~$200/day network-wide at a conservative
# assumed ETH price of ~$2,000 (i.e. LOW, so the wei figure this produces is
# generously HIGH — this is a breaker, not a floor): 0.1 ETH. Re-derive by
# hand if ETH re-prices materially for a long stretch; do not make this
# "self-adjusting" again.
GAS_TOPUP_GLOBAL_DAILY_CAP_WEI = 100_000_000_000_000_000  # 0.1 ETH
# Sanity bound on topup COUNT for the global scope alongside the wei cap —
# not the primary control (the wei cap is), just a backstop against a huge
# number of dust-sized top-ups.
GLOBAL_DAILY_TOPUP_MAX_COUNT = 5000

# DESIGN CHANGE — per-wallet LIFETIME ceiling (anti-sybil, complements the
# daily caps): an ABSOLUTE wei constant, same F5 rationale as
# GAS_TOPUP_GLOBAL_DAILY_CAP_WEI (deriving from the live per-tx ceiling would
# let effective lifetime exposure drift with price noise). Sized generously
# above what a genuine long-lived user could plausibly need — roughly 40
# top-ups at the $0.50 ceiling — while bounding what a single sybil'd wallet
# can drain across day boundaries: ~0.02 ETH (~$40-60 depending on price).
WALLET_LIFETIME_TOPUP_CAP_WEI = 20_000_000_000_000_000  # 0.02 ETH

# DESIGN CHANGE — eligibility gate (anti-sybil): a wallet with NO observed
# real funds (`has_verified_funds=False`, see `ensure_gas`'s docstring) must
# be at least this old before it can draw an automatic top-up. A genuine new
# user who funds their wallet first (the common case — you need USDC to
# send/earn with anyway) is unaffected: `has_verified_funds=True` bypasses
# this entirely and instantly. This only slows down a wallet that has NEVER
# held real funds, which is exactly the sybil attacker's cheapest lever
# (mint account -> immediately request top-up -> repeat).
GAS_TOPUP_MIN_ACCOUNT_AGE_SECONDS = 86400  # 24 hours

# How long to wait for a top-up tx to land before treating it as failed
# (retryable) rather than claiming success. F4 fix: was 45s — see
# `run_gas_sensitive`'s module-docstring note; a shorter timeout on top of
# dedicated-pool dispatch bounds the worst case further.
GAS_TOPUP_CONFIRM_TIMEOUT_SECONDS = 15

# Fixed gas-unit estimates for earn withdraw (Aave V3 on Base), used when we
# don't already have a built tx to read `.gas`/`.gasPrice` off of (unlike
# /send, which reuses the exact built ERC-20 transfer tx). Deposit has its
# own live estimator — see `estimate_gas_wei_for_deposit` — because it can
# be TWO txs (approve + supply); this flat number is deposit's last-resort
# fallback only.
#
# F2 fix: real observed Base costs are approve ~46k + supply (first deposit,
# worst case incl. isolation-mode/collateral bookkeeping) ~230k gas units;
# bot/services/savings_service.py's `_build_and_send` inflates EACH leg by
# 1.2x before broadcast, so the wallet actually needs ~(46k+230k)*1.2≈331k
# units worth of ETH for a first-time deposit. The OLD 220k estimate here
# covered only ~2/3 of that, and because a static estimate has no live
# signal, the topped-up amount (220k*1.3 buffer=286k) landed the approve but
# not the supply — and the wallet, now holding "more than 220k" of gas,
# would never re-trigger a top-up on retry (`ensure_gas`'s own
# already-funded check at the top short-circuits it), permanently wedging
# the depositor. This is the STATIC FALLBACK ONLY (see
# `estimate_gas_wei_for_deposit`, which estimates live and sums both legs
# for real when it can) so it goes well above the derived ~331k figure.
DEPOSIT_GAS_UNITS_ESTIMATE = 450_000
WITHDRAW_GAS_UNITS_ESTIMATE = 170_000

# L2 fix: truly-last-resort fallback if `estimate_gas_wei_for_action`'s OWN
# RPC calls (get_web3/gas_price) ALSO fail — i.e. RPC is down for both the
# live estimate path AND its own fallback. A fixed, generous wei figure so
# `estimate_gas_wei_for_deposit`/`estimate_gas_wei_for_withdraw`'s "never
# raises" docstring claims are actually true, rather than letting a raw RPC
# exception escape two levels of fallback. This is a "don't crash" backstop,
# not a precise estimate — sized well above a realistic real-world cost.
_RPC_DOWN_FALLBACK_GAS_WEI = 2_000_000_000_000_000  # 0.002 ETH

# H3: dedicated bounded pool for the ONE call that can genuinely block for
# seconds — `ensure_gas` itself — dispatched via `run_gas_sensitive()` /
# `run_gas_sensitive_sync()`. Sized generously enough that ordinary
# concurrent top-ups are never bottlenecked by it; bounded so a burst of
# top-ups can never consume every slot in the API's SHARED default executor
# (`min(32, cpu+4)`), which every OTHER mobile send/earn call also uses for
# their (fast, no-top-up) build/sign/broadcast work.
_TOPUP_EXECUTOR = ThreadPoolExecutor(max_workers=16, thread_name_prefix="gas-topup")
# H3: no extra queuing headroom beyond the pool's own worker count — once
# all `_TOPUP_QUEUE_MAX` dispatches are in flight, the NEXT caller gets an
# immediate, retryable `GasTopUpBusy` (mapped to HTTP 503) instead of
# queuing behind an unbounded, untimed backlog of up to ~57s-each slow
# top-ups. Shared by both `run_gas_sensitive` (async) and
# `run_gas_sensitive_sync` (blocking-thread callers) since they dispatch
# onto the SAME underlying `_TOPUP_EXECUTOR`.
_TOPUP_QUEUE_MAX = 16
_topup_slots = threading.BoundedSemaphore(_TOPUP_QUEUE_MAX)

# F7: OP-stack L1 data-availability fee oracle predeploy — same address on
# every OP-stack chain (Base included). op-geth's balance precheck for a tx
# includes this on top of `gas * gasPrice`; omitting it here let a
# congestion-inflated L1 fee pass our precheck/top-up and still fail on
# broadcast, burning a top-up and a cap slot for nothing.
_L1_FEE_ORACLE_ADDRESS = "0x420000000000000000000000000000000000000F"
_L1_FEE_ORACLE_ABI = [
    {
        "name": "getL1Fee",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "_data", "type": "bytes"}],
        "outputs": [{"name": "", "type": "uint256"}],
    }
]
# Mobile is Base-only today (see api/routes/mobile.py's `_SEND_CHAIN`); kept
# as an explicit allowlist rather than "try on every chain" so a non-OP-stack
# chain never wastes an RPC round trip / logs a spurious warning.
_OP_STACK_CHAINS = frozenset({"base"})


class GasTopUpError(Exception):
    """Base for all ensure_gas() failures. Message is safe to surface as an
    HTTP error detail."""


class GasTopUpCapExceeded(GasTopUpError):
    """A per-transaction, per-user-daily, per-IP-daily, lifetime, or
    global-daily cap was hit. Deterministic — never sent anything, safe to
    surface directly."""


class GasTopUpIneligible(GasTopUpCapExceeded):
    """DESIGN CHANGE: the wallet failed the eligibility gate (see
    `_wallet_is_eligible_for_topup`) — no observed real funds and younger
    than `GAS_TOPUP_MIN_ACCOUNT_AGE_SECONDS`. Subclasses `GasTopUpCapExceeded`
    so every existing caller (which only catches that base class) already
    handles it correctly as a deterministic, non-retryable rejection; a
    caller that wants distinct copy for this specific case can catch
    `GasTopUpIneligible` before the base class. Message is stable so the
    mobile copy layer can map it to plain language."""


class GasTopUpFailed(GasTopUpError):
    """The top-up attempt itself failed, timed out waiting for confirmation,
    or landed but reverted — OR the caps themselves could not be verified
    (DB unreachable). Callers MUST treat this as retryable and MUST NOT
    report the original action as having succeeded."""


class GasTopUpBusy(GasTopUpError):
    """H3 fix: the dedicated top-up dispatch pool (`_TOPUP_EXECUTOR`) is
    saturated. Retryable, and — critically — nothing was reserved or spent
    to produce this error, unlike `GasTopUpCapExceeded`/`GasTopUpFailed`.
    Deliberately does NOT subclass either of those: a caller that only
    catches the base `GasTopUpError` still handles it, but a caller that
    wants a distinct "system is busy, retry shortly" 503 (rather than a cap
    message or a "this attempt failed" retry) can catch it first — see
    api/routes/mobile.py's send/earn handlers."""


def _utc_day_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _utc_today() -> date:
    return _utc_day_start().date()


# ── M3: module-level HTTP client + short-lived price cache ─────────────────

_HTTPX_CLIENT_LOCK = threading.Lock()
_httpx_client: Any = None

_PRICE_CACHE_TTL_SECONDS = 60
_price_cache_lock = threading.Lock()
_price_cache: dict = {"price": None, "fetched_at": 0.0}


def _get_httpx_client():
    """M3 fix: a single, module-level `httpx.Client` reused across every
    price fetch. The old code did `httpx.Client(timeout=3.0).get(...)`
    inline — a brand-new client (and its own connection pool) on EVERY
    top-up, never closed, i.e. a socket/connection-pool leak on every single
    call. Lazily created on first use (thread-safe, double-checked lock) so
    importing this module never opens a socket."""
    global _httpx_client
    if _httpx_client is None:
        with _HTTPX_CLIENT_LOCK:
            if _httpx_client is None:
                import httpx

                # H3/M3: tight, phase-specific timeouts — total worst case
                # ~1.5s, not the old flat `timeout=3.0` (which applies PER
                # PHASE in httpx, i.e. up to ~12s worst case across
                # connect+read+write+pool). A slow/unreachable price API
                # must fail fast into the fixed-wei fallback, not eat a
                # meaningful chunk of `ensure_gas`'s already-bounded budget.
                _httpx_client = httpx.Client(
                    timeout=httpx.Timeout(connect=0.5, read=1.0, write=1.0, pool=0.5)
                )
    return _httpx_client


def _fetch_live_eth_price_usd() -> Optional[float]:
    """F5 fix. Standalone, genuinely-synchronous ETH/USD fetch — deliberately
    NOT `bot.services.price_service`. That service's caching lock
    (`bot/utils/cache.py`'s `asyncio.Lock`) and shared `ClientSession`
    (`bot/utils/http_client.py`) are both bound to whichever event loop
    first touched them (the main API loop). `ensure_gas` runs via
    `run_gas_sensitive`'s dedicated thread pool, i.e. a worker thread with
    NO running loop of its own — `asyncio.run(price_service.get_prices(...))`
    from there always hit those main-loop-bound primitives and always raised
    RuntimeError, which was caught and silently ignored, so the "live" price
    path was dead code in production and the much-lower fixed-wei fallback
    ALWAYS applied. A one-off `httpx.Client()` call has no such cross-loop
    state and genuinely works from any thread.

    M3 fix: now backed by a module-level client (`_get_httpx_client`, was
    leaking a socket per call) and a ~60s in-process price cache — under
    load (exactly when the daily caps matter most), CoinGecko's public
    rate limit would otherwise 429 and silently fall back to the much lower
    fixed-wei ceiling far more often than a genuine price change requires.

    Kept as its own function (rather than inlined into `_max_topup_wei`) so
    tests can mock exactly this seam — see tests/test_gas_topup_service.py.
    """
    now = time.monotonic()
    with _price_cache_lock:
        cached_price = _price_cache["price"]
        if (
            cached_price is not None
            and (now - _price_cache["fetched_at"]) < _PRICE_CACHE_TTL_SECONDS
        ):
            return cached_price

    client = _get_httpx_client()
    resp = client.get(
        "https://api.coingecko.com/api/v3/simple/price",
        params={"ids": "ethereum", "vs_currencies": "usd"},
    )
    resp.raise_for_status()
    price = resp.json().get("ethereum", {}).get("usd")

    if price:
        with _price_cache_lock:
            _price_cache["price"] = price
            _price_cache["fetched_at"] = now
    return price


def _max_topup_wei() -> int:
    """Live per-transaction ceiling in wei, clamped by the absolute backstop
    regardless of source. Falls back to a fixed wei ceiling (also clamped)
    if the price lookup fails."""
    try:
        eth_price = _fetch_live_eth_price_usd()
        if eth_price and eth_price > 0:
            ceiling = int((GAS_TOPUP_MAX_USD / Decimal(str(eth_price))) * Decimal(10**18))
            if ceiling > 0:
                return min(ceiling, GAS_TOPUP_ABSOLUTE_MAX_WEI)
    except Exception as e:  # noqa: BLE001 — price lookup failure, not a verdict
        logger.warning(f"gas_topup_service: ETH price lookup failed, using fallback ceiling: {e}")
    return min(GAS_TOPUP_FALLBACK_MAX_WEI, GAS_TOPUP_ABSOLUTE_MAX_WEI)


# ── M4: IPv6 scope normalization ────────────────────────────────────────────


def _normalize_ip_for_scope(ip_address: str) -> str:
    """M4 fix: collapse an IPv6 address to its `/IPV6_SCOPE_PREFIX_LENGTH`
    (/64) network prefix before it's used as a per-IP `_daily_reserve` scope
    key. The raw-address scope key let a single attacker (one IPv6 /64 —
    routinely delegated to ONE customer by an ISP) mint 2^64 distinct
    per-IP scopes, each starting the per-IP daily cap fresh, and grew
    `gas_topup_daily_counters` unboundedly in the process. IPv4 addresses
    and anything unparseable (e.g. "unknown", the module's default) pass
    through unchanged — an IPv4 /32 has no equivalent trivial-rotation
    lever."""
    try:
        addr = ipaddress.ip_address(ip_address)
    except ValueError:
        return ip_address
    if isinstance(addr, ipaddress.IPv6Address):
        network = ipaddress.ip_network(f"{addr}/{IPV6_SCOPE_PREFIX_LENGTH}", strict=False)
        return str(network.network_address)
    return str(addr)


def estimate_l1_data_fee_wei(chain_name: str, tx: dict) -> int:
    """Blocking. F7 fix: best-effort OP-stack L1 data-availability fee for
    `tx`, queried live from the chain's GasPriceOracle predeploy
    (`getL1Fee`). We often don't have a final signature at precheck time, so
    the calldata is padded with a fixed-size dummy signature/RLP-overhead
    tail — this slightly OVERESTIMATES size/fee, the safe direction for a
    precheck. Returns 0 (never raises) for a non-OP-stack chain, or if the
    call fails for any reason (RPC hiccup, mocked web3 in tests, oracle not
    present) — callers must treat 0 as "couldn't determine one", not as
    "confirmed zero L1 fee"."""
    if chain_name not in _OP_STACK_CHAINS:
        return 0
    try:
        from bot.services.rpc_manager import rpc_manager

        web3 = rpc_manager.get_web3(chain_name)
        oracle = web3.eth.contract(
            address=Web3.to_checksum_address(_L1_FEE_ORACLE_ADDRESS), abi=_L1_FEE_ORACLE_ABI
        )
        data = tx.get("data") or tx.get("input") or "0x"
        if isinstance(data, (bytes, bytearray)):
            data_bytes = bytes(data)
        else:
            data_hex = data[2:] if data.startswith("0x") else data
            data_bytes = bytes.fromhex(data_hex) if data_hex else b""
        # ~110 bytes covers an EIP-1559 tx's signature (65) + type/RLP
        # length-prefix overhead, erring toward overestimating.
        padded = data_bytes + b"\x00" * 110
        return int(oracle.functions.getL1Fee(padded).call())
    except Exception as e:  # noqa: BLE001 — best-effort, never blocks a topup
        logger.warning(f"gas_topup_service: L1 data fee estimate failed for {chain_name}: {e}")
        return 0


def estimate_gas_wei_for_action(chain_name: str, gas_units: int) -> int:
    """Blocking. `gas_units * current gas price` + best-effort L1 data fee
    (F7) — used by callers (earn withdraw's fallback) that don't already
    have a built tx to read gas off of. The L1 fee here is always computed
    against EMPTY calldata (`{"data": "0x"}`) — this function has no
    knowledge of what the real tx's calldata will be, so it's a deliberate
    underestimate for anything that isn't a plain native transfer; see
    `estimate_gas_wei_for_withdraw` (L2 fix) for a caller that builds the
    REAL withdraw calldata instead. Run via `run_gas_sensitive`/
    asyncio.to_thread from an async context."""
    from bot.services.rpc_manager import rpc_manager

    web3 = rpc_manager.get_web3(chain_name)
    l2_execution_wei = int(web3.eth.gas_price * gas_units)
    l1_fee_wei = estimate_l1_data_fee_wei(chain_name, {"data": "0x"})
    return l2_execution_wei + l1_fee_wei


def estimate_gas_wei_for_deposit(chain_name: str, wallet_address: str, amount_wei: int) -> int:
    """Blocking. F2 fix. Best-effort LIVE estimate of a first-time Aave V3
    deposit's total gas cost — approve (only if the current allowance is
    insufficient) + supply — using the real ABI/calldata
    `savings_service.deposit()` will actually send, not a flat unit count.
    Applies the same 1.2x per-leg buffer `_build_and_send` uses, plus the L1
    data fee (F7), so this matches what will actually be spent.

    The supply leg is estimated live (`eth_estimateGas`) only when no
    approve is needed (i.e. allowance already covers amount_wei), since
    `eth_estimateGas` for `supply` reverts before an approval lands —
    otherwise a generous static per-leg estimate is used for that leg's GAS
    UNITS specifically (still real-world derived, see
    `DEPOSIT_GAS_UNITS_ESTIMATE`'s comment). L2 fix: the supply leg's L1
    DATA fee is now always included in both branches — `build_transaction`
    is pure local ABI-encoding (no RPC call, no revert risk) even when we
    can't live-simulate the supply call's gas units, so there's no reason
    to skip its L1 fee just because we're using the static unit fallback for
    its gas. Previously, whenever an approval was needed, the supply leg's
    L1 fee was silently omitted entirely (only the approve leg's L1 fee was
    added), under-estimating the total for every first-time depositor.

    L2 fix (docstring accuracy): "never raises" is now actually true. The
    fallback path (`estimate_gas_wei_for_action`) makes its OWN `get_web3`/
    `gas_price` RPC calls — if RPC is down for BOTH the live estimate here
    AND that fallback, this now catches that second failure too and returns
    a fixed last-resort figure (`_RPC_DOWN_FALLBACK_GAS_WEI`) instead of
    letting the exception escape.
    """
    from bot.services.rpc_manager import rpc_manager
    from bot.services.savings_service import (
        AAVE_POOL_ABI,
        AAVE_POOL_ADDRESS,
        ERC20_ABI,
        USDC_ADDRESS,
    )

    # Generous static per-leg fallback for supply's GAS UNITS when it can't
    # be simulated (allowance not yet granted) — derived from the same
    # real-world figures as DEPOSIT_GAS_UNITS_ESTIMATE's comment (~230k
    # observed, buffered up).
    supply_leg_fallback_units = 280_000

    try:
        web3 = rpc_manager.get_web3(chain_name)
        owner = Web3.to_checksum_address(wallet_address)
        pool_addr = Web3.to_checksum_address(AAVE_POOL_ADDRESS)
        usdc_addr = Web3.to_checksum_address(USDC_ADDRESS)
        usdc = web3.eth.contract(address=usdc_addr, abi=ERC20_ABI)
        pool = web3.eth.contract(address=pool_addr, abi=AAVE_POOL_ABI)
        gas_price = web3.eth.gas_price

        total_units = 0
        l1_fee_wei = 0
        allowance = usdc.functions.allowance(owner, pool_addr).call()
        needs_approve = allowance < amount_wei
        if needs_approve:
            approve_fn = usdc.functions.approve(pool_addr, amount_wei)
            approve_gas = approve_fn.estimate_gas({"from": owner})
            total_units += int(approve_gas * 1.2)
            approve_tx = approve_fn.build_transaction({"from": owner, "gas": 0, "gasPrice": 0})
            l1_fee_wei += estimate_l1_data_fee_wei(chain_name, approve_tx)
            # Supply can't be simulated pre-approval (would revert on the
            # transferFrom allowance check) — use the generous static leg
            # for GAS UNITS, but its L1 fee only depends on calldata SIZE,
            # which we CAN compute without simulating (build_transaction is
            # pure local encoding) — L2 fix, see docstring above.
            total_units += int(supply_leg_fallback_units * 1.2)
            supply_fn = pool.functions.supply(usdc_addr, amount_wei, owner, 0)
            supply_tx = supply_fn.build_transaction({"from": owner, "gas": 0, "gasPrice": 0})
            l1_fee_wei += estimate_l1_data_fee_wei(chain_name, supply_tx)
        else:
            supply_fn = pool.functions.supply(usdc_addr, amount_wei, owner, 0)
            supply_gas = supply_fn.estimate_gas({"from": owner})
            total_units += int(supply_gas * 1.2)
            supply_tx = supply_fn.build_transaction({"from": owner, "gas": 0, "gasPrice": 0})
            l1_fee_wei += estimate_l1_data_fee_wei(chain_name, supply_tx)

        return int(total_units * gas_price) + l1_fee_wei
    except Exception as e:  # noqa: BLE001 — fall back to the static estimate
        logger.warning(
            f"gas_topup_service: live deposit gas estimate failed, using static fallback: {e}"
        )
        try:
            return estimate_gas_wei_for_action(chain_name, DEPOSIT_GAS_UNITS_ESTIMATE)
        except Exception as e2:  # noqa: BLE001 — L2 fix: make "never raises" true
            logger.error(
                "gas_topup_service: RPC unreachable for BOTH the live deposit estimate AND its "
                f"fallback — using the fixed last-resort figure: {e2}"
            )
            return _RPC_DOWN_FALLBACK_GAS_WEI


def estimate_gas_wei_for_withdraw(chain_name: str, wallet_address: str, amount_wei: int) -> int:
    """Blocking. L2 fix: `estimate_gas_wei_for_action`'s L1 data fee for the
    withdraw path was previously computed against EMPTY calldata
    (`{"data": "0x"}`), not Aave's actual `Pool.withdraw(...)` calldata — an
    OP-stack L1 fee scales with calldata SIZE, so an empty-calldata estimate
    systematically under-quotes it (real `withdraw` calldata is a 4-byte
    selector + 3 * 32-byte args, not 0 bytes). This builds the REAL
    `withdraw` calldata (same ABI/args `savings_service.withdraw()` will
    actually send) purely to size the L1 fee correctly. Gas UNITS still use
    the static `WITHDRAW_GAS_UNITS_ESTIMATE` (no live `eth_estimateGas`
    here, unlike deposit — a withdraw can't be safely pre-simulated without
    duplicating savings_service's own position-balance check).

    `amount_wei` should be `savings_service.MAX_UINT256` for a "withdraw
    everything" call (matching the sentinel Aave itself uses), same as the
    real tx.

    Never raises (L2 fix, same reasoning as `estimate_gas_wei_for_deposit`):
    any RPC/ABI-encoding failure falls back to `estimate_gas_wei_for_action`,
    and if THAT also fails (RPC down for both paths), falls back further to
    a fixed last-resort figure rather than letting an exception escape."""
    from bot.services.rpc_manager import rpc_manager
    from bot.services.savings_service import AAVE_POOL_ABI, AAVE_POOL_ADDRESS, USDC_ADDRESS

    try:
        web3 = rpc_manager.get_web3(chain_name)
        owner = Web3.to_checksum_address(wallet_address)
        pool = web3.eth.contract(
            address=Web3.to_checksum_address(AAVE_POOL_ADDRESS), abi=AAVE_POOL_ABI
        )
        withdraw_fn = pool.functions.withdraw(
            Web3.to_checksum_address(USDC_ADDRESS), amount_wei, owner
        )
        withdraw_tx = withdraw_fn.build_transaction({"from": owner, "gas": 0, "gasPrice": 0})
        l1_fee_wei = estimate_l1_data_fee_wei(chain_name, withdraw_tx)
        l2_execution_wei = int(web3.eth.gas_price * WITHDRAW_GAS_UNITS_ESTIMATE)
        return l2_execution_wei + l1_fee_wei
    except Exception as e:  # noqa: BLE001 — fall back to the static estimate
        logger.warning(
            f"gas_topup_service: live withdraw L1 fee estimate failed, using static fallback: {e}"
        )
        try:
            return estimate_gas_wei_for_action(chain_name, WITHDRAW_GAS_UNITS_ESTIMATE)
        except Exception as e2:  # noqa: BLE001 — L2 fix: make "never raises" true
            logger.error(
                "gas_topup_service: RPC unreachable for BOTH the live withdraw estimate AND its "
                f"fallback — using the fixed last-resort figure: {e2}"
            )
            return _RPC_DOWN_FALLBACK_GAS_WEI


async def run_gas_sensitive(func, *args, **kwargs) -> Any:
    """H3 fix. Dispatch a blocking, gas-topup-capable call (`ensure_gas`
    itself — NOT the surrounding fast build/sign/broadcast work; see the
    module docstring's DISPATCH section) on this module's own dedicated
    `_TOPUP_EXECUTOR` pool instead of `asyncio.to_thread`'s shared default
    executor. Async callers (e.g. api/routes/mobile.py's earn flow, which
    already only wraps the `ensure_gas` call itself) use this. Blocking-
    thread callers (e.g. `_send_usdc_base`, which runs on a worker thread
    with no running loop) must use `run_gas_sensitive_sync` instead.

    Raises `GasTopUpBusy` immediately (does not queue) if all
    `_TOPUP_QUEUE_MAX` dispatch slots are already in use — callers MUST
    catch this and map it to a retryable HTTP 503, not a cap message."""
    if not _topup_slots.acquire(blocking=False):
        raise GasTopUpBusy("Gas top-up is busy right now. Please try again in a moment.")
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_TOPUP_EXECUTOR, functools.partial(func, *args, **kwargs))
    finally:
        _topup_slots.release()


def run_gas_sensitive_sync(func, *args, **kwargs) -> Any:
    """H3 fix. Blocking counterpart to `run_gas_sensitive`, for a caller
    that is ALREADY running on a worker thread (not the event loop) — e.g.
    `_send_usdc_base` (api/routes/mobile.py), which does its own gas
    precheck/build/sign/broadcast on the API's SHARED thread pool (via
    `asyncio.to_thread`) and must only hand the potentially-slow
    `ensure_gas` call itself to the dedicated pool. Shares the same bounded
    `_topup_slots` semaphore as `run_gas_sensitive`, so the two dispatch
    paths can never together exceed `_TOPUP_QUEUE_MAX` concurrent
    `ensure_gas` calls regardless of which one a caller uses.

    Raises `GasTopUpBusy` immediately (does not queue) if saturated, same
    contract as `run_gas_sensitive`."""
    if not _topup_slots.acquire(blocking=False):
        raise GasTopUpBusy("Gas top-up is busy right now. Please try again in a moment.")
    try:
        future = _TOPUP_EXECUTOR.submit(func, *args, **kwargs)
        return future.result()
    finally:
        _topup_slots.release()


def _daily_reserve(scope: str, amount_wei: int, cap_wei: int, cap_count: int) -> bool:
    """F6 fix (M1 fix: now also used for the per-user scope). Atomically
    check-and-reserve `amount_wei` against a per-(UTC day, scope) counter row
    in `gas_topup_daily_counters` — used for the global breaker
    (`scope="global"`), the per-IP cap (`scope="ip:<address-or-/64>"`), AND
    (M1) the per-user cap (`scope=f"user:{user_id}"`). Replaces the old
    per-user check's read-then-compare-then-send: N concurrent requests
    could each read the same stale total and collectively overshoot the cap
    by up to N x per-tx ceiling.

    A single `INSERT ... ON CONFLICT (day, scope) DO UPDATE ... WHERE ...`
    statement: both Postgres and SQLite (3.35+, this repo's is 3.45) execute
    the conflicting UPDATE branch atomically under the row lock the UPSERT
    itself takes, so there is no separate SELECT-then-UPDATE window for a
    race to land in. The very first reservation for a given (day, scope)
    takes the INSERT branch unconditionally (no prior row to guard against)
    — safe in practice since a single `amount_wei` is always far below both
    caps by construction (the per-tx ceiling bounds it).

    Returns True if reserved (caller may proceed to spend `amount_wei`),
    False if either cap would be exceeded — nothing is reserved in that
    case. A SUCCESSFUL reservation is NOT automatically rolled back if the
    top-up later fails — see the module docstring's H2 section: `ensure_gas`
    calls `_daily_release` explicitly on every pre-broadcast failure path,
    and deliberately does NOT for a PostBroadcastAmbiguous/confirmed
    outcome.

    Raises `GasTopUpFailed` if the DB itself is unreachable — this table is
    the sole source of truth for these caps, so a query failure must fail
    closed (see `_lifetime_reserve`'s docstring for the same reasoning)."""
    from sqlalchemy import text

    from database.db import get_session

    today = _utc_today()
    try:
        with get_session() as session:
            result = session.execute(
                text("""
                    INSERT INTO gas_topup_daily_counters (day, scope, total_wei, topup_count)
                    VALUES (:day, :scope, :amount, 1)
                    ON CONFLICT (day, scope) DO UPDATE
                    SET total_wei = gas_topup_daily_counters.total_wei + :amount,
                        topup_count = gas_topup_daily_counters.topup_count + 1
                    WHERE gas_topup_daily_counters.total_wei + :amount <= :cap_wei
                      AND gas_topup_daily_counters.topup_count + 1 <= :cap_count
                    RETURNING total_wei
                    """),
                {
                    "day": today,
                    "scope": scope,
                    "amount": amount_wei,
                    "cap_wei": cap_wei,
                    "cap_count": cap_count,
                },
            )
            row = result.first()
            return row is not None
    except Exception as e:
        logger.error(f"gas_topup_service: daily counter reserve failed for scope={scope}: {e}")
        raise GasTopUpFailed(
            "We couldn't verify today's gas top-up limits. Please try again in a moment."
        ) from e


def _daily_release(scope: str, amount_wei: int) -> None:
    """H2 fix: compensating decrement for a `_daily_reserve` reservation
    whose top-up attempt failed BEFORE anything was broadcast — i.e.
    genuinely zero ETH left the hot wallet, so the reservation must not
    permanently consume quota. See `ensure_gas`'s pre-broadcast failure
    branches (and the module docstring's H2 section) for exactly which
    cases call this — this deliberately includes `HotWalletBusyError` from
    hot_wallet.py's cross-replica send lock, expected under ordinary
    concurrent top-up traffic.

    Deliberately NEVER called for a `PostBroadcastAmbiguous` outcome (the
    broadcast call raised AFTER the tx may already have been
    accepted/propagated — see that exception's docstring in hot_wallet.py)
    or a genuinely-confirmed broadcast (receipt timeout / on-chain revert
    both mean real ETH already left the hot wallet) — those keep their
    reservation, the conservative direction (the breaker trips a little
    earlier than the true spend requires, never later).

    Best-effort: floors at 0 via a portable `CASE` (works identically on
    SQLite and Postgres, unlike a bare `MAX()`/`GREATEST()` scalar call,
    which isn't portable between the two) and never raises — a failed
    release just leaves the breaker slightly tighter than necessary for the
    rest of the UTC day, which is the safe direction; it must not turn a
    pre-broadcast failure into a SECOND hard error on top of the one the
    caller is already raising."""
    from sqlalchemy import text

    from database.db import get_session

    today = _utc_today()
    try:
        with get_session() as session:
            session.execute(
                text("""
                    UPDATE gas_topup_daily_counters
                    SET total_wei = CASE WHEN total_wei > :amount THEN total_wei - :amount ELSE 0 END,
                        topup_count = CASE WHEN topup_count > 0 THEN topup_count - 1 ELSE 0 END
                    WHERE day = :day AND scope = :scope
                    """),
                {"day": today, "scope": scope, "amount": amount_wei},
            )
    except Exception as e:  # noqa: BLE001 — best-effort compensating release
        logger.error(
            f"gas_topup_service: failed to release reserved quota for scope={scope} "
            f"amount_wei={amount_wei}: {e}"
        )


def _lifetime_reserve(wallet_address: str, amount_wei: int, cap_wei: int) -> bool:
    """DESIGN CHANGE: atomic check-and-reserve against the per-wallet
    LIFETIME ceiling (`WALLET_LIFETIME_TOPUP_CAP_WEI`) — same UPSERT-with-
    WHERE-guard pattern as `_daily_reserve` (see its docstring for the full
    atomicity rationale), just against `gas_topup_wallet_lifetime` (keyed by
    wallet_address, no day dimension — a lifetime cap never resets) instead
    of `gas_topup_daily_counters`. The address is lower-cased before use so
    `0xABC...` and `0xabc...` share one row.

    Raises `GasTopUpFailed` if the DB is unreachable — same fail-closed
    reasoning as `_daily_reserve`."""
    from sqlalchemy import text

    from database.db import get_session

    key = wallet_address.lower()
    try:
        with get_session() as session:
            result = session.execute(
                text("""
                    INSERT INTO gas_topup_wallet_lifetime (wallet_address, total_wei, topup_count)
                    VALUES (:addr, :amount, 1)
                    ON CONFLICT (wallet_address) DO UPDATE
                    SET total_wei = gas_topup_wallet_lifetime.total_wei + :amount,
                        topup_count = gas_topup_wallet_lifetime.topup_count + 1
                    WHERE gas_topup_wallet_lifetime.total_wei + :amount <= :cap_wei
                    RETURNING total_wei
                    """),
                {"addr": key, "amount": amount_wei, "cap_wei": cap_wei},
            )
            return result.first() is not None
    except Exception as e:
        logger.error(f"gas_topup_service: lifetime reserve failed for wallet={key}: {e}")
        raise GasTopUpFailed(
            "We couldn't verify this wallet's gas top-up history. Please try again in a moment."
        ) from e


def _lifetime_release(wallet_address: str, amount_wei: int) -> None:
    """H2-style compensating decrement for `_lifetime_reserve` on a
    pre-broadcast failure. See `_daily_release`'s docstring for the full
    reasoning (never called for an ambiguous/confirmed-broadcast outcome) —
    identical contract, just against the lifetime table."""
    from sqlalchemy import text

    from database.db import get_session

    key = wallet_address.lower()
    try:
        with get_session() as session:
            session.execute(
                text("""
                    UPDATE gas_topup_wallet_lifetime
                    SET total_wei = CASE WHEN total_wei > :amount THEN total_wei - :amount ELSE 0 END,
                        topup_count = CASE WHEN topup_count > 0 THEN topup_count - 1 ELSE 0 END
                    WHERE wallet_address = :addr
                    """),
                {"addr": key, "amount": amount_wei},
            )
    except Exception as e:  # noqa: BLE001 — best-effort compensating release
        logger.error(
            f"gas_topup_service: failed to release lifetime reservation for wallet={key} "
            f"amount_wei={amount_wei}: {e}"
        )


def _refund_reservations(
    reserved_scopes: list, lifetime_reserved: bool, wallet_address: str, amount_wei: int
) -> None:
    """H2 fix: refund every daily-scope reservation in `reserved_scopes`
    (via `_daily_release`) plus the lifetime reservation if one was taken
    (via `_lifetime_release`). Called from every PRE-BROADCAST failure
    branch in `ensure_gas` — see the module docstring's H2 section. Never
    called once a broadcast attempt has actually occurred."""
    for scope in reserved_scopes:
        _daily_release(scope, amount_wei)
    if lifetime_reserved:
        _lifetime_release(wallet_address, amount_wei)


def _wallet_is_eligible_for_topup(
    user_id: int, wallet_address: str, has_verified_funds: bool
) -> bool:
    """DESIGN CHANGE (anti-sybil eligibility gate): True if `wallet_address`
    is either already known to hold/have held real funds
    (`has_verified_funds` — callers pass this from the SAME balance check
    the module docstring's ORDERING section already requires before calling
    `ensure_gas`, e.g. `savings_service.get_usdc_balance(...) > 0`; a
    genuine inbound deposit had to land for that to be true) OR is at least
    `GAS_TOPUP_MIN_ACCOUNT_AGE_SECONDS` old (queried from `wallets.created_at`).

    Without this gate, the per-user/IP/global daily caps alone don't stop a
    sybil attacker: minting a fresh, never-funded account (near-free) resets
    the per-user cap instantly, so an attacker only needs enough accounts +
    IPs to keep hitting the IP/global caps every day. This forces each
    account to EITHER wait out the age window OR actually move real (if
    dust-sized) funds through the wallet first — which is where the
    reviewer's dust-transfer cost estimate for a sybil campaign comes from.

    Fails CLOSED (ineligible) if the DB lookup itself fails or no matching
    wallet row is found — same reasoning as `_daily_reserve`/
    `_lifetime_reserve`'s fail-closed DB-error handling: an unknown account
    age must never be treated as "old enough"."""
    if has_verified_funds:
        return True

    from sqlalchemy import func

    from bot.models.user import Wallet
    from database.db import get_session

    try:
        with get_session() as session:
            wallet = (
                session.query(Wallet)
                .filter(Wallet.user_id == user_id)
                .filter(func.lower(Wallet.address) == wallet_address.lower())
                .first()
            )
            if wallet is None or wallet.created_at is None:
                return False
            created_at = wallet.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            age_seconds = (datetime.now(timezone.utc) - created_at).total_seconds()
            return age_seconds >= GAS_TOPUP_MIN_ACCOUNT_AGE_SECONDS
    except Exception as e:  # noqa: BLE001 — fail closed
        logger.error(
            f"gas_topup_service: eligibility check failed for user={user_id} "
            f"wallet={wallet_address}: {e}"
        )
        return False


def _record_topup_pending(
    user_id: int,
    wallet_address: str,
    chain: str,
    amount_wei: int,
    reason: str,
) -> int:
    """F3 fix. Insert a status="pending" audit row BEFORE anything is
    broadcast from the hot wallet. The daily/lifetime caps are enforced from
    `gas_topup_daily_counters`/`gas_topup_wallet_lifetime` (F6/DESIGN CHANGE),
    but this table remains the durable audit trail — a top-up must never be
    able to spend without a durable row backing it. Raises `GasTopUpFailed`
    (refuses the top-up, spends nothing — caller must refund every
    reservation, see the module docstring's H2 section) if the insert
    itself fails. Returns the new row's id for `_update_topup_status` to
    update later."""
    from bot.models.gas_topup import GasTopUp
    from database.db import get_session

    try:
        with get_session() as session:
            row = GasTopUp(
                user_id=user_id,
                wallet_address=wallet_address,
                chain=chain,
                amount_wei=amount_wei,
                tx_hash=None,
                reason=reason,
                status="pending",
            )
            session.add(row)
            session.flush()
            return row.id
    except Exception as e:
        logger.error(
            f"gas_topup_service: FAILED TO RECORD a pending top-up BEFORE spend — refusing "
            f"(user={user_id} wallet={wallet_address} amount_wei={amount_wei}): {e}"
        )
        raise GasTopUpFailed(
            "We couldn't get your wallet ready right now. Please try again in a moment."
        ) from e


def _update_topup_status(row_id: int, *, status: str, tx_hash: Optional[str]) -> None:
    """Update the pending row to its final status once the broadcast result
    is known. Best-effort: by the time this runs, the spend has already
    definitively happened or definitively not happened, so a failure here
    is logged CRITICAL but not raised — the row from `_record_topup_pending`
    still exists and still counts toward the caps even if this update never
    lands, just with a stale "pending" status rather than a lost row."""
    from bot.models.gas_topup import GasTopUp
    from database.db import get_session

    try:
        with get_session() as session:
            row = session.get(GasTopUp, row_id)
            if row is not None:
                row.status = status
                if tx_hash:
                    row.tx_hash = tx_hash
    except Exception as e:
        logger.critical(
            f"gas_topup_service: FAILED TO UPDATE top-up row {row_id} to status={status} "
            f"tx_hash={tx_hash}: {e}"
        )


def ensure_gas(
    *,
    user_id: int,
    wallet_address: str,
    chain_name: str,
    estimated_gas_wei: int,
    reason: str,
    ip_address: str = "unknown",
    has_verified_funds: bool = False,
) -> bool:
    """Blocking — callers MUST dispatch via `run_gas_sensitive()` (async
    context) or `run_gas_sensitive_sync()` (already on a worker thread), not
    `asyncio.to_thread` (see module docstring's DISPATCH section, F4/H3
    fixes).

    Top up `wallet_address` (the AUTHENTICATED user's own resolved wallet —
    callers MUST NOT pass a client-supplied address) with native token from
    the gas-payer hot wallet if it can't cover `estimated_gas_wei`.
    `ip_address` should be the caller's real client IP (see
    api/routes/mobile.py's `_client_ip`) — used only for the per-IP daily
    cap (F6, normalized per M4); defaults to "unknown" so this stays
    optional for any non-HTTP/test caller, which just shares one bucket.
    `has_verified_funds` should be `True` when the caller has ALREADY
    confirmed (via the same balance check the ORDERING section requires)
    that this wallet holds/held real funds — see the ELIGIBILITY GATE
    section of the module docstring and `_wallet_is_eligible_for_topup`.

    Returns True if a top-up was performed, False if the wallet already had
    enough. Raises `GasTopUpCapExceeded` (incl. `GasTopUpIneligible`),
    `GasTopUpFailed`, or `GasTopUpBusy` otherwise — never silently proceeds
    past a cap, a failed/unconfirmed top-up, or a saturated dispatch pool.

    MUST only be called after the caller has already validated the
    underlying action's balance/amount (see module docstring's ordering
    note).
    """
    from bot.services.hot_wallet import PostBroadcastAmbiguous, hot_wallet_service
    from bot.services.rpc_manager import rpc_manager

    web3 = rpc_manager.get_web3(chain_name)
    from_addr = Web3.to_checksum_address(wallet_address)
    native_balance = web3.eth.get_balance(from_addr)
    if native_balance >= estimated_gas_wei:
        return False

    shortfall = estimated_gas_wei - native_balance
    per_tx_ceiling = _max_topup_wei()

    if shortfall > per_tx_ceiling:
        raise GasTopUpCapExceeded(
            "This transfer needs more gas than we can auto-fund right now. "
            "Please add a small amount of ETH on Base to your wallet and try again."
        )

    topup_wei = min(int(Decimal(shortfall) * GAS_TOPUP_BUFFER_MULTIPLIER), per_tx_ceiling)
    topup_wei = max(topup_wei, shortfall)  # never top up less than the actual shortfall

    # DESIGN CHANGE: eligibility gate — checked BEFORE any quota is
    # reserved, so an ineligible attempt never even touches the daily/
    # lifetime counters.
    if not _wallet_is_eligible_for_topup(user_id, from_addr, has_verified_funds):
        raise GasTopUpIneligible(
            "Your wallet needs to receive funds first (or wait a little longer) before "
            "automatic gas top-up is available. Add a small amount of ETH on Base to your "
            "wallet directly, or try again once you've received a deposit."
        )

    user_scope = f"user:{user_id}"
    ip_scope = f"ip:{_normalize_ip_for_scope(ip_address)}"
    max_user_daily_wei = per_tx_ceiling * USER_DAILY_TOPUP_MULTIPLE
    max_ip_daily_wei = per_tx_ceiling * IP_DAILY_TOPUP_MULTIPLE

    reserved_scopes: list = []
    lifetime_reserved = False

    # M1 fix: per-user cap is now an atomic reserve (was read-then-compare
    # via a separate query — two concurrent requests could each read the
    # same stale count/total and both pass). M2 fix note: a pre-broadcast
    # failure below refunds this reservation (H2), so a transient failure
    # (RPC blip, HotWalletBusyError) no longer permanently consumes a slot
    # of the daily COUNT cap either — it simply never counted.
    if not _daily_reserve(user_scope, topup_wei, max_user_daily_wei, MAX_TOPUPS_PER_USER_PER_DAY):
        raise GasTopUpCapExceeded(
            "You've reached today's gas top-up limit for this wallet. "
            "Try again tomorrow, or add a small amount of ETH on Base directly."
        )
    reserved_scopes.append(user_scope)

    # F6/M4: per-IP cap, atomic reserve, IPv6 normalized to /64.
    if not _daily_reserve(ip_scope, topup_wei, max_ip_daily_wei, MAX_TOPUPS_PER_IP_PER_DAY):
        _refund_reservations(reserved_scopes, lifetime_reserved, from_addr, topup_wei)
        raise GasTopUpCapExceeded(
            "You've reached today's gas top-up limit for this wallet. "
            "Try again tomorrow, or add a small amount of ETH on Base directly."
        )
    reserved_scopes.append(ip_scope)

    # F5/F6: global circuit breaker — atomic reserve against an ABSOLUTE wei
    # constant (not a runtime-derived multiple).
    if not _daily_reserve(
        "global", topup_wei, GAS_TOPUP_GLOBAL_DAILY_CAP_WEI, GLOBAL_DAILY_TOPUP_MAX_COUNT
    ):
        _refund_reservations(reserved_scopes, lifetime_reserved, from_addr, topup_wei)
        logger.critical(
            "GAS TOP-UP GLOBAL DAILY CIRCUIT BREAKER TRIPPED: "
            f"reserving {topup_wei} wei would exceed cap {GAS_TOPUP_GLOBAL_DAILY_CAP_WEI} wei "
            f"(user={user_id}, reason={reason})"
        )
        raise GasTopUpCapExceeded(
            "Gas top-up is temporarily paused network-wide. Please try again later "
            "or add a small amount of ETH on Base directly."
        )
    reserved_scopes.append("global")

    # DESIGN CHANGE: per-wallet lifetime ceiling — atomic reserve.
    if not _lifetime_reserve(from_addr, topup_wei, WALLET_LIFETIME_TOPUP_CAP_WEI):
        _refund_reservations(reserved_scopes, lifetime_reserved, from_addr, topup_wei)
        raise GasTopUpCapExceeded(
            "This wallet has reached its lifetime gas top-up limit. "
            "Please add a small amount of ETH on Base directly."
        )
    lifetime_reserved = True

    gas_wallet = hot_wallet_service.get_gas_payer_wallet("evm")
    if gas_wallet is None:
        # H2: pre-broadcast failure — refund every reservation above.
        _refund_reservations(reserved_scopes, lifetime_reserved, from_addr, topup_wei)
        raise GasTopUpFailed(
            "We couldn't get your wallet ready right now. Please try again in a moment."
        )

    amount_eth = Decimal(topup_wei) / Decimal(10**18)

    # F3: durable row BEFORE broadcast — see module docstring / this
    # function's docstring for why.
    try:
        row_id = _record_topup_pending(user_id, from_addr, chain_name, topup_wei, reason)
    except GasTopUpFailed:
        # H2: pre-broadcast failure — refund every reservation above.
        _refund_reservations(reserved_scopes, lifetime_reserved, from_addr, topup_wei)
        raise

    tx_hash: Optional[str] = None
    status = "sent"
    try:
        tx_hash = asyncio.run(
            hot_wallet_service.send_native_token(
                wallet=gas_wallet,
                chain_name=chain_name,
                to_address=from_addr,
                amount=amount_eth,
            )
        )
    except PostBroadcastAmbiguous as e:
        # H2: DELIBERATELY do NOT refund here — the broadcast call itself
        # raised AFTER the tx may already have been accepted/propagated by
        # the node (see hot_wallet.py's PostBroadcastAmbiguous docstring).
        # Funds may well have moved, so refunding could let a retry
        # double-spend this quota for the same ETH. This applies to BOTH
        # sub-cases below (with or without a resolved tx_hash) — the
        # ambiguity, not the presence of a hash, is what matters.
        tx_hash = e.tx_hash
        status = "ambiguous"
        if not tx_hash:
            _update_topup_status(row_id, status="failed", tx_hash=None)
            raise GasTopUpFailed(
                "We couldn't confirm your wallet top-up. Please try again in a moment."
            ) from e
    except Exception as e:
        # H2 fix: this branch is reached ONLY for a genuinely pre-broadcast
        # failure (nonce fetch, `HotWalletBusyError` from the cross-replica
        # send lock — EXPECTED under ordinary concurrent top-up traffic, not
        # a hard failure — an RPC error before any broadcast attempt, etc.)
        # — anything that could have ambiguously broadcast raises
        # PostBroadcastAmbiguous instead (see hot_wallet.py's module
        # docstring). Genuinely zero ETH left the hot wallet here, so refund
        # every reservation taken above — without this, ordinary
        # multi-replica concurrency alone (two top-ups racing the same
        # cross-replica lock) could burn global/user/IP/lifetime quota with
        # nothing ever spent, eventually tripping the breaker on its own.
        logger.error(f"Gas top-up broadcast failed for user {user_id} wallet {from_addr}: {e}")
        _update_topup_status(row_id, status="failed", tx_hash=None)
        _refund_reservations(reserved_scopes, lifetime_reserved, from_addr, topup_wei)
        raise GasTopUpFailed(
            "We couldn't get your wallet ready right now. Please try again in a moment."
        ) from e

    # Update BEFORE waiting for confirmation — something was broadcast and
    # spent from the hot wallet, so it belongs in the audit trail regardless
    # of what happens next. H2: no refund past this point under any
    # outcome — real ETH already left the hot wallet.
    _update_topup_status(row_id, status=status, tx_hash=tx_hash)

    try:
        receipt = web3.eth.wait_for_transaction_receipt(
            tx_hash, timeout=GAS_TOPUP_CONFIRM_TIMEOUT_SECONDS
        )
    except Exception as e:
        raise GasTopUpFailed(
            "Your wallet top-up is still confirming. Please try again in a moment."
        ) from e

    if receipt.get("status") != 1:
        raise GasTopUpFailed("Your wallet top-up failed on-chain. Please try again in a moment.")

    return True

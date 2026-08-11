"""Auto gas top-up from the hot wallet — MONEY-PATH.

A Gekko user must never need to hold ETH: when a wallet action (send, earn
deposit/withdraw) needs Base gas the wallet can't cover, this service tops
the wallet up from the gas-payer hot wallet (same custodial pattern as
bot/services/paymaster.py's `sponsor_transaction`, reused rather than
reinvented — the differences here are the hard per-tx/day/global spend caps
and the durable audit trail, since paymaster.py's sponsorship config lives
per-chain in the DB and this path is mobile-specific and always Base today).

ORDERING / ANTI-GRIEFING (do this, and only this):
`ensure_gas()` MUST be called only after the caller has already validated
that the underlying action is real and funded — i.e. the user's token
balance covers the amount they're trying to move. Both call sites
(api/routes/mobile.py's `_send_usdc_base` and `_execute_earn_action`) do
this: the USDC/aToken balance and amount are checked BEFORE this module is
ever invoked. That means a top-up always accompanies genuine transfer
intent; a user cannot cheaply trigger repeated top-ups by polling a
balance-check endpoint alone, since no such endpoint calls this module.

SPEND CONTROLS (all enforced here, before any transfer is made):
  * Per-transaction ceiling (`GAS_TOPUP_MAX_USD`, converted to wei via a
    genuinely synchronous live price lookup — see `_fetch_live_eth_price_usd`
    — with a conservative fixed-wei fallback, then clamped by an absolute
    backstop regardless of what the price lookup returns).
  * Per-user daily count + wei caps (`MAX_TOPUPS_PER_USER_PER_DAY`,
    `USER_DAILY_TOPUP_MULTIPLE`), computed by querying the `gas_topups`
    audit table for today's UTC rows — the audit log and the enforcement
    data source are the same table, so they cannot drift apart.
  * Per-IP daily count + wei caps (`MAX_TOPUPS_PER_IP_PER_DAY`,
    `IP_DAILY_TOPUP_MULTIPLE`) — a user_id is free to mint (a fresh mobile
    signup), a routable client IP is not; see `_daily_reserve`.
  * Global daily circuit breaker (`GAS_TOPUP_GLOBAL_DAILY_CAP_WEI`, an
    ABSOLUTE wei constant) — trips a CRITICAL log and refuses ALL further
    top-ups for the rest of the UTC day once the network-wide total is hit.
    Both the per-IP and global caps are enforced via `_daily_reserve`, a
    single atomic UPSERT against the `gas_topup_daily_counters` table, so
    concurrent requests cannot each read the same stale total and
    collectively overshoot the cap (the old per-user-only, read-then-compare
    version of this check could).

Every exceeded cap raises `GasTopUpCapExceeded` with a stable, plain-language
message (never mentions "gas"/"ETH" internals beyond what's needed to be
actionable) that callers surface directly as the HTTP error detail — the
mobile client's copy layer maps details to user-facing text, so these
strings must stay stable. A failed/timed-out top-up attempt raises
`GasTopUpFailed`, which callers must treat as retryable and MUST NOT report
the original action as having succeeded.

AUDIT ROW LIFECYCLE (fixes a fail-open bug where a swallowed insert failure
made the daily caps silently infinite): a `gas_topups` row is inserted with
status="pending" BEFORE anything is broadcast from the hot wallet — see
`_record_topup_pending`, called from `ensure_gas` right after the caps pass
and right before `hot_wallet_service.send_native_token`. If that insert
itself fails, `ensure_gas` raises `GasTopUpFailed` and refuses to spend —
spend must never happen without a durable row backing it, since
`_user_daily_stats` computes the caps SOLELY from this table. The row is
then updated in place to its final status (`_update_topup_status`) once the
broadcast result (success/ambiguous/failure) is known.

DISPATCH (avoids starving the API's shared thread pool): `ensure_gas` and
`api/routes/mobile.py`'s `_send_usdc_base` are both plain blocking functions
that can block for up to `GAS_TOPUP_CONFIRM_TIMEOUT_SECONDS` waiting for a
top-up's receipt. Callers MUST dispatch them via `run_gas_sensitive()`
(below), which runs on this module's own small dedicated `_TOPUP_EXECUTOR`
pool rather than `asyncio.to_thread`'s shared default executor
(`min(32, cpu+4)`, shared with EVERY unrelated `to_thread` call in the API
process) — a burst of concurrent gasless actions can then only ever queue
against each other, never against unrelated endpoints.
"""

import asyncio
import functools
import logging
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
MAX_TOPUPS_PER_USER_PER_DAY = 5
USER_DAILY_TOPUP_MULTIPLE = 5  # value cap = 5x the live per-tx ceiling (~$2.50/day/user)

# Per-IP daily caps (F6) — looser than the per-user cap since one IP can
# legitimately be many real users (NAT/shared wifi/corporate egress), but
# still bounds how many "fresh accounts, same source" a single attacker can
# turn into free top-ups before this cap (not just the per-user one, which a
# sybil attacker trivially resets by minting a new user_id) kicks in.
MAX_TOPUPS_PER_IP_PER_DAY = 20
IP_DAILY_TOPUP_MULTIPLE = 20  # value cap = 20x the live per-tx ceiling (~$10/day/IP)

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

# F4: dedicated bounded pool for every blocking gas-topup-capable call
# (`ensure_gas` itself, and api/routes/mobile.py's `_send_usdc_base`, which
# embeds a synchronous `ensure_gas` call) — see `run_gas_sensitive`. Sized
# generously enough that ordinary (no-top-up-needed) sends/deposits are
# never bottlenecked by it; bounded so a burst of top-ups can never consume
# every slot in the API's SHARED default executor (`min(32, cpu+4)`), which
# is what starved unrelated endpoints before this fix.
_TOPUP_EXECUTOR = ThreadPoolExecutor(max_workers=16, thread_name_prefix="gas-topup")

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
    """A per-transaction, per-user-daily, per-IP-daily, or global-daily cap
    was hit. Deterministic — never sent anything, safe to surface directly."""


class GasTopUpFailed(GasTopUpError):
    """The top-up attempt itself failed, timed out waiting for confirmation,
    or landed but reverted — OR the caps themselves could not be verified
    (DB unreachable). Callers MUST treat this as retryable and MUST NOT
    report the original action as having succeeded."""


def _utc_day_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _utc_today() -> date:
    return _utc_day_start().date()


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
    state and genuinely works from any thread. Kept as its own function
    (rather than inlined into `_max_topup_wei`) so tests can mock exactly
    this seam — see tests/test_gas_topup_service.py.
    """
    import httpx

    resp = httpx.Client(timeout=3.0).get(
        "https://api.coingecko.com/api/v3/simple/price",
        params={"ids": "ethereum", "vs_currencies": "usd"},
    )
    resp.raise_for_status()
    return resp.json().get("ethereum", {}).get("usd")


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
    (F7) — used by callers (earn withdraw) that don't already have a built
    tx to read gas off of. Run via `run_gas_sensitive`/asyncio.to_thread
    from an async context."""
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

    The supply leg is estimated live only when no approve is needed (i.e.
    allowance already covers amount_wei), since `eth_estimateGas` for
    `supply` reverts before an approval lands — otherwise a generous static
    per-leg estimate is used for that leg specifically (still real-world
    derived, see `DEPOSIT_GAS_UNITS_ESTIMATE`'s comment).

    Never raises: any RPC failure falls back to the fully-static
    `DEPOSIT_GAS_UNITS_ESTIMATE` (already sized to cover the SUM of both
    legs) via `estimate_gas_wei_for_action`.
    """
    from bot.services.rpc_manager import rpc_manager
    from bot.services.savings_service import (
        AAVE_POOL_ABI,
        AAVE_POOL_ADDRESS,
        ERC20_ABI,
        USDC_ADDRESS,
    )

    # Generous static per-leg fallback for supply when it can't be simulated
    # (allowance not yet granted) — derived from the same real-world figures
    # as DEPOSIT_GAS_UNITS_ESTIMATE's comment (~230k observed, buffered up).
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
            # transferFrom allowance check) — use the generous static leg.
            total_units += int(supply_leg_fallback_units * 1.2)
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
        return estimate_gas_wei_for_action(chain_name, DEPOSIT_GAS_UNITS_ESTIMATE)


async def run_gas_sensitive(func, *args, **kwargs) -> Any:
    """F4 fix. Dispatch a blocking, gas-topup-capable call (`ensure_gas`
    itself, or `_send_usdc_base`, which embeds one) on this module's own
    dedicated `_TOPUP_EXECUTOR` pool instead of `asyncio.to_thread`'s shared
    default executor. Callers (api/routes/mobile.py) MUST use this — not
    `asyncio.to_thread` — for both call sites. See the module docstring's
    DISPATCH section for the full rationale."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_TOPUP_EXECUTOR, functools.partial(func, *args, **kwargs))


def _user_daily_stats(user_id: int) -> Tuple[int, int]:
    """(count, total_wei) of this user's top-ups since UTC midnight today.

    F8 fix: this is the caps' data source, so a query failure (missing
    table, pool exhaustion, read-only replica, etc.) must fail CLOSED —
    raise `GasTopUpFailed` rather than let a raw DB exception surface as an
    unrelated 500 while behaving as if it were "0 top-ups today" (this
    module's docstring, and `database/db.py`'s `_create_gas_topups_table`
    docstring, both claim fail-closed behaviour — this makes that true)."""
    from bot.models.gas_topup import GasTopUp
    from database.db import get_session

    start = _utc_day_start()
    try:
        with get_session() as session:
            rows = (
                session.query(GasTopUp)
                .filter(GasTopUp.user_id == user_id, GasTopUp.created_at >= start)
                .all()
            )
            return len(rows), sum(int(r.amount_wei or 0) for r in rows)
    except Exception as e:
        logger.error(f"gas_topup_service: failed to read daily stats for user={user_id}: {e}")
        raise GasTopUpFailed(
            "We couldn't verify today's gas top-up limits. Please try again in a moment."
        ) from e


def _daily_reserve(scope: str, amount_wei: int, cap_wei: int, cap_count: int) -> bool:
    """F6 fix. Atomically check-and-reserve `amount_wei` against a per-
    (UTC day, scope) counter row in `gas_topup_daily_counters` — used for
    BOTH the global breaker (`scope="global"`) and the per-IP cap
    (`scope="ip:<address>"`). Replaces the old global check's
    read-then-compare-then-send: N concurrent requests could each read the
    same stale total and collectively overshoot the cap by up to
    N x per-tx ceiling.

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
    case. Deliberately does NOT roll back a successful reservation if the
    top-up later fails to broadcast/confirm: that is the conservative
    direction (the breaker trips a little earlier than the true spend would
    require, never later) rather than reopening a window where a failed
    attempt's capacity could be double-spent by a retry racing a rollback.

    Raises `GasTopUpFailed` if the DB itself is unreachable — this table is
    the sole source of truth for these caps, so a query failure must fail
    closed (see `_user_daily_stats`'s F8 note for the same reasoning)."""
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


def _record_topup_pending(
    user_id: int,
    wallet_address: str,
    chain: str,
    amount_wei: int,
    reason: str,
) -> int:
    """F3 fix. Insert a status="pending" audit row BEFORE anything is
    broadcast from the hot wallet. The caps (`_user_daily_stats`,
    `_daily_reserve`) are computed from this table, so a top-up must never
    be able to spend without a durable row backing it — the old version
    recorded AFTER broadcasting and swallowed every insert exception, so a
    persistent insert failure (FK violation, pool exhaustion, read-only
    replica) silently made the per-user counters read 0 forever while
    spending continued unaudited and unbounded. Raises `GasTopUpFailed`
    (refuses the top-up, spends nothing) if the insert itself fails.
    Returns the new row's id for `_update_topup_status` to update later."""
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
) -> bool:
    """Blocking — callers MUST dispatch via `run_gas_sensitive()`, not
    `asyncio.to_thread` (see module docstring's DISPATCH section, F4 fix).

    Top up `wallet_address` (the AUTHENTICATED user's own resolved wallet —
    callers MUST NOT pass a client-supplied address) with native token from
    the gas-payer hot wallet if it can't cover `estimated_gas_wei`.
    `ip_address` should be the caller's real client IP (see
    api/routes/mobile.py's `_client_ip`) — used only for the per-IP daily
    cap (F6); defaults to "unknown" so this stays optional for any
    non-HTTP/test caller, which just shares one bucket.

    Returns True if a top-up was performed, False if the wallet already had
    enough. Raises `GasTopUpCapExceeded` or `GasTopUpFailed` otherwise —
    never silently proceeds past a cap or a failed/unconfirmed top-up.

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

    max_user_daily_wei = per_tx_ceiling * USER_DAILY_TOPUP_MULTIPLE
    user_count_today, user_wei_today = _user_daily_stats(user_id)
    if (
        user_count_today + 1 > MAX_TOPUPS_PER_USER_PER_DAY
        or user_wei_today + topup_wei > max_user_daily_wei
    ):
        raise GasTopUpCapExceeded(
            "You've reached today's gas top-up limit for this wallet. "
            "Try again tomorrow, or add a small amount of ETH on Base directly."
        )

    # F6: per-IP cap, atomic reserve — harder to mint than a user_id.
    max_ip_daily_wei = per_tx_ceiling * IP_DAILY_TOPUP_MULTIPLE
    if not _daily_reserve(
        f"ip:{ip_address}", topup_wei, max_ip_daily_wei, MAX_TOPUPS_PER_IP_PER_DAY
    ):
        raise GasTopUpCapExceeded(
            "You've reached today's gas top-up limit for this wallet. "
            "Try again tomorrow, or add a small amount of ETH on Base directly."
        )

    # F5/F6: global circuit breaker — atomic reserve against an ABSOLUTE wei
    # constant (not a runtime-derived multiple).
    if not _daily_reserve(
        "global", topup_wei, GAS_TOPUP_GLOBAL_DAILY_CAP_WEI, GLOBAL_DAILY_TOPUP_MAX_COUNT
    ):
        logger.critical(
            "GAS TOP-UP GLOBAL DAILY CIRCUIT BREAKER TRIPPED: "
            f"reserving {topup_wei} wei would exceed cap {GAS_TOPUP_GLOBAL_DAILY_CAP_WEI} wei "
            f"(user={user_id}, reason={reason})"
        )
        raise GasTopUpCapExceeded(
            "Gas top-up is temporarily paused network-wide. Please try again later "
            "or add a small amount of ETH on Base directly."
        )

    gas_wallet = hot_wallet_service.get_gas_payer_wallet("evm")
    if gas_wallet is None:
        raise GasTopUpFailed(
            "We couldn't get your wallet ready right now. Please try again in a moment."
        )

    amount_eth = Decimal(topup_wei) / Decimal(10**18)

    # F3: durable row BEFORE broadcast — see module docstring / this
    # function's docstring for why.
    row_id = _record_topup_pending(user_id, from_addr, chain_name, topup_wei, reason)

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
        tx_hash = e.tx_hash
        status = "ambiguous"
        if not tx_hash:
            _update_topup_status(row_id, status="failed", tx_hash=None)
            raise GasTopUpFailed(
                "We couldn't confirm your wallet top-up. Please try again in a moment."
            ) from e
    except Exception as e:
        logger.error(f"Gas top-up broadcast failed for user {user_id} wallet {from_addr}: {e}")
        _update_topup_status(row_id, status="failed", tx_hash=None)
        raise GasTopUpFailed(
            "We couldn't get your wallet ready right now. Please try again in a moment."
        ) from e

    # Update BEFORE waiting for confirmation — something was broadcast and
    # spent from the hot wallet, so it belongs in the audit trail regardless
    # of what happens next.
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

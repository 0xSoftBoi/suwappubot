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
  * Per-transaction ceiling (`GAS_TOPUP_MAX_USD`, converted to wei via a live
    price lookup with a conservative fixed-wei fallback, then clamped by an
    absolute backstop regardless of what the price lookup returns).
  * Per-user daily count + wei caps (`MAX_TOPUPS_PER_USER_PER_DAY`,
    `USER_DAILY_TOPUP_MULTIPLE`), computed by querying the `gas_topups`
    audit table for today's UTC rows — the audit log and the enforcement
    data source are the same table, so they cannot drift apart.
  * Global daily circuit breaker (`GLOBAL_DAILY_TOPUP_MULTIPLE`) — trips a
    CRITICAL log and refuses ALL further top-ups for the rest of the UTC day
    once the network-wide total is hit.

Every exceeded cap raises `GasTopUpCapExceeded` with a stable, plain-language
message (never mentions "gas"/"ETH" internals beyond what's needed to be
actionable) that callers surface directly as the HTTP error detail — the
mobile client's copy layer maps details to user-facing text, so these
strings must stay stable. A failed/timed-out top-up attempt raises
`GasTopUpFailed`, which callers must treat as retryable and MUST NOT report
the original action as having succeeded.
"""

import asyncio
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional, Tuple

from web3 import Web3

logger = logging.getLogger(__name__)


# ── spend controls (named constants — do not inline these) ─────────────────

# Hard per-transaction ceiling, target ~$0.50 of ETH. Computed from a live
# price via bot.services.price_service (the same price source paymaster.py
# already uses for gas costing). Falls back to a conservative fixed wei
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

# Global daily circuit breaker across ALL users combined.
GLOBAL_DAILY_TOPUP_MULTIPLE = (
    400  # value cap = 400x the live per-tx ceiling (~$200/day network-wide)
)

# How long to wait for a top-up tx to land before treating it as failed
# (retryable) rather than claiming success.
GAS_TOPUP_CONFIRM_TIMEOUT_SECONDS = 45

# Fixed gas-unit estimates for earn deposit/withdraw (Aave V3 on Base), used
# when we don't already have a built tx to read `.gas`/`.gasPrice` off of
# (unlike /send, which reuses the exact built ERC-20 transfer tx). Deposit
# may need an approve + supply (two txs); withdraw is a single call.
# Conservative on purpose — Base gas is cheap enough that overestimating by
# a wide margin still stays well under the per-tx ceiling.
DEPOSIT_GAS_UNITS_ESTIMATE = 220_000
WITHDRAW_GAS_UNITS_ESTIMATE = 170_000


class GasTopUpError(Exception):
    """Base for all ensure_gas() failures. Message is safe to surface as an
    HTTP error detail."""


class GasTopUpCapExceeded(GasTopUpError):
    """A per-transaction, per-user-daily, or global-daily cap was hit.
    Deterministic — never sent anything, safe to surface directly."""


class GasTopUpFailed(GasTopUpError):
    """The top-up attempt itself failed, timed out waiting for confirmation,
    or landed but reverted. Callers MUST treat this as retryable and MUST
    NOT report the original action as having succeeded."""


def _utc_day_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def _max_topup_wei() -> int:
    """Live per-transaction ceiling in wei, clamped by the absolute backstop
    regardless of source. Falls back to a fixed wei ceiling (also clamped)
    if the price lookup fails."""
    try:
        from bot.services.price_service import price_service

        prices = asyncio.run(price_service.get_prices(["ETH"]))
        eth_price = prices.get("ETH")
        if eth_price and eth_price > 0:
            ceiling = int((GAS_TOPUP_MAX_USD / Decimal(str(eth_price))) * Decimal(10**18))
            if ceiling > 0:
                return min(ceiling, GAS_TOPUP_ABSOLUTE_MAX_WEI)
    except Exception as e:  # noqa: BLE001 — price lookup failure, not a verdict
        logger.warning(f"gas_topup_service: ETH price lookup failed, using fallback ceiling: {e}")
    return min(GAS_TOPUP_FALLBACK_MAX_WEI, GAS_TOPUP_ABSOLUTE_MAX_WEI)


def estimate_gas_wei_for_action(chain_name: str, gas_units: int) -> int:
    """Blocking. `gas_units * current gas price` — used by callers (earn
    deposit/withdraw) that don't already have a built tx to read gas off of.
    Run via asyncio.to_thread from an async context."""
    from bot.services.rpc_manager import rpc_manager

    web3 = rpc_manager.get_web3(chain_name)
    return int(web3.eth.gas_price * gas_units)


def _user_daily_stats(user_id: int) -> Tuple[int, int]:
    """(count, total_wei) of this user's top-ups since UTC midnight today."""
    from bot.models.gas_topup import GasTopUp
    from database.db import get_session

    start = _utc_day_start()
    with get_session() as session:
        rows = (
            session.query(GasTopUp)
            .filter(GasTopUp.user_id == user_id, GasTopUp.created_at >= start)
            .all()
        )
        return len(rows), sum(int(r.amount_wei or 0) for r in rows)


def _global_daily_total_wei() -> int:
    """Total wei topped up (all users) since UTC midnight today."""
    from sqlalchemy import func

    from bot.models.gas_topup import GasTopUp
    from database.db import get_session

    start = _utc_day_start()
    with get_session() as session:
        total = (
            session.query(func.coalesce(func.sum(GasTopUp.amount_wei), 0))
            .filter(GasTopUp.created_at >= start)
            .scalar()
        )
        return int(total or 0)


def _record_topup(
    user_id: int,
    wallet_address: str,
    chain: str,
    amount_wei: int,
    tx_hash: Optional[str],
    reason: str,
    status: str,
) -> None:
    from bot.models.gas_topup import GasTopUp
    from database.db import get_session

    try:
        with get_session() as session:
            session.add(
                GasTopUp(
                    user_id=user_id,
                    wallet_address=wallet_address,
                    chain=chain,
                    amount_wei=amount_wei,
                    tx_hash=tx_hash,
                    reason=reason,
                    status=status,
                )
            )
    except Exception as e:
        # Never let a logging failure mask that real funds were just spent —
        # log CRITICAL so this is never silently lost, but don't raise (the
        # top-up itself already succeeded/failed independently of this row).
        logger.critical(
            f"gas_topup_service: FAILED TO RECORD an already-sent top-up "
            f"(user={user_id} wallet={wallet_address} amount_wei={amount_wei} "
            f"tx_hash={tx_hash}): {e}"
        )


def ensure_gas(
    *,
    user_id: int,
    wallet_address: str,
    chain_name: str,
    estimated_gas_wei: int,
    reason: str,
) -> bool:
    """Blocking. Top up `wallet_address` (the AUTHENTICATED user's own
    resolved wallet — callers MUST NOT pass a client-supplied address) with
    native token from the gas-payer hot wallet if it can't cover
    `estimated_gas_wei`.

    Returns True if a top-up was performed, False if the wallet already had
    enough. Raises `GasTopUpCapExceeded` or `GasTopUpFailed` otherwise —
    never silently proceeds past a cap or a failed/unconfirmed top-up.

    MUST only be called after the caller has already validated the
    underlying action's balance/amount (see module docstring's ordering
    note) — run via asyncio.to_thread from an async context, or directly
    from an already-offloaded thread (mirrors _send_usdc_base's pattern of
    calling asyncio.run() for its own signing step).
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
    max_global_daily_wei = per_tx_ceiling * GLOBAL_DAILY_TOPUP_MULTIPLE

    user_count_today, user_wei_today = _user_daily_stats(user_id)
    if (
        user_count_today + 1 > MAX_TOPUPS_PER_USER_PER_DAY
        or user_wei_today + topup_wei > max_user_daily_wei
    ):
        raise GasTopUpCapExceeded(
            "You've reached today's gas top-up limit for this wallet. "
            "Try again tomorrow, or add a small amount of ETH on Base directly."
        )

    global_wei_today = _global_daily_total_wei()
    if global_wei_today + topup_wei > max_global_daily_wei:
        logger.critical(
            "GAS TOP-UP GLOBAL DAILY CIRCUIT BREAKER TRIPPED: "
            f"{global_wei_today} + {topup_wei} wei would exceed cap {max_global_daily_wei} wei "
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
            raise GasTopUpFailed(
                "We couldn't confirm your wallet top-up. Please try again in a moment."
            ) from e
    except Exception as e:
        logger.error(f"Gas top-up broadcast failed for user {user_id} wallet {from_addr}: {e}")
        raise GasTopUpFailed(
            "We couldn't get your wallet ready right now. Please try again in a moment."
        ) from e

    # Record BEFORE waiting for confirmation — something was broadcast and
    # spent from the hot wallet, so it belongs in the audit trail and counts
    # against the caps regardless of what happens next.
    _record_topup(user_id, from_addr, chain_name, topup_wei, tx_hash, reason, status=status)

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

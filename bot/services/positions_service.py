"""Seed the user's average-cost spot positions from their swap history.

The live settlement hook in swap_engine maintains UserPosition going forward, but
existing holdings would show nothing until the user's next swap. This backfill
reconstructs cost basis by replaying past swaps through the SAME average-cost
logic, so the Positions view is populated immediately.

Valuation note: a swap leg in a stablecoin gives an exact USD value regardless of
when it happened; for swaps between two volatile tokens we fall back to the
*current* price (an approximation for old swaps — historical prices aren't
stored). Most swaps route through a stablecoin or native asset, so the common
case is accurate.
"""

import logging
from datetime import datetime

from database.db import get_session, run_in_db
from bot.models.user import User
from bot.models.swap import SwapTransaction, SwapStatus
from bot.models.positions import UserPosition
from bot.config.tokens import get_token_by_symbol
from bot.services.price_service import price_service

logger = logging.getLogger(__name__)

# Statuses where the tx was actually broadcast (holdings really changed).
_REPLAY_STATUSES = (
    SwapStatus.SUBMITTED.value,
    SwapStatus.CONFIRMING.value,
    SwapStatus.COMPLETED.value,
)
_MAX_REPLAY = 1000  # bound one-time latency for heavy traders


def _is_stable(sym: str) -> bool:
    cfg = get_token_by_symbol(sym or "")
    return bool(cfg and getattr(cfg, "is_stablecoin", False))


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


async def backfill_user_positions(user_id: int) -> bool:
    """Reconstruct the user's spot cost basis from swap history. Idempotent:
    clears existing rows and replays from scratch, then stamps
    User.positions_backfilled_at. Best-effort — returns False on failure."""

    def _load():
        with get_session() as session:
            rows = (
                session.query(SwapTransaction)
                .filter(
                    SwapTransaction.user_id == user_id,
                    SwapTransaction.status.in_(_REPLAY_STATUSES),
                )
                .order_by(SwapTransaction.created_at.asc())
                .limit(_MAX_REPLAY)
                .all()
            )
            return [
                (s.from_token, s.from_chain, s.to_token, s.to_chain, s.from_amount, s.to_amount)
                for s in rows
            ]

    try:
        swaps = await run_in_db(_load)
    except Exception as e:
        logger.warning(f"backfill: could not load swaps for {user_id}: {e}")
        return False

    # Current prices for the volatile tokens (one batched call).
    price_map: dict = {}
    symbols = set()
    for ft, fc, tt, tc, fa, ta in swaps:
        if tt and not _is_stable(tt):
            symbols.add(tt.upper())
        if ft and not _is_stable(ft):
            symbols.add(ft.upper())
    if symbols:
        try:
            prices = await price_service.get_prices(list(symbols))
            price_map = {k.upper(): v for k, v in (prices or {}).items() if v}
        except Exception:
            price_map = {}

    def _swap_usd(ft, tt, fq, tq) -> float:
        if tt and _is_stable(tt) and tq > 0:
            return tq
        if ft and _is_stable(ft) and fq > 0:
            return fq
        p = price_map.get((tt or "").upper())
        if p and tq > 0:
            return p * tq
        p = price_map.get((ft or "").upper())
        if p and fq > 0:
            return p * fq
        return 0.0

    def _replay():
        with get_session() as session:
            session.query(UserPosition).filter(UserPosition.user_id == user_id).delete()

            # Accumulate avg-cost in memory (no per-swap DB query), then bulk
            # insert. acc[(token, chain)] = [qty, cost_usd, realized_pnl_usd].
            acc: dict = {}

            def slot(token, chain):
                return acc.setdefault((token, chain), [0.0, 0.0, 0.0])

            for ft, fc, tt, tc, fa, ta in swaps:
                fq, tq = _f(fa), _f(ta)
                usd = _swap_usd(ft, tt, fq, tq)
                if usd <= 0:
                    continue
                # SELL leg: realize PnL vs tracked basis.
                if fq > 0 and ft:
                    p = slot(ft, fc)
                    if p[0] > 0:
                        avg = p[1] / p[0]
                        sold = min(fq, p[0])
                        cost_sold = avg * sold
                        proceeds = usd * (sold / fq)
                        p[2] += proceeds - cost_sold
                        p[0] -= sold
                        p[1] = max(0.0, p[1] - cost_sold)
                        if p[0] <= 1e-12:
                            p[0] = 0.0
                            p[1] = 0.0
                # BUY leg: add to cost basis.
                if tq > 0 and tt:
                    p = slot(tt, tc)
                    p[0] += tq
                    p[1] += usd

            for (token, chain), (qty, cost, realized) in acc.items():
                if qty <= 1e-12 and abs(realized) < 1e-9:
                    continue  # never held / nothing realized — skip empty row
                session.add(
                    UserPosition(
                        user_id=user_id,
                        token=token,
                        chain=chain,
                        qty=qty,
                        cost_usd=cost,
                        realized_pnl_usd=realized,
                    )
                )

            u = session.query(User).filter(User.id == user_id).first()
            if u:
                u.positions_backfilled_at = datetime.utcnow()
            session.commit()

    try:
        await run_in_db(_replay)
        logger.info(f"Backfilled {len(swaps)} swaps into positions for user {user_id}")
        return True
    except Exception as e:
        logger.warning(f"backfill: replay failed for {user_id}: {e}")
        return False

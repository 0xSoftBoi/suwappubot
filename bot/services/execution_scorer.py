"""Post-trade execution scoring.

EXECUTION INTELLIGENCE (phase 2). A fill cannot be judged at the moment it
happens — only against what the market did afterwards. This service walks
completed swaps and records the destination-token price at fixed horizons,
splitting execution quality into two independent measures:

  * ``realized_vs_quoted_bps`` — MISNAMED. It does not compare a realized fill
    to a quote and never has: it is ``bps(to_amount_usd, from_amount_usd)``,
    and BOTH of those are written once in ``execute_swap()`` from the quote's
    expected amounts. No realized fill data enters it. What it measures is the
    quoted round-trip COST of the trade — spread, price impact, platform fee,
    priced-in bridge fees. Real, but it cannot answer "did we deliver the
    quote", so never render it as though it grades our execution.
    (True fill accuracy lives in ``swap_transactions.realized_to_amount``; see
    ``execution_receipt.py``, which surfaces this column as ``quoted_cost_bps``.
    The column keeps its name only because renaming it means a migration plus
    a coordinated change here and in ``execution_benchmark``.)

  * ``markout_bps`` — did the price move against the taker after the fill?
    Attributable to the market (adverse selection, toxic flow, timing) and
    only knowable once the horizon elapses.

Keeping them apart matters: cost is what the trade charged the user, while a
persistently bad ``markout`` on a venue is a warning to give users rather than
a routing bug. Neither is a verdict on our own fill accuracy.

Idempotency: UNIQUE(swap_id, horizon) on the marks table. Each pass inserts
with an ON CONFLICT DO NOTHING guard, so restarts and overlapping passes are
safe and no bookkeeping column is needed on swap_transactions.

Follows the tx_poller pattern — load rows to plain dicts and close the session
before any network call, then write back in short-lived sessions, so a DB
connection is never held across an await on an external API.
"""

import asyncio
import logging
import time
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import text

from database.db import get_session

logger = logging.getLogger(__name__)

# Horizons scored after completion. Keep short — each one is a price lookup.
HORIZONS = {
    "5m": timedelta(minutes=5),
    "1h": timedelta(hours=1),
    "24h": timedelta(hours=24),
}

# Don't attempt to score swaps older than this; the price lookup degrades and
# the row is unlikely to become useful.
MAX_SCORE_AGE = timedelta(days=3)

# Scored in this order so the baseline horizon is always written first.
HORIZON_ORDER = ("5m", "1h", "24h")

# The earliest mark doubles as the markout reference price.
BASELINE_HORIZON = "5m"

# Rows examined per pass, bounding both DB and price-API work.
BATCH_SIZE = 50

DEFAULT_INTERVAL_SECONDS = 120


def _as_datetime(value) -> Optional[datetime]:
    """Coerce a DB timestamp to a datetime.

    Postgres returns a datetime; SQLite (tests, bot-first boot) returns an ISO
    string. Normalizing here keeps the horizon arithmetic below dialect-free.
    """
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def bps(actual: float, expected: float) -> Optional[float]:
    """Difference in basis points, or None when the base is unusable."""
    if not expected or expected <= 0:
        return None
    return ((actual - expected) / expected) * 10_000


class ExecutionScorer:
    """Background service that marks out completed swaps."""

    def __init__(self, interval_seconds: int = DEFAULT_INTERVAL_SECONDS):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._interval = interval_seconds
        logger.info(f"Execution scorer initialized (interval: {interval_seconds}s)")

    async def start(self, bot=None):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(
            "Execution scorer started (interval=%ss, horizons=%s)",
            self._interval,
            ",".join(HORIZON_ORDER),
        )

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Execution scorer stopped")

    async def _loop(self):
        from bot.utils.redis_cache import redis_cache

        while self._running:
            # Beat FIRST, before the work.
            #
            # The heartbeat answers "is this loop alive?", which is a different
            # question from "did the last pass succeed?". Writing it after the
            # work (as this originally did) means one raised exception makes a
            # perfectly healthy, retrying service report `unknown` in
            # /health/ready — indistinguishable from never having started.
            # Failures are surfaced through the log line below instead.
            try:
                await redis_cache.set(
                    "service:execution_scorer:heartbeat", time.time(), ttl_seconds=300
                )
            except Exception as e:  # pragma: no cover - redis outage
                logger.warning(f"[execution_scorer] heartbeat write failed: {e}")

            try:
                scored = await self._score_due_swaps()
                if scored:
                    logger.info(f"[execution_scorer] wrote {scored} marks")
            except Exception as e:
                logger.error(f"[execution_scorer] pass failed: {e}", exc_info=True)

            await asyncio.sleep(self._interval)

    def _load_candidates(self) -> list[dict]:
        """Phase 1 — read due swaps into dicts, then release the session."""
        now = datetime.utcnow()
        cutoff = now - MAX_SCORE_AGE

        with get_session() as session:
            rows = session.execute(
                text("""
                    SELECT id, to_token, to_amount_usd, from_amount_usd, completed_at
                    FROM swap_transactions
                    WHERE status = 'completed'
                      AND completed_at IS NOT NULL
                      AND completed_at >= :cutoff
                      AND to_token IS NOT NULL
                    ORDER BY completed_at DESC
                    LIMIT :limit
                    """),
                {"cutoff": cutoff, "limit": BATCH_SIZE},
            ).fetchall()

            return [
                {
                    "id": r[0],
                    "to_token": r[1],
                    "to_amount_usd": r[2],
                    "from_amount_usd": r[3],
                    "completed_at": _as_datetime(r[4]),
                }
                for r in rows
            ]

    def _existing_marks(self, swap_ids: list[int]) -> dict[tuple[int, str], Optional[float]]:
        """Recorded (swap, horizon) marks and the price observed for each.

        Returns prices too, because the earliest mark doubles as the markout
        baseline (see _score_due_swaps).
        """
        if not swap_ids:
            return {}
        # Expand the IN list positionally so this works on both Postgres and
        # SQLite without dialect branching.
        placeholders = ", ".join(f":id{i}" for i in range(len(swap_ids)))
        params = {f"id{i}": sid for i, sid in enumerate(swap_ids)}
        with get_session() as session:
            rows = session.execute(
                text(
                    f"SELECT swap_id, horizon, to_token_price_usd "
                    f"FROM swap_execution_marks WHERE swap_id IN ({placeholders})"
                ),
                params,
            ).fetchall()
            return {(r[0], r[1]): r[2] for r in rows}

    async def _score_due_swaps(self) -> int:
        from bot.services.price_service import price_service

        candidates = self._load_candidates()
        if not candidates:
            return 0

        marks = self._existing_marks([c["id"] for c in candidates])
        now = datetime.utcnow()
        written = 0

        for swap in candidates:
            completed_at = swap["completed_at"]
            if completed_at is None:
                continue

            for label in HORIZON_ORDER:
                delta = HORIZONS[label]
                if (swap["id"], label) in marks:
                    continue
                # Horizon has not elapsed — leave it for a later pass.
                if now < completed_at + delta:
                    continue

                # Phase 2 — network call with no DB session held.
                price = await price_service.get_price(swap["to_token"])
                if price is None:
                    # Unpriceable (long-tail) token. Skip rather than write a
                    # null row, so a later pass can retry if it gets listed.
                    continue

                to_usd = swap["to_amount_usd"]
                from_usd = swap["from_amount_usd"]

                # Quoted round-trip cost — value out vs value in, both from the
                # quote. NOT fill accuracy; see the module docstring before
                # relabelling this or the column it lands in.
                quoted_cost = bps(to_usd, from_usd) if (to_usd and from_usd) else None

                # Markout baseline.
                #
                # We do NOT persist a price at fill time, so the earliest mark
                # (BASELINE_HORIZON) is used as the reference and carries a NULL
                # markout itself. Later horizons measure drift from it. This is
                # therefore markout relative to shortly-after-fill, not to the
                # exact fill — honest limitation, and still the right signal for
                # spotting venues whose fills consistently age badly.
                baseline = marks.get((swap["id"], BASELINE_HORIZON))
                if label == BASELINE_HORIZON or baseline is None:
                    markout = None
                else:
                    markout = bps(price, baseline)

                self._write_mark(
                    swap_id=swap["id"],
                    horizon=label,
                    to_token_price_usd=price,
                    fill_price_usd=baseline,
                    realized_vs_quoted_bps=quoted_cost,
                    markout_bps=markout,
                )
                # Keep the in-memory view current so a baseline written this
                # pass is available to the later horizons of the same swap.
                marks[(swap["id"], label)] = price
                written += 1

        return written

    def _write_mark(self, **kw) -> None:
        """Phase 3 — short-lived session, idempotent insert."""
        with get_session() as session:
            dialect = session.bind.dialect.name
            conflict = (
                "ON CONFLICT (swap_id, horizon) DO NOTHING"
                if dialect == "postgresql"
                else "ON CONFLICT DO NOTHING"
            )
            session.execute(
                text(f"""
                    INSERT INTO swap_execution_marks
                        (swap_id, horizon, to_token_price_usd, fill_price_usd,
                         realized_vs_quoted_bps, markout_bps, scored_at)
                    VALUES
                        (:swap_id, :horizon, :to_token_price_usd, :fill_price_usd,
                         :realized_vs_quoted_bps, :markout_bps, :scored_at)
                    {conflict}
                    """),
                {**kw, "scored_at": datetime.utcnow()},
            )


# Global instance, started from the api.main lifespan.
execution_scorer = ExecutionScorer()

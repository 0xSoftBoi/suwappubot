"""Read-only data access for the terminal's execution-quality analytics.

Kept as a small standalone helper (not a class-based service) so the route in
``api/routes/terminal.py`` — which owns the actual computation, per that
module's existing house pattern — stays a thin auth+orchestration layer while
the DB query lives alongside the other data-access services. This module
performs no writes.
"""

from __future__ import annotations

from bot.models.swap import SwapStatus, SwapTransaction
from database.db import get_session


def get_recent_completed_swaps(user_id: int, limit: int = 30) -> list[dict]:
    """Return the user's most recent COMPLETED swaps as plain dicts.

    Returning dicts (not attached ORM objects) makes the result safe to hand
    back across the ``run_in_db`` thread-pool boundary the caller uses to
    avoid blocking the event loop.
    """
    with get_session() as session:
        rows = (
            session.query(SwapTransaction)
            .filter(
                SwapTransaction.user_id == user_id,
                SwapTransaction.status == SwapStatus.COMPLETED.value,
            )
            .order_by(SwapTransaction.created_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": r.id,
                "created_at": r.created_at,
                "completed_at": r.completed_at,
                "from_chain": r.from_chain,
                "from_token": r.from_token,
                "from_amount": r.from_amount,
                "to_chain": r.to_chain,
                "to_token": r.to_token,
                "to_amount": r.to_amount,
                "route_provider": r.route_provider,
                "route_data": r.route_data,
                "gas_fee": r.gas_fee,
                "bridge_fee": r.bridge_fee,
            }
            for r in rows
        ]

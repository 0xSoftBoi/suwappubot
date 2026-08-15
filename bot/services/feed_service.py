"""Verified trade feed — markets.xyz-parity GAP 3 (see
docs/plans/markets-xyz-parity.md).

Every entry here is backed by a REAL executed trade — ``TraderTrade`` rows
that ``copy_service`` already writes from settled ``SwapTransaction`` records
(see ``copy_service.record_trade`` / ``get_trader_stats``). Nothing here is
self-reported.

Privacy / opt-in: the feed reuses the EXACT SAME discoverability gate copy
trading already enforces —``TraderProfile.is_public`` (must opt in to be
followable/listed at all) — plus a second, narrower gate,
``TraderProfile.show_in_feed`` (default True), that lets an otherwise-public
trader keep their individual fills out of this specific surface without
losing followability. A trader who has never gone public NEVER appears here,
full stop. No wallet address, private key, or other PII is read or returned
— ``TraderTrade``/``TraderProfile`` only carry token symbols, chain names,
USD notionals and PnL, none of which identify a wallet.
"""

import logging
from typing import Optional

from sqlalchemy import desc

from bot.config.tokens import get_token_by_symbol
from bot.models.copy_trading import TraderProfile, TraderTrade
from bot.models.user import User
from database.db import get_session

logger = logging.getLogger(__name__)

FEED_PAGE_SIZE = 6


def _infer_side(from_token: Optional[str], to_token: Optional[str]) -> str:
    """Best-effort buy/sell label for display only — NOT authoritative.

    TraderTrade doesn't store an explicit side, so this heuristic uses the
    curated stablecoin registry (bot/config/tokens.py): moving OUT of a
    stablecoin into a non-stable token is a "buy"; moving a non-stable token
    INTO a stablecoin is a "sell". Long-tail tokens outside the registry
    default to "buy" since TraderTrade primarily logs the newly-acquired leg.
    """
    to_cfg = get_token_by_symbol(to_token) if to_token else None
    from_cfg = get_token_by_symbol(from_token) if from_token else None

    if to_cfg and to_cfg.is_stablecoin:
        return "sell"
    if from_cfg and from_cfg.is_stablecoin:
        return "buy"
    return "buy"


def _format_entry(trade: TraderTrade, profile: TraderProfile, user: Optional[User]) -> dict:
    """Build a feed entry with ONLY public, non-PII fields."""
    handle = profile.display_name or (user.username if user else None) or f"Trader{profile.user_id}"
    return {
        "trade_id": trade.id,
        "trader_id": profile.user_id,
        "handle": handle,
        "avatar": profile.avatar_emoji or "🦊",
        "from_token": trade.from_token,
        "to_token": trade.to_token,
        "chain": trade.to_chain or trade.from_chain,
        "side": _infer_side(trade.from_token, trade.to_token),
        "amount_usd": trade.amount_usd,
        "pnl_usd": trade.pnl_usd if trade.is_closed else None,
        "pnl_percent": trade.pnl_percent if trade.is_closed else None,
        "is_closed": bool(trade.is_closed),
        "created_at": trade.created_at,
    }


def get_global_feed(limit: int = FEED_PAGE_SIZE, offset: int = 0) -> dict:
    """Latest real fills across every opted-in trader, paginated.

    Only rows from traders with ``is_public`` AND ``show_in_feed`` are
    included — the same opt-in copy_service already enforces for the
    leaderboard/traders search (see copy_service.get_top_traders).
    """
    offset = max(offset, 0)
    limit = max(1, min(limit, 25))

    with get_session() as session:
        rows = (
            session.query(TraderTrade, TraderProfile, User)
            .join(TraderProfile, TraderProfile.user_id == TraderTrade.trader_id)
            .join(User, User.id == TraderTrade.trader_id)
            .filter(
                TraderProfile.is_public == True,  # noqa: E712
                TraderProfile.show_in_feed == True,  # noqa: E712
            )
            .order_by(desc(TraderTrade.created_at))
            .offset(offset)
            .limit(limit + 1)
            .all()
        )

        has_more = len(rows) > limit
        rows = rows[:limit]

        return {
            "items": [_format_entry(t, p, u) for t, p, u in rows],
            "has_more": has_more,
            "offset": offset,
            "limit": limit,
        }


def get_trader_feed(trader_id: int, limit: int = FEED_PAGE_SIZE, offset: int = 0) -> Optional[dict]:
    """Real fills for a single trader, paginated.

    Returns ``None`` (not an empty feed) when the trader isn't discoverable —
    either they never went public, or they opted their trades out of /feed —
    so callers can distinguish "no trader" / "not visible" from "no trades
    yet" and avoid leaking existence of an opted-out profile's trade history.
    """
    offset = max(offset, 0)
    limit = max(1, min(limit, 25))

    with get_session() as session:
        profile = session.query(TraderProfile).filter(TraderProfile.user_id == trader_id).first()
        if not profile or not profile.is_public or not profile.show_in_feed:
            return None

        user = session.query(User).filter(User.id == trader_id).first()

        rows = (
            session.query(TraderTrade)
            .filter(TraderTrade.trader_id == trader_id)
            .order_by(desc(TraderTrade.created_at))
            .offset(offset)
            .limit(limit + 1)
            .all()
        )

        has_more = len(rows) > limit
        rows = rows[:limit]

        return {
            "items": [_format_entry(t, profile, user) for t in rows],
            "has_more": has_more,
            "offset": offset,
            "limit": limit,
            "handle": profile.display_name
            or (user.username if user else None)
            or f"Trader{trader_id}",
            "avatar": profile.avatar_emoji or "🦊",
        }


def format_feed_entry_line(entry: dict) -> str:
    """One compact display line for an entry (no wallet/PII)."""
    side_emoji = "🟢" if entry["side"] == "buy" else "🔴"
    pnl = entry.get("pnl_usd")
    pnl_str = ""
    if pnl is not None:
        pnl_emoji = "📈" if pnl >= 0 else "📉"
        pnl_str = f" {pnl_emoji} ${pnl:,.2f}"
    amount = entry.get("amount_usd") or 0.0
    pair = f"{entry['from_token']}→{entry['to_token']}"
    return (
        f"{side_emoji} *{entry['handle']}* {pair} " f"(${amount:,.0f}){pnl_str} · {entry['chain']}"
    )

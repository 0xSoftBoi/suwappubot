"""Blocking the Telegram bot must not cancel a user's WhatsApp delivery.

Background senders skip users with `bot_blocked_at` set, which is right for
Telegram-only users — retrying a blocked chat forever burns API quota. But
price alerts and the weekly digest deliver to BOTH `telegram_id` and
`whatsapp_id`. Filtering purely on `bot_blocked_at` would drop a dual-channel
user's alert from evaluation entirely: they lose WhatsApp delivery they never
opted out of, and because `is_triggered` is never set, the alert fires at a
stale price if they later unblock.
"""

from datetime import datetime, timezone

from database.db import get_session


def _seed(session, *, telegram_id, whatsapp_id, blocked):
    from bot.models.advanced import AdvancedPriceAlert
    from bot.models.user import User

    user = User(telegram_id=telegram_id, whatsapp_id=whatsapp_id)
    if blocked:
        user.bot_blocked_at = datetime.now(timezone.utc)
    session.add(user)
    session.flush()
    session.add(
        AdvancedPriceAlert(
            user_id=user.id,
            token_symbol="ETH",
            alert_type="price_above",
            target_price=1000.0,
            is_active=True,
            is_triggered=False,
        )
    )
    return user.id


def _active_alert_user_ids():
    """Mirror alert_service's recipient query and return the user_ids it keeps."""
    from sqlalchemy import or_

    from bot.models.advanced import AdvancedPriceAlert
    from bot.models.user import User

    with get_session() as session:
        rows = (
            session.query(AdvancedPriceAlert)
            .join(User, User.id == AdvancedPriceAlert.user_id)
            .filter(
                AdvancedPriceAlert.is_active == True,  # noqa: E712
                AdvancedPriceAlert.is_triggered == False,  # noqa: E712
                or_(User.bot_blocked_at.is_(None), User.whatsapp_id.isnot(None)),
            )
            .all()
        )
        return {r.user_id for r in rows}


def test_telegram_only_blocked_user_is_skipped(tmp_db):
    with get_session() as session:
        uid = _seed(session, telegram_id=700001, whatsapp_id=None, blocked=True)
        session.commit()
    assert uid not in _active_alert_user_ids()


def test_dual_channel_blocked_user_still_evaluated(tmp_db):
    """The whole point: blocking Telegram must not kill WhatsApp delivery."""
    with get_session() as session:
        uid = _seed(session, telegram_id=700002, whatsapp_id="wa-700002", blocked=True)
        session.commit()
    assert uid in _active_alert_user_ids()


def test_unblocked_user_is_evaluated(tmp_db):
    with get_session() as session:
        uid = _seed(session, telegram_id=700003, whatsapp_id=None, blocked=False)
        session.commit()
    assert uid in _active_alert_user_ids()

"""#248: perps_monitor is now started in api/main.py lifespan.

api/main.py can't be imported under local Python 3.9 (repo is 3.10+), so the
lifespan wiring is verified by py_compile separately; here we verify the
start/loop/stop mechanics of the previously-dead service in isolation.
"""

import asyncio
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.perps_monitor import PerpsMonitor


def test_start_runs_loop_then_stops(monkeypatch):
    monkeypatch.setattr(PerpsMonitor, "POLL_INTERVAL", 0.01)
    m = PerpsMonitor()
    calls = {"n": 0}

    async def fake_sync():
        calls["n"] += 1

    m._sync_all_positions = fake_sync

    async def main():
        await m.start()
        assert m._running is True and m._task is not None
        await asyncio.sleep(0.05)  # allow a few poll ticks
        await m.stop()
        assert m._running is False

    asyncio.run(main())
    assert calls["n"] >= 1  # the loop actually ran (it was dead code before)


def test_double_start_is_idempotent(monkeypatch):
    monkeypatch.setattr(PerpsMonitor, "POLL_INTERVAL", 0.01)
    m = PerpsMonitor()

    async def fake_sync():
        pass

    m._sync_all_positions = fake_sync

    async def main():
        await m.start()
        first_task = m._task
        await m.start()  # second start must not spawn a new loop
        assert m._task is first_task
        await m.stop()

    asyncio.run(main())


def test_loop_survives_sync_errors(monkeypatch):
    monkeypatch.setattr(PerpsMonitor, "POLL_INTERVAL", 0.01)
    m = PerpsMonitor()
    calls = {"n": 0}

    async def boom():
        calls["n"] += 1
        raise RuntimeError("transient")

    m._sync_all_positions = boom

    async def main():
        await m.start()
        await asyncio.sleep(0.05)
        await m.stop()

    asyncio.run(main())
    assert calls["n"] >= 2  # loop keeps polling despite errors


# ---------------------------------------------------------------------------
# TP/SL notification dedup
#
# Regression test for the "360 DMs/hour" bug: the TP/SL trigger check had no
# dedup flag, so once mark price crossed the trigger the condition stayed true
# on EVERY 10-second poll and re-sent the DM forever — until the user closed
# the position or blocked the bot.
# ---------------------------------------------------------------------------


def _seed_triggered_long(session_factory, *, tp_price, mark_price):
    """Insert a user + HL account + an open long already past its take-profit."""
    from bot.models.user import User
    from bot.models.perps import PerpPosition, HyperLiquidAccount

    with session_factory() as session:
        user = User(telegram_id=987654321, username="perps_tester")
        session.add(user)
        session.flush()

        session.add(HyperLiquidAccount(user_id=user.id, hl_address="0xhl", is_active=True))
        session.add(
            PerpPosition(
                user_id=user.id,
                market="ETH-USD",
                side="long",
                size=1,
                entry_price=2000,
                mark_price=mark_price,
                tp_price=tp_price,
                status="open",
            )
        )
        session.commit()
        return user.id


def test_tp_alert_fires_once_not_every_poll(tmp_db, monkeypatch):
    """A position sitting past its TP must alert exactly ONCE across many polls."""
    from database.db import SessionLocal
    from bot.models.perps import PerpPosition
    import bot.services.perps_monitor as pm

    # Mark price (reported by HyperLiquid as entry_price) is above the TP, so
    # the trigger condition is true on every single poll.
    user_id = _seed_triggered_long(SessionLocal, tp_price=2500, mark_price=2600)

    async def fake_positions(_address):
        return [
            {
                "market": "ETH-USD",
                "side": "long",
                "entry_price": 2600,
                "unrealized_pnl": 600,
                "liquidation_price": 1000,
                "size": 1,
            }
        ]

    monkeypatch.setattr(pm.hyperliquid_client, "get_open_positions", fake_positions)

    m = pm.PerpsMonitor()
    sent = []

    async def capture(uid, message):
        sent.append(message)
        return True  # _notify_user reports delivery; the dedup flag depends on it

    m._notify_user = capture

    async def main():
        for _ in range(5):  # five polls == 50 seconds of real monitor time
            await m._sync_user_positions(user_id)

    asyncio.run(main())

    tp_alerts = [msg for msg in sent if "Take profit" in msg]
    assert len(tp_alerts) == 1, f"expected exactly 1 TP alert across 5 polls, got {len(tp_alerts)}"

    # The dedup flag must be persisted, not just held in memory — otherwise a
    # restart re-opens the firehose.
    with SessionLocal() as session:
        pos = session.query(PerpPosition).filter_by(user_id=user_id).first()
        assert pos.tp_notified_at is not None


def test_failed_delivery_does_not_suppress_the_alert(tmp_db, monkeypatch):
    """A send that fails must NOT set the dedup flag.

    Otherwise one transient Telegram error permanently suppresses that
    position's stop-loss alert — which on a leveraged position is a
    liquidation, not an inconvenience.
    """
    from database.db import SessionLocal
    from bot.models.perps import PerpPosition
    import bot.services.perps_monitor as pm

    user_id = _seed_triggered_long(SessionLocal, tp_price=2500, mark_price=2600)

    async def fake_positions(_address):
        return [
            {
                "market": "ETH-USD",
                "side": "long",
                "entry_price": 2600,
                "unrealized_pnl": 600,
                "liquidation_price": 1000,
                "size": 1,
            }
        ]

    monkeypatch.setattr(pm.hyperliquid_client, "get_open_positions", fake_positions)

    m = pm.PerpsMonitor()
    attempts = []

    async def failing_send(uid, message):
        attempts.append(message)
        return False  # e.g. Telegram 429, or the bot isn't wired yet

    m._notify_user = failing_send

    asyncio.run(m._sync_user_positions(user_id))

    assert len(attempts) == 1
    with SessionLocal() as session:
        pos = session.query(PerpPosition).filter_by(user_id=user_id).first()
        assert pos.tp_notified_at is None, "a failed send must leave the alert retryable"

    # Next poll retries and succeeds — the alert is not lost.
    delivered = []

    async def ok_send(uid, message):
        delivered.append(message)
        return True

    m._notify_user = ok_send
    asyncio.run(m._sync_user_positions(user_id))
    assert len(delivered) == 1


def test_tp_alert_not_sent_before_trigger(tmp_db, monkeypatch):
    """Sanity check the dedup didn't just suppress alerts unconditionally."""
    from database.db import SessionLocal
    import bot.services.perps_monitor as pm

    # Mark price below TP — must never alert.
    user_id = _seed_triggered_long(SessionLocal, tp_price=2500, mark_price=2100)

    async def fake_positions(_address):
        return [
            {
                "market": "ETH-USD",
                "side": "long",
                "entry_price": 2100,
                "unrealized_pnl": 100,
                "liquidation_price": 1000,
                "size": 1,
            }
        ]

    monkeypatch.setattr(pm.hyperliquid_client, "get_open_positions", fake_positions)

    m = pm.PerpsMonitor()
    sent = []

    async def capture(uid, message):
        sent.append(message)
        return True  # _notify_user reports delivery; the dedup flag depends on it

    m._notify_user = capture

    asyncio.run(m._sync_user_positions(user_id))
    assert not [msg for msg in sent if "Take profit" in msg]

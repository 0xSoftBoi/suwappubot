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

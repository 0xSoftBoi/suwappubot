"""modify_tp_sl must actually reach HyperLiquid.

Before 2026-07-26 `PerpsService.modify_tp_sl` only wrote `tp_price`/`sl_price`
to the DB and never called the exchange, so "edit stop loss" was a silent no-op:
the UI showed a protective stop that did not exist on HL. It is reachable from
both Telegram (bot/handlers/perps.py) and WhatsApp.

These tests pin the contract:
  * an edit places the replacement order on the exchange;
  * a resting order of the same type is cancelled first (replace, not stack);
  * if the exchange rejects the new order the price is NOT persisted, so the DB
    never claims protection the exchange does not have.

All exchange I/O is mocked — no network, no credentials.
"""

import asyncio
import os
from decimal import Decimal
from unittest.mock import AsyncMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

from bot.services.perps_service import PerpsService


class _Pos:
    """Stand-in for a PerpPosition row."""

    def __init__(self):
        self.id = 1
        self.market = "ETH-USD"
        self.side = "long"
        self.size = Decimal("2")
        self.tp_price = None
        self.sl_price = None


class _Order:
    """Stand-in for a resting PerpOrder row."""

    def __init__(self, order_type, hl_order_id="hl-abc"):
        self.id = 99
        self.order_type = order_type
        self.hl_order_id = hl_order_id
        self.status = "pending"


def _patch_session(monkeypatch, position, resting_orders):
    """Route every get_session() in perps_service at in-memory fakes."""

    class _Query:
        def __init__(self, model_rows):
            self._rows = model_rows

        def filter_by(self, **kw):
            # position lookup by id, or the PerpOrder status update by id
            return self

        def filter(self, *a, **kw):
            return self

        def all(self):
            return self._rows

        def first(self):
            return self._rows[0] if self._rows else None

    class _Session:
        def __init__(self):
            self.added = []

        def query(self, model):
            name = getattr(model, "__name__", str(model))
            if name == "PerpPosition":
                return _Query([position])
            if name == "PerpOrder":
                return _Query(resting_orders)
            return _Query([])

        def add(self, obj):
            self.added.append(obj)

        def flush(self):
            pass

        def expunge(self, obj):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr("bot.services.perps_service.get_session", lambda: _Session())


def _service(monkeypatch, place_ok=True):
    svc = PerpsService()
    # A truthy account object is all modify_tp_sl needs from get_account.
    monkeypatch.setattr(svc, "get_account", lambda user_id: object())
    svc._place_tp_sl = AsyncMock(return_value=place_ok)
    svc.cancel_order = AsyncMock(return_value=True)
    return svc


def test_modify_tp_sl_places_order_on_exchange(monkeypatch):
    """The regression that matters: an edit must hit HL, not just the DB."""
    pos = _Pos()
    _patch_session(monkeypatch, pos, [])
    svc = _service(monkeypatch)

    asyncio.run(svc.modify_tp_sl(user_id=1, position_id=1, sl_price=1800.0))

    svc._place_tp_sl.assert_awaited_once()
    kwargs = svc._place_tp_sl.await_args
    assert "stop_loss" in kwargs.args, f"expected stop_loss order, got {kwargs.args}"
    assert 1800.0 in kwargs.args
    # Price persisted only after the exchange accepted it.
    assert pos.sl_price == Decimal("1800.0")


def test_modify_tp_sl_cancels_the_resting_order_first(monkeypatch):
    """An edit replaces protection — it must not stack a second trigger."""
    pos = _Pos()
    resting = _Order("stop_loss", hl_order_id="hl-stale")
    _patch_session(monkeypatch, pos, [resting])
    svc = _service(monkeypatch)

    asyncio.run(svc.modify_tp_sl(user_id=1, position_id=1, sl_price=1750.0))

    svc.cancel_order.assert_awaited_once()
    assert "hl-stale" in svc.cancel_order.await_args.args
    assert resting.status == "cancelled"
    svc._place_tp_sl.assert_awaited_once()


def test_rejected_order_does_not_persist_the_price(monkeypatch):
    """Never record protection the exchange refused — that was the old bug."""
    pos = _Pos()
    _patch_session(monkeypatch, pos, [])
    svc = _service(monkeypatch, place_ok=False)

    with pytest.raises(ValueError, match="HyperLiquid"):
        asyncio.run(svc.modify_tp_sl(user_id=1, position_id=1, sl_price=1700.0))

    assert pos.sl_price is None, "price must not be stored when placement failed"


def test_only_the_requested_leg_is_touched(monkeypatch):
    """Passing only tp_price must not place or clear a stop loss."""
    pos = _Pos()
    _patch_session(monkeypatch, pos, [])
    svc = _service(monkeypatch)

    asyncio.run(svc.modify_tp_sl(user_id=1, position_id=1, tp_price=2500.0))

    assert svc._place_tp_sl.await_count == 1
    assert "take_profit" in svc._place_tp_sl.await_args.args
    assert pos.tp_price == Decimal("2500.0")
    assert pos.sl_price is None

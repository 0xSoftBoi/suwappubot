"""Entry + TP/SL must go to HyperLiquid as ONE atomic bracket.

Before 2026-07-26 `place_order` always sent a single-order action with
grouping="na", and `open_position` then placed TP and SL as two separate
follow-up orders. Those three orders were unlinked, so a filled TP left the SL
resting as a naked reduce-only trigger that could re-open the position inverted.

`place_order` also *accepted* tp_price/sl_price and silently ignored them, which
made the open path look protected when it was not.

These tests pin the wire format we send, since that is what the exchange
actually enforces:
  * a bracketed open uses grouping="normalTpsl" and one orders[] array;
  * the TP/SL legs are reduce-only triggers on the OPPOSITE side of the entry;
  * a plain order still uses grouping="na" (no behaviour change);
  * a reduce-only order never carries a bracket;
  * statuses[] is read POSITIONALLY so child order ids map to the right leg.

No network: the HTTP client is stubbed and we assert on the signed action.
"""

import asyncio
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.services.hyperliquid_client import HyperLiquidClient


class _Resp:
    status_code = 200

    def __init__(self, statuses):
        self._statuses = statuses

    def json(self):
        return {"response": {"data": {"statuses": self._statuses}}}


class _Client:
    """Captures the action we would have POSTed."""

    def __init__(self, statuses):
        self.sent = None
        self._statuses = statuses

    async def post(self, url, json=None, headers=None):
        self.sent = json
        return _Resp(self._statuses)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def _run(monkeypatch, *, statuses, **order_kw):
    hl = HyperLiquidClient()
    client = _Client(statuses)

    # place_order does `client = await self._get_client()`, so these must be
    # coroutines returning the right shapes (asset index is an int).
    monkeypatch.setattr(hl, "_get_client", lambda: _val(client), raising=False)
    monkeypatch.setattr(hl, "_set_leverage", lambda *a, **k: _val(None), raising=False)
    monkeypatch.setattr(hl, "_sign_action", lambda *a, **k: "0xsig", raising=False)
    monkeypatch.setattr(hl, "get_mark_price", lambda market: _val(2000.0), raising=False)
    monkeypatch.setattr(hl, "_resolve_asset_index", lambda *a, **k: _val(0), raising=False)

    kw = dict(
        address="0xabc",
        api_key="k",
        api_secret="s",
        market="ETH-USD",
        side="long",
        size=1.0,
        order_type="market",
    )
    kw.update(order_kw)
    result = asyncio.run(hl.place_order(**kw))
    return client.sent, result


async def _noop():
    return None


async def _val(v):
    return v


def _action(sent):
    assert sent is not None, "no request was sent"
    return sent["action"]


def test_bracketed_open_uses_normalTpsl_grouping(monkeypatch):
    sent, result = _run(
        monkeypatch,
        statuses=[
            {"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1"}},
            {"resting": {"oid": 2}},
            {"resting": {"oid": 3}},
        ],
        tp_price=2200.0,
        sl_price=1800.0,
    )
    action = _action(sent)
    assert action["grouping"] == "normalTpsl", "entry+TP+SL must be one atomic set"
    assert len(action["orders"]) == 3, "entry + 2 legs in a single orders[] array"
    # Child ids map positionally: statuses[1]=TP, statuses[2]=SL.
    assert result.child_order_ids == {"take_profit": "2", "stop_loss": "3"}


def test_bracket_legs_are_reduce_only_and_inverted(monkeypatch):
    sent, _ = _run(
        monkeypatch, statuses=[{"filled": {"oid": 1}}, {"resting": {"oid": 2}}], tp_price=2200.0
    )
    orders = _action(sent)["orders"]
    entry, tp = orders[0], orders[1]
    # Long entry buys; its take-profit must SELL and be reduce-only.
    assert entry["b"] is True
    assert tp["b"] is False, "exit leg must be the inverse side of the entry"
    assert tp["r"] is True, "exit leg must be reduce-only"
    assert tp["t"]["trigger"]["tpsl"] == "tp"


def test_short_entry_inverts_the_other_way(monkeypatch):
    sent, _ = _run(
        monkeypatch,
        side="short",
        statuses=[{"filled": {"oid": 1}}, {"resting": {"oid": 2}}],
        sl_price=2200.0,
    )
    orders = _action(sent)["orders"]
    entry, sl = orders[0], orders[1]
    assert entry["b"] is False, "short entry sells"
    assert sl["b"] is True, "closing a short buys"
    assert sl["t"]["trigger"]["tpsl"] == "sl"


def test_plain_order_is_unchanged(monkeypatch):
    """No TP/SL -> exactly the previous single-order, grouping='na' behaviour."""
    sent, result = _run(
        monkeypatch, statuses=[{"filled": {"oid": 1, "avgPx": "2000", "totalSz": "1"}}]
    )
    action = _action(sent)
    assert action["grouping"] == "na"
    assert len(action["orders"]) == 1
    assert result.child_order_ids == {}


def test_reduce_only_order_never_carries_a_bracket(monkeypatch):
    """A close must not attach TP/SL even if prices are passed."""
    sent, _ = _run(
        monkeypatch,
        reduce_only=True,
        tp_price=2200.0,
        sl_price=1800.0,
        statuses=[{"filled": {"oid": 1}}],
    )
    action = _action(sent)
    assert action["grouping"] == "na"
    assert len(action["orders"]) == 1


def test_rejected_leg_is_not_reported_as_accepted(monkeypatch):
    """An entry can fill while a leg is refused — don't claim protection."""
    sent, result = _run(
        monkeypatch,
        statuses=[{"filled": {"oid": 1}}, {"error": "bad trigger price"}],
        sl_price=1800.0,
    )
    assert _action(sent)["grouping"] == "normalTpsl"
    assert "stop_loss" not in result.child_order_ids

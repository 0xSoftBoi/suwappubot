"""Unit tests for the HyperLiquid WS alert feed message-parsing/formatting.

These exercise the pure parsing + formatting layer with mocked WS frames; no
live socket and no Telegram are required. Network/DB calls are stubbed.
"""

import json

import pytest

from bot.services.hl_ws_alerts import HLWebSocketAlerts

# ----------------------------- formatters ----------------------------- #


def test_format_fill_buy():
    fill = {"coin": "BTC", "side": "B", "sz": "0.5", "px": "60000", "closedPnl": "0"}
    text = HLWebSocketAlerts._format_fill(fill)
    assert text is not None
    assert "BUY" in text and "BTC" in text
    assert "$30,000.00" in text  # 0.5 * 60000 notional


def test_format_fill_sell_with_pnl():
    fill = {"coin": "ETH", "side": "A", "sz": "2", "px": "3000", "closedPnl": "150.5"}
    text = HLWebSocketAlerts._format_fill(fill)
    assert "SELL" in text
    assert "PnL: $150.50" in text


def test_format_fill_rejects_garbage():
    assert HLWebSocketAlerts._format_fill({"coin": "BTC", "sz": "0", "px": "0"}) is None
    assert HLWebSocketAlerts._format_fill("not a dict") is None


def test_format_liquidation():
    text = HLWebSocketAlerts._format_liquidation({"coin": "SOL", "sz": "10"})
    assert text is not None
    assert "LIQUIDATION" in text and "SOL" in text


def test_format_funding_received_and_paid():
    recv = HLWebSocketAlerts._format_funding({"coin": "BTC", "usdc": "1.25"})
    paid = HLWebSocketAlerts._format_funding({"coin": "BTC", "usdc": "-1.25"})
    assert "received" in recv
    assert "paid" in paid
    assert HLWebSocketAlerts._format_funding({"coin": "BTC", "usdc": "0"}) is None


def test_format_whale_above_threshold():
    trade = {"coin": "BTC", "side": "B", "sz": "20", "px": "60000"}
    text = HLWebSocketAlerts._format_whale(trade, threshold=1_000_000.0)
    assert text is not None
    assert "Whale" in text and "BUY" in text


def test_format_whale_below_threshold_is_none():
    trade = {"coin": "BTC", "side": "A", "sz": "0.001", "px": "60000"}
    assert HLWebSocketAlerts._format_whale(trade, threshold=1_000_000.0) is None


# --------------------------- message routing -------------------------- #


@pytest.fixture
def svc(monkeypatch):
    s = HLWebSocketAlerts()
    s._addr_to_user = {"0xabc": 42}
    sent = []

    # Both take an optional `category`, which safe_send uses to honor the
    # user's per-notification-type mute settings. Accept and record it so the
    # fakes match the real signatures.
    async def _fake_notify_user(user_id, message, category=None):
        sent.append((user_id, message, category))

    async def _fake_notify_channel(message, category=None):
        sent.append(("channel", message, category))

    monkeypatch.setattr(s, "_notify_user", _fake_notify_user)
    monkeypatch.setattr(s, "_notify_channel", _fake_notify_channel)
    s._sent = sent
    return s


def _enable(monkeypatch, **flags):
    from bot.services import hl_ws_alerts as mod

    for k, v in flags.items():
        monkeypatch.setattr(mod.settings, k, v, raising=False)


@pytest.mark.asyncio
async def test_user_fills_dispatch(svc, monkeypatch):
    _enable(monkeypatch, hl_ws_alerts_enabled=True)
    frame = json.dumps(
        {
            "channel": "userFills",
            "data": {
                "user": "0xABC",
                "isSnapshot": False,
                "fills": [{"coin": "BTC", "side": "B", "sz": "0.5", "px": "60000"}],
            },
        }
    )
    await svc._handle_message(frame)
    assert len(svc._sent) == 1
    assert svc._sent[0][0] == 42
    assert "BUY" in svc._sent[0][1]


@pytest.mark.asyncio
async def test_snapshot_is_skipped(svc, monkeypatch):
    _enable(monkeypatch, hl_ws_alerts_enabled=True)
    frame = json.dumps(
        {
            "channel": "userFills",
            "data": {
                "user": "0xABC",
                "isSnapshot": True,
                "fills": [{"coin": "BTC", "side": "B", "sz": "0.5", "px": "60000"}],
            },
        }
    )
    await svc._handle_message(frame)
    assert svc._sent == []


@pytest.mark.asyncio
async def test_unknown_user_ignored(svc, monkeypatch):
    _enable(monkeypatch, hl_ws_alerts_enabled=True)
    frame = json.dumps(
        {
            "channel": "userFills",
            "data": {
                "user": "0xDEADBEEF",
                "fills": [{"coin": "BTC", "side": "B", "sz": "1", "px": "60000"}],
            },
        }
    )
    await svc._handle_message(frame)
    assert svc._sent == []


@pytest.mark.asyncio
async def test_user_events_liquidation_and_funding(svc, monkeypatch):
    _enable(monkeypatch, hl_ws_alerts_enabled=True)
    frame = json.dumps(
        {
            "channel": "userEvents",
            "data": {
                "user": "0xABC",
                "liquidation": {"coin": "ETH", "sz": "3"},
                "funding": {"coin": "ETH", "usdc": "2.5"},
            },
        }
    )
    await svc._handle_message(frame)
    msgs = [m for _, m, _category in svc._sent]
    assert any("LIQUIDATION" in m for m in msgs)
    assert any("Funding" in m for m in msgs)

    # A liquidation is a risk event; funding is routine. They must be gated by
    # different preference toggles so muting one doesn't silence the other.
    categories = {m: c for _, m, c in svc._sent}
    assert next(c for m, c in categories.items() if "LIQUIDATION" in m) == "risk_event"
    assert next(c for m, c in categories.items() if "Funding" in m) == "proactive_alert"


@pytest.mark.asyncio
async def test_whale_trades_broadcast(svc, monkeypatch):
    _enable(
        monkeypatch,
        hl_whale_alerts_enabled=True,
        hl_whale_alert_threshold_usd=1_000_000.0,
    )
    frame = json.dumps(
        {
            "channel": "trades",
            "data": [
                {"coin": "BTC", "side": "B", "sz": "20", "px": "60000"},  # 1.2M -> alert
                {"coin": "BTC", "side": "A", "sz": "0.001", "px": "60000"},  # tiny -> skip
            ],
        }
    )
    await svc._handle_message(frame)
    assert len(svc._sent) == 1
    assert svc._sent[0][0] == "channel"
    assert "Whale" in svc._sent[0][1]


@pytest.mark.asyncio
async def test_flags_off_suppress_everything(svc, monkeypatch):
    _enable(monkeypatch, hl_ws_alerts_enabled=False, hl_whale_alerts_enabled=False)
    fills = json.dumps(
        {
            "channel": "userFills",
            "data": {
                "user": "0xABC",
                "fills": [{"coin": "BTC", "side": "B", "sz": "1", "px": "60000"}],
            },
        }
    )
    trades = json.dumps(
        {"channel": "trades", "data": [{"coin": "BTC", "side": "B", "sz": "20", "px": "60000"}]}
    )
    await svc._handle_message(fills)
    await svc._handle_message(trades)
    assert svc._sent == []


@pytest.mark.asyncio
async def test_subscription_response_and_garbage_are_noops(svc):
    await svc._handle_message(json.dumps({"channel": "subscriptionResponse", "data": {}}))
    await svc._handle_message("not json {{{")
    await svc._handle_message(json.dumps([1, 2, 3]))  # non-dict top level
    assert svc._sent == []


def test_subscriptions_built_from_tracked_users(monkeypatch):
    s = HLWebSocketAlerts()
    s._addr_to_user = {"0xabc": 1, "0xdef": 2}
    _enable(monkeypatch, hl_ws_alerts_enabled=True, hl_whale_alerts_enabled=True)
    monkeypatch.setattr(
        "bot.services.hl_ws_alerts.settings.hl_whale_alert_coins", "BTC,ETH", raising=False
    )
    subs = s._subscriptions()
    types = [x["type"] for x in subs]
    assert types.count("userFills") == 2
    assert types.count("userEvents") == 2
    assert types.count("trades") == 2

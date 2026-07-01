"""Functional end-to-end tests for the anticipatory-UX work.

Drives the REAL handler code paths (address detection, paste-to-trade card,
the paste→swap money-path contract, keyword router, /check, the live /start
hub, the proactive-alerts opt-in toggle + migration) with only the external
boundaries mocked: Telegram I/O, the token-metadata/safety network calls, and
the swap quote/execution. No real network, no real money.

The money-path test is the important one: it asserts a paste-to-trade Buy seeds
the EXACT swap context the normal flow expects and hands off to
show_wallet_selection (which enforces 2FA + spending limits) — and never calls
execute_swap directly.
"""

import os
import re

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from unittest.mock import AsyncMock, MagicMock

import pytest

# Real token addresses for detection/passthrough tests.
USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"  # 42-char EVM
USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"  # base58 mint
TRON_ADDR = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"


# ---------------------------------------------------------------------------
# mock Update / Context builders
# ---------------------------------------------------------------------------
def _msg_update(text, user_id=777001):
    u = MagicMock()
    u.message = MagicMock()
    u.message.text = text
    u.message.reply_text = AsyncMock()
    u.callback_query = None
    u.effective_user = MagicMock(id=user_id)
    return u


def _cb_update(data, user_id=777001):
    u = MagicMock()
    u.callback_query = MagicMock()
    u.callback_query.data = data
    u.callback_query.answer = AsyncMock()
    u.callback_query.edit_message_text = AsyncMock()
    u.callback_query.message = MagicMock()
    u.message = None
    u.effective_user = MagicMock(id=user_id)
    return u


def _ctx(args=None):
    c = MagicMock()
    c.user_data = {}
    c.args = args or []
    return c


def _all_buttons(markup):
    return [b for row in markup.inline_keyboard for b in row]


# ---------------------------------------------------------------------------
# 1. Address detection
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "addr,expected",
    [
        (USDC_ETH, "evm"),
        (USDC_SOL, "solana"),
        (TRON_ADDR, "tron"),
        ("0x123", None),  # short 0x junk must NOT match starknet
        ("hello world", None),
        ("", None),
    ],
)
def test_detect_address_chain(addr, expected):
    from bot.utils.validators import detect_address_chain

    ok, fam = detect_address_chain(addr)
    assert fam == expected
    assert ok == (expected is not None)


# ---------------------------------------------------------------------------
# 2. get_token_address passthrough (the swap-engine enabler)
# ---------------------------------------------------------------------------
def test_get_token_address_passthrough():
    from bot.config.tokens import get_token_address

    # Raw addresses pass through unchanged...
    assert get_token_address(USDC_ETH, "ethereum") == USDC_ETH
    assert get_token_address(USDC_SOL, "solana") == USDC_SOL
    # ...known symbols still resolve to their registry address...
    assert get_token_address("USDC", "ethereum") not in (None, "USDC")
    # ...and an unknown short symbol still returns None (no false passthrough).
    assert get_token_address("FOOBAR", "ethereum") is None


# ---------------------------------------------------------------------------
# 3. Paste-to-trade renders a card and stashes the pending token
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_paste_renders_card_and_stashes_token(monkeypatch):
    import bot.handlers.paste_trade as pt

    # No metadata network: Alchemy "not configured" → EVM identity (ethereum).
    monkeypatch.setattr(pt, "is_alchemy_configured", lambda: False)

    update, context = _msg_update(USDC_ETH), _ctx()
    await pt.on_freeform_text(update, context)

    # A card was sent with Buy buttons...
    update.message.reply_text.assert_awaited_once()
    markup = update.message.reply_text.call_args.kwargs["reply_markup"]
    cbs = [b.callback_data for b in _all_buttons(markup)]
    assert any(c.startswith("pbuy_") for c in cbs), cbs
    assert "paste_cancel" in cbs
    # ...and the pending token was stashed for paste_buy_entry to read.
    assert context.user_data["paste_token"]["address"] == USDC_ETH
    assert context.user_data["paste_token"]["chain"] == "ethereum"


# ---------------------------------------------------------------------------
# 4. MONEY-PATH GUARDRAIL: Buy seeds swap context + hands off to wallet
#    selection (2FA/limits), never executes directly.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_paste_buy_entry_seeds_swap_context_and_uses_confirm_flow(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.services.tos_service import tos_service
    from database.db import SessionLocal
    from bot.models.user import User

    # Seed a TOS-accepted user.
    tg_id = 777042
    with SessionLocal() as s:
        s.add(User(telegram_id=tg_id, tos_accepted=True))
        s.commit()
    monkeypatch.setattr(tos_service, "is_accepted_telegram", lambda _id: True)

    # Mock the boundaries: rate limiter, wallet, prewarm, and the downstream
    # confirm step. We assert the SEEDING + that show_wallet_selection is the
    # handoff (the 2FA/spending-limit gate), and execute_swap is NOT called.
    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(
        swap.wallet_service,
        "get_default_wallet",
        lambda uid, ct: MagicMock(id=99, address="0xWALLET"),
    )
    monkeypatch.setattr(swap, "_schedule_quote_prewarm", lambda *a, **k: None)
    sentinel = object()
    wallet_sel = AsyncMock(return_value=sentinel)
    monkeypatch.setattr(swap, "show_wallet_selection", wallet_sel)
    executed = AsyncMock()
    if hasattr(swap.swap_engine, "execute_swap"):
        monkeypatch.setattr(swap.swap_engine, "execute_swap", executed)

    update, context = _cb_update("pbuy_0.05", user_id=tg_id), _ctx()
    context.user_data["paste_token"] = {
        "chain": "ethereum",
        "address": USDC_ETH,
        "symbol": "USDC",
        "decimals": 18,
    }

    result = await swap.paste_buy_entry(update, context)

    # Seeded the EXACT contract the normal swap flow consumes.
    sd = context.user_data["swap"]
    assert sd["from_chain"] == "ethereum"
    assert sd["from_token"] == "ETH"  # native, spent to buy the token
    assert sd["to_chain"] == "ethereum"
    assert sd["to_token"] == USDC_ETH  # raw address (passthrough quote)
    assert sd["amount"] == 0.05
    assert sd["wallet_id"] == 99
    assert context.user_data["user_id"] is not None
    # Handed off to the confirm/2FA/limits gate, did NOT execute directly.
    wallet_sel.assert_awaited_once()
    assert result is sentinel
    executed.assert_not_called()


# ---------------------------------------------------------------------------
# 5. Freeform non-address text is never silently dropped
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_keyword_router_replies_with_actions():
    import bot.handlers.paste_trade as pt

    update, context = _msg_update("how do I buy eth"), _ctx()
    await pt.on_freeform_text(update, context)

    update.message.reply_text.assert_awaited_once()
    markup = update.message.reply_text.call_args.kwargs["reply_markup"]
    cbs = [b.callback_data for b in _all_buttons(markup)]
    assert "swap_start" in cbs  # "buy" keyword routed to Swap


# ---------------------------------------------------------------------------
# 6. /check rejects junk, accepts an address
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_check_command_rejects_invalid():
    import bot.handlers.paste_trade as pt

    update, context = _msg_update("/check"), _ctx(args=["not-an-address"])
    await pt.check_command(update, context)
    update.message.reply_text.assert_awaited_once()
    assert "valid token address" in update.message.reply_text.call_args.args[0].lower()


# ---------------------------------------------------------------------------
# 7. Live home hub: renders for zero-state + contextual-row logic
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_render_home_zero_state(tmp_db, monkeypatch):
    import bot.handlers.home as home

    # Patch the RPC-bound leaves so the hub renders deterministically offline.
    monkeypatch.setattr(home, "_portfolio_usd", AsyncMock(return_value=None))
    monkeypatch.setattr(home, "_pnl_24h", AsyncMock(return_value=None))
    monkeypatch.setattr(home, "_idle_usdc_and_apy", AsyncMock(return_value=(0.0, None)))

    text, markup = await home.render_home(user_id=999999)
    assert isinstance(text, str) and text
    assert _all_buttons(markup)  # keyboard rendered


def test_contextual_row_priority():
    from bot.handlers.home import _contextual_row

    # Claimable wins.
    row = _contextual_row(idle_usdc=1000, apy=8.0, claimable_count=1, claimable_usd=42.0)
    assert any("Redeem" in b.text for b in row)
    # Idle USDC next.
    row = _contextual_row(idle_usdc=1000, apy=8.0, claimable_count=0, claimable_usd=0.0)
    assert any("Earn" in b.text for b in row)
    # Default quick actions.
    row = _contextual_row(idle_usdc=0, apy=None, claimable_count=0, claimable_usd=0.0)
    assert {b.callback_data for b in row} >= {"swap_start", "positions_menu"}


# ---------------------------------------------------------------------------
# 8. Proactive-alerts opt-in: toggle flips the flag; migration is idempotent
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_toggle_proactive_flips_flag(tmp_db, monkeypatch):
    import bot.handlers.settings as st
    from database.db import SessionLocal
    from bot.models.user import User
    from bot.models.favorites import UserSettings

    tg_id = 777088
    with SessionLocal() as s:
        u = User(telegram_id=tg_id, tos_accepted=True)
        s.add(u)
        s.flush()
        s.add(UserSettings(user_id=u.id, proactive_alerts_enabled=False))
        s.commit()
        uid = u.id

    # settings_callback re-renders; stub it so the test focuses on the flip.
    monkeypatch.setattr(st, "settings_callback", AsyncMock())

    await st.toggle_proactive_callback(_cb_update("settings_toggle_proactive", tg_id), _ctx())

    with SessionLocal() as s:
        us = s.query(UserSettings).filter(UserSettings.user_id == uid).first()
        assert us.proactive_alerts_enabled is True


def test_proactive_migration_idempotent(tmp_db):
    # tmp_db already ran _ensure_schema once; running the column add again must
    # be a no-op (additive + idempotent migration contract).
    from sqlalchemy import inspect, create_engine
    from database import db

    engine = create_engine(tmp_db)
    inspector = inspect(engine)
    db._add_user_settings_proactive_column(engine, inspector, is_sqlite=True)  # 2nd run
    cols = [c["name"] for c in inspect(engine).get_columns("user_settings")]
    assert "proactive_alerts_enabled" in cols


# ---------------------------------------------------------------------------
# 9. Dead-button audit: every callback_data the new UI emits has a handler
# ---------------------------------------------------------------------------
def test_no_dead_buttons():
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1]
    ui_files = [
        root / "bot/handlers/home.py",
        root / "bot/handlers/paste_trade.py",
        root / "bot/handlers/trending.py",
        root / "bot/handlers/start.py",
    ]
    emitted = set()
    for f in ui_files:
        emitted |= set(re.findall(r'callback_data="([a-z_]+)', f.read_text()))

    # Patterns registered anywhere (main.py + every handler's entry_points/states).
    registered = ""
    for f in (root / "bot/main.py", *(root / "bot/handlers").glob("*.py")):
        registered += f.read_text()
    patterns = set(re.findall(r'pattern="\^([a-z_]+)', registered))

    # A callback is covered if an exact pattern exists OR a prefix pattern
    # (e.g. "pbuy_" covers "pbuy_custom") matches it.
    def covered(cb):
        if cb in patterns or cb == "noop":
            return True
        return any(cb.startswith(p) for p in patterns if p.endswith("_"))

    dead = sorted(cb for cb in emitted if not covered(cb))
    assert not dead, f"dead buttons (no handler): {dead}"


# ---------------------------------------------------------------------------
# 10. Raw-address receive-amount is corrected to the token's real decimals
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_destination_decimals_correction(monkeypatch):
    """A token bought by raw address must display its receive amount using the
    token's REAL on-chain decimals, not the registry's 18-decimal default.

    Regression for the live-test finding: 0.01 ETH -> USDC(Base, 6dp) showed
    1.68e-11 because the human conversion used 18 decimals. Execution was always
    correct (raw amounts); only the display was wrong.
    """
    from types import SimpleNamespace
    from bot.services.swap_engine import SwapEngine

    eng = SwapEngine()
    # 16810460 raw / 10^18 = 1.68e-11 (the WRONG value providers produce).
    quote = SimpleNamespace(to_amount="16810460", to_amount_human=1.68e-11, exchange_rate=0.0)
    USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

    # Mock the on-chain read → real USDC decimals (no network).
    monkeypatch.setattr(eng, "_resolve_onchain_decimals", AsyncMock(return_value=6))

    corrected = await eng._correct_destination_decimals(quote, USDC_BASE, "base", amount=0.01)
    # 16810460 / 10^6 = 16.81 USDC — a sane figure.
    assert abs(corrected.to_amount_human - 16.81046) < 1e-3
    assert corrected.exchange_rate > 1  # ~1681 USDC per ETH
    assert corrected.to_amount == "16810460"  # raw untouched → execution safe


@pytest.mark.asyncio
async def test_decimals_correction_skips_registry_symbols(monkeypatch):
    """A normal registry symbol (not a raw address) is left untouched."""
    from types import SimpleNamespace
    from bot.services.swap_engine import SwapEngine

    eng = SwapEngine()
    # If this were called it would corrupt the value; assert it ISN'T.
    resolver = AsyncMock(return_value=6)
    monkeypatch.setattr(eng, "_resolve_onchain_decimals", resolver)

    quote = SimpleNamespace(to_amount="1000000", to_amount_human=1.0, exchange_rate=1.0)
    out = await eng._correct_destination_decimals(quote, "USDC", "base", amount=1.0)
    assert out.to_amount_human == 1.0  # unchanged
    resolver.assert_not_called()  # raw-address guard short-circuits first

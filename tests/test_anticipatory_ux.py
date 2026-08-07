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

import asyncio
import os
import re
from types import SimpleNamespace

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
ROBINHOOD_VANTIS = "0xB6d695d5fbcEbD837f6b9f214c9BeeE8bA90762B"
ROBINHOOD_AAPL = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"


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


# ---------------------------------------------------------------------------
# 11. Robinhood long-tail launch flow: discover → fund elsewhere → one quote
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_paste_metadata_probe_can_resolve_robinhood(monkeypatch):
    """A 0x token that only exists on chain 4663 must not fall back to Ethereum."""
    import bot.handlers.paste_trade as pt

    client = MagicMock()

    async def metadata(_address, chain):
        if chain == "robinhood":
            return SimpleNamespace(symbol="VANTIS", name="Vantis", decimals=18)
        return None

    client.get_token_metadata = AsyncMock(side_effect=metadata)
    monkeypatch.setattr(pt, "is_alchemy_configured", lambda: True)
    monkeypatch.setattr(pt, "get_alchemy_client", lambda: client)

    info = await pt.get_token_info(ROBINHOOD_VANTIS, "evm")

    assert "robinhood" in pt.EVM_PROBE_CHAINS
    assert info == {
        "chain": "robinhood",
        "address": ROBINHOOD_VANTIS,
        "symbol": "VANTIS",
        "name": "Vantis",
        "decimals": 18,
    }


@pytest.mark.asyncio
async def test_robinhood_token_card_offers_fund_from_another_chain(monkeypatch):
    import bot.handlers.paste_trade as pt

    monkeypatch.setattr(
        pt,
        "get_token_info",
        AsyncMock(
            return_value={
                "chain": "robinhood",
                "address": ROBINHOOD_VANTIS,
                "symbol": "VANTIS",
                "name": "Vantis",
                "decimals": 18,
            }
        ),
    )
    monkeypatch.setattr(
        pt,
        "check_address_gate",
        AsyncMock(return_value=SimpleNamespace(blocked=False, reason="")),
    )

    update, context = _msg_update(ROBINHOOD_VANTIS), _ctx()
    await pt._render_token_card(update, context, ROBINHOOD_VANTIS, "evm")

    markup = update.message.reply_text.call_args.kwargs["reply_markup"]
    callbacks = {button.callback_data for button in _all_buttons(markup)}
    assert "pbuy_cross" in callbacks
    assert context.user_data["paste_token"]["chain"] == "robinhood"


@pytest.mark.asyncio
async def test_canonical_robinhood_equity_card_fails_closed(monkeypatch):
    """Stock Tokens need a dedicated eligibility product before trading is exposed."""
    import bot.handlers.paste_trade as pt

    monkeypatch.setattr(
        pt,
        "get_token_info",
        AsyncMock(
            return_value={
                "chain": "robinhood",
                "address": ROBINHOOD_AAPL,
                "symbol": "AAPL",
                "name": "Apple",
                "decimals": 18,
            }
        ),
    )
    monkeypatch.setattr(
        pt,
        "check_address_gate",
        AsyncMock(return_value=SimpleNamespace(blocked=False, reason="")),
    )

    update, context = _msg_update(ROBINHOOD_AAPL), _ctx()
    await pt._render_token_card(update, context, ROBINHOOD_AAPL, "evm")

    assert "paste_token" not in context.user_data
    sent = update.message.reply_text.call_args.args[0].lower()
    assert "stock" in sent and ("eligib" in sent or "not enabled" in sent)
    markup = update.message.reply_text.call_args.kwargs.get("reply_markup")
    if markup:
        assert not any((b.callback_data or "").startswith("pbuy_") for b in _all_buttons(markup))


@pytest.mark.asyncio
async def test_pbuy_cross_locks_robinhood_destination_and_offers_evm_sources(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.models.user import User
    from bot.services.tos_service import tos_service
    from database.db import SessionLocal

    tg_id = 777463
    with SessionLocal() as session:
        session.add(User(telegram_id=tg_id, tos_accepted=True))
        session.commit()
    monkeypatch.setattr(tos_service, "is_accepted_telegram", lambda _id: True)
    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))

    update, context = _cb_update("pbuy_cross", user_id=tg_id), _ctx()
    context.user_data["paste_token"] = {
        "chain": "robinhood",
        "address": ROBINHOOD_VANTIS,
        "symbol": "VANTIS",
        "decimals": 18,
    }

    result = await swap.paste_buy_entry(update, context)

    assert result == swap.SELECT_FROM_CHAIN
    assert context.user_data["paste_swap_destination"] == {
        "chain": "robinhood",
        "address": ROBINHOOD_VANTIS,
        "symbol": "VANTIS",
    }
    markup = update.callback_query.edit_message_text.call_args.kwargs["reply_markup"]
    callbacks = {button.callback_data for button in _all_buttons(markup)}
    assert {"from_chain_base", "from_chain_ethereum", "from_chain_arbitrum"} <= callbacks
    assert "from_chain_robinhood" not in callbacks
    assert "from_chain_solana" not in callbacks


@pytest.mark.asyncio
async def test_source_token_restores_locked_robinhood_target(monkeypatch):
    import bot.handlers.swap as swap

    update, context = _cb_update("from_token_USDC"), _ctx()
    context.user_data.update(
        {
            "swap": {"from_chain": "base"},
            "paste_swap_destination": {
                "chain": "robinhood",
                "address": ROBINHOOD_VANTIS,
                "symbol": "VANTIS",
            },
        }
    )

    result = await swap.select_from_token(update, context)

    assert result == swap.ENTER_AMOUNT
    assert context.user_data["swap"] == {
        "from_chain": "base",
        "from_token": "USDC",
        "to_chain": "robinhood",
        "to_token": ROBINHOOD_VANTIS,
        "single_wallet_only": True,
    }
    assert "paste_swap_destination" not in context.user_data


@pytest.mark.asyncio
async def test_robinhood_custom_paste_buy_is_single_wallet(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.models.user import User
    from bot.services.tos_service import tos_service
    from database.db import SessionLocal

    tg_id = 777464
    with SessionLocal() as session:
        session.add(User(telegram_id=tg_id, tos_accepted=True))
        session.commit()
    monkeypatch.setattr(tos_service, "is_accepted_telegram", lambda _id: True)
    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))

    update, context = _cb_update("pbuy_custom", user_id=tg_id), _ctx()
    context.user_data["paste_token"] = {
        "chain": "robinhood",
        "address": ROBINHOOD_VANTIS,
        "symbol": "VANTIS",
    }
    context.user_data["paste_swap_destination"] = {
        "chain": "robinhood",
        "address": "0x000000000000000000000000000000000000dead",
        "symbol": "STALE",
    }

    result = await swap.paste_buy_entry(update, context)

    assert result == swap.ENTER_AMOUNT
    assert context.user_data["swap"]["single_wallet_only"] is True
    assert "paste_swap_destination" not in context.user_data


@pytest.mark.asyncio
async def test_robinhood_preset_paste_buy_is_single_wallet(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.models.user import User
    from bot.services.tos_service import tos_service
    from database.db import SessionLocal

    tg_id = 777465
    with SessionLocal() as session:
        session.add(User(telegram_id=tg_id, tos_accepted=True))
        session.commit()
    monkeypatch.setattr(tos_service, "is_accepted_telegram", lambda _id: True)
    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(
        swap.wallet_service,
        "get_default_wallet",
        lambda *_: SimpleNamespace(id=73, address="0x0000000000000000000000000000000000000073"),
    )
    monkeypatch.setattr(swap, "_schedule_quote_prewarm", lambda *args, **kwargs: None)
    wallet_selection = AsyncMock(return_value=swap.SELECT_WALLETS)
    monkeypatch.setattr(swap, "show_wallet_selection", wallet_selection)

    update, context = _cb_update("pbuy_0.05", user_id=tg_id), _ctx()
    context.user_data["paste_token"] = {
        "chain": "robinhood",
        "address": ROBINHOOD_VANTIS,
        "symbol": "VANTIS",
    }

    result = await swap.paste_buy_entry(update, context)

    assert result == swap.SELECT_WALLETS
    assert context.user_data["swap"]["single_wallet_only"] is True
    wallet_selection.assert_awaited_once()


@pytest.mark.asyncio
async def test_forged_robinhood_equity_paste_buy_fails_before_wallet_work(tmp_db, monkeypatch):
    """Execution re-checks the canonical address even if discovery UI was bypassed."""
    import bot.handlers.swap as swap
    from bot.models.user import User
    from bot.services.tos_service import tos_service
    from database.db import SessionLocal

    tg_id = 777469
    with SessionLocal() as session:
        session.add(User(telegram_id=tg_id, tos_accepted=True))
        session.commit()
    monkeypatch.setattr(tos_service, "is_accepted_telegram", lambda _id: True)
    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    get_default_wallet = MagicMock(
        return_value=SimpleNamespace(id=74, address="0x0000000000000000000000000000000000000074")
    )
    monkeypatch.setattr(swap.wallet_service, "get_default_wallet", get_default_wallet)
    monkeypatch.setattr(swap, "_schedule_quote_prewarm", lambda *args, **kwargs: None)
    wallet_selection = AsyncMock(return_value=swap.SELECT_WALLETS)
    monkeypatch.setattr(swap, "show_wallet_selection", wallet_selection)

    update, context = _cb_update("pbuy_0.05", user_id=tg_id), _ctx()
    context.user_data["paste_token"] = {
        "chain": "robinhood",
        "address": ROBINHOOD_AAPL,
        "symbol": "TOTALLY_NOT_AAPL",  # Symbol spoofing must not bypass the address gate.
    }

    result = await swap.paste_buy_entry(update, context)

    assert result == swap.ConversationHandler.END
    get_default_wallet.assert_not_called()
    wallet_selection.assert_not_awaited()
    assert "stock" in update.callback_query.edit_message_text.call_args.args[0].lower()


@pytest.mark.asyncio
async def test_start_swap_clears_stale_paste_destination(tmp_db, monkeypatch):
    import bot.handlers.swap as swap

    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    update, context = _cb_update("swap_start", user_id=888001), _ctx()
    context.user_data["paste_swap_destination"] = {
        "chain": "robinhood",
        "address": ROBINHOOD_VANTIS,
        "symbol": "VANTIS",
    }

    # No DB user is intentional: stale intent must be cleared before any early return.
    assert await swap.start_swap(update, context, is_callback=True) == swap.ConversationHandler.END
    assert "paste_swap_destination" not in context.user_data


@pytest.mark.asyncio
async def test_swap_cancel_clears_stale_paste_destination(monkeypatch):
    import bot.handlers.start as start
    import bot.handlers.swap as swap

    monkeypatch.setattr(start, "main_menu_callback", AsyncMock())
    update, context = _cb_update("swap_cancel"), _ctx()
    context.user_data.update(
        {
            "swap": {"from_chain": "base"},
            "paste_swap_destination": {
                "chain": "robinhood",
                "address": ROBINHOOD_VANTIS,
                "symbol": "VANTIS",
            },
        }
    )

    assert await swap.swap_cancel(update, context) == swap.ConversationHandler.END
    assert "swap" not in context.user_data
    assert "paste_swap_destination" not in context.user_data


@pytest.mark.asyncio
async def test_single_wallet_mode_renders_single_sender_copy(tmp_db):
    import bot.handlers.swap as swap
    from bot.models.user import User, Wallet
    from database.db import SessionLocal

    with SessionLocal() as session:
        user = User(telegram_id=777466, tos_accepted=True)
        session.add(user)
        session.flush()
        wallet = Wallet(
            user_id=user.id,
            name="Primary",
            address="0x0000000000000000000000000000000000000001",
            chain_type="evm",
            is_default=True,
        )
        session.add(wallet)
        session.commit()
        user_id, wallet_id = user.id, wallet.id

    update, context = _cb_update("swap_back_to_wallets"), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "from_chain": "base",
                "from_token": "USDC",
                "to_chain": "robinhood",
                "to_token": ROBINHOOD_VANTIS,
                "amount": 10.0,
                "wallet_id": wallet_id,
                "single_wallet_only": True,
            },
        }
    )

    assert await swap.show_wallet_selection(update, context) == swap.SELECT_WALLETS

    call = update.callback_query.edit_message_text.call_args
    assert "select wallet" in call.args[0].lower()
    assert "each selected wallet" not in call.args[0].lower()
    labels = {button.text for button in _all_buttons(call.kwargs["reply_markup"])}
    assert "✅ Confirm Wallet" in labels


@pytest.mark.asyncio
async def test_single_wallet_toggle_replaces_selection(monkeypatch):
    import bot.handlers.swap as swap

    render = AsyncMock(return_value=swap.SELECT_WALLETS)
    monkeypatch.setattr(swap, "show_wallet_selection", render)
    update, context = _cb_update("swap_toggle_wallet_22"), _ctx()
    context.user_data["swap"] = {
        "selected_wallets": [11],
        "single_wallet_only": True,
    }

    assert await swap.toggle_wallet_callback(update, context) == swap.SELECT_WALLETS
    assert context.user_data["swap"]["selected_wallets"] == [22]


@pytest.mark.asyncio
async def test_single_wallet_confirm_rejects_forged_multiwallet_state(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.models.user import User, Wallet
    from bot.services.x402_service import x402_service
    from database.db import SessionLocal

    with SessionLocal() as session:
        user = User(telegram_id=777467, tos_accepted=True)
        session.add(user)
        session.flush()
        wallets = [
            Wallet(
                user_id=user.id,
                name=f"Wallet {i}",
                address=f"0x{i:040x}",
                chain_type="evm",
            )
            for i in (1, 2)
        ]
        session.add_all(wallets)
        session.commit()
        user_id, wallet_ids = user.id, [wallet.id for wallet in wallets]

    context = _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "from_chain": "base",
                "from_token": "USDC",
                "to_chain": "robinhood",
                "to_token": ROBINHOOD_VANTIS,
                "amount": 10.0,
                "single_wallet_only": True,
                "selected_wallets": wallet_ids,
            },
        }
    )
    monkeypatch.setattr(x402_service, "get_tier", AsyncMock(return_value="free"))
    monkeypatch.setattr(swap.fee_service, "get_fee_bps", MagicMock(return_value=100))
    monkeypatch.setattr(swap.quote_cache, "get", AsyncMock(return_value=None))
    get_quote = AsyncMock(side_effect=AssertionError("must reject before quoting"))
    monkeypatch.setattr(swap.swap_engine, "get_quote", get_quote)

    update = _cb_update("swap_wallets_confirmed", user_id=777467)
    await swap.wallets_confirmed_callback(update, context)

    get_quote.assert_not_awaited()
    last_message = update.callback_query.edit_message_text.call_args.args[0].lower()
    assert "one wallet" in last_message


@pytest.mark.asyncio
async def test_swap_confirm_renders_preflight_before_slow_balance_validation(tmp_db, monkeypatch):
    import bot.handlers.swap as swap
    from bot.models.user import User, Wallet
    from database.db import SessionLocal

    with SessionLocal() as session:
        user = User(telegram_id=777469, tos_accepted=True)
        session.add(user)
        session.flush()
        wallet = Wallet(
            user_id=user.id,
            name="Preflight Wallet",
            address="0x00000000000000000000000000000000000000c3",
            chain_type="evm",
            is_default=True,
        )
        session.add(wallet)
        session.commit()
        user_id, wallet_id = user.id, wallet.id

    update, context = _cb_update("swap_confirm", user_id=777469), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "quote": SimpleNamespace(),
                "wallet_id": wallet_id,
                "selected_wallets": [wallet_id],
            },
        }
    )

    preflight_rendered = asyncio.Event()
    validation_started = asyncio.Event()
    release_validation = asyncio.Event()
    order = []

    async def record_edit(text, *args, **kwargs):
        order.append(("edit", text))
        if "Validating balances & gas" in text:
            preflight_rendered.set()

    async def slow_balance_validation(*args, **kwargs):
        order.append(("balance", "started"))
        validation_started.set()
        await release_validation.wait()
        return True

    update.callback_query.edit_message_text = AsyncMock(side_effect=record_edit)
    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(swap.quote_validator, "validate_balance", slow_balance_validation)
    monkeypatch.setattr(swap.quote_validator, "validate_gas", AsyncMock(return_value=True))
    run_confirmed = AsyncMock(return_value=swap.ConversationHandler.END)
    monkeypatch.setattr(swap, "_run_confirmed_swap", run_confirmed)

    task = asyncio.create_task(swap.confirm_swap(update, context))
    await asyncio.wait_for(validation_started.wait(), timeout=1)

    assert preflight_rendered.is_set()
    assert order[:2] == [
        ("edit", "⏳ Validating balances & gas…"),
        ("balance", "started"),
    ]
    assert not task.done()

    release_validation.set()
    await asyncio.wait_for(task, timeout=1)
    run_confirmed.assert_awaited_once()

    # The preflight paint is UX-only. A transient Telegram edit failure must not
    # become a new dependency that blocks otherwise-valid execution handoff.
    from telegram.error import TelegramError

    run_confirmed.reset_mock()
    update.callback_query.edit_message_text = AsyncMock(
        side_effect=TelegramError("temporary Telegram edit failure")
    )
    await asyncio.wait_for(swap.confirm_swap(update, context), timeout=1)
    run_confirmed.assert_awaited_once()


@pytest.mark.asyncio
async def test_single_wallet_requote_binds_selected_wallet_and_refreshes_risk_state(
    tmp_db, monkeypatch
):
    import bot.handlers.swap as swap
    from bot.models.subscription import SubscriptionTier
    from bot.models.user import User, Wallet
    from bot.services.swap_engine import SwapQuote
    from bot.services.x402_service import x402_service
    from database.db import SessionLocal

    with SessionLocal() as session:
        user = User(telegram_id=777468, tos_accepted=True)
        session.add(user)
        session.flush()
        default_wallet = Wallet(
            user_id=user.id,
            name="Default",
            address="0x00000000000000000000000000000000000000a1",
            chain_type="evm",
            is_default=True,
        )
        selected_wallet = Wallet(
            user_id=user.id,
            name="Selected",
            address="0x00000000000000000000000000000000000000b2",
            chain_type="evm",
            is_default=False,
        )
        session.add_all([default_wallet, selected_wallet])
        session.commit()
        user_id = user.id
        selected_id = selected_wallet.id
        default_address = default_wallet.address
        selected_address = selected_wallet.address

    quote = SwapQuote(
        provider="lifi",
        from_chain="base",
        to_chain="robinhood",
        from_token="USDC",
        to_token=ROBINHOOD_VANTIS,
        from_amount="10000000",
        from_amount_human=10.0,
        to_amount="2500000000000000000",
        to_amount_human=2.5,
        to_amount_min="2400000000000000000",
        gas_cost_usd=0.03,
        fee_cost_usd=0.01,
        total_cost_usd=0.04,
        estimated_time=4,
        price_impact=0.1,
        exchange_rate=0.25,
        raw_quote={"provider": "lifi"},
    )

    monkeypatch.setattr(swap, "enforce_rate_limit_for_update", AsyncMock(return_value=True))
    monkeypatch.setattr(
        swap.wallet_service,
        "get_default_wallet",
        MagicMock(return_value=SimpleNamespace(address=default_address)),
    )
    get_quote = AsyncMock(return_value=quote)
    monkeypatch.setattr(swap.swap_engine, "get_quote", get_quote)
    monkeypatch.setattr(x402_service, "get_tier", AsyncMock(return_value=SubscriptionTier.PRO))
    get_fee_bps = MagicMock(return_value=37)
    monkeypatch.setattr(swap.fee_service, "get_fee_bps", get_fee_bps)
    fee_calc = AsyncMock(return_value=(0.037, 0.37, 0.37))
    monkeypatch.setattr(swap.fee_service, "calculate_fee_with_price", fee_calc)
    usd_value = AsyncMock(return_value=123.45)
    monkeypatch.setattr(swap.spending_limit_service, "usd_value", usd_value)

    update, context = _cb_update("swap_requote", user_id=777468), _ctx()
    context.user_data.update(
        {
            "user_id": user_id,
            "swap": {
                "from_chain": "base",
                "from_token": "USDC",
                "to_chain": "robinhood",
                "to_token": ROBINHOOD_VANTIS,
                "amount": 10.0,
                "wallet_id": None,
                "selected_wallets": [selected_id],
                "single_wallet_only": True,
                # Deliberately stale values: re-quote must replace all of them.
                "fee_amount": 99.0,
                "fee_percentage": 99.0,
                "fee_usd": 99.0,
                "amount_usd": 9999.0,
            },
        }
    )

    assert await swap.swap_requote(update, context) == swap.CONFIRM_SWAP

    kwargs = get_quote.await_args.kwargs
    assert kwargs["from_address"] == selected_address
    assert kwargs["platform_fee_bps"] == 37
    get_fee_bps.assert_called_once_with(SubscriptionTier.PRO, user_id=user_id)
    fee_calc.assert_awaited_once_with(
        amount=10.0,
        token_symbol="USDC",
        tier=SubscriptionTier.PRO,
        user_id=user_id,
    )
    usd_value.assert_awaited_once_with("USDC", 10.0)
    assert context.user_data["swap"]["fee_amount"] == 0.037
    assert context.user_data["swap"]["fee_percentage"] == 0.37
    assert context.user_data["swap"]["fee_usd"] == 0.37
    assert context.user_data["swap"]["amount_usd"] == 123.45

"""Tests for WhatsApp conversation flows.

Covers:
(a) Registry — all flows register; predict/positions/settings present.
(b) Trigger routing — real trigger strings resolve to the right flow via
    the same logic WhatsAppRouter uses.
(c) start() / step transitions for predict, positions, and settings
    flows with all external services mocked.

Note on CI vs local:
  The local .venv has a broken web3/eth_utils combination that prevents
  importing bot.services (bot/services/__init__.py pulls in wallet.py ->
  web3).  We work around this by:
    - Importing only from bot.services.whatsapp_flows.* and
      bot.services.whatsapp_conversation (neither touches web3 at import time).
    - Patching conversation_manager directly on the already-imported module
      object rather than via the "bot.services.*" dotted string (which would
      trigger the bot/services/__init__.py import).
    - Patching database.db.get_session (not a method on the flow module).
  In CI the full web3 stack is present and everything passes normally.
"""

import os
import sys
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# Minimal env for import-time settings validation (mirrors conftest.py)
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_state(flow: str, step: str, data: dict = None):
    """Build a ConversationState directly without Redis."""
    from bot.services.whatsapp_conversation import ConversationState

    return ConversationState(flow=flow, step=step, data=data or {})


def _mock_session_cm(session_obj=None):
    """Return a context-manager mock that yields session_obj."""
    if session_obj is None:
        session_obj = MagicMock()
    cm = MagicMock()
    cm.__enter__ = MagicMock(return_value=session_obj)
    cm.__exit__ = MagicMock(return_value=False)
    return cm, session_obj


def _resolve_flow_by_trigger(text: str):
    """Mirror WhatsAppRouter trigger lookup: flow_name + trigger_commands."""
    from bot.services.whatsapp_flows import get_all_flows

    text_lower = text.lower()
    for _name, flow in get_all_flows().items():
        triggers = [flow.flow_name] + (flow.trigger_commands or [])
        if text_lower in [t.lower() for t in triggers]:
            return flow
    return None


# ---------------------------------------------------------------------------
# Autouse fixture: patch conversation_manager on the already-imported module
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def mock_conversation_manager():
    """Replace conversation_manager for the duration of every test.

    We patch the module-level attribute directly (not via the 'bot.services.*'
    dotted-string form, which would re-import bot/services/__init__.py and
    trigger the web3 dependency on broken local envs).
    """
    import bot.services.whatsapp_flows.base as _base_mod

    mgr = AsyncMock()
    mgr.set_state = AsyncMock()
    mgr.update_step = AsyncMock()
    mgr.clear_state = AsyncMock()
    mgr.get_state = AsyncMock(return_value=None)

    orig = _base_mod.conversation_manager
    _base_mod.conversation_manager = mgr
    try:
        yield mgr
    finally:
        _base_mod.conversation_manager = orig


# ---------------------------------------------------------------------------
# (a) Registry tests
# ---------------------------------------------------------------------------


class TestRegistry:
    def test_registry_non_empty(self):
        from bot.services.whatsapp_flows import get_all_flows

        assert len(get_all_flows()) > 0

    def test_predict_registered(self):
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("predict")
        assert flow is not None
        assert flow.flow_name == "predict"

    def test_positions_registered(self):
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("positions")
        assert flow is not None
        assert flow.flow_name == "positions"

    def test_settings_registered(self):
        from bot.services.whatsapp_flows import get_flow

        flow = get_flow("settings")
        assert flow is not None
        assert flow.flow_name == "settings"

    def test_perps_registered(self):
        from bot.services.whatsapp_flows import get_flow

        assert get_flow("perps") is not None

    def test_swap_registered(self):
        from bot.services.whatsapp_flows import get_flow

        assert get_flow("swap") is not None


# ---------------------------------------------------------------------------
# (b) Trigger routing tests
# ---------------------------------------------------------------------------


class TestTriggerRouting:
    def test_predict_trigger(self):
        flow = _resolve_flow_by_trigger("predict")
        assert flow is not None and flow.flow_name == "predict"

    def test_predictions_trigger(self):
        flow = _resolve_flow_by_trigger("predictions")
        assert flow is not None and flow.flow_name == "predict"

    def test_predict_slash_trigger(self):
        flow = _resolve_flow_by_trigger("/predict")
        assert flow is not None and flow.flow_name == "predict"

    def test_positions_trigger(self):
        flow = _resolve_flow_by_trigger("positions")
        assert flow is not None and flow.flow_name == "positions"

    def test_pos_trigger(self):
        flow = _resolve_flow_by_trigger("pos")
        assert flow is not None and flow.flow_name == "positions"

    def test_pnl_trigger(self):
        flow = _resolve_flow_by_trigger("pnl")
        assert flow is not None and flow.flow_name == "positions"

    def test_settings_trigger(self):
        flow = _resolve_flow_by_trigger("settings")
        assert flow is not None and flow.flow_name == "settings"

    def test_config_trigger(self):
        flow = _resolve_flow_by_trigger("config")
        assert flow is not None and flow.flow_name == "settings"

    def test_settings_slash_trigger(self):
        flow = _resolve_flow_by_trigger("/settings")
        assert flow is not None and flow.flow_name == "settings"

    def test_perps_trigger(self):
        flow = _resolve_flow_by_trigger("perps")
        assert flow is not None and flow.flow_name == "perps"

    def test_long_trigger(self):
        flow = _resolve_flow_by_trigger("long")
        assert flow is not None and flow.flow_name == "perps"

    def test_unknown_text_returns_none(self):
        assert _resolve_flow_by_trigger("notacommand_xyz_9999") is None

    def test_trigger_is_case_insensitive(self):
        # Router normalises with .lower()
        flow = _resolve_flow_by_trigger("PREDICT")
        assert flow is not None and flow.flow_name == "predict"


# ---------------------------------------------------------------------------
# (c) Flow step transition tests
# ---------------------------------------------------------------------------

# ---- PredictFlow -----------------------------------------------------------


class TestPredictFlow:
    @pytest.fixture
    def flow(self):
        from bot.services.whatsapp_flows.predict_flow import PredictFlow

        return PredictFlow()

    async def test_start_returns_main_menu(self, flow, mock_conversation_manager):
        resp = await flow.start("u1", 1)
        assert "Prediction Markets" in resp.text
        assert resp.buttons is not None
        ids = [b["id"] for b in resp.buttons]
        assert "pred_trending" in ids
        assert "pred_positions" in ids
        mock_conversation_manager.set_state.assert_awaited_once()

    async def test_step_show_menu_search(self, flow, mock_conversation_manager):
        """pred_search branches to search prompt — no external calls needed."""
        state = _make_state("predict", "show_menu", {"user_db_id": 1})
        resp = await flow._step_show_menu("u1", 1, "pred_search", state)
        assert "Search" in resp.text
        mock_conversation_manager.update_step.assert_awaited_once()

    async def test_step_show_menu_unknown_rerenders_menu(self, flow):
        state = _make_state("predict", "show_menu", {"user_db_id": 1})
        resp = await flow._step_show_menu("u1", 1, "garbage_input", state)
        ids = [b["id"] for b in resp.buttons]
        assert "pred_trending" in ids

    async def test_step_show_menu_positions(self, flow, mock_conversation_manager):
        """pred_positions calls _build_positions which needs DB — mock it."""
        state = _make_state("predict", "show_menu", {"user_db_id": 1})
        with patch.object(
            flow,
            "_build_positions",
            new=AsyncMock(
                return_value=MagicMock(text="*My Positions*", buttons=[], list_sections=None)
            ),
        ):
            resp = await flow._step_show_menu("u1", 1, "pred_positions", state)
        assert "Positions" in resp.text

    async def test_step_confirm_order_cancel(self, flow, mock_conversation_manager):
        state = _make_state(
            "predict",
            "confirm_order",
            {
                "user_db_id": 1,
                "outcome": "Yes",
                "amount": 10.0,
                "selected_market": {
                    "condition_id": "cid1",
                    "question": "Will BTC reach 100k?",
                    "description": "",
                    "outcome_yes_price": 0.6,
                    "outcome_no_price": 0.4,
                    "volume_24hr": 50000,
                    "volume_total": 500000,
                    "liquidity": 20000,
                    "end_date": "2025-12-31",
                    "active": True,
                    "closed": False,
                    "tokens": [
                        {"outcome": "Yes", "token_id": "tok_yes"},
                        {"outcome": "No", "token_id": "tok_no"},
                    ],
                    "image": "",
                    "category": "Crypto",
                },
            },
        )
        resp = await flow._step_confirm_order("u1", 1, "pred_cancel_order", state)
        assert "cancel" in resp.text.lower()
        mock_conversation_manager.clear_state.assert_awaited_once()

    async def test_step_confirm_order_unrecognised_rerenders_confirmation(self, flow):
        state = _make_state(
            "predict",
            "confirm_order",
            {
                "user_db_id": 1,
                "outcome": "Yes",
                "amount": 10.0,
                "selected_market": {
                    "condition_id": "cid1",
                    "question": "Will ETH hit 10k?",
                    "description": "",
                    "outcome_yes_price": 0.5,
                    "outcome_no_price": 0.5,
                    "volume_24hr": 1000,
                    "volume_total": 10000,
                    "liquidity": 5000,
                    "end_date": "",
                    "active": True,
                    "closed": False,
                    "tokens": [],
                    "image": "",
                    "category": "",
                },
            },
        )
        resp = await flow._step_confirm_order("u1", 1, "not_a_button", state)
        ids = [b["id"] for b in resp.buttons]
        assert "pred_confirm" in ids
        assert "pred_cancel_order" in ids

    async def test_select_side_quick_amount(self, flow, mock_conversation_manager):
        """Choosing a quick amount in _step_select_side transitions to confirm."""
        state = _make_state(
            "predict",
            "select_side",
            {
                "user_db_id": 1,
                "outcome": "Yes",
                "selected_market": {
                    "condition_id": "cid2",
                    "question": "Test?",
                    "description": "",
                    "outcome_yes_price": 0.7,
                    "outcome_no_price": 0.3,
                    "volume_24hr": 1000,
                    "volume_total": 5000,
                    "liquidity": 2000,
                    "end_date": "",
                    "active": True,
                    "closed": False,
                    "tokens": [],
                    "image": "",
                    "category": "",
                },
            },
        )
        resp = await flow._step_select_side("u1", 1, "pred_amt_10", state)
        # Should build a confirmation with the confirm button
        assert resp.buttons is not None
        ids = [b["id"] for b in resp.buttons]
        assert "pred_confirm" in ids

    async def test_cancel_keyword_handled_by_base(self, flow, mock_conversation_manager):
        """Universal cancel from BaseWhatsAppFlow.handle() resets state."""
        state = _make_state("predict", "show_menu", {"user_db_id": 1})
        resp = await flow.handle("u1", 1, "cancel", state)
        assert "Cancelled" in resp.text
        mock_conversation_manager.clear_state.assert_awaited_once()


# ---- PositionsFlow ---------------------------------------------------------


class TestPositionsFlow:
    @pytest.fixture
    def flow(self):
        from bot.services.whatsapp_flows.positions_flow import PositionsFlow

        return PositionsFlow()

    def _token_index(self):
        return {
            "pos_pick_0": {"token": "ETH", "chain": "ethereum", "qty": 0.5, "chain_type": "evm"},
            "pos_pick_1": {"token": "SOL", "chain": "solana", "qty": 2.0, "chain_type": "svm"},
        }

    async def test_start_no_held_tokens_clears_state(self, flow, mock_conversation_manager):
        """When _aggregate_positions returns no held tokens, state is cleared."""
        import bot.services.whatsapp_flows.positions_flow as _pos_mod

        with patch.object(
            _pos_mod,
            "_aggregate_positions",
            new=AsyncMock(return_value=("*Your Positions*\n\nNo tracked spot positions yet.", [])),
        ):
            # Stub DB backfill check: user already backfilled
            session_mock = MagicMock()
            cm, _ = _mock_session_cm(session_mock)
            user_mock = MagicMock()
            user_mock.positions_backfilled_at = "2025-01-01"
            session_mock.query.return_value.filter.return_value.first.return_value = user_mock
            with patch("database.db.get_session", return_value=cm):
                resp = await flow.start("u1", 1)
        assert "Positions" in resp.text
        mock_conversation_manager.clear_state.assert_awaited_once()

    async def test_start_with_held_tokens_shows_sell_button(self, flow, mock_conversation_manager):
        import bot.services.whatsapp_flows.positions_flow as _pos_mod

        with patch.object(
            _pos_mod,
            "_aggregate_positions",
            new=AsyncMock(
                return_value=(
                    "*Your Positions*\n\nTotal Value: $500\n",
                    [{"token": "ETH", "chain": "ethereum", "qty": 0.5, "chain_type": "evm"}],
                )
            ),
        ):
            session_mock = MagicMock()
            cm, _ = _mock_session_cm(session_mock)
            user_mock = MagicMock()
            user_mock.positions_backfilled_at = "2025-01-01"
            session_mock.query.return_value.filter.return_value.first.return_value = user_mock
            with patch("database.db.get_session", return_value=cm):
                resp = await flow.start("u1", 1)
        assert resp.buttons is not None
        ids = [b["id"] for b in resp.buttons]
        assert "pos_sell_token" in ids

    async def test_step_show_summary_shows_token_list(self, flow, mock_conversation_manager):
        state = _make_state(
            "positions",
            "show_summary",
            {
                "user_db_id": 1,
                "token_index": self._token_index(),
            },
        )
        resp = await flow._step_show_summary("u1", 1, "pos_sell_token", state)
        assert resp.list_sections is not None
        row_ids = [r["id"] for s in resp.list_sections for r in s["rows"]]
        assert "pos_pick_0" in row_ids
        assert "pos_pick_1" in row_ids

    async def test_step_show_summary_wrong_input_re_prompts(self, flow):
        state = _make_state(
            "positions",
            "show_summary",
            {
                "user_db_id": 1,
                "token_index": self._token_index(),
            },
        )
        resp = await flow._step_show_summary("u1", 1, "garbage", state)
        ids = [b["id"] for b in resp.buttons]
        assert "pos_sell_token" in ids

    async def test_step_select_token_valid_pick(self, flow, mock_conversation_manager):
        state = _make_state(
            "positions",
            "select_token",
            {
                "user_db_id": 1,
                "token_index": self._token_index(),
            },
        )
        resp = await flow._step_select_token("u1", 1, "pos_pick_0", state)
        assert "ETH" in resp.text
        assert resp.buttons is not None
        ids = [b["id"] for b in resp.buttons]
        assert "pos_sell_25" in ids
        assert "pos_sell_50" in ids
        assert "pos_sell_100" in ids

    async def test_step_select_token_invalid_shows_list(self, flow):
        state = _make_state(
            "positions",
            "select_token",
            {
                "user_db_id": 1,
                "token_index": self._token_index(),
            },
        )
        resp = await flow._step_select_token("u1", 1, "pos_pick_999", state)
        assert resp.list_sections is not None

    async def test_step_sell_unknown_pct_re_prompts(self, flow):
        state = _make_state(
            "positions",
            "sell",
            {
                "user_db_id": 1,
                "token": "ETH",
                "chain": "ethereum",
                "chain_type": "evm",
            },
        )
        resp = await flow._step_sell("u1", 1, "bad_input", state)
        ids = [b["id"] for b in resp.buttons]
        assert "pos_sell_25" in ids

    async def test_step_sell_usdc_already_stable(self, flow, mock_conversation_manager):
        """Selling USDC returns early with a friendly message."""
        state = _make_state(
            "positions",
            "sell",
            {
                "user_db_id": 1,
                "token": "USDC",
                "chain": "ethereum",
                "chain_type": "evm",
            },
        )
        resp = await flow._step_sell("u1", 1, "pos_sell_100", state)
        assert "usdc" in resp.text.lower() or "already" in resp.text.lower()


# ---- SettingsFlow ----------------------------------------------------------

_FULL_SETTINGS = {
    "slippage_bps": 50,
    "notify": True,
    "panic": False,
    "mev": True,
    "speed": "normal",
    "chain": "any",
    "output_token": "USDC",
    "per_swap": 5000.0,
    "daily": 50000.0,
    "twofa": 1000.0,
}


class TestSettingsFlow:
    @pytest.fixture
    def flow(self):
        from bot.services.whatsapp_flows.settings_flow import SettingsFlow

        return SettingsFlow()

    def _patched_load(self):
        """Context manager that stubs _load_full_settings."""
        import bot.services.whatsapp_flows.settings_flow as _sf

        return patch.object(_sf, "_load_full_settings", return_value=_FULL_SETTINGS)

    def _patched_db(self):
        """Context manager that stubs database.db.get_session."""
        session_mock = MagicMock()
        session_mock.__enter__ = MagicMock(return_value=session_mock)
        session_mock.__exit__ = MagicMock(return_value=False)
        us = MagicMock()
        user = MagicMock()
        session_mock.query.return_value.filter.return_value.first.side_effect = [user, us]
        return patch("database.db.get_session", return_value=session_mock), session_mock, us

    async def test_start_shows_main_menu(self, flow, mock_conversation_manager):
        with self._patched_load():
            resp = await flow.start("u1", 1)
        assert "*Settings*" in resp.text
        assert resp.list_sections is not None
        mock_conversation_manager.set_state.assert_awaited_once()

    async def test_start_db_error_returns_error_text(self, flow, mock_conversation_manager):
        import bot.services.whatsapp_flows.settings_flow as _sf

        with patch.object(_sf, "_load_full_settings", return_value={}):
            resp = await flow.start("u1", 1)
        assert "Could not load settings" in resp.text

    async def test_step_main_menu_set_slippage(self, flow, mock_conversation_manager):
        state = _make_state("settings", "main_menu", {"user_db_id": 1})
        resp = await flow._step_main_menu("u1", 1, "set_slippage", state)
        assert "slippage" in resp.text.lower()
        mock_conversation_manager.update_step.assert_awaited_once()

    async def test_step_main_menu_set_speed(self, flow, mock_conversation_manager):
        state = _make_state("settings", "main_menu", {"user_db_id": 1})
        resp = await flow._step_main_menu("u1", 1, "set_speed", state)
        assert resp.list_sections is not None
        row_ids = [r["id"] for s in resp.list_sections for r in s["rows"]]
        assert "speed_slow" in row_ids
        assert "speed_normal" in row_ids
        assert "speed_fast" in row_ids

    async def test_step_main_menu_set_chain(self, flow, mock_conversation_manager):
        state = _make_state("settings", "main_menu", {"user_db_id": 1})
        resp = await flow._step_main_menu("u1", 1, "set_chain", state)
        assert resp.list_sections is not None
        row_ids = [r["id"] for s in resp.list_sections for r in s["rows"]]
        assert "chain_ethereum" in row_ids
        assert "chain_solana" in row_ids

    async def test_step_main_menu_set_output_token(self, flow, mock_conversation_manager):
        state = _make_state("settings", "main_menu", {"user_db_id": 1})
        resp = await flow._step_main_menu("u1", 1, "set_output_token", state)
        assert resp.list_sections is not None
        row_ids = [r["id"] for s in resp.list_sections for r in s["rows"]]
        assert "outtok_USDC" in row_ids

    async def test_step_main_menu_unknown_rerenders_menu(self, flow):
        state = _make_state("settings", "main_menu", {"user_db_id": 1})
        with self._patched_load():
            resp = await flow._step_main_menu("u1", 1, "garbage_input", state)
        assert "*Settings*" in resp.text

    async def test_step_set_speed_valid(self, flow, mock_conversation_manager):
        state = _make_state("settings", "set_speed", {"user_db_id": 1})
        session_mock = MagicMock()
        session_mock.__enter__ = MagicMock(return_value=session_mock)
        session_mock.__exit__ = MagicMock(return_value=False)
        us = MagicMock()
        session_mock.query.return_value.filter.return_value.first.return_value = us
        with patch("database.db.get_session", return_value=session_mock):
            resp = await flow._step_set_speed("u1", 1, "speed_fast", state)
        assert "fast" in resp.text.lower()
        assert us.tx_speed_preset == "fast"

    async def test_step_set_speed_invalid_rerenders_picker(self, flow):
        state = _make_state("settings", "set_speed", {"user_db_id": 1})
        resp = await flow._step_set_speed("u1", 1, "speed_warp99", state)
        assert resp.list_sections is not None

    async def test_step_slippage_valid(self, flow, mock_conversation_manager):
        state = _make_state("settings", "set_slippage", {"user_db_id": 1})
        session_mock = MagicMock()
        session_mock.__enter__ = MagicMock(return_value=session_mock)
        session_mock.__exit__ = MagicMock(return_value=False)
        user = MagicMock()
        us = MagicMock()
        session_mock.query.return_value.filter.return_value.first.side_effect = [user, us]
        with patch("database.db.get_session", return_value=session_mock):
            resp = await flow._step_slippage("u1", 1, "0.5", state)
        assert "0.5%" in resp.text

    async def test_step_slippage_out_of_range(self, flow):
        state = _make_state("settings", "set_slippage", {"user_db_id": 1})
        resp = await flow._step_slippage("u1", 1, "99", state)
        assert "between" in resp.text.lower()

    async def test_step_slippage_non_numeric(self, flow):
        state = _make_state("settings", "set_slippage", {"user_db_id": 1})
        resp = await flow._step_slippage("u1", 1, "abc", state)
        assert "valid" in resp.text.lower() or "number" in resp.text.lower()

    async def test_step_set_limits_valid(self, flow, mock_conversation_manager):
        state = _make_state("settings", "set_limits", {"user_db_id": 1})
        session_mock = MagicMock()
        session_mock.__enter__ = MagicMock(return_value=session_mock)
        session_mock.__exit__ = MagicMock(return_value=False)
        us = MagicMock()
        session_mock.query.return_value.filter.return_value.first.return_value = us
        with patch("database.db.get_session", return_value=session_mock):
            with patch("bot.services.security.sync_limits_to_turnkey", new=AsyncMock()):
                resp = await flow._step_set_limits("u1", 1, "1000 10000", state)
        assert "1,000" in resp.text or "1000" in resp.text

    async def test_step_set_limits_per_swap_exceeds_daily(self, flow):
        state = _make_state("settings", "set_limits", {"user_db_id": 1})
        resp = await flow._step_set_limits("u1", 1, "50000 1000", state)
        assert "cannot exceed" in resp.text.lower() or "daily" in resp.text.lower()

    async def test_step_set_limits_invalid_format(self, flow):
        state = _make_state("settings", "set_limits", {"user_db_id": 1})
        resp = await flow._step_set_limits("u1", 1, "only_one_number", state)
        assert (
            "two" in resp.text.lower()
            or "space" in resp.text.lower()
            or "numbers" in resp.text.lower()
        )

    async def test_step_2fa_threshold_valid(self, flow, mock_conversation_manager):
        state = _make_state("settings", "set_2fa_threshold", {"user_db_id": 1})
        session_mock = MagicMock()
        session_mock.__enter__ = MagicMock(return_value=session_mock)
        session_mock.__exit__ = MagicMock(return_value=False)
        user = MagicMock()
        us = MagicMock()
        session_mock.query.return_value.filter.return_value.first.side_effect = [user, us]
        with patch("database.db.get_session", return_value=session_mock):
            resp = await flow._step_set_2fa_threshold("u1", 1, "2000", state)
        assert "2,000" in resp.text or "2000" in resp.text

    async def test_step_2fa_threshold_negative(self, flow):
        state = _make_state("settings", "set_2fa_threshold", {"user_db_id": 1})
        resp = await flow._step_set_2fa_threshold("u1", 1, "-50", state)
        assert "valid" in resp.text.lower() or "non-negative" in resp.text.lower()

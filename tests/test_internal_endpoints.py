"""Tests for the internal agent API endpoints (api/routes/internal.py)."""

import pytest
import os
import json
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction, SwapStatus
from bot.models.agent import RegisteredAgent
from bot.services.swap_engine import SwapQuote
from bot.utils.exceptions import SwapError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db_session_mock(return_map=None):
    """Build a mock get_session context manager.

    ``return_map`` maps model class names to the object that
    ``session.query(Model).filter(...).first()`` should return.
    """
    return_map = return_map or {}

    mock_session = MagicMock()

    def smart_query(model):
        mock_query = MagicMock()
        mock_filter = MagicMock()
        name = model.__name__ if hasattr(model, "__name__") else str(model)
        mock_filter.first.return_value = return_map.get(name)
        mock_query.filter.return_value = mock_filter
        return mock_query

    mock_session.query.side_effect = smart_query

    mock_context = MagicMock()
    mock_context.__enter__ = MagicMock(return_value=mock_session)
    mock_context.__exit__ = MagicMock(return_value=None)
    mock_get_session = MagicMock(return_value=mock_context)
    return mock_get_session, mock_session


def _set_internal_key(key: str):
    """Patch the module-level INTERNAL_API_KEY."""
    return patch("api.routes.internal.INTERNAL_API_KEY", key)


# We import the FastAPI router and build a TestClient lazily so that
# the env-var patches take effect first.


def _get_test_client():
    """Build a FastAPI TestClient wrapping only the internal router."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.routes.internal import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Auth tests
# ---------------------------------------------------------------------------

class TestInternalAuth:
    """Tests for the X-Internal-Key authentication gate."""

    def test_missing_key_returns_422(self):
        """Missing X-Internal-Key header should return 422 (unprocessable)."""
        with _set_internal_key("secret123"):
            client = _get_test_client()
            resp = client.post(
                "/internal/agent/provision-wallet",
                json={"agent_uuid": "abc", "chain_type": "evm"},
            )
            # FastAPI returns 422 when a required Header is absent
            assert resp.status_code == 422

    def test_wrong_key_returns_403(self):
        """Invalid X-Internal-Key should return 403."""
        with _set_internal_key("secret123"):
            client = _get_test_client()
            resp = client.post(
                "/internal/agent/provision-wallet",
                json={"agent_uuid": "abc", "chain_type": "evm"},
                headers={"X-Internal-Key": "wrong_key"},
            )
            assert resp.status_code == 403

    def test_empty_configured_key_returns_500(self):
        """If INTERNAL_API_KEY is not configured, should return 500."""
        with _set_internal_key(""):
            client = _get_test_client()
            resp = client.post(
                "/internal/agent/provision-wallet",
                json={"agent_uuid": "abc", "chain_type": "evm"},
                headers={"X-Internal-Key": "anything"},
            )
            assert resp.status_code == 500


# ---------------------------------------------------------------------------
# Provision-wallet endpoint
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestProvisionWallet:
    """Tests for POST /internal/agent/provision-wallet."""

    async def test_provision_wallet_success(self):
        """Happy path: creates user + wallet and returns IDs."""
        mock_user = User(
            id=10,
            telegram_id=None,
            username="agent_test-uuid",
            created_at=datetime.utcnow(),
        )
        mock_wallet = Wallet(
            id=20,
            user_id=10,
            address="0xNewAgentWalletAddress",
            chain_type="evm",
            is_active=True,
        )

        mock_get_session, mock_session = _make_db_session_mock({
            "User": mock_user,
        })

        # Simulate session.flush assigning an id to newly-added wallet
        def add_side_effect(obj):
            if isinstance(obj, Wallet):
                obj.id = 20
                obj.address = "0xNewAgentWalletAddress"
            elif isinstance(obj, User):
                obj.id = 10
        mock_session.add.side_effect = add_side_effect

        # Mock Turnkey
        mock_sub_org = MagicMock()
        mock_sub_org.sub_org_id = "sub-org-123"

        mock_turnkey_wallet = MagicMock()
        mock_turnkey_wallet.address = "0xNewAgentWalletAddress"
        mock_turnkey_wallet.wallet_id = "tk-wallet-1"
        mock_turnkey_wallet.account_id = "tk-account-1"

        mock_turnkey = AsyncMock()
        mock_turnkey.create_sub_organization = AsyncMock(return_value=mock_sub_org)
        mock_turnkey.create_wallet = AsyncMock(return_value=mock_turnkey_wallet)

        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", True), \
             patch("api.routes.internal.get_session", mock_get_session), \
             patch("api.routes.internal.is_turnkey_configured", return_value=True), \
             patch("api.routes.internal.get_turnkey_client", return_value=mock_turnkey):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/provision-wallet",
                json={"agent_uuid": "test-uuid", "chain_type": "evm"},
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["internal_user_id"] == 10
        assert data["internal_wallet_id"] == 20
        assert data["wallet_address"] == "0xNewAgentWalletAddress"

        # Verify Turnkey was called
        mock_turnkey.create_sub_organization.assert_called_once()
        mock_turnkey.create_wallet.assert_called_once()

    async def test_provision_wallet_db_unavailable(self):
        """Should return 503 when database is not available."""
        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", False):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/provision-wallet",
                json={"agent_uuid": "test-uuid"},
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 503

    async def test_provision_wallet_turnkey_not_configured(self):
        """Should return 501 when Turnkey is not set up."""
        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", True), \
             patch("api.routes.internal.is_turnkey_configured", return_value=False):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/provision-wallet",
                json={"agent_uuid": "test-uuid"},
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 501


# ---------------------------------------------------------------------------
# Execute-swap endpoint
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
class TestExecuteSwap:
    """Tests for POST /internal/agent/execute-swap."""

    def _make_quote_data(self, **overrides):
        """Return a minimal valid quote_data dict."""
        data = {
            "provider": "lifi",
            "from_chain": "base",
            "to_chain": "base",
            "from_token": "ETH",
            "to_token": "USDC",
            "from_amount": "500000000000000000",
            "from_amount_human": 0.5,
            "to_amount": "1234560000",
            "to_amount_human": 1234.56,
            "to_amount_min": "1222220000",
            "gas_cost_usd": 0.5,
            "fee_cost_usd": 0.0,
            "total_cost_usd": 0.5,
            "estimated_time": 30,
            "price_impact": 0.01,
            "exchange_rate": 2469.12,
            "raw_quote": {},
        }
        data.update(overrides)
        return data

    def _make_request_body(self, **overrides):
        body = {
            "agent_id": 1,
            "agent_uuid": "aaaa-bbbb",
            "wallet_address": "0xWalletAddr",
            "internal_user_id": 10,
            "internal_wallet_id": 20,
            "chain_type": "evm",
            "idempotency_key": "test-idem-key",
            "quote_data": self._make_quote_data(),
        }
        body.update(overrides)
        return body

    async def test_execute_swap_success(self):
        """Happy path: swap engine returns a submitted transaction."""
        mock_swap_tx = MagicMock(spec=SwapTransaction)
        mock_swap_tx.id = 123
        mock_swap_tx.tx_hash = "0xdeadbeef"
        mock_swap_tx.status = SwapStatus.SUBMITTED.value
        mock_swap_tx.from_chain = "base"
        mock_swap_tx.from_token = "ETH"
        mock_swap_tx.from_amount = "500000000000000000"
        mock_swap_tx.to_chain = "base"
        mock_swap_tx.to_token = "USDC"
        mock_swap_tx.to_amount = "1234560000"
        mock_swap_tx.agent_id = None
        mock_swap_tx.agent_uuid = None

        mock_engine = MagicMock()
        mock_engine.execute_swap = AsyncMock(return_value=mock_swap_tx)

        mock_get_session, mock_session = _make_db_session_mock({
            "SwapTransaction": mock_swap_tx,
            "RegisteredAgent": None,
        })

        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", True), \
             patch("api.routes.internal.SwapEngine", return_value=mock_engine), \
             patch("api.routes.internal.get_session", mock_get_session):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/execute-swap",
                json=self._make_request_body(),
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["swap_id"] == 123
        assert data["tx_hash"] == "0xdeadbeef"
        assert data["status"] == "submitted"

        # Verify engine was called with correct params
        mock_engine.execute_swap.assert_called_once()
        call_kwargs = mock_engine.execute_swap.call_args.kwargs
        assert call_kwargs["wallet_id"] == 20
        assert call_kwargs["user_id"] == 10
        assert call_kwargs["idempotency_key"] == "test-idem-key"

        # Verify agent linkage was stamped
        assert mock_swap_tx.agent_id == 1
        assert mock_swap_tx.agent_uuid == "aaaa-bbbb"

    async def test_execute_swap_engine_error(self):
        """Test that a SwapError from the engine returns 400."""
        mock_engine = MagicMock()
        mock_engine.execute_swap = AsyncMock(
            side_effect=SwapError("Insufficient balance")
        )

        mock_get_session, _ = _make_db_session_mock()

        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", True), \
             patch("api.routes.internal.SwapEngine", return_value=mock_engine), \
             patch("api.routes.internal.get_session", mock_get_session):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/execute-swap",
                json=self._make_request_body(),
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 400
        assert "Insufficient balance" in resp.json()["detail"]

    async def test_execute_swap_invalid_quote_data(self):
        """Test that missing required fields in quote_data returns 400."""
        body = self._make_request_body(quote_data={"provider": "lifi"})

        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", True):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/execute-swap",
                json=body,
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 400
        assert "Invalid quote_data" in resp.json()["detail"]

    async def test_execute_swap_db_unavailable(self):
        """Should return 503 when database is not available."""
        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", False):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/execute-swap",
                json=self._make_request_body(),
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 503

    async def test_execute_swap_fires_submitted_webhook(self):
        """Test that a swap.submitted webhook is dispatched after successful execution."""
        mock_swap_tx = MagicMock(spec=SwapTransaction)
        mock_swap_tx.id = 42
        mock_swap_tx.tx_hash = "0xabc"
        mock_swap_tx.status = SwapStatus.SUBMITTED.value
        mock_swap_tx.from_chain = "base"
        mock_swap_tx.from_token = "ETH"
        mock_swap_tx.from_amount = "500000000000000000"
        mock_swap_tx.to_chain = "base"
        mock_swap_tx.to_token = "USDC"
        mock_swap_tx.to_amount = "1234560000"
        mock_swap_tx.agent_id = None
        mock_swap_tx.agent_uuid = None

        mock_engine = MagicMock()
        mock_engine.execute_swap = AsyncMock(return_value=mock_swap_tx)

        mock_agent = MagicMock(spec=RegisteredAgent)
        mock_agent.callback_url = "https://agent.example.com/webhook"
        mock_agent.id = 1

        mock_get_session, _ = _make_db_session_mock({
            "SwapTransaction": mock_swap_tx,
            "RegisteredAgent": mock_agent,
        })

        mock_dispatcher = AsyncMock()

        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", True), \
             patch("api.routes.internal.SwapEngine", return_value=mock_engine), \
             patch("api.routes.internal.get_session", mock_get_session), \
             patch("bot.services.webhook_dispatcher.webhook_dispatcher", mock_dispatcher):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/execute-swap",
                json=self._make_request_body(),
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 200

        # Verify webhook was dispatched
        mock_dispatcher.dispatch.assert_called_once()
        call_kwargs = mock_dispatcher.dispatch.call_args.kwargs
        assert call_kwargs["agent_id"] == 1
        assert call_kwargs["event_type"] == "swap.submitted"
        assert call_kwargs["callback_url"] == "https://agent.example.com/webhook"

        # Verify the payload is valid JSON with expected fields
        payload = json.loads(call_kwargs["payload"])
        assert payload["event"] == "swap.submitted"
        assert payload["data"]["swap_id"] == 42
        assert payload["data"]["tx_hash"] == "0xabc"

    async def test_execute_swap_no_webhook_when_no_callback_url(self):
        """No webhook should fire if the agent has no callback_url."""
        mock_swap_tx = MagicMock(spec=SwapTransaction)
        mock_swap_tx.id = 42
        mock_swap_tx.tx_hash = "0xabc"
        mock_swap_tx.status = SwapStatus.SUBMITTED.value
        mock_swap_tx.agent_id = None
        mock_swap_tx.agent_uuid = None

        mock_engine = MagicMock()
        mock_engine.execute_swap = AsyncMock(return_value=mock_swap_tx)

        mock_agent = MagicMock(spec=RegisteredAgent)
        mock_agent.callback_url = None
        mock_agent.id = 1

        mock_get_session, _ = _make_db_session_mock({
            "SwapTransaction": mock_swap_tx,
            "RegisteredAgent": mock_agent,
        })

        mock_dispatcher = AsyncMock()

        with _set_internal_key("secret123"), \
             patch("api.routes.internal.DATABASE_AVAILABLE", True), \
             patch("api.routes.internal.SwapEngine", return_value=mock_engine), \
             patch("api.routes.internal.get_session", mock_get_session), \
             patch("bot.services.webhook_dispatcher.webhook_dispatcher", mock_dispatcher):

            client = _get_test_client()
            resp = client.post(
                "/internal/agent/execute-swap",
                json=self._make_request_body(),
                headers={"X-Internal-Key": "secret123"},
            )

        assert resp.status_code == 200
        mock_dispatcher.dispatch.assert_not_called()


# ---------------------------------------------------------------------------
# SwapTransaction agent columns
# ---------------------------------------------------------------------------

class TestSwapTransactionAgentColumns:
    """Verify the new agent_id / agent_uuid columns on SwapTransaction."""

    def test_agent_columns_exist(self):
        """SwapTransaction should have agent_id and agent_uuid attributes."""
        tx = SwapTransaction()
        assert hasattr(tx, "agent_id")
        assert hasattr(tx, "agent_uuid")

    def test_agent_columns_default_to_none(self):
        """Agent columns should be None by default (non-agent swaps)."""
        tx = SwapTransaction()
        assert tx.agent_id is None
        assert tx.agent_uuid is None

    def test_agent_columns_can_be_set(self):
        """Agent columns should be settable."""
        tx = SwapTransaction()
        tx.agent_id = 42
        tx.agent_uuid = "aaaa-bbbb-cccc"
        assert tx.agent_id == 42
        assert tx.agent_uuid == "aaaa-bbbb-cccc"

"""Bot-side smart-account integration: api-ts client method + /sa handler.

The on-chain derivation lives in api-ts (permissionless.js); these tests cover
the Python bot's plumbing — the HTTP call shape and the read-only /sa command —
with the api-ts call mocked.
"""

import os
from unittest.mock import AsyncMock, MagicMock

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from database.db import get_session, init_db
from bot.models.user import User, Wallet
from bot.services.api_client import api_client
import bot.handlers.smart_account as sa

SA_ADDR = "0x35b96a60a485Ae03226b37B73bBA1eeaC827abC4"
OWNER = "0x6456f69215C470e1545Ed6eea4621C136B30D85d"


@pytest.fixture()
def sqlite_db(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'sa.db'}")
    yield


def _add_user_with_wallets(telegram_id=111):
    with get_session() as session:
        user = User(id=1, telegram_id=telegram_id, username="alice")
        session.add(user)
        session.flush()
        # A non-default EVM wallet and a default EVM wallet (default must win).
        session.add(
            Wallet(
                user_id=user.id,
                name="Hot 1",
                address="0x1111111111111111111111111111111111111111",
                chain_type="evm",
                is_active=True,
                is_default=False,
            )
        )
        session.add(
            Wallet(
                user_id=user.id,
                name="Main",
                address=OWNER,
                chain_type="evm",
                is_active=True,
                is_default=True,
            )
        )
        # A Solana wallet that must never be picked.
        session.add(
            Wallet(
                user_id=user.id,
                name="Sol",
                address="SoLwallet1111111111111111111111111111111111",
                chain_type="solana",
                is_active=True,
                is_default=False,
            )
        )


# ── api-ts client method ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_predict_smart_account_calls_correct_endpoint(monkeypatch):
    captured = {}

    async def fake_request(method, path, params=None, json_data=None):
        captured.update(method=method, path=path, json_data=json_data)
        return {
            "chain_id": 8453,
            "owner": OWNER,
            "smart_account_address": SA_ADDR,
            "is_deployed": False,
        }

    monkeypatch.setattr(api_client, "_request", fake_request)

    res = await api_client.predict_smart_account(8453, OWNER)

    assert captured["method"] == "POST"
    assert captured["path"] == "/v1/smart-account/predict"
    assert captured["json_data"] == {"chainId": 8453, "owner": OWNER}
    assert res["smart_account_address"] == SA_ADDR


# ── wallet resolution ───────────────────────────────────────────────────────


def test_default_evm_wallet_prefers_default(sqlite_db):
    _add_user_with_wallets()
    result = sa._get_default_evm_wallet(111)
    assert result == ("Main", OWNER)


def test_default_evm_wallet_none_when_no_evm(sqlite_db):
    with get_session() as session:
        user = User(id=1, telegram_id=222, username="bob")
        session.add(user)
        session.flush()
        session.add(
            Wallet(
                user_id=user.id,
                name="Sol",
                address="SoLwallet1111111111111111111111111111111111",
                chain_type="solana",
                is_active=True,
                is_default=True,
            )
        )
    assert sa._get_default_evm_wallet(222) is None


# ── /sa command handler ─────────────────────────────────────────────────────


def _fake_update(telegram_id=111):
    update = MagicMock()
    update.effective_user = MagicMock()
    update.effective_user.id = telegram_id
    update.message = MagicMock()
    update.message.reply_text = AsyncMock()
    return update


@pytest.mark.asyncio
async def test_sa_command_renders_smart_account(sqlite_db, monkeypatch):
    _add_user_with_wallets()
    predict = AsyncMock(return_value={"smart_account_address": SA_ADDR, "is_deployed": False})
    monkeypatch.setattr(api_client, "predict_smart_account", predict)

    update = _fake_update(111)
    context = MagicMock()
    context.user_data = {}

    await sa.smart_account_command(update, context)

    # Predicted on the default chain (Base) using the default wallet's address.
    predict.assert_awaited_once_with(sa.DEFAULT_SA_CHAIN_ID, OWNER)
    update.message.reply_text.assert_awaited_once()
    sent_text = update.message.reply_text.call_args.args[0]
    assert SA_ADDR in sent_text
    assert "Base" in sent_text
    # Wallet is cached for the chain-switch callback.
    assert context.user_data["sa_wallet"]["address"] == OWNER


@pytest.mark.asyncio
async def test_sa_command_without_evm_wallet_prompts(sqlite_db, monkeypatch):
    with get_session() as session:
        session.add(User(id=1, telegram_id=333, username="carol"))
    monkeypatch.setattr(api_client, "predict_smart_account", AsyncMock())

    update = _fake_update(333)
    context = MagicMock()
    context.user_data = {}

    await sa.smart_account_command(update, context)

    sent_text = update.message.reply_text.call_args.args[0]
    assert "EVM wallet" in sent_text


@pytest.mark.asyncio
async def test_sa_chain_callback_reprices_for_new_chain(sqlite_db, monkeypatch):
    _add_user_with_wallets()
    predict = AsyncMock(return_value={"smart_account_address": SA_ADDR, "is_deployed": True})
    monkeypatch.setattr(api_client, "predict_smart_account", predict)

    query = MagicMock()
    query.data = "sa_chain_42161"  # Arbitrum
    query.answer = AsyncMock()
    query.edit_message_text = AsyncMock()
    update = MagicMock()
    update.callback_query = query
    update.effective_user = MagicMock(id=111)
    context = MagicMock()
    context.user_data = {"sa_wallet": {"name": "Main", "address": OWNER}}

    await sa.smart_account_chain_callback(update, context)

    predict.assert_awaited_once_with(42161, OWNER)
    text = query.edit_message_text.call_args.args[0]
    assert "Arbitrum" in text
    assert "Deployed" in text

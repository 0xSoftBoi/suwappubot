"""Tests for bot/services/tx_poller.py — transaction confirmation polling.

Covers:
  * Per-chain status checks (EVM / Solana / Li.Fi cross-chain) mapping raw RPC
    responses to SwapStatus values, with mocked HTTP (no live RPC).
  * `_apply_status_update`: pending -> confirmed/failed DB transitions,
    idempotency on already-terminal rows, missing-row no-op, and that a DB
    exception during the write is caught and logged (not raised).
  * `_check_pending_transactions`: the poll loop survives an exception thrown
    while checking one transaction and still applies the update for the next.
"""

import logging
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

from database.db import get_session, init_db  # noqa: E402
from bot.models.swap import SwapStatus, SwapTransaction  # noqa: E402
from bot.models.user import User  # noqa: E402
from bot.services.tx_poller import TransactionPoller  # noqa: E402


@pytest.fixture()
def sqlite_db(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'tx-poller.db'}"
    assert init_db(database_url)
    yield


@pytest.fixture()
def poller():
    return TransactionPoller()


def _make_user(session) -> int:
    user = User(telegram_id=555111, username="poller_test")
    session.add(user)
    session.flush()
    return user.id


def _make_tx(session, user_id, **overrides) -> int:
    defaults = dict(
        user_id=user_id,
        from_chain="ethereum",
        from_token="USDC",
        from_amount="1000000",
        to_chain="ethereum",
        to_token="WETH",
        to_amount="500000000000000",
        status=SwapStatus.SUBMITTED.value,
        tx_hash="0x" + "ab" * 32,
        created_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    tx = SwapTransaction(**defaults)
    session.add(tx)
    session.flush()
    return tx.id


class FakeResponse:
    def __init__(self, body: dict, status: int = 200):
        self._body = body
        self.status = status

    async def json(self):
        return self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False


class FakeHttpSession:
    def __init__(self, response: FakeResponse):
        self._response = response

    def post(self, url, json=None):
        return self._response


def _patch_http(monkeypatch, response: FakeResponse):
    async def fake_get_session():
        return FakeHttpSession(response)

    monkeypatch.setattr("bot.services.tx_poller.get_session", fake_get_session)


# ---------------------------------------------------------------------------
# _check_evm_tx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_evm_tx_success_status_completed(poller, monkeypatch):
    _patch_http(monkeypatch, FakeResponse({"result": {"status": "0x1"}}))
    status = await poller._check_evm_tx("0xabc", "https://rpc.example")
    assert status == SwapStatus.COMPLETED.value


@pytest.mark.asyncio
async def test_check_evm_tx_reverted_status_failed(poller, monkeypatch):
    _patch_http(monkeypatch, FakeResponse({"result": {"status": "0x0"}}))
    status = await poller._check_evm_tx("0xabc", "https://rpc.example")
    assert status == SwapStatus.FAILED.value


@pytest.mark.asyncio
async def test_check_evm_tx_not_yet_mined_stays_submitted(poller, monkeypatch):
    _patch_http(monkeypatch, FakeResponse({"result": None}))
    status = await poller._check_evm_tx("0xabc", "https://rpc.example")
    assert status == SwapStatus.SUBMITTED.value


@pytest.mark.asyncio
async def test_check_evm_tx_http_error_returns_none(poller, monkeypatch):
    _patch_http(monkeypatch, FakeResponse({}, status=500))
    status = await poller._check_evm_tx("0xabc", "https://rpc.example")
    assert status is None


@pytest.mark.asyncio
async def test_check_evm_tx_exception_is_caught_and_returns_none(poller, monkeypatch):
    async def raising_get_session():
        raise ConnectionError("RPC unreachable")

    monkeypatch.setattr("bot.services.tx_poller.get_session", raising_get_session)
    status = await poller._check_evm_tx("0xabc", "https://rpc.example")
    assert status is None


# ---------------------------------------------------------------------------
# _check_solana_tx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_solana_tx_confirmed(poller, monkeypatch):
    body = {"result": {"value": [{"err": None, "confirmations": None}]}}
    _patch_http(monkeypatch, FakeResponse(body))
    status = await poller._check_solana_tx("sig123")
    assert status == SwapStatus.COMPLETED.value


@pytest.mark.asyncio
async def test_check_solana_tx_still_confirming(poller, monkeypatch):
    body = {"result": {"value": [{"err": None, "confirmations": 3}]}}
    _patch_http(monkeypatch, FakeResponse(body))
    status = await poller._check_solana_tx("sig123")
    assert status == SwapStatus.SUBMITTED.value


@pytest.mark.asyncio
async def test_check_solana_tx_failed(poller, monkeypatch):
    body = {"result": {"value": [{"err": {"InstructionError": [0, "Custom"]}}]}}
    _patch_http(monkeypatch, FakeResponse(body))
    status = await poller._check_solana_tx("sig123")
    assert status == SwapStatus.FAILED.value


@pytest.mark.asyncio
async def test_check_solana_tx_not_found_stays_submitted(poller, monkeypatch):
    body = {"result": {"value": [None]}}
    _patch_http(monkeypatch, FakeResponse(body))
    status = await poller._check_solana_tx("sig123")
    assert status == SwapStatus.SUBMITTED.value


# ---------------------------------------------------------------------------
# _check_lifi_status_dict (cross-chain)
# ---------------------------------------------------------------------------


class _FakeLiFiStatus:
    def __init__(self, status, receiving_tx_hash=None):
        self.status = status
        self.receiving_tx_hash = receiving_tx_hash


@pytest.mark.asyncio
async def test_check_lifi_status_done_returns_completed_with_dest_hash(poller, monkeypatch):
    async def fake_get_status(**kwargs):
        return _FakeLiFiStatus("DONE", receiving_tx_hash="0xdest")

    monkeypatch.setattr(poller._lifi, "get_status", fake_get_status)

    status, dest_hash = await poller._check_lifi_status_dict(
        {"tx_hash": "0xsrc", "from_chain": "ethereum", "to_chain": "base"}
    )
    assert status == SwapStatus.COMPLETED.value
    assert dest_hash == "0xdest"


@pytest.mark.asyncio
async def test_check_lifi_status_failed(poller, monkeypatch):
    async def fake_get_status(**kwargs):
        return _FakeLiFiStatus("FAILED")

    monkeypatch.setattr(poller._lifi, "get_status", fake_get_status)

    status, dest_hash = await poller._check_lifi_status_dict(
        {"tx_hash": "0xsrc", "from_chain": "ethereum", "to_chain": "base"}
    )
    assert status == SwapStatus.FAILED.value
    assert dest_hash is None


@pytest.mark.asyncio
async def test_check_lifi_status_pending_maps_to_confirming(poller, monkeypatch):
    async def fake_get_status(**kwargs):
        return _FakeLiFiStatus("PENDING")

    monkeypatch.setattr(poller._lifi, "get_status", fake_get_status)

    status, _ = await poller._check_lifi_status_dict(
        {"tx_hash": "0xsrc", "from_chain": "ethereum", "to_chain": "base"}
    )
    assert status == SwapStatus.CONFIRMING.value


@pytest.mark.asyncio
async def test_check_lifi_status_exception_returns_none(poller, monkeypatch):
    async def raising_get_status(**kwargs):
        raise RuntimeError("Li.Fi API down")

    monkeypatch.setattr(poller._lifi, "get_status", raising_get_status)

    status, dest_hash = await poller._check_lifi_status_dict(
        {"tx_hash": "0xsrc", "from_chain": "ethereum", "to_chain": "base"}
    )
    assert status is None
    assert dest_hash is None


# ---------------------------------------------------------------------------
# _apply_status_update — DB state transitions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_apply_status_update_pending_to_completed(poller, sqlite_db):
    with get_session() as session:
        user_id = _make_user(session)
        tx_id = _make_tx(session, user_id, status=SwapStatus.SUBMITTED.value)

    await poller._apply_status_update(
        {
            "id": tx_id,
            "status": SwapStatus.SUBMITTED.value,
            "user_id": user_id,
            "from_token": "USDC",
            "to_token": "WETH",
            "from_chain": "ethereum",
            "to_chain": "ethereum",
            "from_amount": "1000000",
            "error_message": None,
            "tx_hash": "0x" + "ab" * 32,
        },
        SwapStatus.COMPLETED.value,
    )

    with get_session() as session:
        tx = session.query(SwapTransaction).filter(SwapTransaction.id == tx_id).first()
        assert tx.status == SwapStatus.COMPLETED.value
        assert tx.completed_at is not None


@pytest.mark.asyncio
async def test_apply_status_update_records_dest_tx_hash(poller, sqlite_db):
    with get_session() as session:
        user_id = _make_user(session)
        tx_id = _make_tx(session, user_id, from_chain="ethereum", to_chain="base")

    await poller._apply_status_update(
        {
            "id": tx_id,
            "status": SwapStatus.SUBMITTED.value,
            "user_id": user_id,
            "from_token": "USDC",
            "to_token": "WETH",
            "from_chain": "ethereum",
            "to_chain": "base",
            "from_amount": "1000000",
            "error_message": None,
            "tx_hash": "0xsrc",
        },
        SwapStatus.COMPLETED.value,
        dest_tx_hash="0xdest",
    )

    with get_session() as session:
        tx = session.query(SwapTransaction).filter(SwapTransaction.id == tx_id).first()
        assert tx.destination_tx_hash == "0xdest"


@pytest.mark.asyncio
async def test_apply_status_update_skips_already_terminal_row(poller, sqlite_db):
    """A tx already COMPLETED (e.g. by a racing ws watcher) must not be
    re-applied/double-notified."""
    with get_session() as session:
        user_id = _make_user(session)
        tx_id = _make_tx(session, user_id, status=SwapStatus.COMPLETED.value)

    await poller._apply_status_update(
        {
            "id": tx_id,
            "status": SwapStatus.SUBMITTED.value,
            "user_id": user_id,
            "from_token": "USDC",
            "to_token": "WETH",
            "from_chain": "ethereum",
            "to_chain": "ethereum",
            "from_amount": "1000000",
            "error_message": None,
            "tx_hash": "0xsrc",
        },
        SwapStatus.FAILED.value,  # would be a nonsensical downgrade — must be ignored
    )

    with get_session() as session:
        tx = session.query(SwapTransaction).filter(SwapTransaction.id == tx_id).first()
        assert tx.status == SwapStatus.COMPLETED.value  # unchanged


@pytest.mark.asyncio
async def test_apply_status_update_missing_row_is_noop(poller, sqlite_db):
    # Should not raise even though no such tx id exists.
    await poller._apply_status_update(
        {
            "id": 999999,
            "status": SwapStatus.SUBMITTED.value,
            "user_id": 1,
            "from_token": "USDC",
            "to_token": "WETH",
            "from_chain": "ethereum",
            "to_chain": "ethereum",
            "from_amount": "1000000",
            "error_message": None,
            "tx_hash": "0xsrc",
        },
        SwapStatus.COMPLETED.value,
    )


@pytest.mark.asyncio
async def test_apply_status_update_db_exception_is_caught_and_logged(
    poller, sqlite_db, monkeypatch, caplog
):
    def raising_get_db_session(*args, **kwargs):
        raise RuntimeError("DB connection pool exhausted")

    monkeypatch.setattr("bot.services.tx_poller.get_db_session", raising_get_db_session)

    with caplog.at_level(logging.ERROR, logger="bot.services.tx_poller"):
        await poller._apply_status_update(
            {
                "id": 1,
                "status": SwapStatus.SUBMITTED.value,
                "user_id": 1,
                "from_token": "USDC",
                "to_token": "WETH",
                "from_chain": "ethereum",
                "to_chain": "ethereum",
                "from_amount": "1000000",
                "error_message": None,
                "tx_hash": "0xsrc",
            },
            SwapStatus.COMPLETED.value,
        )  # must not raise

    assert any("Error writing tx" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# _check_pending_transactions — the full poll cycle survives per-tx errors
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_pending_transactions_survives_exception_on_one_tx(
    poller, sqlite_db, monkeypatch, caplog
):
    with get_session() as session:
        user_id = _make_user(session)
        broken_tx_id = _make_tx(
            session,
            user_id,
            created_at=datetime.now(timezone.utc) - timedelta(hours=1),
            tx_hash="0xbroken",
        )
        good_tx_id = _make_tx(
            session,
            user_id,
            created_at=datetime.now(timezone.utc) - timedelta(hours=1),
            tx_hash="0xgood",
        )

    async def fake_check_tx_status_dict(tx_dict):
        if tx_dict["id"] == broken_tx_id:
            raise ConnectionError("RPC timeout")
        return SwapStatus.COMPLETED.value, None

    monkeypatch.setattr(poller, "_check_tx_status_dict", fake_check_tx_status_dict)
    # Skip websocket watcher spin-up entirely for this test.
    monkeypatch.setattr(poller, "_maybe_start_ws_watcher", lambda tx_dict: None)

    with caplog.at_level(logging.ERROR, logger="bot.services.tx_poller"):
        result = await poller._check_pending_transactions()  # must not raise

    assert isinstance(result, bool)
    assert any(f"Error checking tx {broken_tx_id}" in r.message for r in caplog.records)

    with get_session() as session:
        broken = session.query(SwapTransaction).filter(SwapTransaction.id == broken_tx_id).first()
        good = session.query(SwapTransaction).filter(SwapTransaction.id == good_tx_id).first()
        assert broken.status == SwapStatus.SUBMITTED.value  # untouched after the error
        assert good.status == SwapStatus.COMPLETED.value  # still applied


@pytest.mark.asyncio
async def test_check_pending_transactions_no_pending_returns_false(poller, sqlite_db):
    result = await poller._check_pending_transactions()
    assert result is False


@pytest.mark.asyncio
async def test_check_pending_transactions_fast_poll_hint_for_recent_tx(
    poller, sqlite_db, monkeypatch
):
    with get_session() as session:
        user_id = _make_user(session)
        _make_tx(session, user_id, created_at=datetime.now(timezone.utc))  # just submitted

    async def fake_check_tx_status_dict(tx_dict):
        return None, None  # no change

    monkeypatch.setattr(poller, "_check_tx_status_dict", fake_check_tx_status_dict)
    monkeypatch.setattr(poller, "_maybe_start_ws_watcher", lambda tx_dict: None)

    result = await poller._check_pending_transactions()
    assert result is True  # fresh tx -> fast-poll hint

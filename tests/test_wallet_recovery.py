"""Tests for bot/services/wallet_recovery.py — Turnkey email recovery flow.

Covers the happy path and failure paths for all three stages:
  1. setup_email_recovery  — link a recovery email to a Turnkey wallet
  2. initiate_recovery     — look up by email, kick off Turnkey's recovery
  3. complete_recovery     — finish recovery with the new authenticator

Turnkey itself is fully mocked (no network); the DB uses a real isolated
sqlite instance so the User/Wallet lookup queries are exercised for real.
"""

import os
from datetime import datetime, timezone
from unittest.mock import AsyncMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest

from database.db import get_session, init_db
from bot.models.user import User, Wallet
from bot.services.wallet_recovery import WalletRecoveryService


@pytest.fixture()
def sqlite_db(tmp_path):
    database_url = f"sqlite:///{tmp_path / 'wallet-recovery.db'}"
    assert init_db(database_url)
    yield


@pytest.fixture()
def service():
    svc = WalletRecoveryService()
    svc._turnkey_client = AsyncMock()  # bypass the lazy get_turnkey_client() import
    return svc


def _make_user_with_turnkey_wallet(
    session, telegram_id=777001, recovery_email=None, sub_org_id="sub-org-1"
):
    user = User(telegram_id=telegram_id, username="recovery_test", recovery_email=recovery_email)
    session.add(user)
    session.flush()
    wallet = Wallet(
        user_id=user.id,
        address="0x" + "cd" * 20,
        chain_type="evm",
        wallet_provider="turnkey",
        turnkey_sub_org_id=sub_org_id,
        is_active=True,
    )
    session.add(wallet)
    session.flush()
    return user.id


# ---------------------------------------------------------------------------
# setup_email_recovery
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_setup_email_recovery_success(service, sqlite_db):
    with get_session() as session:
        _make_user_with_turnkey_wallet(session, telegram_id=1001)

    ok = await service.setup_email_recovery(1001, "user@example.com")
    assert ok is True

    with get_session() as session:
        user = session.query(User).filter(User.telegram_id == 1001).first()
        assert user.recovery_email == "user@example.com"
        assert user.recovery_setup_at is not None


@pytest.mark.asyncio
async def test_setup_email_recovery_user_not_found(service, sqlite_db):
    ok = await service.setup_email_recovery(99999, "nope@example.com")
    assert ok is False


@pytest.mark.asyncio
async def test_setup_email_recovery_no_turnkey_wallet(service, sqlite_db):
    with get_session() as session:
        user = User(telegram_id=1002, username="no_wallet")
        session.add(user)
        session.flush()
        # Non-turnkey wallet only.
        session.add(
            Wallet(
                user_id=user.id,
                address="0x" + "ab" * 20,
                chain_type="evm",
                wallet_provider="local",
                is_active=True,
            )
        )

    ok = await service.setup_email_recovery(1002, "user@example.com")
    assert ok is False


# ---------------------------------------------------------------------------
# initiate_recovery
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_initiate_recovery_success(service, sqlite_db):
    with get_session() as session:
        _make_user_with_turnkey_wallet(
            session,
            telegram_id=2001,
            recovery_email="recover@example.com",
            sub_org_id="sub-org-abc",
        )

    service._turnkey_client.init_email_recovery = AsyncMock(return_value="recovery-user-123")

    result = await service.initiate_recovery("recover@example.com", "pubkey-new-device")

    assert result == "recovery-user-123"
    service._turnkey_client.init_email_recovery.assert_awaited_once_with(
        email="recover@example.com",
        target_public_key="pubkey-new-device",
        organization_id="sub-org-abc",
    )


@pytest.mark.asyncio
async def test_initiate_recovery_no_user_with_email_returns_none(service, sqlite_db):
    result = await service.initiate_recovery("unknown@example.com", "pubkey")
    assert result is None
    service._turnkey_client.init_email_recovery.assert_not_called()


@pytest.mark.asyncio
async def test_initiate_recovery_no_turnkey_wallet_returns_none(service, sqlite_db):
    with get_session() as session:
        user = User(telegram_id=2002, username="no_tk", recovery_email="recover2@example.com")
        session.add(user)

    result = await service.initiate_recovery("recover2@example.com", "pubkey")
    assert result is None
    service._turnkey_client.init_email_recovery.assert_not_called()


@pytest.mark.asyncio
async def test_initiate_recovery_turnkey_failure_returns_none_not_raised(service, sqlite_db):
    """Documents current (silent-failure) behavior: a Turnkey outage during
    recovery init is swallowed and surfaces to the caller as a plain None,
    indistinguishable from "email not found". This is a UX/observability gap
    worth flagging — see final report."""
    with get_session() as session:
        _make_user_with_turnkey_wallet(
            session,
            telegram_id=2003,
            recovery_email="recover3@example.com",
            sub_org_id="sub-org-xyz",
        )

    service._turnkey_client.init_email_recovery = AsyncMock(
        side_effect=RuntimeError("Turnkey API down")
    )

    result = await service.initiate_recovery("recover3@example.com", "pubkey")
    assert result is None  # swallowed, not raised


# ---------------------------------------------------------------------------
# complete_recovery
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_complete_recovery_success(service, sqlite_db):
    with get_session() as session:
        user_id = _make_user_with_turnkey_wallet(
            session,
            telegram_id=3001,
            recovery_email="complete@example.com",
            sub_org_id="sub-org-complete",
        )

    service._turnkey_client.recover_user = AsyncMock(return_value="new-auth-id-1")

    ok = await service.complete_recovery(
        "complete@example.com", {"type": "passkey", "id": "cred-1"}, new_telegram_id="9999999"
    )

    assert ok is True
    service._turnkey_client.recover_user.assert_awaited_once_with(
        authenticator={"type": "passkey", "id": "cred-1"},
        organization_id="sub-org-complete",
    )
    with get_session() as session:
        user = session.query(User).filter(User.id == user_id).first()
        assert str(user.telegram_id) == "9999999"


@pytest.mark.asyncio
async def test_complete_recovery_no_user_returns_false(service, sqlite_db):
    ok = await service.complete_recovery("unknown@example.com", {"type": "passkey"})
    assert ok is False


@pytest.mark.asyncio
async def test_complete_recovery_no_turnkey_wallet_returns_false(service, sqlite_db):
    with get_session() as session:
        user = User(telegram_id=3002, username="no_tk2", recovery_email="notk@example.com")
        session.add(user)

    ok = await service.complete_recovery("notk@example.com", {"type": "passkey"})
    assert ok is False


@pytest.mark.asyncio
async def test_complete_recovery_no_auth_id_returned_is_failure(service, sqlite_db):
    with get_session() as session:
        _make_user_with_turnkey_wallet(
            session,
            telegram_id=3003,
            recovery_email="noauth@example.com",
            sub_org_id="sub-org-noauth",
        )

    service._turnkey_client.recover_user = AsyncMock(return_value=None)

    ok = await service.complete_recovery("noauth@example.com", {"type": "passkey"})
    assert ok is False


@pytest.mark.asyncio
async def test_complete_recovery_turnkey_exception_returns_false_not_raised(service, sqlite_db):
    """Same silent-failure pattern as initiate_recovery — documented, not fixed."""
    with get_session() as session:
        _make_user_with_turnkey_wallet(
            session, telegram_id=3004, recovery_email="boom@example.com", sub_org_id="sub-org-boom"
        )

    service._turnkey_client.recover_user = AsyncMock(side_effect=RuntimeError("Turnkey down"))

    ok = await service.complete_recovery("boom@example.com", {"type": "passkey"})
    assert ok is False


# ---------------------------------------------------------------------------
# get_recovery_status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_recovery_status_user_not_found(service, sqlite_db):
    status = await service.get_recovery_status(555001)
    assert status == {"has_recovery": False}


@pytest.mark.asyncio
async def test_get_recovery_status_no_recovery_set_up(service, sqlite_db):
    with get_session() as session:
        session.add(User(telegram_id=555002, username="norecovery"))

    status = await service.get_recovery_status(555002)
    assert status["has_recovery"] is False
    assert status["recovery_email"] is None
    assert status["has_turnkey_wallet"] is False


@pytest.mark.asyncio
async def test_get_recovery_status_with_recovery_and_turnkey_wallet(service, sqlite_db):
    with get_session() as session:
        _make_user_with_turnkey_wallet(
            session,
            telegram_id=555003,
            recovery_email="status@example.com",
            sub_org_id="sub-org-status",
        )
        user = session.query(User).filter(User.telegram_id == 555003).first()
        user.recovery_setup_at = datetime.now(timezone.utc)

    status = await service.get_recovery_status(555003)
    assert status["has_recovery"] is True
    assert status["recovery_email"] == "status@example.com"
    assert status["has_turnkey_wallet"] is True
    assert status["setup_at"] is not None

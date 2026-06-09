"""Tests for bot/services/wallet.py — WalletService.

Covers: wallet creation, encryption-at-rest, private key access, model
properties, and signing error paths.  All external deps (KMS, RPC, DB
encryption helpers) are monkeypatched so no real network or key-management
calls are made.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

from database.db import get_session  # noqa: E402
from bot.models.user import User, Wallet  # noqa: E402
from bot.services.wallet import WalletService  # noqa: E402
from bot.config.settings import settings as app_settings  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_user(session, uid=1):
    u = User(id=uid, telegram_id=uid * 100, username=f"user{uid}")
    session.add(u)
    session.flush()
    return u


def _make_local_wallet(session, user_id, chain_type="evm", is_default=False, address=None):
    """Insert a minimal local wallet row directly (bypasses encryption)."""
    w = Wallet(
        user_id=user_id,
        address=address or "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        encrypted_private_key="fernet_encrypted_pk",
        encryption_scheme="legacy_fernet_v1",
        chain_type=chain_type,
        wallet_provider="local",
        name="Test Wallet",
        is_default=is_default,
    )
    session.add(w)
    session.flush()
    return w


def _make_turnkey_wallet(session, user_id):
    w = Wallet(
        user_id=user_id,
        address="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
        encrypted_private_key=None,
        encryption_scheme="turnkey",
        chain_type="evm",
        wallet_provider="turnkey",
        name="Turnkey Wallet",
    )
    session.add(w)
    session.flush()
    return w


# ---------------------------------------------------------------------------
# Wallet creation
# ---------------------------------------------------------------------------


def test_create_evm_wallet_returns_valid_address():
    """create_evm_wallet() must return a checksummed 0x address + hex private key."""
    svc = WalletService()
    address, pk = svc.create_evm_wallet()
    assert address.startswith("0x")
    assert len(address) == 42
    assert len(pk) in (64, 66)  # 64 hex chars or 0x-prefixed


def test_create_evm_wallet_address_derived_from_private_key():
    """The returned address must match what eth_account derives from the key."""
    from eth_account import Account

    svc = WalletService()
    address, pk = svc.create_evm_wallet()
    derived = Account.from_key(pk if pk.startswith("0x") else "0x" + pk).address
    assert derived.lower() == address.lower()


# ---------------------------------------------------------------------------
# save_wallet — encryption at rest
# ---------------------------------------------------------------------------


def test_save_wallet_stores_encrypted_not_plaintext(tmp_db, monkeypatch):
    """Private key must never be stored in plaintext."""
    monkeypatch.setattr(
        "bot.services.wallet.encrypt_private_key",
        lambda pk, key: "ENCRYPTED_SENTINEL",
    )
    monkeypatch.setattr(
        app_settings, "wallet_encryption_scheme", "legacy_fernet_v1"
    )
    with get_session() as session:
        _make_user(session)

    svc = WalletService()
    raw_pk = "0xdeadbeef" + "0" * 56
    wallet = svc.save_wallet(1, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", raw_pk, "evm")

    assert wallet.encrypted_private_key == "ENCRYPTED_SENTINEL"
    assert wallet.encrypted_private_key != raw_pk


def test_save_wallet_unsets_other_defaults_for_same_chain(tmp_db, monkeypatch):
    """Setting is_default=True must demote the previous default of the same chain."""
    monkeypatch.setattr(
        "bot.services.wallet.encrypt_private_key",
        lambda pk, key: "ENCRYPTED",
    )
    monkeypatch.setattr(
        app_settings, "wallet_encryption_scheme", "legacy_fernet_v1"
    )
    with get_session() as session:
        _make_user(session)

    svc = WalletService()
    first = svc.save_wallet(1, "0x" + "a" * 40, "0xpk1", "evm", is_default=True)
    second = svc.save_wallet(1, "0x" + "b" * 40, "0xpk2", "evm", is_default=True)

    with get_session() as session:
        w1 = session.query(Wallet).filter(Wallet.id == first.id).first()
        w2 = session.query(Wallet).filter(Wallet.id == second.id).first()
        assert w1.is_default is False
        assert w2.is_default is True


# ---------------------------------------------------------------------------
# Wallet model properties
# ---------------------------------------------------------------------------


def test_wallet_is_turnkey_property(tmp_db):
    with get_session() as session:
        _make_user(session)
        w = _make_turnkey_wallet(session, 1)
        assert w.is_turnkey_wallet is True
        assert w.is_local_wallet is False


def test_wallet_is_local_property(tmp_db):
    with get_session() as session:
        _make_user(session)
        w = _make_local_wallet(session, 1)
        assert w.is_local_wallet is True
        assert w.is_turnkey_wallet is False


# ---------------------------------------------------------------------------
# get_private_key
# ---------------------------------------------------------------------------


def test_get_private_key_raises_for_turnkey_wallet(tmp_db):
    """Turnkey wallets have no local key — must raise ValueError."""
    with get_session() as session:
        _make_user(session)
        w = _make_turnkey_wallet(session, 1)

    svc = WalletService()
    with pytest.raises(ValueError, match="Turnkey"):
        svc.get_private_key(w)


def test_get_private_key_decrypts_legacy_scheme(tmp_db, monkeypatch):
    """get_private_key returns the plaintext key after decryption."""
    monkeypatch.setattr(
        "bot.services.wallet.get_private_key_with_auto_migrate",
        lambda wallet_row, session, auto_migrate: "decrypted_pk",
    )
    with get_session() as session:
        _make_user(session)
        w = _make_local_wallet(session, 1)

    svc = WalletService()
    result = svc.get_private_key(w, auto_migrate=False)
    assert result == "decrypted_pk"


# ---------------------------------------------------------------------------
# Signing error paths
# ---------------------------------------------------------------------------


def test_sign_evm_local_zeroizes_key_even_on_exception(tmp_db, monkeypatch):
    """_zeroize_str must be called on the private key even if signing raises."""
    zeroize_calls = []
    monkeypatch.setattr(
        "bot.services.wallet._zeroize_str",
        lambda s: zeroize_calls.append(s),
    )
    monkeypatch.setattr(
        "bot.services.wallet.get_private_key_with_auto_migrate",
        lambda **_: "0x" + "a" * 64,
    )
    monkeypatch.setattr(
        "bot.services.wallet.Account.sign_transaction",
        lambda tx, pk: (_ for _ in ()).throw(ValueError("bad tx")),
    )
    with get_session() as session:
        _make_user(session)
        w = _make_local_wallet(session, 1)

    svc = WalletService()
    with pytest.raises((ValueError, Exception)):
        svc._sign_evm_local(w, {"to": "0x" + "b" * 40, "value": 0, "gas": 21000})

    # Key must have been zeroized despite the exception
    assert len(zeroize_calls) >= 1


def test_get_evm_token_balance_returns_zero_on_rpc_error(monkeypatch):
    """Balances default to 0.0 when RPC is unavailable — no crash."""
    monkeypatch.setattr(
        "bot.config.tokens.get_token_address",
        lambda symbol, chain: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    )
    monkeypatch.setattr(
        "bot.config.tokens.get_token_decimals",
        lambda symbol, chain: 6,
    )

    async def _raise(*args, **kwargs):
        raise ConnectionError("RPC down")

    import asyncio

    svc = WalletService()
    svc._evm_rpc_call = _raise

    balance = asyncio.run(svc.get_evm_token_balance("ethereum", "USDC", "0x" + "a" * 40))
    assert balance == 0.0

"""Tests for the ERC-20 approval-mode mechanism (SwapEngine._approval_amount).

The audit added an `approval_mode` setting so the fleet can switch from
unlimited (max-uint, fewer txs) to exact-amount (no standing allowance)
approvals. Default behavior must remain 'unlimited' so this is opt-in.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402

from bot.services.swap_engine import SwapEngine, MAX_UINT256  # noqa: E402
import bot.services.swap_engine as swap_engine_mod  # noqa: E402


@pytest.fixture()
def engine():
    # Bypass __init__ (heavy provider wiring) — _approval_amount only reads
    # module-level `settings` and MAX_UINT256.
    return SwapEngine.__new__(SwapEngine)


def _set_mode(monkeypatch, mode):
    monkeypatch.setattr(swap_engine_mod.settings, "approval_mode", mode, raising=False)


def test_default_is_unlimited(engine, monkeypatch):
    # No setting present at all -> getattr default 'unlimited'.
    monkeypatch.delattr(swap_engine_mod.settings, "approval_mode", raising=False)
    assert engine._approval_amount(12345) == MAX_UINT256


def test_explicit_unlimited(engine, monkeypatch):
    _set_mode(monkeypatch, "unlimited")
    assert engine._approval_amount(999) == MAX_UINT256


def test_exact_returns_swap_amount(engine, monkeypatch):
    _set_mode(monkeypatch, "exact")
    assert engine._approval_amount(1_000_000) == 1_000_000


def test_exact_is_case_insensitive(engine, monkeypatch):
    _set_mode(monkeypatch, "EXACT")
    assert engine._approval_amount(42) == 42


def test_exact_coerces_to_int(engine, monkeypatch):
    _set_mode(monkeypatch, "exact")
    # Callers may pass a Decimal/str base-unit amount; result must be an int
    # suitable for an on-chain approve().
    assert engine._approval_amount("250") == 250
    assert isinstance(engine._approval_amount(7.0), int)


def test_unknown_mode_falls_back_to_unlimited(engine, monkeypatch):
    _set_mode(monkeypatch, "garbage")
    assert engine._approval_amount(5) == MAX_UINT256

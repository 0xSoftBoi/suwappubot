"""Tests for the refresh-token rotation + reuse-detection logic (H13)."""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import pytest

from bot.services.refresh_token_service import (
    issue_refresh_token,
    revoke_refresh_token,
    rotate_refresh_token,
)

USER = 999
ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"


def test_issue_then_rotate_chains(tmp_db):
    token1, _ = issue_refresh_token(USER, address=ADDR, client="webapp")
    out = rotate_refresh_token(token1)
    assert out is not None
    user_id, address, token2, _exp = out
    assert user_id == USER
    assert address == ADDR  # address carried through for re-minting the access JWT
    assert token2 != token1
    # the successor is itself rotatable
    out2 = rotate_refresh_token(token2)
    assert out2 is not None and out2[2] != token2


def test_reuse_of_rotated_token_is_rejected_and_revokes_family(tmp_db):
    token1, _ = issue_refresh_token(USER, address=ADDR)
    _, _, token2, _ = rotate_refresh_token(token1)  # token1 now rotated
    # Replaying the already-used token1 is treated as theft.
    assert rotate_refresh_token(token1) is None
    # ...and the whole family (including the live token2) is revoked.
    assert rotate_refresh_token(token2) is None


def test_revoke_invalidates_token(tmp_db):
    token, _ = issue_refresh_token(USER, address=ADDR)
    assert revoke_refresh_token(token) is True
    assert rotate_refresh_token(token) is None


def test_unknown_token_returns_none(tmp_db):
    assert rotate_refresh_token("not-a-real-token") is None
    assert revoke_refresh_token("not-a-real-token") is False

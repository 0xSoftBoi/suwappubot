"""Regression test: OAuth callback must bind a 'link' flow to the session user.

An attacker could pre-seed a link-state bound to a victim's user_id and trick the
victim into authorizing, binding the attacker's OAuth identity to the victim's
account. The callback now requires the authenticated session to match
oauth_state.user_id for link flows (login flows are unaffected).
"""
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import api.routes.oauth as oauth


def _db_returning(state_obj):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = state_obj
    return db


async def _call(db, current_user):
    return await oauth.oauth_callback(
        provider="google",
        code="dummy-code",
        state="dummy-state",
        error=None,
        error_description=None,
        response=MagicMock(),
        db=db,
        current_user=current_user,
    )


async def test_link_callback_rejects_unauthenticated_session():
    state = SimpleNamespace(action="link", user_id=1, is_expired=False)
    with pytest.raises(HTTPException) as exc:
        await _call(_db_returning(state), current_user=None)
    assert exc.value.status_code == 403


async def test_link_callback_rejects_wrong_user():
    state = SimpleNamespace(action="link", user_id=1, is_expired=False)
    other_user = SimpleNamespace(id=2)
    with pytest.raises(HTTPException) as exc:
        await _call(_db_returning(state), current_user=other_user)
    assert exc.value.status_code == 403


async def test_link_callback_allows_matching_user_past_the_check(monkeypatch):
    # Matching session → the link binding check passes and the flow proceeds to
    # token exchange. We stub get_oauth_service to fail fast there, then assert the
    # error is our sentinel (reached token exchange) — NOT the 403 link mismatch.
    state = SimpleNamespace(action="link", user_id=7, is_expired=False, code_verifier="x")
    matching = SimpleNamespace(id=7)

    def _boom():
        raise RuntimeError("reached token exchange")

    monkeypatch.setattr(oauth, "get_oauth_service", _boom)
    with pytest.raises(RuntimeError, match="reached token exchange"):
        await _call(_db_returning(state), current_user=matching)

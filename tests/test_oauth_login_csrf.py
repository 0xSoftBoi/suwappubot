"""Regression test: OAuth login callback must be bound to a browser nonce cookie.

Login CSRF / session fixation: an attacker starts their own /authorize, captures a
valid code+state pre-consumption, and sends the callback URL to a victim. Without a
browser-bound nonce the victim's browser is silently logged into the ATTACKER's
account. The callback now issues a nonce cookie at /authorize (login action) and
requires it to match OAuthState.login_nonce at /callback; a missing or mismatched
cookie is rejected before any session is issued. Link flows are covered separately
in test_oauth_link_binding.py.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from types import SimpleNamespace  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402

import pytest  # noqa: E402
from starlette.responses import RedirectResponse  # noqa: E402

import api.routes.oauth as oauth  # noqa: E402


def _db_returning(state_obj):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = state_obj
    return db


def _request_with_cookies(cookies):
    return SimpleNamespace(cookies=cookies or {})


async def _call(db, request):
    # Login flow => current_user is None (unauthenticated browser).
    return await oauth.oauth_callback(
        provider="google",
        code="dummy-code",
        state="dummy-state",
        error=None,
        error_description=None,
        response=MagicMock(),
        request=request,
        db=db,
        current_user=None,
    )


async def test_login_callback_rejects_missing_nonce_cookie():
    state = SimpleNamespace(
        action="login",
        user_id=None,
        is_expired=False,
        login_nonce="secret-nonce",
        redirect_uri=None,
    )
    result = await _call(_db_returning(state), _request_with_cookies({}))
    # Code returns RedirectResponse with nonce_missing error, not HTTPException
    assert isinstance(result, RedirectResponse)
    # Check redirect location header contains the error
    assert any("nonce_missing" in str(v) for v in result.headers.values())


async def test_login_callback_rejects_wrong_nonce_cookie():
    state = SimpleNamespace(
        action="login",
        user_id=None,
        is_expired=False,
        login_nonce="secret-nonce",
        redirect_uri=None,
    )
    request = _request_with_cookies({oauth.OAUTH_NONCE_COOKIE: "attacker-value"})
    result = await _call(_db_returning(state), request)
    # Code returns RedirectResponse with nonce_mismatch error, not HTTPException
    assert isinstance(result, RedirectResponse)
    # Check redirect location header contains the error
    assert any("nonce_mismatch" in str(v) for v in result.headers.values())


async def test_login_callback_matching_nonce_passes_the_check(monkeypatch):
    # Matching cookie => the nonce binding check passes and the flow proceeds to
    # token exchange. Stub get_oauth_service to fail fast there, then assert the
    # error is our sentinel (reached token exchange) — NOT the 400 nonce rejection.
    state = SimpleNamespace(
        action="login",
        user_id=None,
        is_expired=False,
        login_nonce="secret-nonce",
        code_verifier="x",
        redirect_uri=None,
    )
    request = _request_with_cookies({oauth.OAUTH_NONCE_COOKIE: "secret-nonce"})

    def _boom():
        raise RuntimeError("reached token exchange")

    monkeypatch.setattr(oauth, "get_oauth_service", _boom)
    with pytest.raises(RuntimeError, match="reached token exchange"):
        await _call(_db_returning(state), request)

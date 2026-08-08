"""A successful OAuth callback must return the session cookie it creates."""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

import api.routes.oauth as oauth


async def test_success_redirect_carries_session_cookie(monkeypatch):
    state = SimpleNamespace(
        state="state",
        provider="google",
        action="login",
        user_id=None,
        is_expired=False,
        login_nonce="browser-nonce",
        code_verifier="verifier",
        redirect_uri="https://terminal.suwappu.bot/",
    )
    user = SimpleNamespace(id=42)
    identity = SimpleNamespace(last_login_at=None)
    wallet = SimpleNamespace(address="0x1111111111111111111111111111111111111111")
    user_info = SimpleNamespace(provider_user_id="google-user")

    state_query = MagicMock()
    state_query.filter.return_value.first.return_value = state
    wallet_query = MagicMock()
    wallet_query.filter.return_value.order_by.return_value.first.return_value = wallet
    db = MagicMock()
    db.query.side_effect = lambda model: state_query if model is oauth.OAuthState else wallet_query

    service = SimpleNamespace(
        exchange_code=AsyncMock(return_value=SimpleNamespace(access_token="token")),
        get_user_info=AsyncMock(return_value=user_info),
    )
    monkeypatch.setattr(oauth, "get_oauth_service", lambda: service)
    monkeypatch.setattr(oauth, "_find_or_create_user", AsyncMock(return_value=(user, identity)))
    monkeypatch.setattr(oauth, "_store_oauth_tokens", AsyncMock(return_value=None))
    monkeypatch.setattr(oauth, "_is_allowed_redirect", lambda _url: True)

    result = await oauth.oauth_callback(
        provider="google",
        code="code",
        state="state",
        error=None,
        error_description=None,
        response=MagicMock(),
        request=SimpleNamespace(cookies={oauth.OAUTH_NONCE_COOKIE: "browser-nonce"}),
        db=db,
        current_user=None,
    )

    cookies = result.headers.getlist("set-cookie")
    assert any(cookie.startswith("suwappu_auth=") for cookie in cookies)
    assert any("suwappu_oauth_nonce=" in cookie and "Max-Age=0" in cookie for cookie in cookies)

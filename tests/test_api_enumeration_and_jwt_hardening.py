"""
Regression tests for the security hardening applied to api/main.py:

1. User-ID enumeration throttling on the /users/{user_id}/* discovery
   endpoints (per-agent-key rate limit + distinct-user fan-out alerting).
2. JWT token lifetime reduction (7 days -> 1 hour) and per-request
   re-validation that the token's subject is still an authorized user.

The monolith (``api.main``) pulls in the whole bot stack and requires
Python 3.10+ to import (it uses ``str | None`` syntax transitively). On
older interpreters these tests skip rather than error.
"""

import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("AGENT_API_KEY", "test-agent-key")

try:
    import api.main as main
except Exception as exc:  # pragma: no cover - environment guard
    # The monolith uses 3.10+ syntax transitively; skip on older interpreters
    # or when optional bot deps are unavailable, rather than failing collection.
    pytest.skip(
        f"api.main import unavailable in this environment: {exc!r}",
        allow_module_level=True,
    )


def test_jwt_expiry_is_short_lived():
    """A leaked token must not stay valid for days. Cap at <= 1 hour."""
    assert main.JWT_EXPIRY_HOURS <= 1, (
        f"JWT_EXPIRY_HOURS={main.JWT_EXPIRY_HOURS}; expected <= 1 hour to "
        "limit the blast radius of a stolen token."
    )


def test_jwt_token_roundtrip_when_user_authorized(monkeypatch):
    """A freshly issued, signature-valid token decodes when the user is authorized."""
    # Force the authorization check to treat the user as valid without a DB.
    monkeypatch.setattr(main, "_user_is_authorized", lambda user_id: True)
    token = main.create_jwt_token("0xabc", 123)
    payload = main.decode_jwt_token(token)
    assert payload is not None
    assert payload["user_id"] == 123


def test_jwt_rejected_when_user_no_longer_authorized(monkeypatch):
    """
    Core fix: a signature-valid token for a user who has since been
    deauthorized/deleted must be rejected on decode, not trusted until exp.
    """
    monkeypatch.setattr(main, "_user_is_authorized", lambda user_id: True)
    token = main.create_jwt_token("0xabc", 999)
    # Simulate the user being revoked after the token was issued.
    monkeypatch.setattr(main, "_user_is_authorized", lambda user_id: False)
    assert main.decode_jwt_token(token) is None


@pytest.mark.asyncio
async def test_enumeration_guard_throttles_per_agent_key(monkeypatch):
    """
    A single agent key hitting the discovery endpoints must be capped so it
    cannot walk user_id 1..N unbounded. After the per-minute cap is reached,
    further calls raise HTTP 429.
    """
    # Use a small, deterministic cap and a fresh limiter for isolation.
    from bot.utils.rate_limiter import UserRateLimiter
    monkeypatch.setattr(main, "_ENUM_MAX_REQUESTS", 3, raising=False)
    monkeypatch.setattr(
        main, "_enum_rate_limiter",
        UserRateLimiter(max_requests=3, window_seconds=60),
        raising=False,
    )
    monkeypatch.setattr(main, "_enum_seen_users", {}, raising=False)

    key = "agent-key-enum"

    # First 3 calls (the cap) succeed.
    for uid in range(3):
        await main.enforce_enumeration_guard(key, uid)

    # The 4th call within the window is rejected with 429.
    with pytest.raises(main.HTTPException) as exc:
        await main.enforce_enumeration_guard(key, 4)
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_enumeration_guard_is_per_key(monkeypatch):
    """Throttling one agent key must not affect a different key."""
    from bot.utils.rate_limiter import UserRateLimiter
    monkeypatch.setattr(
        main, "_enum_rate_limiter",
        UserRateLimiter(max_requests=2, window_seconds=60),
        raising=False,
    )
    monkeypatch.setattr(main, "_enum_seen_users", {}, raising=False)

    # Exhaust key A.
    await main.enforce_enumeration_guard("key-A", 1)
    await main.enforce_enumeration_guard("key-A", 2)
    with pytest.raises(main.HTTPException):
        await main.enforce_enumeration_guard("key-A", 3)

    # Key B still has its own independent budget.
    await main.enforce_enumeration_guard("key-B", 1)
    await main.enforce_enumeration_guard("key-B", 2)

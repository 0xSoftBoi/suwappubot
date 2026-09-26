"""Tests for the four read-only referral webapp endpoints added to api/webapp.py:

  GET /webapp/referrals/stats
  GET /webapp/referrals
  GET /webapp/referrals/code
  GET /webapp/referrals/leaderboard

Auth uses the same JWT pattern as test_webapp_limit_orders.py — SECRET_KEY env var
controls the JWT_SECRET used by api.main.  Service layer calls are mocked via
monkeypatch so no real DB rows are needed beyond what the auth check reads.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("SECRET_KEY", "test-secret")

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api.webapp import router  # noqa: E402

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SECRET = "test-secret"


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def app_client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# Dummy ReferralCode-like object returned by get_or_create_code
class _FakeCode:
    def __init__(self, code="TESTREF_ABCD", tier=None):
        self.code = code
        self.referrer_tier = tier
        self.times_used = 3


# ---------------------------------------------------------------------------
# Fixture: patch referral_service at the module level used by the endpoints
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_referral_service(monkeypatch):
    """Replace referral_service methods with deterministic stubs."""
    from unittest.mock import MagicMock

    svc = MagicMock()
    svc.get_referral_stats.return_value = {
        "referral_code": "TESTREF_ABCD",
        "total_referrals": 5,
        "active_referrals": 3,
        "total_earnings_usd": 12.50,
        "pending_rewards_usd": 2.00,
        "pending_rewards_count": 1,
        "code_times_used": 3,
    }
    svc.get_or_create_code.return_value = _FakeCode()
    svc.get_referrals_list.return_value = [
        {"user_id": 2, "username": "alice", "joined_at": None, "total_rewards_usd": 7.0},
        {"user_id": 3, "username": "bob", "joined_at": None, "total_rewards_usd": 5.5},
    ]
    svc.get_leaderboard.return_value = [
        {"user_id": 1, "username": "alice", "total_reward_usd": 50.0},
        {"user_id": 2, "username": "bob", "total_reward_usd": 30.0},
    ]

    monkeypatch.setattr("bot.services.referral_service.referral_service", svc)

    # Patch JWT_SECRET in api.main so token verification succeeds
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)

    return svc


# ---------------------------------------------------------------------------
# /webapp/referrals/stats
# ---------------------------------------------------------------------------


class TestReferralStats:
    def test_returns_expected_shape(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/stats", headers=auth_headers())
        assert r.status_code == 200
        body = r.json()
        assert body["referral_code"] == "TESTREF_ABCD"
        assert "TESTREF_ABCD" in body["referral_link"]
        assert body["referral_link"].startswith("https://t.me/")
        assert body["tier"] == "standard"
        assert body["reward_rate_pct"] == 30
        assert "total_referrals" in body
        assert "active_referrals" in body
        assert "total_earnings_usd" in body
        assert "pending_rewards_usd" in body

    def test_elite_tier_returns_40_pct(self, mock_referral_service):
        mock_referral_service.get_or_create_code.return_value = _FakeCode(tier="elite")
        client = app_client()
        r = client.get("/webapp/referrals/stats", headers=auth_headers())
        assert r.status_code == 200
        body = r.json()
        assert body["tier"] == "elite"
        assert body["reward_rate_pct"] == 40

    def test_power_tier_returns_30_pct(self, mock_referral_service):
        mock_referral_service.get_or_create_code.return_value = _FakeCode(tier="power")
        client = app_client()
        r = client.get("/webapp/referrals/stats", headers=auth_headers())
        assert r.status_code == 200
        assert r.json()["reward_rate_pct"] == 30

    def test_unauthenticated_returns_401(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/stats")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# /webapp/referrals
# ---------------------------------------------------------------------------


class TestReferralsList:
    def test_returns_referrals_key(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals", headers=auth_headers())
        assert r.status_code == 200
        body = r.json()
        assert "referrals" in body
        assert len(body["referrals"]) == 2
        assert body["referrals"][0]["username"] == "alice"

    def test_scoped_to_authed_caller(self, mock_referral_service):
        """Service is called with the authed user_id, not someone else's."""
        client = app_client()
        client.get("/webapp/referrals", headers=auth_headers(user_id=7))
        mock_referral_service.get_referrals_list.assert_called_once()
        call_user_id = mock_referral_service.get_referrals_list.call_args[0][0]
        assert call_user_id == 7

    def test_limit_query_param_forwarded(self, mock_referral_service):
        client = app_client()
        client.get("/webapp/referrals?limit=50", headers=auth_headers())
        _, kwargs = mock_referral_service.get_referrals_list.call_args
        assert kwargs.get("limit") == 50

    def test_unauthenticated_returns_401(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# /webapp/referrals/code
# ---------------------------------------------------------------------------


class TestReferralCode:
    def test_returns_code_and_link(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/code", headers=auth_headers())
        assert r.status_code == 200
        body = r.json()
        assert body["code"] == "TESTREF_ABCD"
        assert body["link"].startswith("https://t.me/")
        assert "TESTREF_ABCD" in body["link"]

    def test_auto_creates_code_for_new_user(self, mock_referral_service):
        """get_or_create_code is always called — auto-creation happens inside the service."""
        client = app_client()
        client.get("/webapp/referrals/code", headers=auth_headers(user_id=99))
        mock_referral_service.get_or_create_code.assert_called_once_with(99)

    def test_unauthenticated_returns_401(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/code")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# /webapp/referrals/leaderboard
# ---------------------------------------------------------------------------


class TestReferralLeaderboard:
    def test_returns_leaderboard_key(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/leaderboard", headers=auth_headers())
        assert r.status_code == 200
        body = r.json()
        assert "leaderboard" in body
        entries = body["leaderboard"]
        assert len(entries) == 2

    def test_rank_starts_at_1(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/leaderboard", headers=auth_headers())
        entries = r.json()["leaderboard"]
        ranks = [e["rank"] for e in entries]
        assert ranks == [1, 2]

    def test_contains_username_and_reward(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/leaderboard", headers=auth_headers())
        entries = r.json()["leaderboard"]
        assert entries[0]["username"] == "alice"
        assert entries[0]["total_reward_usd"] == pytest.approx(50.0)

    def test_does_not_leak_user_id_or_wallet(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/leaderboard", headers=auth_headers())
        for entry in r.json()["leaderboard"]:
            assert "user_id" not in entry
            assert "wallet" not in entry

    def test_unauthenticated_returns_401(self, mock_referral_service):
        client = app_client()
        r = client.get("/webapp/referrals/leaderboard")
        assert r.status_code == 401

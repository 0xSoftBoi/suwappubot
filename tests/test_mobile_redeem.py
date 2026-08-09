"""Tests for POST /v1/mobile/points/rewards/{reward_id}/redeem
(api/routes/mobile.py::redeem_reward), fixed to stop calling the
non-existent `points_service.redeem_reward` (every call previously raised
AttributeError and leaked str(e) in a 400 response).

The route now dispatches to the same real points_service methods used by the
Telegram /xp flow (bot/handlers/points.py::redeem_callback), by reward shape:
  - async marketplace category  -> redeem_marketplace_reward
  - cash-equivalent types       -> rejected (not live)
  - "subscription"              -> redeem_subscription_reward
  - everything else             -> spend_points

MONEY-PATH: this touches points/reward redemption dispatch.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from database.db import get_session, init_db
from bot.models.points import Reward
from bot.models.user import User

import api.routes.mobile as mobile_mod

_SECRET = "test-secret"


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def app_client():
    app = FastAPI()
    app.include_router(mobile_mod.router)
    return TestClient(app)


@pytest.fixture()
def sqlite_db(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'mobile-redeem.db'}"
    assert init_db(database_url)

    # api/routes/mobile.py imports DATABASE_AVAILABLE at module-import time, so
    # it doesn't see init_db()'s later flip — patch it directly on the module.
    monkeypatch.setattr(mobile_mod, "DATABASE_AVAILABLE", True)

    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)

    with get_session() as session:
        session.add(User(id=1, username="redeemer"))
        session.flush()

    yield


def _make_reward(reward_id, reward_type, reward_value="1", category="own_product", cost=100):
    with get_session() as session:
        session.add(
            Reward(
                id=reward_id,
                name="Test Reward",
                description="desc",
                points_cost=cost,
                reward_type=reward_type,
                reward_value=reward_value,
                reward_category=category,
                is_active=True,
            )
        )
        session.flush()


class TestRedeemDispatch:
    def test_generic_reward_uses_spend_points(self, sqlite_db, monkeypatch):
        _make_reward(1, reward_type="fee_discount", reward_value="0.5")

        called = {}

        def fake_spend_points(*, user_id, amount, reward_type, reward_value):
            called["args"] = dict(
                user_id=user_id, amount=amount, reward_type=reward_type, reward_value=reward_value
            )
            return True, "Fee discount active."

        monkeypatch.setattr(
            "bot.services.points_service.points_service.spend_points", fake_spend_points
        )

        client = app_client()
        r = client.post("/v1/mobile/points/rewards/1/redeem", headers=auth_headers())

        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["message"] == "Fee discount active."
        assert called["args"] == {
            "user_id": 1,
            "amount": 100,
            "reward_type": "fee_discount",
            "reward_value": "0.5",
        }

    def test_subscription_reward_uses_redeem_subscription_reward(self, sqlite_db, monkeypatch):
        _make_reward(2, reward_type="subscription", reward_value="pro")

        def fake_redeem_subscription(*, user_id, reward_id):
            assert user_id == 1
            assert reward_id == 2
            return True, "PRO active until 2026-08-01", "2026-08-01"

        monkeypatch.setattr(
            "bot.services.points_service.points_service.redeem_subscription_reward",
            fake_redeem_subscription,
        )

        client = app_client()
        r = client.post("/v1/mobile/points/rewards/2/redeem", headers=auth_headers())

        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["expiresAt"] == "2026-08-01"

    def test_marketplace_reward_uses_redeem_marketplace_reward(self, sqlite_db, monkeypatch):
        _make_reward(3, reward_type="merch", reward_value="hoodie", category="merch")

        def fake_redeem_marketplace(*, user_id, reward_id):
            return True, "Test Reward is on its way — order #42.", 42

        monkeypatch.setattr(
            "bot.services.points_service.points_service.redeem_marketplace_reward",
            fake_redeem_marketplace,
        )

        client = app_client()
        r = client.post("/v1/mobile/points/rewards/3/redeem", headers=auth_headers())

        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["orderId"] == 42

    def test_cash_equivalent_reward_rejected(self, sqlite_db):
        _make_reward(4, reward_type="cashout", reward_value="10")

        client = app_client()
        r = client.post("/v1/mobile/points/rewards/4/redeem", headers=auth_headers())

        assert r.status_code == 400
        assert "not live yet" in r.json()["detail"] or "coming soon" in r.json()["detail"]

    def test_unknown_reward_returns_404(self, sqlite_db):
        client = app_client()
        r = client.post("/v1/mobile/points/rewards/999/redeem", headers=auth_headers())
        assert r.status_code == 404

    def test_service_failure_surfaces_clean_message_not_raw_exception(self, sqlite_db, monkeypatch):
        _make_reward(5, reward_type="fee_discount")

        def fake_spend_points(*, user_id, amount, reward_type, reward_value):
            return False, "Not enough points. You have 10, need 100."

        monkeypatch.setattr(
            "bot.services.points_service.points_service.spend_points", fake_spend_points
        )

        client = app_client()
        r = client.post("/v1/mobile/points/rewards/5/redeem", headers=auth_headers())

        assert r.status_code == 400
        assert r.json()["detail"] == "Not enough points. You have 10, need 100."

    def test_unexpected_crash_never_leaks_raw_exception(self, sqlite_db, monkeypatch):
        """Regression: the old code called a nonexistent method, and str(e) from the
        AttributeError leaked straight into the HTTP response. Any unexpected crash
        in the dispatched service call must now return a safe, generic message."""
        _make_reward(6, reward_type="fee_discount")

        def boom(*, user_id, amount, reward_type, reward_value):
            raise RuntimeError("some internal secret detail: db://user:pass@host")

        monkeypatch.setattr("bot.services.points_service.points_service.spend_points", boom)

        client = app_client()
        r = client.post("/v1/mobile/points/rewards/6/redeem", headers=auth_headers())

        assert r.status_code == 400
        detail = r.json()["detail"]
        assert "some internal secret detail" not in detail
        assert "db://" not in detail

    def test_unauthenticated_returns_401(self, sqlite_db):
        _make_reward(7, reward_type="fee_discount")
        client = app_client()
        r = client.post("/v1/mobile/points/rewards/7/redeem")
        assert r.status_code == 401

    def test_no_such_method_as_redeem_reward_on_points_service(self):
        """Regression guard for the original bug: points_service has no
        `redeem_reward` method. If one is ever added with different semantics,
        this test should be revisited rather than silently passing."""
        from bot.services.points_service import points_service

        assert not hasattr(points_service, "redeem_reward")


class TestRewardsListing:
    """M1 regression: GET /points/rewards used `r.cost`, which doesn't exist
    on the Reward model (it's `points_cost`) — every call 500'd, so the
    mobile client could never render the store it can now redeem from."""

    def test_rewards_listing_returns_points_cost_as_cost(self, sqlite_db):
        _make_reward(50, reward_type="fee_discount", reward_value="0.5", cost=777)

        client = app_client()
        r = client.get("/v1/mobile/points/rewards", headers=auth_headers())

        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["id"] == 50
        assert body[0]["cost"] == 777
        assert body[0]["rewardType"] == "fee_discount"

    def test_rewards_listing_excludes_inactive_rewards(self, sqlite_db):
        with get_session() as session:
            session.add(
                Reward(
                    id=51,
                    name="Inactive Reward",
                    description="desc",
                    points_cost=100,
                    reward_type="raffle",
                    reward_value="1",
                    reward_category="own_product",
                    is_active=False,
                )
            )
            session.flush()

        client = app_client()
        r = client.get("/v1/mobile/points/rewards", headers=auth_headers())

        assert r.status_code == 200
        assert all(item["id"] != 51 for item in r.json())


class TestRedeemIdempotency:
    """H6: the mobile redeem route must not let a duplicate request (same
    client Idempotency-Key) re-spend points / re-grant a reward. The
    authoritative double-spend guard is the `.with_for_update()` row lock in
    points_service (see tests/test_points_concurrency.py); this covers the
    route-level replay-the-first-result behavior."""

    def test_duplicate_idempotency_key_replays_first_result_without_recalling_service(
        self, sqlite_db, monkeypatch
    ):
        _make_reward(60, reward_type="fee_discount", reward_value="0.5", cost=100)

        call_count = {"n": 0}

        def fake_spend_points(*, user_id, amount, reward_type, reward_value):
            call_count["n"] += 1
            return True, f"Redeemed (call #{call_count['n']})"

        monkeypatch.setattr(
            "bot.services.points_service.points_service.spend_points", fake_spend_points
        )

        client = app_client()
        headers = dict(auth_headers())
        headers["Idempotency-Key"] = "test-idem-dup-1"

        r1 = client.post("/v1/mobile/points/rewards/60/redeem", headers=headers)
        r2 = client.post("/v1/mobile/points/rewards/60/redeem", headers=headers)

        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.json() == r2.json()
        # The service must only ever be invoked ONCE for this idempotency key —
        # the second request replays the cached result instead of re-spending.
        assert call_count["n"] == 1

    def test_different_idempotency_keys_are_independent_requests(self, sqlite_db, monkeypatch):
        _make_reward(61, reward_type="fee_discount", reward_value="0.5", cost=100)

        call_count = {"n": 0}

        def fake_spend_points(*, user_id, amount, reward_type, reward_value):
            call_count["n"] += 1
            return True, f"Redeemed (call #{call_count['n']})"

        monkeypatch.setattr(
            "bot.services.points_service.points_service.spend_points", fake_spend_points
        )

        client = app_client()
        headers1 = dict(auth_headers())
        headers1["Idempotency-Key"] = "test-idem-key-a"
        headers2 = dict(auth_headers())
        headers2["Idempotency-Key"] = "test-idem-key-b"

        r1 = client.post("/v1/mobile/points/rewards/61/redeem", headers=headers1)
        r2 = client.post("/v1/mobile/points/rewards/61/redeem", headers=headers2)

        assert r1.status_code == 200
        assert r2.status_code == 200
        assert call_count["n"] == 2

    def test_duplicate_idempotency_key_replays_a_failure_result_too(self, sqlite_db, monkeypatch):
        _make_reward(62, reward_type="fee_discount", reward_value="0.5", cost=100)

        call_count = {"n": 0}

        def fake_spend_points(*, user_id, amount, reward_type, reward_value):
            call_count["n"] += 1
            return False, "Not enough points. You have 10, need 100."

        monkeypatch.setattr(
            "bot.services.points_service.points_service.spend_points", fake_spend_points
        )

        client = app_client()
        headers = dict(auth_headers())
        headers["Idempotency-Key"] = "test-idem-dup-fail-1"

        r1 = client.post("/v1/mobile/points/rewards/62/redeem", headers=headers)
        r2 = client.post("/v1/mobile/points/rewards/62/redeem", headers=headers)

        assert r1.status_code == 400
        assert r2.status_code == 400
        assert r1.json()["detail"] == r2.json()["detail"]
        assert call_count["n"] == 1

    def test_same_idempotency_key_reused_across_different_rewards_does_not_replay(
        self, sqlite_db, monkeypatch
    ):
        """NEW-5: a client that (incorrectly, but plausibly — e.g. a buggy
        mobile client that generates one Idempotency-Key per screen-load
        instead of per-request) reuses the SAME Idempotency-Key header across
        two DIFFERENT reward_ids must NOT get reward A's cached success
        replayed as a false success for reward B. Before the fix, the
        header-derived cache key was (user_id, "hdr:"+header) — omitting
        reward_id entirely — so this scenario silently skipped reward B's
        redemption while still reporting success."""
        _make_reward(63, reward_type="fee_discount", reward_value="0.5", cost=100)
        _make_reward(64, reward_type="fee_discount", reward_value="0.5", cost=100)

        call_count = {"n": 0}

        def fake_spend_points(*, user_id, amount, reward_type, reward_value):
            call_count["n"] += 1
            return True, f"Redeemed (call #{call_count['n']})"

        monkeypatch.setattr(
            "bot.services.points_service.points_service.spend_points", fake_spend_points
        )

        client = app_client()
        headers = dict(auth_headers())
        headers["Idempotency-Key"] = "reused-across-rewards"

        r1 = client.post("/v1/mobile/points/rewards/63/redeem", headers=headers)
        r2 = client.post("/v1/mobile/points/rewards/64/redeem", headers=headers)

        assert r1.status_code == 200
        assert r2.status_code == 200
        # Both rewards must actually invoke the service — reward B is NOT a
        # replay of reward A's cached result.
        assert call_count["n"] == 2
        assert r1.json()["message"] != r2.json()["message"]


class TestRedeemIdemEntryCleanup:
    """NEW-7 (now structural): `_redeem_idem_entries` entries created for a
    cache key must not live forever once that key's cached result has
    expired/been pruned — otherwise a long-lived worker process accumulates
    one entry per distinct (user_id, Idempotency-Key or auto-bucket) forever.

    The old implementation kept the lock and the cached result in TWO
    parallel dicts (`_redeem_idem_locks` + `_redeem_idem_results`), which
    could drift out of sync (that was the actual NEW-7 bug: a lock outliving
    its already-pruned result because the bulk sweep only ever walked the
    results dict). They're now a single `_IdemEntry` per key in one dict, so
    lock and result are always pruned together by construction — there is no
    "orphaned lock with no result" state left to test for."""

    def test_expired_lookup_prunes_its_own_entry(self, sqlite_db):
        import api.routes.mobile as mobile_mod

        cache_key = (1, "hdr:65:prune-me")
        mobile_mod._redeem_idem_entries[cache_key] = mobile_mod._IdemEntry(
            lock=mobile_mod.threading.Lock(),
            timestamp=0.0,  # epoch — long expired
            status_code=200,
            body={"success": True},
        )

        assert cache_key in mobile_mod._redeem_idem_entries

        result = mobile_mod._redeem_idem_lookup(cache_key)

        assert result is None  # TTL (300s) elapsed since epoch
        assert cache_key not in mobile_mod._redeem_idem_entries  # lock + result pruned together

    def test_store_sweep_prunes_expired_entries_but_keeps_in_flight_ones(self, monkeypatch):
        import api.routes.mobile as mobile_mod

        monkeypatch.setattr(mobile_mod, "_redeem_idem_entries", {})

        # An expired entry: must be swept.
        expired_key = (1, "auto:66:expired")
        mobile_mod._redeem_idem_entries[expired_key] = mobile_mod._IdemEntry(
            lock=mobile_mod.threading.Lock(),
            timestamp=0.0,  # epoch — long expired
            status_code=200,
            body={"success": True},
        )

        # An in-flight entry: lock claimed, no result yet (timestamp is None).
        # Must survive the sweep regardless of dict size — we can't know its
        # age, and removing it would hand a fresh Lock to a genuinely
        # concurrent duplicate request instead of making it wait.
        in_flight_key = (2, "auto:67:in-flight")
        mobile_mod._redeem_idem_get_lock(in_flight_key)

        # Push the dict over the 1000-entry threshold so the sweep in
        # `_redeem_idem_store` runs.
        for i in range(1001):
            mobile_mod._redeem_idem_store((i, "auto:filler"), 200, {"success": True})

        assert expired_key not in mobile_mod._redeem_idem_entries
        assert in_flight_key in mobile_mod._redeem_idem_entries


class TestGetPointsFieldMapping:
    """NEW-9: GET /v1/mobile/points referenced attributes that don't exist on
    UserPoints (points, spendable_points, level_emoji, fee_discount,
    next_level, last_checkin_at) and called xp_to_next_level as a property
    instead of a method — every real-account call 500'd or serialized a bound
    method. Verify every field is now correctly mapped from the real model
    columns/helpers (bot/models/points.py)."""

    def test_no_account_returns_safe_defaults(self, sqlite_db):
        client = app_client()
        r = client.get("/v1/mobile/points", headers=auth_headers())

        assert r.status_code == 200
        body = r.json()
        assert body["points"] == 0
        assert body["spendablePoints"] == 0
        assert body["level"] == "bronze"
        assert body["canCheckin"] is True
        assert isinstance(body["xpToNextLevel"], int)

    def test_existing_account_maps_real_columns(self, sqlite_db):
        from bot.models.points import UserPoints

        with get_session() as session:
            session.add(
                UserPoints(
                    user_id=1,
                    total_points_earned=5000,
                    current_points=1200,
                    points_spent=3800,
                    xp=6000,
                    level="gold",
                    daily_streak=4,
                    longest_streak=10,
                )
            )
            session.flush()

        client = app_client()
        r = client.get("/v1/mobile/points", headers=auth_headers())

        assert r.status_code == 200
        body = r.json()
        assert body["points"] == 5000  # total_points_earned (lifetime)
        assert body["spendablePoints"] == 1200  # current_points (redeemable)
        assert body["xp"] == 6000
        assert body["level"] == "gold"
        assert body["levelEmoji"] == "🥇"
        assert body["nextLevel"] == "platinum"
        assert body["dailyStreak"] == 4
        assert body["longestStreak"] == 10
        assert body["lastCheckinAt"] is None
        assert body["canCheckin"] is True
        # Regression guard: xp_to_next_level is a METHOD on UserPoints, not a
        # property — the old code returned the bound method object itself
        # (unserializable / nonsensical), not an int.
        assert isinstance(body["xpToNextLevel"], int)
        assert body["xpToNextLevel"] > 0

    def test_checked_in_today_reports_can_checkin_false(self, sqlite_db):
        from datetime import datetime, timezone

        from bot.models.points import UserPoints

        with get_session() as session:
            session.add(
                UserPoints(
                    user_id=1,
                    total_points_earned=10,
                    current_points=10,
                    xp=10,
                    level="bronze",
                    last_checkin=datetime.now(timezone.utc),
                )
            )
            session.flush()

        client = app_client()
        r = client.get("/v1/mobile/points", headers=auth_headers())

        assert r.status_code == 200
        body = r.json()
        assert body["canCheckin"] is False
        assert body["lastCheckinAt"] is not None

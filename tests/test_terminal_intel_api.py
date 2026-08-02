"""Tests for the token-intel terminal HTTP routes added to api/routes/terminal.py:

    GET    /terminal/intel/{chain}/{token_address}
    GET    /terminal/intel/devwatch
    POST   /terminal/intel/devwatch
    DELETE /terminal/intel/devwatch/{watch_id}
    GET    /terminal/intel/devwatch/hits

Auth follows the same JWT pattern as test_webapp_referrals.py — SECRET_KEY env
var is patched onto api.main.JWT_SECRET, and tokens are signed the same way.
The report endpoint is public/unauthenticated (matches the rest of the
public read-only analytics routes in this module, e.g. /terminal/token/safety).
Business logic (TokenIntelService.analyze) is mocked; DeployerWatch/
DeployerWatchHit rows use a real isolated SQLite DB per test.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("SECRET_KEY", "test-secret")

from unittest.mock import AsyncMock

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.terminal import router
from bot.models.intel import DeployerWatch, DeployerWatchHit
from bot.services.token_intel.intel_service import HolderInfo, TokenIntelReport, token_intel_service
from database.db import get_session, init_db

_SECRET = "test-secret"


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def app_client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _db(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'terminal-intel.db'}")


@pytest.fixture(autouse=True)
def _jwt_secret(monkeypatch):
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)


def _sample_report(chain="ethereum", address="0x" + "ab" * 20) -> TokenIntelReport:
    report = TokenIntelReport(token_address=address, chain=chain)
    report.name = "Test Token"
    report.symbol = "TEST"
    report.deployer = "0x" + "cd" * 20
    report.deployer_prior_deploys = 3
    report.deployer_dead_deploys = 1
    report.set_top_holders(
        [
            {"address": "0x" + "11" * 20, "balance": 1000.0, "pct": 25.0},
            {"address": "0x" + "22" * 20, "balance": 800.0, "pct": 20.0},
        ]
    )
    report.cluster_groups = [["0x" + "11" * 20, "0x" + "22" * 20]]
    report.bundle_buyer_count = 4
    report.snipe_buyer_count = 2
    report.pair_created_at = 1_700_000_000_000
    report.flags = ["HIGH_TOP10", "CLUSTERED"]
    return report


# ---------------------------------------------------------------------------
# GET /terminal/intel/{chain}/{token_address}
# ---------------------------------------------------------------------------


class TestIntelReport:
    def test_happy_path_shape(self, monkeypatch):
        report = _sample_report()
        monkeypatch.setattr(token_intel_service, "analyze", AsyncMock(return_value=report))

        client = app_client()
        r = client.get(f"/terminal/intel/ethereum/{report.token_address}")
        assert r.status_code == 200
        body = r.json()

        assert body["token_address"] == report.token_address
        assert body["chain"] == "ethereum"
        assert body["name"] == "Test Token"
        assert body["symbol"] == "TEST"
        assert body["deployer"] == report.deployer
        assert body["deployer_prior_deploys"] == 3
        assert body["deployer_dead_deploys"] == 1
        assert body["mint_authority"] is None
        assert len(body["top_holders"]) == 2
        assert body["top_holders"][0]["address"] == "0x" + "11" * 20
        assert body["top_holders"][0]["pct"] == 25.0
        assert body["top10_pct"] == 45.0
        assert body["cluster_groups"] == [["0x" + "11" * 20, "0x" + "22" * 20]]
        assert body["bundle_buyer_count"] == 4
        assert body["snipe_buyer_count"] == 2
        assert body["pair_created_at"] == 1_700_000_000_000
        assert set(body["flags"]) == {"HIGH_TOP10", "CLUSTERED"}
        assert body["notes"] == []
        assert "generated_at" in body

    def test_auto_chain_evm_address_resolves_to_ethereum(self, monkeypatch):
        captured = {}

        async def fake_analyze(token_address, chain, force_refresh=False):
            captured["chain"] = chain
            return _sample_report(chain=chain, address=token_address)

        monkeypatch.setattr(token_intel_service, "analyze", AsyncMock(side_effect=fake_analyze))

        client = app_client()
        addr = "0x" + "ab" * 20
        r = client.get(f"/terminal/intel/auto/{addr}")
        assert r.status_code == 200
        assert captured["chain"] == "ethereum"
        assert r.json()["chain"] == "ethereum"

    def test_auto_chain_solana_address_resolves_to_solana(self, monkeypatch):
        captured = {}

        async def fake_analyze(token_address, chain, force_refresh=False):
            captured["chain"] = chain
            return _sample_report(chain=chain, address=token_address)

        monkeypatch.setattr(token_intel_service, "analyze", AsyncMock(side_effect=fake_analyze))

        client = app_client()
        # Valid base58 Solana mint-shaped address (44 chars).
        sol_addr = "So11111111111111111111111111111111111111112"
        r = client.get(f"/terminal/intel/auto/{sol_addr}")
        assert r.status_code == 200
        assert captured["chain"] == "solana"

    def test_auto_chain_invalid_address_degrades_without_500(self):
        client = app_client()
        r = client.get("/terminal/intel/auto/not-a-real-address")
        assert r.status_code == 200
        body = r.json()
        assert body["chain"] == "unknown"
        assert "auto_detect_invalid_address" in body["notes"]

    def test_graceful_degradation_on_service_exception(self, monkeypatch):
        """Never 500 on upstream/service failure — return a partial report."""
        monkeypatch.setattr(
            token_intel_service, "analyze", AsyncMock(side_effect=RuntimeError("upstream down"))
        )

        client = app_client()
        addr = "0x" + "ff" * 20
        r = client.get(f"/terminal/intel/ethereum/{addr}")
        assert r.status_code == 200
        body = r.json()
        assert body["token_address"] == addr
        assert body["chain"] == "ethereum"
        assert "intel_analysis_failed" in body["notes"]
        assert body["flags"] == []


# ---------------------------------------------------------------------------
# devwatch list/add/delete
# ---------------------------------------------------------------------------


class TestDevWatch:
    def test_add_then_list(self):
        client = app_client()
        r = client.post(
            "/terminal/intel/devwatch",
            json={"deployer_address": "0xDeployer1", "chain": "ethereum", "label": "sniper"},
            headers=auth_headers(1),
        )
        assert r.status_code == 200
        added = r.json()
        assert added["deployerAddress"] == "0xDeployer1"
        assert added["chain"] == "ethereum"
        assert added["label"] == "sniper"
        assert added["hitCount"] == 0
        assert added["id"] is not None

        r = client.get("/terminal/intel/devwatch", headers=auth_headers(1))
        assert r.status_code == 200
        watches = r.json()["watches"]
        assert len(watches) == 1
        assert watches[0]["id"] == added["id"]

    def test_add_is_idempotent_on_duplicate(self):
        client = app_client()
        body = {"deployer_address": "0xDeployer2", "chain": "solana"}
        r1 = client.post("/terminal/intel/devwatch", json=body, headers=auth_headers(1))
        r2 = client.post("/terminal/intel/devwatch", json=body, headers=auth_headers(1))
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == r2.json()["id"]

        r = client.get("/terminal/intel/devwatch", headers=auth_headers(1))
        assert len(r.json()["watches"]) == 1

    def test_delete_own_watch(self):
        client = app_client()
        added = client.post(
            "/terminal/intel/devwatch",
            json={"deployer_address": "0xDeployer3", "chain": "ethereum"},
            headers=auth_headers(1),
        ).json()

        r = client.delete(f"/terminal/intel/devwatch/{added['id']}", headers=auth_headers(1))
        assert r.status_code == 200
        assert r.json()["ok"] is True

        r = client.get("/terminal/intel/devwatch", headers=auth_headers(1))
        assert r.json()["watches"] == []

    def test_delete_is_idor_safe(self):
        """User B must not be able to delete user A's watch."""
        client = app_client()
        added = client.post(
            "/terminal/intel/devwatch",
            json={"deployer_address": "0xDeployerA", "chain": "ethereum"},
            headers=auth_headers(1),
        ).json()

        r = client.delete(f"/terminal/intel/devwatch/{added['id']}", headers=auth_headers(2))
        assert r.status_code == 404

        # Still present for the owner.
        r = client.get("/terminal/intel/devwatch", headers=auth_headers(1))
        assert len(r.json()["watches"]) == 1

    def test_devwatch_endpoints_require_auth(self):
        client = app_client()
        assert client.get("/terminal/intel/devwatch").status_code == 401
        assert (
            client.post(
                "/terminal/intel/devwatch",
                json={"deployer_address": "0xX", "chain": "ethereum"},
            ).status_code
            == 401
        )
        assert client.delete("/terminal/intel/devwatch/1").status_code == 401
        assert client.get("/terminal/intel/devwatch/hits").status_code == 401

    def test_hits_scoped_and_ordered(self):
        client = app_client()
        w1 = client.post(
            "/terminal/intel/devwatch",
            json={"deployer_address": "0xDeployerA", "chain": "ethereum", "label": "alpha"},
            headers=auth_headers(1),
        ).json()
        # A watch belonging to a different user — its hits must never appear.
        other = client.post(
            "/terminal/intel/devwatch",
            json={"deployer_address": "0xDeployerB", "chain": "ethereum"},
            headers=auth_headers(2),
        ).json()

        with get_session() as session:
            session.add(
                DeployerWatchHit(watch_id=w1["id"], token_address="0xTokenOld", chain="ethereum")
            )
            session.add(
                DeployerWatchHit(watch_id=w1["id"], token_address="0xTokenNew", chain="ethereum")
            )
            session.add(
                DeployerWatchHit(
                    watch_id=other["id"], token_address="0xTokenOther", chain="ethereum"
                )
            )

        r = client.get("/terminal/intel/devwatch/hits", headers=auth_headers(1))
        assert r.status_code == 200
        hits = r.json()["hits"]
        assert len(hits) == 2
        assert all(h["label"] == "alpha" for h in hits)
        assert {h["tokenAddress"] for h in hits} == {"0xTokenOld", "0xTokenNew"}

        # Reflects the hit count on the list endpoint too.
        r = client.get("/terminal/intel/devwatch", headers=auth_headers(1))
        watch = next(w for w in r.json()["watches"] if w["id"] == w1["id"])
        assert watch["hitCount"] == 2

    def test_hits_limit_respected(self):
        client = app_client()
        w = client.post(
            "/terminal/intel/devwatch",
            json={"deployer_address": "0xDeployerC", "chain": "ethereum"},
            headers=auth_headers(1),
        ).json()
        with get_session() as session:
            for i in range(5):
                session.add(
                    DeployerWatchHit(watch_id=w["id"], token_address=f"0xTok{i}", chain="ethereum")
                )

        r = client.get("/terminal/intel/devwatch/hits?limit=2", headers=auth_headers(1))
        assert len(r.json()["hits"]) == 2

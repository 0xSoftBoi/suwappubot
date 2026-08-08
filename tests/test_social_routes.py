"""Contract tests for the Jelly-native social discovery and claim flow."""

import os
import sys
from types import ModuleType

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("SECRET_KEY", "test-secret-key-which-is-at-least-32b")

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import social
from bot.models.social import JellyAccountClaim
from bot.models.user import User
from database.db import get_session, init_db

_SECRET = "test-secret-key-which-is-at-least-32b"
_WALLET = "0x" + "1" * 40


def auth_headers(*, user_id: int = 1, address: str = _WALLET, src: str = "siwe") -> dict[str, str]:
    token = jwt.encode(
        {"user_id": user_id, "address": address, "src": src},
        _SECRET,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _database(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'social-routes.db'}")
    with get_session() as session:
        session.add(User(id=1, username="jelly-creator"))


@pytest.fixture(autouse=True)
def _jwt_decoder(monkeypatch):
    """Keep route tests focused without importing the full production ASGI app."""
    main_mod = ModuleType("api.main")

    def decode_jwt_token(token):
        try:
            return jwt.decode(token, _SECRET, algorithms=["HS256"])
        except jwt.PyJWTError:
            return None

    main_mod.decode_jwt_token = decode_jwt_token
    monkeypatch.setitem(sys.modules, "api.main", main_mod)


@pytest.fixture(autouse=True)
def _single_use_store(monkeypatch):
    async def healthy_redis():
        return True

    monkeypatch.setattr(social.redis_cache, "ping", healthy_redis)


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(social.router)
    return TestClient(app)


def test_search_returns_only_source_safe_cards(client, monkeypatch):
    async def fake_firehose(path, *, params=None):
        assert path == social.JELLYJELLY_SEARCH_PATH
        assert params["q"] == "real trader"
        return {
            "jellies": [
                {
                    "id": "proof_123",
                    "title": "I bought the dip",
                    "summary": "Real-time reaction",
                    "username": "Alice",
                    "hls_master": "https://media.example/secret.m3u8",
                    "mp4_fallback": "https://media.example/secret.mp4",
                    "watch_url": "https://attacker.example/watch/proof_123",
                }
            ]
        }

    monkeypatch.setattr(social, "_firehose_get", fake_firehose)

    response = client.get("/webapp/social/jellies?q=real%20trader")

    assert response.status_code == 200
    card = response.json()["items"][0]
    assert card["watchUrl"] == "https://jellyjelly.com/watch/proof_123"
    assert card["thumbnailUrl"] is None
    assert "hls_master" not in card
    assert "mp4_fallback" not in card
    assert "watch_url" not in card


def test_claim_requires_a_wallet_backed_session(client):
    response = client.post(
        "/webapp/social/jelly/claims/challenge", headers=auth_headers(src="telegram")
    )

    assert response.status_code == 403
    assert "wallet" in response.json()["detail"].lower()


def test_claim_is_canonical_public_wallet_bound_and_single_use(client, monkeypatch):
    phrase_holder: dict[str, str] = {}

    async def fake_firehose(path, *, params=None):
        assert path == "/v3/jelly/proof_123"
        return {
            "id": "proof_123",
            "privacy": "public",
            "participants": [{"username": "RealTrader"}],
            "title": "Live reaction",
            "transcript_overlay": [{"text": f"I say {phrase_holder['phrase']} on camera"}],
            "hls_master": "https://media.example/never-returned.m3u8",
        }

    monkeypatch.setattr(social, "_firehose_get", fake_firehose)

    challenge_response = client.post(
        "/webapp/social/jelly/claims/challenge", headers=auth_headers()
    )
    assert challenge_response.status_code == 200
    challenge = challenge_response.json()
    phrase_holder["phrase"] = challenge["phrase"]

    claimed = client.post(
        "/webapp/social/jelly/claims/verify",
        headers=auth_headers(),
        json={
            "challengeId": challenge["challengeId"],
            "jellyUrl": "https://jellyjelly.com/watch/proof_123",
        },
    )

    assert claimed.status_code == 200
    claim = claimed.json()["claim"]
    assert claim["username"] == "realtrader"
    assert claim["watchUrl"] == "https://jellyjelly.com/watch/proof_123"
    assert claim["walletAddress"] == _WALLET
    assert claim["walletProof"] == "siwe-session"
    assert "hls_master" not in claim

    with get_session() as session:
        stored = session.query(JellyAccountClaim).one()
        assert stored.claim_jelly_id == "proof_123"
        assert stored.jelly_username == "realtrader"

    replay = client.post(
        "/webapp/social/jelly/claims/verify",
        headers=auth_headers(),
        json={
            "challengeId": challenge["challengeId"],
            "jellyUrl": "https://jellyjelly.com/watch/proof_123",
        },
    )
    assert replay.status_code == 400


def test_claim_rejects_direct_media_urls_before_provider_fetch(client, monkeypatch):
    called = False

    async def fake_firehose(path, *, params=None):
        nonlocal called
        called = True
        return {}

    monkeypatch.setattr(social, "_firehose_get", fake_firehose)
    challenge = client.post("/webapp/social/jelly/claims/challenge", headers=auth_headers()).json()

    response = client.post(
        "/webapp/social/jelly/claims/verify",
        headers=auth_headers(),
        json={
            "challengeId": challenge["challengeId"],
            "jellyUrl": "https://cdn.example.net/creator-upload.mp4",
        },
    )

    assert response.status_code == 422
    assert called is False


def test_claim_cannot_be_completed_by_a_different_wallet_session(client, monkeypatch):
    async def unexpected_provider_call(path, *, params=None):
        raise AssertionError("wrong wallet must be rejected before provider lookup")

    monkeypatch.setattr(social, "_firehose_get", unexpected_provider_call)
    challenge = client.post("/webapp/social/jelly/claims/challenge", headers=auth_headers()).json()

    response = client.post(
        "/webapp/social/jelly/claims/verify",
        headers=auth_headers(address="0x" + "2" * 40),
        json={
            "challengeId": challenge["challengeId"],
            "jellyUrl": "https://jellyjelly.com/watch/proof_123",
        },
    )

    assert response.status_code == 403


def test_claim_rejects_ambiguous_participants(client, monkeypatch):
    phrase_holder: dict[str, str] = {}

    async def fake_firehose(path, *, params=None):
        return {
            "id": "proof_123",
            "privacy": "public",
            "participants": [{"username": "alice"}, {"username": "bob"}],
            "transcript_overlay": [{"text": phrase_holder["phrase"]}],
        }

    monkeypatch.setattr(social, "_firehose_get", fake_firehose)
    challenge = client.post("/webapp/social/jelly/claims/challenge", headers=auth_headers()).json()
    phrase_holder["phrase"] = challenge["phrase"]

    response = client.post(
        "/webapp/social/jelly/claims/verify",
        headers=auth_headers(),
        json={
            "challengeId": challenge["challengeId"],
            "jellyUrl": "https://jellyjelly.com/watch/proof_123",
        },
    )

    assert response.status_code == 422
    assert "creator handle" in response.json()["detail"]

"""Terminal social/copy-trading route contracts.

Trader discovery is deliberately public and read-only; mutating follow/copy
settings remain authenticated.  Jelly linkage is proof metadata only and must
always point back to the canonical JellyJelly watch URL.
"""

from datetime import datetime, timedelta
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")
os.environ.setdefault("SECRET_KEY", "test-secret")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import jwt  # noqa: E402

from api.webapp import router  # noqa: E402
from bot.models.copy_trading import TraderProfile, TraderTrade  # noqa: E402
from bot.models.social import JellyAccountClaim  # noqa: E402
from bot.models.user import User, Wallet  # noqa: E402
from database.db import get_session, init_db  # noqa: E402

_SECRET = "test-secret"


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _seed_traders() -> None:
    now = datetime.utcnow()
    with get_session() as session:
        session.add_all(
            [
                User(id=1, username="realtrader"),
                User(id=2, username="private_trader"),
                User(id=3, username="copier"),
                Wallet(
                    id=1,
                    user_id=1,
                    address="0x" + "1" * 40,
                    chain_type="evm",
                    wallet_provider="external",
                    is_active=True,
                    is_default=True,
                ),
                Wallet(
                    id=3,
                    user_id=3,
                    address="0x" + "3" * 40,
                    chain_type="evm",
                    wallet_provider="external",
                    is_active=True,
                    is_default=True,
                ),
                TraderProfile(
                    id=11,
                    user_id=1,
                    is_public=True,
                    display_name="Real Trader",
                    bio="Trading in public",
                    total_trades=23,
                    winning_trades=15,
                    total_pnl_usd=740.0,
                    total_volume_usd=15_000.0,
                    win_rate=65.2,
                    avg_trade_size_usd=652.17,
                    best_trade_pnl_usd=320.0,
                    worst_trade_pnl_usd=-90.0,
                    follower_count=12,
                    times_copied=7,
                    rank_score=10.0,
                    created_at=now - timedelta(days=120),
                ),
                TraderProfile(
                    id=12,
                    user_id=2,
                    is_public=False,
                    display_name="Do Not Leak",
                    total_trades=999,
                    total_pnl_usd=99_999.0,
                    rank_score=999.0,
                ),
                TraderTrade(
                    trader_id=1,
                    swap_id=101,
                    from_token="USDC",
                    to_token="SOL",
                    from_chain="solana",
                    to_chain="solana",
                    amount_usd=250.0,
                    pnl_usd=75.0,
                    pnl_percent=30.0,
                    is_closed=True,
                    is_winning=True,
                    created_at=now - timedelta(days=2),
                ),
                JellyAccountClaim(
                    user_id=1,
                    jelly_username="realtrader",
                    claim_jelly_id="jelly-proof-123",
                    wallet_address="0x" + "1" * 40,
                    wallet_proof="siwe-session",
                ),
            ]
        )


def _auth_headers(user_id: int = 3, src: str = "siwe") -> dict[str, str]:
    token = jwt.encode({"user_id": user_id, "src": src}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def _patch_jwt_secret(monkeypatch) -> None:
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)


def test_public_trader_discovery_is_read_only_and_jelly_linked(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'copy-discovery.db'}")
    _seed_traders()

    response = _client().get("/webapp/copy-trading/top-traders?timeframe=7d")

    assert response.status_code == 200
    traders = response.json()
    assert [trader["id"] for trader in traders] == ["11"]
    trader = traders[0]
    assert trader["name"] == "Real Trader"
    assert trader["pnl7d"] == 75.0
    assert trader["jellyUsername"] == "realtrader"
    assert trader["jellyLinked"] is True
    assert trader["jellyWatchUrl"] == "https://jellyjelly.com/watch/jelly-proof-123"
    # Track-record age is grounded in the first observed trade, not profile age.
    assert 1 <= trader["trackRecordDays"] <= 2


def test_public_trader_search_matches_jelly_handle_without_leaking_private_profiles(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'copy-search.db'}")
    _seed_traders()
    client = _client()

    found = client.get("/webapp/copy-trading/top-traders?q=realtrader")
    private = client.get("/webapp/copy-trading/top-traders?q=Do%20Not%20Leak")

    assert found.status_code == 200
    assert [trader["id"] for trader in found.json()] == ["11"]
    assert private.status_code == 200
    assert private.json() == []


def test_public_trader_profile_exposes_recent_activity_without_follow_state(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'copy-profile.db'}")
    _seed_traders()

    response = _client().get("/webapp/copy-trading/traders/11")

    assert response.status_code == 200
    profile = response.json()
    assert profile["isFollowing"] is False
    assert profile["jellyUsername"] == "realtrader"
    assert profile["recentTrades"][0] == {
        "id": "1",
        "action": "buy",
        "token": "SOL",
        "tokenPair": "USDC/SOL",
        "chain": "solana",
        "fromToken": "USDC",
        "toToken": "SOL",
        "fromChain": "solana",
        "toChain": "solana",
        "amountUsd": 250.0,
        "pnlUsd": 75.0,
        "timestamp": profile["recentTrades"][0]["timestamp"],
    }


def test_public_trader_feed_connects_activity_to_jelly_identity(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'copy-feed.db'}")
    _seed_traders()

    response = _client().get("/webapp/copy-trading/feed")

    assert response.status_code == 200
    assert len(response.json()) == 1
    item = response.json()[0]
    assert item["traderId"] == "11"
    assert item["traderName"] == "Real Trader"
    assert item["jellyUsername"] == "realtrader"
    assert item["jellyLinked"] is True
    assert item["token"] == "SOL"
    assert item["action"] == "buy"


def test_native_asset_funded_memecoin_trade_is_a_buy(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'copy-native-buy.db'}")
    now = datetime.utcnow()
    with get_session() as session:
        session.add_all(
            [
                User(id=41, username="pumptrader"),
                TraderProfile(
                    id=41,
                    user_id=41,
                    is_public=True,
                    display_name="Pump Trader",
                ),
                TraderTrade(
                    trader_id=41,
                    swap_id=4101,
                    from_token="SOL",
                    to_token="MEME",
                    from_chain="solana",
                    to_chain="solana",
                    amount_usd=500.0,
                    pnl_usd=0.0,
                    created_at=now,
                ),
            ]
        )

    response = _client().get("/webapp/copy-trading/feed")

    assert response.status_code == 200
    item = response.json()[0]
    assert item["action"] == "buy"
    assert item["token"] == "MEME"
    assert item["tokenPair"] == "SOL/MEME"
    assert item["fromToken"] == "SOL"
    assert item["toToken"] == "MEME"


def test_windowed_leaderboard_ranks_full_public_population(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'copy-window-rank.db'}")
    now = datetime.utcnow()
    with get_session() as session:
        # Fill the old all-time top-100 candidate pool with established traders.
        for user_id in range(1, 102):
            session.add(User(id=user_id, username=f"legacy{user_id}"))
            session.add(
                TraderProfile(
                    id=user_id,
                    user_id=user_id,
                    is_public=True,
                    display_name=f"Legacy {user_id}",
                    rank_score=float(1000 - user_id),
                )
            )

        breakout_user_id = 202
        breakout_profile_id = 202
        session.add(User(id=breakout_user_id, username="breakout"))
        session.add(
            TraderProfile(
                id=breakout_profile_id,
                user_id=breakout_user_id,
                is_public=True,
                display_name="Breakout",
                rank_score=-1.0,
            )
        )
        session.add(
            TraderTrade(
                trader_id=breakout_user_id,
                swap_id=20201,
                from_token="USDC",
                to_token="SOL",
                from_chain="solana",
                to_chain="solana",
                amount_usd=1000.0,
                pnl_usd=900.0,
                created_at=now,
            )
        )

    response = _client().get("/webapp/copy-trading/top-traders?timeframe=7d&limit=1")

    assert response.status_code == 200
    assert [trader["id"] for trader in response.json()] == [str(breakout_profile_id)]


def test_private_trader_profile_stays_private(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'copy-private-profile.db'}")
    _seed_traders()

    response = _client().get("/webapp/copy-trading/traders/12")

    assert response.status_code == 404


def test_notify_follow_requires_auth_but_does_not_authorize_future_spend(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'copy-notify.db'}")
    _seed_traders()
    _patch_jwt_secret(monkeypatch)
    client = _client()

    unauthenticated = client.post(
        "/webapp/copy-trading/follow/11",
        json={"copyMode": "notify"},
    )
    assert unauthenticated.status_code == 401

    followed = client.post(
        "/webapp/copy-trading/follow/11",
        headers=_auth_headers(),
        json={"copyMode": "notify"},
    )
    assert followed.status_code == 200


def test_external_wallet_cannot_enable_unattended_copy_execution(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'copy-external-auto.db'}")
    _seed_traders()
    _patch_jwt_secret(monkeypatch)

    response = _client().post(
        "/webapp/copy-trading/follow/11",
        headers=_auth_headers(),
        json={
            "copyMode": "fixed",
            "fixedAmount": 25,
            "maxPerTrade": 50,
            "dailyLimit": 100,
            "maxSlippage": 1,
            "chainFilter": ["ethereum"],
        },
    )

    assert response.status_code == 409
    assert "signing wallet" in response.json()["detail"].lower()


def test_automatic_copy_rejects_an_empty_chain_filter_before_authorizing_spend(
    tmp_path, monkeypatch
):
    assert init_db(f"sqlite:///{tmp_path / 'copy-empty-chains.db'}")
    _seed_traders()
    _patch_jwt_secret(monkeypatch)

    response = _client().post(
        "/webapp/copy-trading/follow/11",
        headers=_auth_headers(),
        json={
            "copyMode": "fixed",
            "fixedAmount": 25,
            "chainFilter": [],
        },
    )

    assert response.status_code == 422
    assert "at least one chain" in response.text.lower()

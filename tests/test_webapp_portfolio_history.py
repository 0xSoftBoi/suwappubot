import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

from datetime import datetime, timedelta, timezone  # noqa: E402

import jwt  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from api.webapp import router, maybe_record_portfolio_snapshot  # noqa: E402
from bot.models.portfolio_snapshot import PortfolioValueSnapshot  # noqa: E402
from bot.models.user import User, Wallet  # noqa: E402
from database.db import get_session, init_db  # noqa: E402

_SECRET = "test-secret"


def auth_headers(user_id: int = 1):
    token = jwt.encode({"user_id": user_id}, _SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def app_client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def seed_user_wallet(user_id: int = 1):
    with get_session() as session:
        session.add_all(
            [
                User(id=user_id, username="terminal-user"),
                Wallet(
                    id=user_id,
                    user_id=user_id,
                    address="0xportfoliowallet",
                    chain_type="evm",
                    wallet_provider="turnkey",
                    turnkey_wallet_id="wallet-id",
                    turnkey_account_id="account-id",
                    is_active=True,
                    is_default=True,
                ),
            ]
        )


def _patch_jwt_secret(monkeypatch):
    import api.main as main_mod

    monkeypatch.setattr(main_mod, "JWT_SECRET", _SECRET)


def _seed_snapshot(user_id: int, total_usd: float, when: datetime, source: str = "refresh"):
    with get_session() as session:
        session.add(
            PortfolioValueSnapshot(
                user_id=user_id,
                total_usd=total_usd,
                token_count=1,
                source=source,
                captured_at=when,
            )
        )


def test_history_requires_auth(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'history-401.db'}")
    client = app_client()
    response = client.get("/webapp/portfolio/history?period=7d")
    assert response.status_code == 401


def test_history_empty_when_no_snapshots(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'history-empty.db'}")
    seed_user_wallet()
    _patch_jwt_secret(monkeypatch)

    client = app_client()
    response = client.get("/webapp/portfolio/history?period=7d", headers=auth_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["period"] == "7d"
    assert body["points"] == []


def test_history_unknown_period_is_400(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'history-bad-period.db'}")
    seed_user_wallet()
    _patch_jwt_secret(monkeypatch)

    client = app_client()
    response = client.get("/webapp/portfolio/history?period=eternity", headers=auth_headers())
    assert response.status_code == 400


def test_history_filters_by_period(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'history-period-filter.db'}")
    seed_user_wallet()
    _patch_jwt_secret(monkeypatch)

    now = datetime.now(timezone.utc)
    _seed_snapshot(1, 100.0, now - timedelta(days=40))  # outside 30d, inside all
    _seed_snapshot(1, 200.0, now - timedelta(days=10))  # inside 30d, outside 7d
    _seed_snapshot(1, 300.0, now - timedelta(hours=1))  # inside everything

    client = app_client()

    resp_7d = client.get("/webapp/portfolio/history?period=7d", headers=auth_headers())
    values_7d = [p["value"] for p in resp_7d.json()["points"]]
    assert values_7d == [300.0]

    resp_30d = client.get("/webapp/portfolio/history?period=30d", headers=auth_headers())
    values_30d = [p["value"] for p in resp_30d.json()["points"]]
    assert values_30d == [200.0, 300.0]

    resp_all = client.get("/webapp/portfolio/history?period=all", headers=auth_headers())
    values_all = [p["value"] for p in resp_all.json()["points"]]
    assert values_all == [100.0, 200.0, 300.0]


def test_history_downsamples_to_at_most_300_points(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'history-downsample.db'}")
    seed_user_wallet()
    _patch_jwt_secret(monkeypatch)

    now = datetime.now(timezone.utc)
    for i in range(500):
        _seed_snapshot(1, float(i), now - timedelta(minutes=500 - i))

    client = app_client()
    response = client.get("/webapp/portfolio/history?period=all", headers=auth_headers())
    points = response.json()["points"]
    assert len(points) <= 300
    # Still ordered ascending by time, first/last preserved.
    times = [p["time"] for p in points]
    assert times == sorted(times)
    assert points[0]["value"] == 0.0
    assert points[-1]["value"] == 499.0


def test_opportunistic_snapshot_deduped_within_five_minutes(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'history-dedup.db'}")
    seed_user_wallet()

    with get_session() as session:
        maybe_record_portfolio_snapshot(
            session, user_id=1, total_usd=10.0, token_count=1, source="request"
        )
        maybe_record_portfolio_snapshot(
            session, user_id=1, total_usd=20.0, token_count=1, source="request"
        )

    with get_session() as session:
        rows = (
            session.query(PortfolioValueSnapshot).filter(PortfolioValueSnapshot.user_id == 1).all()
        )
        assert len(rows) == 1
        assert rows[0].total_usd == 10.0

    # An old-enough prior snapshot should allow a new insert.
    with get_session() as session:
        row = (
            session.query(PortfolioValueSnapshot)
            .filter(PortfolioValueSnapshot.user_id == 1)
            .first()
        )
        row.captured_at = datetime.now(timezone.utc) - timedelta(minutes=10)

    with get_session() as session:
        maybe_record_portfolio_snapshot(
            session, user_id=1, total_usd=30.0, token_count=1, source="request"
        )

    with get_session() as session:
        rows = (
            session.query(PortfolioValueSnapshot)
            .filter(PortfolioValueSnapshot.user_id == 1)
            .order_by(PortfolioValueSnapshot.captured_at)
            .all()
        )
        assert len(rows) == 2
        assert rows[-1].total_usd == 30.0


def test_terminal_portfolio_endpoint_returns_real_balances_and_snapshots(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'history-terminal-portfolio.db'}")
    seed_user_wallet()
    _patch_jwt_secret(monkeypatch)

    async def fake_get_all_balances(self, address, chain_type):
        return {"ethereum": {"ETH": 1.5}}

    monkeypatch.setattr(
        "bot.services.wallet.WalletService.get_balances_by_address", fake_get_all_balances
    )

    async def fake_get_prices(self, tokens):
        # Pin every symbol at $1 so totals equal balances in this test.
        return {t.upper(): 1.0 for t in tokens}

    monkeypatch.setattr("bot.services.price_service.PriceService.get_prices", fake_get_prices)

    client = app_client()
    response = client.get("/webapp/portfolio", headers=auth_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["totalUsdValue"] == 1.5
    assert len(body["tokens"]) == 1
    assert body["tokens"][0]["symbol"] == "ETH"

    with get_session() as session:
        rows = (
            session.query(PortfolioValueSnapshot)
            .filter(PortfolioValueSnapshot.user_id == 1, PortfolioValueSnapshot.source == "request")
            .all()
        )
        assert len(rows) == 1
        assert rows[0].total_usd == 1.5


def test_snapshotter_writes_refresh_rows(tmp_path, monkeypatch):
    assert init_db(f"sqlite:///{tmp_path / 'history-snapshotter.db'}")
    seed_user_wallet()

    async def fake_get_all_balances(self, address, chain_type):
        return {"ethereum": {"ETH": 2.0}}

    monkeypatch.setattr(
        "bot.services.wallet.WalletService.get_balances_by_address", fake_get_all_balances
    )

    async def fake_get_prices(self, tokens):
        return {t.upper(): 1.0 for t in tokens}

    monkeypatch.setattr("bot.services.price_service.PriceService.get_prices", fake_get_prices)

    from bot.services.portfolio_snapshotter import PortfolioSnapshotter
    import asyncio

    snapshotter = PortfolioSnapshotter(snapshot_interval=900)
    snapshotter._running = True
    asyncio.run(snapshotter._snapshot_all())

    with get_session() as session:
        rows = (
            session.query(PortfolioValueSnapshot)
            .filter(PortfolioValueSnapshot.user_id == 1, PortfolioValueSnapshot.source == "refresh")
            .all()
        )
        assert len(rows) == 1
        assert rows[0].total_usd == 2.0

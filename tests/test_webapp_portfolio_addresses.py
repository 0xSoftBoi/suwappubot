"""
Unit tests for get_my_portfolio() real-address resolution (api/webapp.py).

MONEY-PATH adjacent: the webapp Send flow gates ERC-20 sends on whether
`address` is a real contract address (isAddress() check). This test asserts:
  - native assets (e.g. ETH on ethereum) get the native sentinel ("")
  - known ERC-20 tokens get the real checksummed address + decimals from
    bot/config/tokens.py
  - tokens with no known address for a chain get the explicit "0x..."
    placeholder (never the native sentinel), so the client gate stays closed
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("SECRET_KEY", "test-secret")

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.webapp import router, get_telegram_user, TelegramUser
from bot.config.tokens import TOKENS
from database.db import get_session, init_db
from bot.models.user import User, Wallet


def app_client():
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_telegram_user] = lambda: TelegramUser(
        id=1, first_name="Test", username="tester"
    )
    return TestClient(app)


def seed_user_wallet():
    with get_session() as session:
        session.add_all(
            [
                User(id=1, telegram_id=1, username="tester"),
                Wallet(
                    id=1,
                    user_id=1,
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


def test_portfolio_returns_real_addresses_and_decimals(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'webapp-portfolio.db'}")
    seed_user_wallet()

    usdt_eth_address = TOKENS["USDT"].addresses["ethereum"]
    usdt_decimals = TOKENS["USDT"].decimals
    bnb_eth_address = TOKENS["BNB"].addresses["ethereum"]

    fake_balances = {
        "ethereum": {
            "ETH": 1.5,  # native
            "USDT": 100.0,  # known ERC-20
            "TOTALLY_UNKNOWN_TOKEN": 5.0,  # no address in TOKENS
            "BNB": 2.0,  # ERC-20 wrapped BNB on ethereum, NOT native here
        },
        "bsc": {
            "BNB": 3.0,  # native on bsc
            "USDT": 50.0,  # BEP-20 USDT — per-chain decimals override (18dp)
        },
        "citrea": {
            "cBTC": 0.1,  # native
            "BTC": 0.1,  # TOKENS["BTC"] resolves to the zero address on
            # citrea (it IS native cBTC under a different symbol) — must be
            # skipped, not emitted as a zero-address "native" duplicate row.
        },
    }

    with patch(
        "bot.services.wallet.WalletService.get_all_balances",
        new=AsyncMock(return_value=fake_balances),
    ):
        client = app_client()
        resp = client.get(
            "/webapp/users/me/portfolio",
            headers={"X-Telegram-Init-Data": "irrelevant-because-overridden"},
        )

    assert resp.status_code == 200
    body = resp.json()["tokens"]
    tokens = {(t["chain"], t["symbol"]): t for t in body}

    # Native asset -> empty-string sentinel, native decimals
    assert tokens[("ethereum", "ETH")]["address"] == ""
    assert tokens[("ethereum", "ETH")]["decimals"] == 18

    # Known ERC-20 on ethereum -> real contract address + config decimals
    assert tokens[("ethereum", "USDT")]["address"] == usdt_eth_address
    assert tokens[("ethereum", "USDT")]["address"] != "0x..."
    assert tokens[("ethereum", "USDT")]["decimals"] == usdt_decimals

    # Unknown token -> explicit non-native placeholder, not the native sentinel
    assert tokens[("ethereum", "TOTALLY_UNKNOWN_TOKEN")]["address"] == "0x..."
    assert tokens[("ethereum", "TOTALLY_UNKNOWN_TOKEN")]["decimals"] is None

    # BNB is an ERC-20 on ethereum (NOT ethereum's native asset) -> must get
    # the real wrapped-BNB contract address, never the native sentinel.
    assert tokens[("ethereum", "BNB")]["address"] == bnb_eth_address
    assert tokens[("ethereum", "BNB")]["address"] != ""

    # BEP-20 USDT on bsc is 18dp, NOT the 6dp top-level default — locks in the
    # get_token_decimals() per-chain override fix.
    assert tokens[("bsc", "USDT")]["decimals"] == 18
    # BNB is bsc's native asset -> native sentinel + native decimals.
    assert tokens[("bsc", "BNB")]["address"] == ""
    assert tokens[("bsc", "BNB")]["decimals"] == 18

    # citrea: native cBTC row present as usual...
    assert tokens[("citrea", "cBTC")]["address"] == ""
    assert tokens[("citrea", "cBTC")]["decimals"] == 18
    # ...but TOKENS["BTC"] on citrea resolves to the zero address (it's really
    # native cBTC under another symbol) -> that row must be skipped entirely,
    # never emitted as a zero-address duplicate "native" row.
    assert ("citrea", "BTC") not in tokens

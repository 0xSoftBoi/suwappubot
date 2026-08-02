"""Wave 4 correctness tests: PnL token decimals + CoW appData hash."""

import asyncio
import os

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from web3 import Web3
import json as _json

from database.db import get_session, init_db
from bot.models.user import User
from bot.models.swap import SwapTransaction

# --- CoW appData hash ------------------------------------------------------


def test_cow_appdata_is_full_32_byte_hash():
    from bot.services.cow_api import cow_api

    app_data = cow_api.app_data
    assert app_data.startswith("0x")
    assert len(app_data) == 66  # 0x + 64 hex chars = full 32 bytes
    # Matches keccak of the canonical JSON document.
    expected_doc = _json.dumps(
        {"appCode": "suwappu", "version": "1.0.0", "metadata": {}},
        separators=(",", ":"),
        sort_keys=True,
    )
    assert app_data == Web3.to_hex(Web3.keccak(text=expected_doc))


# --- PnL uses real token decimals -----------------------------------------


@pytest.fixture()
def sqlite_db(tmp_path):
    assert init_db(f"sqlite:///{tmp_path / 'pnl.db'}")
    with get_session() as session:
        session.add(User(id=1, telegram_id=1, username="u"))
    yield


def test_pnl_uses_token_decimals_not_hardcoded_6(sqlite_db, monkeypatch):
    # A completed swap into WETH (18 decimals): 1 WETH out for $2000 in.
    with get_session() as session:
        session.add(
            SwapTransaction(
                id=1,
                user_id=1,
                from_chain="ethereum",
                from_token="USDC",
                from_amount="2000000000",
                from_amount_usd=2000.0,
                to_chain="ethereum",
                to_token="WETH",
                to_amount=str(10**18),
                status="completed",
                tx_hash="0xabc",
            )
        )

    import bot.services.pnl as pnl_mod

    async def fake_get_prices(tokens):
        return {"WETH": 2500.0}

    monkeypatch.setattr(pnl_mod.price_service, "get_prices", fake_get_prices)

    data = asyncio.run(pnl_mod.pnl_service.get_swap_pnl_data(1))
    assert data is not None
    # 1.0 WETH for $2000 -> entry price $2000 (the old /1e6 bug gave ~$2e-9).
    assert data["entry_price"] == pytest.approx(2000.0, rel=1e-6)
    assert data["current_price"] == 2500.0
    assert data["roi_percent"] == pytest.approx(25.0, rel=1e-6)

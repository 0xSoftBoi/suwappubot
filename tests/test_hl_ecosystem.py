"""Tests for the deep HyperLiquid ecosystem layer — validator ranking, vault
snapshot parsing, HYPE pricing, and holdings aggregation. Pure logic only
(no live network / funds): the client's network calls are stubbed.
"""

import asyncio
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.services.hyperliquid_client import HyperLiquidClient, hype_to_wei, HLP_VAULT_ADDRESS


def _stub_info(hl, payload):
    async def _info(body):
        return payload

    hl._info = _info


# --- validator ranking ------------------------------------------------------

_VALIDATORS = [
    {
        "validator": "0xaaa",
        "name": "HighAPR",
        "isJailed": False,
        "isActive": True,
        "commission": "0.05",
        "stake": 1000_00000000,
        "stats": [["day", {"predictedApr": "0.03"}], ["week", {"predictedApr": "0.02"}]],
    },
    {
        "validator": "0xbbb",
        "name": "LowAPR",
        "isJailed": False,
        "isActive": True,
        "commission": "0.10",
        "stake": 500_00000000,
        "stats": [["day", {"predictedApr": "0.01"}]],
    },
    {
        "validator": "0xccc",
        "name": "Jailed",
        "isJailed": True,
        "isActive": True,
        "commission": "0.00",
        "stake": 1,
        "stats": [["day", {"predictedApr": "0.99"}]],
    },
    {
        "validator": "0xddd",
        "name": "Inactive",
        "isJailed": False,
        "isActive": False,
        "commission": "0.00",
        "stake": 1,
        "stats": [["day", {"predictedApr": "0.99"}]],
    },
]


def test_ranked_validators_filters_and_sorts():
    hl = HyperLiquidClient()
    _stub_info(hl, _VALIDATORS)
    ranked = asyncio.run(hl.get_ranked_validators(limit=8))
    # Jailed + inactive excluded.
    names = [v["name"] for v in ranked]
    assert names == ["HighAPR", "LowAPR"]
    # APR/commission parsed to percent; stake converted from wei.
    top = ranked[0]
    assert round(top["apr_pct"], 4) == 3.0
    assert round(top["commission_pct"], 4) == 5.0
    assert round(top["stake_hype"], 2) == 1000.0


def test_ranked_validators_respects_limit():
    hl = HyperLiquidClient()
    _stub_info(hl, _VALIDATORS)
    assert len(asyncio.run(hl.get_ranked_validators(limit=1))) == 1


# --- vault snapshot ---------------------------------------------------------

_VAULT = {
    "name": "Hyperliquidity Provider (HLP)",
    "vaultAddress": HLP_VAULT_ADDRESS,
    "apr": 0.12,
    "leaderCommission": 0.10,
    "allowDeposits": True,
    "portfolio": [
        ["day", {"accountValueHistory": [[1, "100.0"], [2, "282000000.5"]]}],
        ["week", {"accountValueHistory": [[1, "1.0"]]}],
    ],
    "followers": [
        {
            "user": "0xUSER",
            "vaultEquity": "599.5",
            "pnl": "75.3",
            "allTimePnl": "151.4",
            "lockupUntil": 1770680880422,
        },
        {"user": "0xother", "vaultEquity": "1.0", "pnl": "0", "allTimePnl": "0", "lockupUntil": 0},
    ],
}


def test_vault_snapshot_parses_apr_tvl_and_user():
    hl = HyperLiquidClient()
    _stub_info(hl, _VAULT)
    snap = asyncio.run(hl.get_vault_snapshot(HLP_VAULT_ADDRESS, "0xuser"))  # case-insensitive
    assert round(snap["apr_pct"], 2) == 12.0
    assert snap["tvl_usd"] == 282000000.5  # last point of the daily history
    assert snap["allow_deposits"] is True
    assert round(snap["leader_commission_pct"], 2) == 10.0
    assert snap["user"] is not None
    assert snap["user"]["equity_usd"] == 599.5
    assert snap["user"]["all_time_pnl_usd"] == 151.4


def test_vault_snapshot_user_absent():
    hl = HyperLiquidClient()
    _stub_info(hl, _VAULT)
    snap = asyncio.run(hl.get_vault_snapshot(HLP_VAULT_ADDRESS, "0xnobody"))
    assert snap["user"] is None


# --- HYPE price -------------------------------------------------------------


def test_hype_price_from_dict_mids():
    hl = HyperLiquidClient()
    _stub_info(hl, {"HYPE": "42.5", "BTC": "100000"})
    assert asyncio.run(hl.get_hype_price()) == 42.5


def test_hype_price_missing_returns_zero():
    hl = HyperLiquidClient()
    _stub_info(hl, {"BTC": "100000"})
    assert asyncio.run(hl.get_hype_price()) == 0.0


# --- wei conversion + constant ---------------------------------------------


def test_hype_to_wei_and_hlp_constant():
    assert hype_to_wei(1) == 100_000_000
    assert HLP_VAULT_ADDRESS.startswith("0x") and len(HLP_VAULT_ADDRESS) == 42

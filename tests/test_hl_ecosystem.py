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


# --- testnet wiring ---------------------------------------------------------


def test_testnet_client_targets_testnet_and_signs_b():
    main = HyperLiquidClient(testnet=False)
    test = HyperLiquidClient(testnet=True)
    assert main.is_mainnet is True and "api.hyperliquid.xyz" in main.INFO_URL
    assert test.is_mainnet is False and "testnet" in test.INFO_URL
    # Same action signs differently per network (phantom-agent source "a" vs "b").
    action = {"type": "claimRewards"}
    pk = "0x0123456789012345678901234567890123456789012345678901234567890123"
    assert main._sign_action(action, 1700000000000, pk) != test._sign_action(
        action, 1700000000000, pk
    )


# --- spot trading: impostor-safe asset resolution (money path) --------------

_REAL_HYPE_ID = "0x0d01dc56dcaaca66ad901c959b4011ec"

_SPOT_META = {
    "tokens": [
        {"name": "USDC", "index": 0, "isCanonical": True, "szDecimals": 8, "tokenId": "0xusdc"},
        {"name": "PURR", "index": 1, "isCanonical": True, "szDecimals": 0, "tokenId": "0xpurr"},
        # Real HYPE: non-canonical, must be matched by tokenId.
        {
            "name": "HYPE",
            "index": 150,
            "isCanonical": False,
            "szDecimals": 2,
            "tokenId": _REAL_HYPE_ID,
        },
        # Impostor sharing the HYPE name with a different id — must be ignored.
        {"name": "HYPE", "index": 999, "isCanonical": False, "szDecimals": 2, "tokenId": "0xSCAM"},
        # A non-canonical token that is NOT HYPE — resolving by name must refuse it.
        {"name": "WOW", "index": 98, "isCanonical": False, "szDecimals": 2, "tokenId": "0xwow"},
    ],
    "universe": [
        {"tokens": [1, 0], "name": "PURR/USDC", "index": 0, "isCanonical": True},
        {"tokens": [150, 0], "name": "@107", "index": 107, "isCanonical": False},
        {"tokens": [999, 0], "name": "@500", "index": 500, "isCanonical": False},
        {"tokens": [98, 0], "name": "@109", "index": 109, "isCanonical": False},
    ],
}


def _stub_spot_meta(hl):
    async def _meta():
        return _SPOT_META

    hl._get_spot_meta = _meta


def test_spot_resolve_hype_by_token_id_not_name():
    hl = HyperLiquidClient()
    _stub_spot_meta(hl)
    a = asyncio.run(hl.resolve_spot_asset("HYPE"))
    # Must pick the REAL HYPE (index 150 → universe 107 → asset 10107), not the scam.
    assert a["asset_id"] == 10107
    assert a["sz_decimals"] == 2
    assert a["base_index"] == 150


def test_spot_resolve_canonical_purr():
    hl = HyperLiquidClient()
    _stub_spot_meta(hl)
    a = asyncio.run(hl.resolve_spot_asset("PURR"))
    assert a["asset_id"] == 10000  # 10000 + universe index 0
    assert a["sz_decimals"] == 0


def test_spot_resolve_explicit_index():
    hl = HyperLiquidClient()
    _stub_spot_meta(hl)
    a = asyncio.run(hl.resolve_spot_asset("@500"))
    assert a["asset_id"] == 10500


def test_spot_resolve_refuses_noncanonical_by_name():
    hl = HyperLiquidClient()
    _stub_spot_meta(hl)
    # WOW is non-canonical and not the pinned HYPE → refuse (anti-impostor).
    assert asyncio.run(hl.resolve_spot_asset("WOW")) is None
    assert asyncio.run(hl.resolve_spot_asset("NOPE")) is None


def test_spot_price_rounding_rules():
    f = HyperLiquidClient._round_spot_price
    assert f(73.20491, 2) == "73.205"  # 5 sig figs, ≤6 dp
    assert f(0.10435612, 0) == "0.10436"  # ≤8 dp, 5 sig figs
    assert f(0, 2) == "0"


# --- spot balances + valuation ---------------------------------------------


def _stub_dispatch(hl, by_type):
    async def _info(body):
        return by_type.get(body.get("type"))

    hl._info = _info


def test_spot_balances_filters_zero():
    hl = HyperLiquidClient()
    _stub_dispatch(
        hl,
        {
            "spotClearinghouseState": {
                "balances": [
                    {"coin": "USDC", "token": 0, "total": "100.0", "hold": "0.0"},
                    {"coin": "HYPE", "token": 150, "total": "2.0", "hold": "0.5"},
                    {"coin": "DUST", "token": 7, "total": "0.0", "hold": "0.0"},
                ]
            }
        },
    )
    bals = asyncio.run(hl.get_spot_balances("0xabc"))
    coins = {b["coin"] for b in bals}
    assert coins == {"USDC", "HYPE"}  # zero-balance DUST dropped


def test_spot_value_usd_prices_usdc_and_tokens():
    hl = HyperLiquidClient()
    ctxs = [
        {"coin": "PURR/USDC", "midPx": "0.10"},
        {"coin": "@107", "midPx": "73.2"},
    ]
    _stub_dispatch(
        hl,
        {
            "spotClearinghouseState": {
                "balances": [
                    {"coin": "USDC", "token": 0, "total": "100.0", "hold": "0"},
                    {"coin": "HYPE", "token": 150, "total": "2.0", "hold": "0"},
                    # Impostor HYPE (token 999) must NOT be priced off the real market.
                    {"coin": "HYPE", "token": 999, "total": "5.0", "hold": "0"},
                ]
            },
            "spotMetaAndAssetCtxs": [_SPOT_META, ctxs],
        },
    )
    val = asyncio.run(hl.get_spot_value_usd("0xabc"))
    # USDC 100 + real HYPE 2*73.2; impostor (pair @500 has no mid) contributes 0.
    assert round(val, 2) == round(100 + 2 * 73.2, 2)  # 246.40

"""Tests for the Morpho Blue (Base) cbBTC/USDC borrow + MetaMorpho earn integration.

Covers:
- bot/config/morpho_config.py — market id derivation (keccak(abi.encode(params)))
  asserted against the hardcoded, on-chain-verified MARKET_ID
- bot/services/morpho_api.py  — shares→assets mulDivUp math (virtual offsets),
  LTV / health-factor / liquidation-price fixtures, open_borrow LTV cap,
  withdraw health floor, full-repay shares-exact path, vault approve/deposit
  and redeem argument shapes, GraphQL→on-chain APY fallback

All web3 / HTTP interaction is mocked — no network.
"""

import asyncio
import math
import os
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402
from eth_abi import encode as abi_encode  # noqa: E402
from web3 import Web3  # noqa: E402

from bot.config.morpho_config import (  # noqa: E402
    CBBTC,
    IRM,
    LLTV,
    MARKET_ID,
    MAX_LTV,
    MORPHO_BLUE,
    ORACLE,
    USDC_BASE,
    WAD,
    assert_market_id,
    compute_market_id,
)
from bot.services.morpho_api import (  # noqa: E402
    SECONDS_PER_YEAR,
    MorphoAPI,
    MorphoError,
    compute_health_factor,
    compute_liquidation_price,
    compute_ltv,
    collateral_value_usdc_raw,
    max_borrow_usdc_raw,
    rate_per_second_to_apy,
    shares_to_assets_up,
)

# ---------------------------------------------------------------------------
# shared fixtures
# ---------------------------------------------------------------------------

PRICE = 63_486 * 10**34  # $63,486/BTC in the oracle's 1e34 USD scale
ONE_CBBTC = 10**8
DEBT_30K = 30_000 * 10**6

USER = Web3.to_checksum_address("0x1111111111111111111111111111111111111111")


class FakeWallet:
    address = USER


def _state(**overrides):
    base = {
        "total_supply_assets": 100_000_000 * 10**6,
        "total_supply_shares": 100_000_000 * 10**6 * 10**6,
        "total_borrow_assets": 50_000_000 * 10**6,
        "total_borrow_shares": 50_000_000 * 10**6 * 10**6,
        "last_update": 1_700_000_000,
        "fee": 0,
        "price": PRICE,
        "supply_shares": 0,
        "borrow_shares": 0,
        "collateral_raw": 0,
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# market id derivation
# ---------------------------------------------------------------------------


class TestMarketId:
    def test_market_id_matches_keccak_of_params(self):
        # Independent re-derivation: keccak256(abi.encode(MarketParams)) must
        # equal the verified hardcoded id — guards against any address/LLTV typo.
        encoded = abi_encode(
            ["(address,address,address,address,uint256)"],
            [(USDC_BASE, CBBTC, ORACLE, IRM, LLTV)],
        )
        computed = Web3.keccak(encoded).hex()
        if not computed.startswith("0x"):
            computed = "0x" + computed
        assert computed.lower() == MARKET_ID.lower()

    def test_compute_market_id_helper_agrees(self):
        c = compute_market_id()
        if not c.startswith("0x"):
            c = "0x" + c
        assert c.lower() == MARKET_ID.lower()

    def test_assert_market_id_passes(self):
        assert_market_id()  # must not raise

    def test_assert_market_id_catches_typo(self):
        # A typo'd params tuple hashes to a different id...
        bad = (CBBTC, USDC_BASE, ORACLE, IRM, LLTV)  # swapped loan/collateral
        c = compute_market_id(bad)
        assert c.lower().removeprefix("0x") != MARKET_ID.lower().removeprefix("0x")
        # ...and a wrong hardcoded id makes the startup assertion raise.
        with patch("bot.config.morpho_config.MARKET_ID", "0x" + "00" * 32):
            with pytest.raises(AssertionError):
                assert_market_id()


# ---------------------------------------------------------------------------
# debt math: shares → assets, mulDivUp with virtual offsets
# ---------------------------------------------------------------------------


class TestSharesMath:
    def test_zero_shares_zero_debt(self):
        assert shares_to_assets_up(0, 10**12, 10**18) == 0

    def test_rounds_up(self):
        # ceil(1e6 * (2_000_000 + 1) / (1_000_000 + 1e6))
        # = ceil(2_000_001_000_000 / 2_000_000) = ceil(1_000_000.5) = 1_000_001
        assert shares_to_assets_up(10**6, 2_000_000, 1_000_000) == 1_000_001

    def test_exact_division_no_extra(self):
        # shares*(ta+1) divisible by (ts+1e6): 3e6 * (1_999_999 + 1) / (5e6 + 1e6)
        # = 6_000_000_000_000 / 6_000_000 = 1_000_000 exactly
        assert shares_to_assets_up(3 * 10**6, 1_999_999, 5 * 10**6) == 1_000_000

    def test_hand_computed_market_fixture(self):
        shares = 7_123_456_789
        ta = 50_000_000 * 10**6
        ts = 50_000_000 * 10**6 * 10**6
        num = shares * (ta + 1)
        den = ts + 10**6
        expected = num // den + (1 if num % den else 0)
        assert shares_to_assets_up(shares, ta, ts) == expected
        # and it never under-reports debt vs floor division
        assert shares_to_assets_up(shares, ta, ts) >= num // den


# ---------------------------------------------------------------------------
# LTV / health factor / liquidation price fixtures
# ---------------------------------------------------------------------------


class TestHealthMath:
    def test_collateral_value(self):
        # 1.0 cbBTC at $63,486 → 63,486 USDC raw (6dp)
        assert collateral_value_usdc_raw(ONE_CBBTC, PRICE) == 63_486 * 10**6

    def test_max_borrow_at_lltv(self):
        # 63,486 * 0.86 = 54,597.96 USDC
        assert max_borrow_usdc_raw(ONE_CBBTC, PRICE) == 54_597_960_000

    def test_ltv_fixture(self):
        ltv = compute_ltv(ONE_CBBTC, PRICE, DEBT_30K)
        assert ltv == pytest.approx(30_000 / 63_486, rel=1e-9)
        assert ltv == pytest.approx(0.4726, abs=5e-4)

    def test_health_factor_fixture(self):
        hf = compute_health_factor(ONE_CBBTC, PRICE, DEBT_30K)
        assert hf == pytest.approx(54_597.96 / 30_000, rel=1e-9)
        assert hf == pytest.approx(1.8199, abs=5e-4)
        # hf == LLTV / ltv
        assert hf == pytest.approx(0.86 / compute_ltv(ONE_CBBTC, PRICE, DEBT_30K), rel=1e-9)

    def test_liquidation_price_fixture(self):
        # debt / (collateral * LLTV) = 30,000 / 0.86 ≈ $34,883.72
        liq = compute_liquidation_price(ONE_CBBTC, DEBT_30K)
        assert liq == pytest.approx(30_000 / 0.86, rel=1e-9)
        assert liq == pytest.approx(34_883.72, abs=0.01)

    def test_no_debt_edges(self):
        assert compute_health_factor(ONE_CBBTC, PRICE, 0) == math.inf
        assert compute_ltv(ONE_CBBTC, PRICE, 0) == 0.0
        assert compute_liquidation_price(ONE_CBBTC, 0) == 0.0
        assert compute_liquidation_price(0, DEBT_30K) == 0.0

    def test_rate_to_apy(self):
        # 3% simple APR per-second rate → compounded APY ≈ e^0.03 - 1
        rate = int(0.03 * WAD) // SECONDS_PER_YEAR
        apy = rate_per_second_to_apy(rate)
        assert apy == pytest.approx(math.expm1(rate / WAD * SECONDS_PER_YEAR), rel=1e-12)


# ---------------------------------------------------------------------------
# write-path harness (mocks _failover/_read_state/contract accessors/sends)
# ---------------------------------------------------------------------------


def _make_api(state, cbbtc_balance=10**12, usdc_balance=10**12):
    api = MorphoAPI()
    web3 = MagicMock()

    api._failover = lambda op, attempts=4: op(web3)
    api._read_state = lambda w3, user=None: dict(state)

    tokens = {}

    def _erc20(w3, address):
        m = tokens.setdefault(address.lower(), MagicMock(name=f"erc20:{address[:8]}"))
        bal = cbbtc_balance if address.lower() == CBBTC.lower() else usdc_balance
        m.functions.balanceOf.return_value.call.return_value = bal
        return m

    morpho = MagicMock(name="morpho")
    vaults = {}

    def _vault(w3, address):
        return vaults.setdefault(address.lower(), MagicMock(name=f"vault:{address[:8]}"))

    api._erc20 = _erc20
    api._morpho = lambda w3: morpho
    api._vault = _vault

    sent = []

    def _send_seq(w3, wallet, fns):
        sent.extend(fns)
        return [f"0xtx{i}" for i in range(len(fns))]

    def _build_and_send(w3, wallet, fn):
        sent.append(fn)
        return "0xtx_single"

    api._send_seq = _send_seq
    api._build_and_send = _build_and_send
    return api, morpho, tokens, vaults, sent


class TestOpenBorrow:
    def test_rejects_borrow_over_max_ltv(self):
        api, *_ = _make_api(_state())
        # 1 cbBTC → value 63,486; cap = int(63,486e6 * 0.645) = 40,948.47 USDC
        max_debt = int(63_486 * 10**6 * MAX_LTV)
        with pytest.raises(MorphoError, match="LTV cap"):
            api.open_borrow(FakeWallet(), ONE_CBBTC, max_debt + 1)

    def test_allows_borrow_at_50_pct_ltv(self):
        api, morpho, tokens, _, sent = _make_api(_state())
        borrow = 31_743 * 10**6  # exactly 50% LTV
        txs = api.open_borrow(FakeWallet(), ONE_CBBTC, borrow)
        assert len(txs) == 3  # approve, supplyCollateral, borrow
        # borrow called with exact assets, shares=0, onBehalf=receiver=user
        morpho.functions.borrow.assert_called_once()
        args = morpho.functions.borrow.call_args.args
        assert args[1] == borrow and args[2] == 0
        assert args[3] == USER and args[4] == USER
        # exact-amount cbBTC approval to Morpho Blue (never unlimited)
        cbbtc = tokens[CBBTC.lower()]
        cbbtc.functions.approve.assert_called_once_with(
            Web3.to_checksum_address(MORPHO_BLUE), ONE_CBBTC
        )

    def test_cap_counts_existing_debt(self):
        shares = 20_000 * 10**6 * 10**6  # ≈ 20,000 USDC existing debt
        api, *_ = _make_api(_state(borrow_shares=shares, collateral_raw=ONE_CBBTC))
        # new collateral 1 BTC → total 2 BTC, cap = int(126,972e6*0.645) ≈ 81,896.94
        with pytest.raises(MorphoError, match="LTV cap"):
            api.open_borrow(FakeWallet(), ONE_CBBTC, 65_000 * 10**6)

    def test_rejects_zero_collateral(self):
        api, *_ = _make_api(_state())
        with pytest.raises(MorphoError):
            api.open_borrow(FakeWallet(), 0, 10**6)

    def test_insufficient_cbbtc_balance(self):
        api, *_ = _make_api(_state(), cbbtc_balance=ONE_CBBTC // 2)
        with pytest.raises(MorphoError, match="Insufficient cbBTC"):
            api.open_borrow(FakeWallet(), ONE_CBBTC, 0)


class TestWithdrawCollateral:
    def test_rejects_when_post_hf_below_floor(self):
        shares = 30_000 * 10**6 * 10**6  # ≈ 30,000 USDC debt
        api, *_ = _make_api(_state(borrow_shares=shares, collateral_raw=ONE_CBBTC))
        # remaining 0.5 BTC → max_borrow ≈ 27,298.98 → HF ≈ 0.91 < 1.1
        with pytest.raises(MorphoError, match="health factor"):
            api.withdraw_collateral(FakeWallet(), ONE_CBBTC // 2)

    def test_allows_full_withdraw_when_debt_free(self):
        api, _, _, _, sent = _make_api(_state(borrow_shares=0, collateral_raw=ONE_CBBTC))
        txs = api.withdraw_collateral(FakeWallet(), ONE_CBBTC)
        assert txs == ["0xtx_single"]
        assert len(sent) == 1

    def test_rejects_more_than_collateral(self):
        api, *_ = _make_api(_state(collateral_raw=ONE_CBBTC))
        with pytest.raises(MorphoError, match="collateral"):
            api.withdraw_collateral(FakeWallet(), 2 * ONE_CBBTC)


class TestRepay:
    def test_full_repay_uses_shares_exact(self):
        shares = 30_000 * 10**6 * 10**6
        api, morpho, tokens, _, _ = _make_api(_state(borrow_shares=shares))
        txs = api.repay(FakeWallet(), assets_raw=None)
        # approve + repay + best-effort allowance revoke (exact-approval invariant)
        assert len(txs) == 3
        # repay(params, assets=0, shares=borrowShares, onBehalf=user, b"")
        args = morpho.functions.repay.call_args.args
        assert args[1] == 0 and args[2] == shares
        assert args[3] == USER and args[4] == b""
        # approval = debt + 0.1% accrual buffer, to Morpho Blue
        st = _state(borrow_shares=shares)
        debt = shares_to_assets_up(shares, st["total_borrow_assets"], st["total_borrow_shares"])
        usdc = tokens[USDC_BASE.lower()]
        # First approve = debt+buffer; second = revoke to 0
        assert usdc.functions.approve.call_args_list[-1].args[1] == 0
        usdc.functions.approve.assert_any_call(
            Web3.to_checksum_address(MORPHO_BLUE), debt + max(1, debt // 1000)
        )

    def test_partial_repay_uses_assets_exact(self):
        shares = 30_000 * 10**6 * 10**6
        api, morpho, tokens, _, _ = _make_api(_state(borrow_shares=shares))
        api.repay(FakeWallet(), assets_raw=10_000 * 10**6)
        args = morpho.functions.repay.call_args.args
        assert args[1] == 10_000 * 10**6 and args[2] == 0
        usdc = tokens[USDC_BASE.lower()]
        assert usdc.functions.approve.call_args.args[1] == 10_000 * 10**6

    def test_partial_repay_covering_full_debt_redirected(self):
        shares = 30_000 * 10**6 * 10**6
        api, *_ = _make_api(_state(borrow_shares=shares))
        with pytest.raises(MorphoError, match="full repay"):
            api.repay(FakeWallet(), assets_raw=40_000 * 10**6)

    def test_repay_with_no_debt(self):
        api, *_ = _make_api(_state(borrow_shares=0))
        with pytest.raises(MorphoError, match="no Morpho debt"):
            api.repay(FakeWallet())


class TestVault:
    VAULT = Web3.to_checksum_address("0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183")

    def test_deposit_approves_vault_exact_amount(self):
        api, _, tokens, vaults, sent = _make_api(_state())
        amount = 5_000 * 10**6
        txs = api.vault_deposit(FakeWallet(), amount, vault=self.VAULT)
        assert len(txs) == 2
        usdc = tokens[USDC_BASE.lower()]
        # spender is the VAULT (not Morpho Blue), amount exact (no revoke needed)
        usdc.functions.approve.assert_called_once_with(self.VAULT, amount)
        vault = vaults[self.VAULT.lower()]
        vault.functions.deposit.assert_called_once_with(amount, USER)

    def test_deposit_insufficient_usdc(self):
        api, *_ = _make_api(_state(), usdc_balance=10**6)
        with pytest.raises(MorphoError, match="Insufficient USDC"):
            api.vault_deposit(FakeWallet(), 5_000 * 10**6, vault=self.VAULT)

    def test_redeem_receiver_and_owner_are_user(self):
        api, _, _, vaults, _ = _make_api(_state())
        vault = vaults.setdefault(self.VAULT.lower(), MagicMock())
        vault.functions.balanceOf.return_value.call.return_value = 777
        txs = api.vault_redeem(FakeWallet(), vault=self.VAULT)  # full balance
        assert txs == ["0xtx_single"]
        vault.functions.redeem.assert_called_once_with(777, USER, USER)

    def test_redeem_rejects_over_balance(self):
        api, _, _, vaults, _ = _make_api(_state())
        vault = vaults.setdefault(self.VAULT.lower(), MagicMock())
        vault.functions.balanceOf.return_value.call.return_value = 10
        with pytest.raises(MorphoError, match="shares"):
            api.vault_redeem(FakeWallet(), shares_raw=11, vault=self.VAULT)


# ---------------------------------------------------------------------------
# GraphQL APY with on-chain fallback
# ---------------------------------------------------------------------------


class TestApyFallback:
    def test_graphql_success_path(self):
        api = MorphoAPI()
        api._graphql = AsyncMock(
            return_value={
                "markets": {
                    "items": [
                        {
                            "marketId": MARKET_ID,
                            "state": {
                                "borrowApy": 0.052,
                                "supplyApy": 0.041,
                                "utilization": 0.78,
                            },
                        }
                    ]
                }
            }
        )
        out = asyncio.run(api.get_market_apys())
        assert out["source"] == "graphql"
        assert out["borrow_apy"] == pytest.approx(0.052)

    def test_http_failure_falls_back_to_onchain(self):
        api = MorphoAPI()
        web3 = MagicMock()
        rate = int(0.05 * WAD) // SECONDS_PER_YEAR
        web3.eth.contract.return_value.functions.borrowRateView.return_value.call.return_value = (
            rate
        )
        api._failover = lambda op, attempts=4: op(web3)
        api._read_state = lambda w3, user=None: _state()

        # The HTTP layer (aiohttp) blows up entirely → _graphql returns None.
        with patch("aiohttp.ClientSession", side_effect=ConnectionError("network down")):
            out = asyncio.run(api.get_market_apys())

        assert out["source"] == "onchain"
        expected_apy = rate_per_second_to_apy(rate)
        assert out["borrow_apy"] == pytest.approx(expected_apy, rel=1e-12)
        # utilization = 50M / 100M
        assert out["utilization"] == pytest.approx(0.5)
        # suppliers earn borrow * utilization (fee switch off)
        assert out["supply_apy"] == pytest.approx(expected_apy * 0.5, rel=1e-12)

    def test_graphql_garbage_falls_back(self):
        api = MorphoAPI()
        api._graphql = AsyncMock(return_value={"markets": {"items": []}})
        web3 = MagicMock()
        web3.eth.contract.return_value.functions.borrowRateView.return_value.call.return_value = (
            10**9
        )
        api._failover = lambda op, attempts=4: op(web3)
        api._read_state = lambda w3, user=None: _state()
        out = asyncio.run(api.get_market_apys())
        assert out["source"] == "onchain"

    def test_vault_apys_empty_on_api_failure(self):
        api = MorphoAPI()
        api._graphql = AsyncMock(return_value=None)
        assert asyncio.run(api.get_vault_apys()) == []

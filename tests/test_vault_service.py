"""Tests for the generic, chain-agnostic ERC-4626 vault engine.

Covers:
- bot/config/vaults.py — every registry row is well-formed, get_vault/list_vaults
- bot/services/vault_service.py — APY math (pinned to real sUSDe share-price
  data), unit conversion at 6dp AND 18dp assets, deposit approve+deposit
  ordering / validation, withdraw full-balance / over-balance rejection
- /earn registration in bot/main.py

All web3 interaction is mocked — no network.
"""

import os
from unittest.mock import MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

import pytest  # noqa: E402
from web3 import Web3  # noqa: E402

from bot.config.vaults import VAULTS, get_vault, list_vaults  # noqa: E402
from bot.services.vault_service import VaultError, VaultService  # noqa: E402

USER = Web3.to_checksum_address("0x1111111111111111111111111111111111111111")


class FakeWallet:
    address = USER


# ---------------------------------------------------------------------------
# registry
# ---------------------------------------------------------------------------


class TestVaultRegistry:
    def test_every_vault_is_well_formed(self):
        assert len(VAULTS) >= 5
        for key, cfg in VAULTS.items():
            assert cfg.key == key
            assert cfg.vault_address.startswith("0x") and len(cfg.vault_address) == 42
            assert cfg.asset_address.startswith("0x") and len(cfg.asset_address) == 42
            # to_checksum_address must not raise (validates hex content/length)
            Web3.to_checksum_address(cfg.vault_address)
            Web3.to_checksum_address(cfg.asset_address)
            assert cfg.share_decimals == 18
            assert cfg.asset_decimals > 0
            assert cfg.chain in ("ethereum", "base")
            assert cfg.protocol
            assert cfg.display_name
            assert cfg.docs_url
            assert cfg.risk_note

    def test_known_asset_decimals(self):
        expected = {
            "susde": 18,
            "sdai": 18,
            "steakusdc-eth": 6,
            "steakusdc-base": 6,
            "gtusdcp-base": 6,
        }
        for key, dp in expected.items():
            assert VAULTS[key].asset_decimals == dp

    def test_get_vault_known_and_unknown(self):
        assert get_vault("susde") is not None
        assert get_vault("nope") is None

    def test_list_vaults_filters_by_chain(self):
        base_vaults = list_vaults(chain="base")
        assert base_vaults and all(v.chain == "base" for v in base_vaults)
        eth_vaults = list_vaults(chain="ethereum")
        assert eth_vaults and all(v.chain == "ethereum" for v in eth_vaults)
        assert len(base_vaults) + len(eth_vaults) == len(VAULTS)

    def test_list_vaults_filters_by_asset(self):
        usdc_vaults = list_vaults(asset="USDC")
        assert usdc_vaults and all(v.asset_symbol.lower() == "usdc" for v in usdc_vaults)
        # case-insensitive
        assert list_vaults(asset="usdc") == usdc_vaults


# ---------------------------------------------------------------------------
# APY math — pinned to real sUSDe on-chain data (2026-08-26)
# ---------------------------------------------------------------------------


class TestApyMath:
    NOW_PRICE = 1245101738337669501
    PAST_PRICE = 1244937217373833839
    ELAPSED = 7 * 24 * 3600  # ~7 days apart

    def test_annualize_matches_real_susde_data(self):
        apy = VaultService.annualize_share_price_growth(
            self.NOW_PRICE, self.PAST_PRICE, self.ELAPSED
        )
        assert apy == pytest.approx(0.0069, abs=0.0001)

    def test_degenerate_inputs_return_none(self):
        assert VaultService.annualize_share_price_growth(0, self.PAST_PRICE, self.ELAPSED) is None
        assert VaultService.annualize_share_price_growth(self.NOW_PRICE, 0, self.ELAPSED) is None
        assert VaultService.annualize_share_price_growth(self.NOW_PRICE, self.PAST_PRICE, 0) is None
        assert (
            VaultService.annualize_share_price_growth(self.NOW_PRICE, self.PAST_PRICE, -1) is None
        )

    def test_apy_none_when_historical_read_unavailable(self):
        """The 'never fabricate' guarantee: if the archive read fails on every
        RPC (the expected case for most public endpoints), apy must be None,
        never 0% or a made-up number."""
        svc = VaultService()
        cfg = get_vault("susde")

        # Current price succeeds...
        svc._failover = lambda chain, op, attempts=4: (self.NOW_PRICE, 23_000_000, 1_700_000_000)
        # ...but every historical attempt fails (mirrors publicnode/ankr/
        # cloudflare-eth archive rejections observed in production).
        svc._historical_share_price = lambda cfg, one_share, num, ts: None

        apy = svc._compute_apy(cfg)
        assert apy is None

    def test_apy_present_when_historical_read_succeeds(self):
        svc = VaultService()
        cfg = get_vault("susde")
        svc._failover = lambda chain, op, attempts=4: (self.NOW_PRICE, 23_000_000, 1_700_000_000)
        svc._historical_share_price = lambda cfg, one_share, num, ts: (
            self.PAST_PRICE,
            self.ELAPSED,
        )
        apy = svc._compute_apy(cfg)
        assert apy == pytest.approx(0.0069, abs=0.0001)

    def test_get_vault_stats_caches_none_apy_briefly(self):
        """apy=None must still be cached (short TTL) — not recomputed on every
        call within the TTL window, so a down archive endpoint isn't hammered."""
        svc = VaultService()
        cfg = get_vault("susde")
        calls = {"n": 0}

        def _compute(_cfg):
            calls["n"] += 1
            return None

        svc._compute_apy = _compute
        svc._failover = lambda chain, op, attempts=4: {
            "vault_key": cfg.key,
            "total_assets_raw": 10**24,
            "total_assets": 10**24 / 10**cfg.asset_decimals,
            "share_price": 1.0,
            "asset_symbol": cfg.asset_symbol,
        }
        stats1 = svc.get_vault_stats("susde")
        stats2 = svc.get_vault_stats("susde")
        assert stats1["apy"] is None and stats2["apy"] is None
        assert calls["n"] == 1  # second call served from cache


# ---------------------------------------------------------------------------
# unit conversion — 6dp (USDC) and 18dp (USDe/DAI) assets
# ---------------------------------------------------------------------------


def _mock_vault_contract(shares_raw: int, assets_raw: int):
    m = MagicMock()
    m.functions.balanceOf.return_value.call.return_value = shares_raw
    m.functions.convertToAssets.return_value.call.return_value = assets_raw
    return m


class TestUnitConversion:
    def test_get_position_6dp_asset(self):
        cfg = get_vault("steakusdc-base")  # USDC, 6dp
        svc = VaultService()
        shares_raw = 5_000 * 10**18  # 5000 shares (18dp share)
        assets_raw = 5_050 * 10**6  # 5050 USDC (6dp asset) — no 1e12 scaling bug
        svc._vault_contract = lambda w3, addr: _mock_vault_contract(shares_raw, assets_raw)
        svc._failover = lambda chain, op, attempts=4: op(MagicMock())
        pos = svc.get_position(cfg.key, USER)
        assert pos["assets"] == pytest.approx(5050.0)
        assert pos["shares"] == pytest.approx(5000.0)

    def test_get_position_18dp_asset(self):
        cfg = get_vault("susde")  # USDe, 18dp
        svc = VaultService()
        shares_raw = 10 * 10**18
        assets_raw = 12 * 10**18
        svc._vault_contract = lambda w3, addr: _mock_vault_contract(shares_raw, assets_raw)
        svc._failover = lambda chain, op, attempts=4: op(MagicMock())
        pos = svc.get_position(cfg.key, USER)
        assert pos["assets"] == pytest.approx(12.0)
        assert pos["shares"] == pytest.approx(10.0)

    def test_get_position_zero_shares_no_convert_call(self):
        cfg = get_vault("steakusdc-base")
        svc = VaultService()
        v = _mock_vault_contract(0, 999)  # convertToAssets should be skipped
        svc._vault_contract = lambda w3, addr: v
        svc._failover = lambda chain, op, attempts=4: op(MagicMock())
        pos = svc.get_position(cfg.key, USER)
        assert pos["assets_raw"] == 0
        assert pos["assets"] == 0.0


# ---------------------------------------------------------------------------
# write-path harness (mocks _failover/_send_seq/_build_and_send)
# ---------------------------------------------------------------------------


def _make_service(vault_key, asset_balance=10**24, vault_share_balance=0):
    svc = VaultService()
    web3 = MagicMock()
    svc._failover = lambda chain, op, attempts=4: op(web3)

    tokens = {}

    def _erc20(w3, address):
        m = tokens.setdefault(address.lower(), MagicMock(name=f"erc20:{address[:8]}"))
        m.functions.balanceOf.return_value.call.return_value = asset_balance
        return m

    vaults = {}

    def _vault(w3, address):
        m = vaults.setdefault(address.lower(), MagicMock(name=f"vault:{address[:8]}"))
        m.functions.balanceOf.return_value.call.return_value = vault_share_balance
        return m

    svc._erc20 = _erc20
    svc._vault_contract = _vault

    sent = []

    def _send_seq(w3, wallet, fns, chain_id):
        sent.extend(fns)
        return [f"0xtx{i}" for i in range(len(fns))]

    def _build_and_send(w3, wallet, fn, chain_id):
        sent.append(fn)
        return "0xtx_single"

    svc._send_seq = _send_seq
    svc._build_and_send = _build_and_send
    return svc, tokens, vaults, sent


class TestDeposit:
    def test_deposit_builds_approve_then_deposit_in_order(self):
        cfg = get_vault("steakusdc-base")
        svc, tokens, vaults, sent = _make_service(cfg.key)
        amount = 1_000 * 10**6
        txs = svc.deposit(FakeWallet(), cfg.key, amount)
        assert len(txs) == 2
        usdc = tokens[cfg.asset_address.lower()]
        usdc.functions.approve.assert_called_once_with(
            Web3.to_checksum_address(cfg.vault_address), amount
        )
        vault = vaults[cfg.vault_address.lower()]
        vault.functions.deposit.assert_called_once_with(amount, USER)
        # order: approve queued before deposit
        assert sent[0] is usdc.functions.approve.return_value
        assert sent[1] is vault.functions.deposit.return_value

    def test_deposit_rejects_zero_or_negative(self):
        cfg = get_vault("susde")
        svc, *_ = _make_service(cfg.key)
        with pytest.raises(VaultError, match="greater than zero"):
            svc.deposit(FakeWallet(), cfg.key, 0)
        with pytest.raises(VaultError, match="greater than zero"):
            svc.deposit(FakeWallet(), cfg.key, -1)

    def test_deposit_rejects_insufficient_balance(self):
        cfg = get_vault("sdai")
        svc, *_ = _make_service(cfg.key, asset_balance=10**6)
        with pytest.raises(VaultError, match="Insufficient"):
            svc.deposit(FakeWallet(), cfg.key, 10**18)

    def test_deposit_unknown_vault_raises(self):
        svc = VaultService()
        with pytest.raises(VaultError, match="Unknown vault"):
            svc.deposit(FakeWallet(), "not-a-vault", 100)


class TestWithdraw:
    def test_withdraw_none_redeems_full_balance(self):
        cfg = get_vault("gtusdcp-base")
        svc, _, vaults, sent = _make_service(cfg.key, vault_share_balance=777)
        txs = svc.withdraw(FakeWallet(), cfg.key, None)
        assert txs == ["0xtx_single"]
        vault = vaults[cfg.vault_address.lower()]
        vault.functions.redeem.assert_called_once_with(777, USER, USER)

    def test_withdraw_rejects_over_balance(self):
        cfg = get_vault("gtusdcp-base")
        svc, *_ = _make_service(cfg.key, vault_share_balance=10)
        with pytest.raises(VaultError, match="shares"):
            svc.withdraw(FakeWallet(), cfg.key, 11)

    def test_withdraw_rejects_zero_balance(self):
        cfg = get_vault("gtusdcp-base")
        svc, *_ = _make_service(cfg.key, vault_share_balance=0)
        with pytest.raises(VaultError, match="Nothing to withdraw"):
            svc.withdraw(FakeWallet(), cfg.key, None)

    def test_withdraw_unknown_vault_raises(self):
        svc = VaultService()
        with pytest.raises(VaultError, match="Unknown vault"):
            svc.withdraw(FakeWallet(), "not-a-vault", None)


# ---------------------------------------------------------------------------
# /earn registration
# ---------------------------------------------------------------------------


class TestEarnRegistration:
    def test_earn_conversation_handler_registered_in_main(self):
        import re

        main_src = open("bot/main.py").read()
        assert "from bot.handlers.earn import earn_conversation_handler" in main_src
        assert re.search(
            r"add_handler\(\s*earn_conversation_handler\s*\)", main_src
        ), "earn_conversation_handler not registered via application.add_handler(...)"

    def test_earn_handler_importable(self):
        from bot.handlers.earn import earn_conversation_handler

        assert earn_conversation_handler is not None

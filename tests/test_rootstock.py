"""Tests for Rootstock (Bitcoin sidechain, chain id 30) support.

Covers:
- bot/config/chains.py    — "rootstock" ChainConfig (EVM, LiFi id 30, legacy gas)
- bot/config/tokens.py    — token addresses + decimals (rUSDT = 18dp trap),
  addresses_equal lowercase comparison helper (EIP-1191 checksums)
- bot/services/rpc_manager.py — CHAINLIST_IDS entry
- chains.apply_min_gas_price — 60M wei network floor
- Aggregator exclusion: rootstock routes via Li.Fi ONLY

No network access.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.config.chains import (  # noqa: E402
    CHAINS,
    ChainType,
    apply_min_gas_price,
    get_chain_by_id,
    get_chain_by_name,
)
from bot.config.tokens import (  # noqa: E402
    addresses_equal,
    get_token_address,
    get_token_decimals,
    get_tokens_for_chain,
)

# ---------------------------------------------------------------------------
# chain config
# ---------------------------------------------------------------------------


class TestRootstockChainConfig:
    def test_present(self):
        assert "rootstock" in CHAINS

    def test_is_evm(self):
        assert CHAINS["rootstock"].chain_type == ChainType.EVM

    def test_chain_id(self):
        assert CHAINS["rootstock"].chain_id == 30
        assert get_chain_by_id(30).name == "rootstock"

    def test_lifi_chain_id(self):
        assert CHAINS["rootstock"].lifi_chain_id == 30

    def test_native_token(self):
        chain = get_chain_by_name("rootstock")
        assert chain.native_token == "RBTC"
        assert chain.native_decimals == 18

    def test_rpc_env(self):
        assert CHAINS["rootstock"].rpc_url_env == "ROOTSTOCK_RPC_URL"

    def test_explorer(self):
        assert CHAINS["rootstock"].explorer_url == "https://rootstock.blockscout.com"

    def test_legacy_gas_only(self):
        assert CHAINS["rootstock"].legacy_gas_only is True
        assert CHAINS["rootstock"].min_gas_price_wei == 60_000_000

    def test_settings_default_rpc(self):
        from bot.config.settings import settings

        assert "public-node.rsk.co" in settings.rootstock_rpc_url

    def test_chainlist_ids(self):
        from bot.services.rpc_manager import CHAINLIST_IDS

        assert CHAINLIST_IDS["rootstock"] == 30


# ---------------------------------------------------------------------------
# tokens
# ---------------------------------------------------------------------------


class TestRootstockTokens:
    def test_wrbtc(self):
        assert addresses_equal(
            get_token_address("WRBTC", "rootstock"),
            "0x542FDA317318eBf1d3DeAF76E0B632741a7e677d",
        )
        assert get_token_decimals("WRBTC", "rootstock") == 18

    def test_usdt_is_usdt0_6_decimals(self):
        # Rootstock USDT default is USD₮0 (6dp, LiFi-routable) — NOT legacy rUSDT
        # (0xef21...bb96, 18dp), which LiFi does not list. Live-verified 2026-06-12.
        assert addresses_equal(
            get_token_address("USDT", "rootstock"),
            "0x779ded0c9e1022225f8e0630b35a9b54be713736",
        )
        assert get_token_decimals("USDT", "rootstock") == 6
        # Addresses stored lowercase: RSK uses EIP-1191 checksums and LiFi's
        # token lookup rejects EIP-55 casing on chain 30.
        assert get_token_address("USDT", "rootstock").islower()
        assert get_token_address("WRBTC", "rootstock").islower()

    def test_usdt_unaffected_elsewhere(self):
        assert get_token_decimals("USDT", "ethereum") == 6
        assert get_token_decimals("USDT", "bsc") == 18

    def test_usdce(self):
        assert addresses_equal(
            get_token_address("USDC", "rootstock"),
            "0x74C9F2B00581F1b11Aa7Ff05aa9f608B7389de67",
        )
        assert get_token_decimals("USDC", "rootstock") == 6

    def test_doc(self):
        assert addresses_equal(
            get_token_address("DOC", "rootstock"),
            "0xE700691Da7B9851F2F35f8b8182C69C53ccad9DB",
        )
        assert get_token_decimals("DOC", "rootstock") == 18

    def test_tokens_for_chain(self):
        symbols = {t.symbol.upper() for t in get_tokens_for_chain("rootstock")}
        assert {"WRBTC", "USDT", "USDC", "DOC"} <= symbols


# ---------------------------------------------------------------------------
# legacy gas floor
# ---------------------------------------------------------------------------


class TestLegacyGasFloor:
    def test_floor_applied_below_minimum(self):
        assert apply_min_gas_price("rootstock", 1_000_000) == 60_000_000

    def test_floor_passthrough_above_minimum(self):
        assert apply_min_gas_price("rootstock", 100_000_000) == 100_000_000

    def test_other_chains_unaffected(self):
        assert apply_min_gas_price("ethereum", 1) == 1
        assert apply_min_gas_price("base", 12345) == 12345

    def test_unknown_chain_passthrough(self):
        assert apply_min_gas_price("not-a-chain", 7) == 7


# ---------------------------------------------------------------------------
# EIP-1191 address comparison
# ---------------------------------------------------------------------------


class TestAddressComparison:
    def test_lowercase_equal(self):
        # RSK uses EIP-1191 (chain-salted) checksums; web3.py emits EIP-55.
        # Comparisons must be case-insensitive.
        eip1191 = "0x542fDA317318eBF1d3DEAf76E0b632741A7e677d"  # arbitrary casing
        eip55 = "0x542FDA317318eBf1d3DeAF76E0B632741a7e677d"
        assert addresses_equal(eip1191, eip55)

    def test_different_addresses(self):
        assert not addresses_equal(
            "0x542FDA317318eBf1d3DeAF76E0B632741a7e677d",
            "0xEf213441a85DF4d7acBdAe0Cf78004E1e486BB96",
        )

    def test_none_safe(self):
        assert not addresses_equal(None, "0x542FDA317318eBf1d3DeAF76E0B632741a7e677d")
        assert not addresses_equal("0x542FDA317318eBf1d3DeAF76E0B632741a7e677d", None)


# ---------------------------------------------------------------------------
# aggregator exclusion — Li.Fi only
# ---------------------------------------------------------------------------


class TestAggregatorExclusion:
    def test_okx_excludes_rootstock(self):
        from bot.services.okx_dex_api import OKX_CHAIN_IDS

        assert "rootstock" not in OKX_CHAIN_IDS

    def test_across_excludes_rootstock(self):
        from bot.services.across_api import ACROSS_CHAIN_IDS

        assert "rootstock" not in ACROSS_CHAIN_IDS

    def test_lifi_id_resolves(self):
        # LiFiAPI builds requests from ChainConfig.lifi_chain_id
        assert get_chain_by_name("rootstock").lifi_chain_id == 30

"""Tests for P1 wrapped-BTC default cleanup.

"BTC" must no longer implicitly mean WBTC. Per-chain defaults:
  base/ethereum/solana -> cbBTC (8dp)
  arbitrum/optimism/polygon -> tBTC (18dp)
  bsc -> BTCB (18dp)
WBTC stays available explicitly as "WBTC". GOAT native BTC unchanged (18dp).
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key-32byteslong!!")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("KMS_PROVIDER", "dev")

from bot.config.tokens import (  # noqa: E402
    get_token_address,
    get_token_decimals,
    get_decimals_by_address,
    get_token_by_symbol,
)

CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf"
CBBTC_SOLANA = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"
TBTC_ETH = "0x18084fbA666a33d37592fA2633fD49a74DD93a88"
TBTC_ARB_OP = "0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40"
TBTC_POLYGON = "0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b"
BTCB_BSC = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c"
WBTC_ETH = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"


class TestBtcDefaultResolution:
    """Default 'BTC' symbol resolution per chain."""

    def test_ethereum_default_is_cbbtc(self):
        assert get_token_address("BTC", "ethereum") == CBBTC
        assert get_token_decimals("BTC", "ethereum") == 8

    def test_base_default_is_cbbtc(self):
        assert get_token_address("BTC", "base") == CBBTC
        assert get_token_decimals("BTC", "base") == 8

    def test_solana_default_is_cbbtc(self):
        assert get_token_address("BTC", "solana") == CBBTC_SOLANA
        assert get_token_decimals("BTC", "solana") == 8

    def test_arbitrum_default_is_tbtc(self):
        assert get_token_address("BTC", "arbitrum") == TBTC_ARB_OP
        assert get_token_decimals("BTC", "arbitrum") == 18

    def test_optimism_default_is_tbtc(self):
        assert get_token_address("BTC", "optimism") == TBTC_ARB_OP
        assert get_token_decimals("BTC", "optimism") == 18

    def test_polygon_default_is_tbtc(self):
        assert get_token_address("BTC", "polygon") == TBTC_POLYGON
        assert get_token_decimals("BTC", "polygon") == 18

    def test_bsc_default_is_btcb_18dp(self):
        assert get_token_address("BTC", "bsc") == BTCB_BSC
        assert get_token_decimals("BTC", "bsc") == 18  # BTCB is 18dp NOT 8

    def test_btc_never_resolves_to_wbtc(self):
        # bsc excluded: the legacy "WBTC" bsc entry is itself the BTCB address
        for chain in ("ethereum", "base", "arbitrum", "optimism", "polygon"):
            wbtc = get_token_address("WBTC", chain)
            assert get_token_address("BTC", chain).lower() != (wbtc or "").lower()

    def test_goat_native_btc_unchanged(self):
        assert get_token_address("BTC", "goat") == "0x0000000000000000000000000000000000000000"
        assert get_token_decimals("BTC", "goat") == 18


class TestExplicitTokenEntries:
    def test_cbbtc_entry(self):
        token = get_token_by_symbol("CBBTC")
        assert token is not None
        assert token.decimals == 8
        for chain in ("ethereum", "base", "arbitrum"):
            assert get_token_address("CBBTC", chain) == CBBTC
        assert get_token_address("CBBTC", "solana") == CBBTC_SOLANA

    def test_tbtc_entry_18dp(self):
        token = get_token_by_symbol("TBTC")
        assert token is not None
        assert token.decimals == 18  # tBTC trap: 18dp NOT 8
        assert get_token_address("TBTC", "ethereum") == TBTC_ETH
        assert get_token_address("TBTC", "arbitrum") == TBTC_ARB_OP
        assert get_token_address("TBTC", "optimism") == TBTC_ARB_OP
        assert get_token_address("TBTC", "polygon") == TBTC_POLYGON

    def test_btcb_entry_18dp(self):
        token = get_token_by_symbol("BTCB")
        assert token is not None
        assert token.decimals == 18  # BTCB trap: 18dp NOT 8
        assert get_token_address("BTCB", "bsc") == BTCB_BSC

    def test_wbtc_still_explicitly_available(self):
        assert get_token_address("WBTC", "ethereum") == WBTC_ETH
        assert get_token_decimals("WBTC", "ethereum") == 8

    def test_wbtc_on_bsc_is_btcb_18dp(self):
        # The 'WBTC' bsc address is actually BTCB — 18dp, pre-existing trap
        assert get_token_decimals("WBTC", "bsc") == 18


class TestDecimalsByAddress:
    def test_cbbtc_address_8dp(self):
        assert get_decimals_by_address(CBBTC.lower(), "ethereum") == 8
        assert get_decimals_by_address(CBBTC.lower(), "base") == 8
        assert get_decimals_by_address(CBBTC.lower(), "arbitrum") == 8

    def test_tbtc_address_18dp(self):
        assert get_decimals_by_address(TBTC_ARB_OP.lower(), "arbitrum") == 18
        assert get_decimals_by_address(TBTC_POLYGON.lower(), "polygon") == 18

    def test_btcb_address_18dp(self):
        assert get_decimals_by_address(BTCB_BSC.lower(), "bsc") == 18

    def test_wbtc_address_8dp(self):
        assert get_decimals_by_address(WBTC_ETH.lower(), "ethereum") == 8

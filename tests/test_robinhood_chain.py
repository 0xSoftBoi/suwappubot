"""Robinhood Chain (4663) native-chain config tests.

Robinhood Chain is an Arbitrum Orbit L2 whose defining trait is that ~100
tokenized equities trade as ordinary ERC-20s, and whose anchor stablecoin is
Paxos USDG rather than USDC. Both facts are easy to regress, so they are pinned
here. All addresses were verified on-chain (eth_getCode + symbol() + decimals())
on 2026-08-04.
"""

import pytest

from bot.config.chains import (
    CHAINS,
    ROBINHOOD_TESTNET,
    ChainType,
    get_chain_by_id,
    get_chain_by_name,
)
from bot.config.tokens import (
    ROBINHOOD_EQUITIES,
    get_decimals_by_address,
    get_robinhood_equity,
    get_token_address,
    get_token_decimals,
    is_robinhood_equity,
)

USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"


class TestRobinhoodChainConfig:
    def test_chain_is_registered_and_user_selectable(self):
        chain = CHAINS["robinhood"]
        assert chain.chain_id == 4663
        assert chain.chain_type is ChainType.EVM
        assert chain.native_token == "ETH"
        assert chain.native_decimals == 18
        assert chain.is_testnet is False

    def test_lifi_routing_is_enabled(self):
        # Li.Fi supports 4663 natively; without this the swap path silently
        # refuses to quote the chain.
        assert CHAINS["robinhood"].lifi_chain_id == 4663

    def test_lookup_by_id_and_name(self):
        assert get_chain_by_id(4663).name == "robinhood"
        assert get_chain_by_name("robinhood").chain_id == 4663
        assert get_chain_by_name("ROBINHOOD").chain_id == 4663

    def test_rpc_env_and_explorer(self):
        chain = CHAINS["robinhood"]
        assert chain.rpc_url_env == "ROBINHOOD_RPC_URL"
        assert chain.explorer_url == "https://robinhoodchain.blockscout.com"

    def test_testnet_is_not_user_selectable(self):
        # Mirrors the Tempo convention: testnets stay out of CHAINS so they never
        # appear in pickers, balance scans, or deposit-address generation.
        assert ROBINHOOD_TESTNET["chain_id"] == 46630
        assert not any(c.chain_id == 46630 for c in CHAINS.values())

    def test_chain_id_does_not_collide(self):
        ids = [c.chain_id for c in CHAINS.values()]
        assert ids.count(4663) == 1


class TestRobinhoodStablecoin:
    def test_usdg_is_the_anchor(self):
        assert get_token_address("USDG", "robinhood") == USDG

    def test_usdg_is_six_decimals(self):
        # USDG is 6dp. Treating it as 18 would misprice every quote by 1e12.
        assert get_token_decimals("USDG", "robinhood") == 6
        assert get_decimals_by_address(USDG, "robinhood") == 6

    def test_there_is_no_usdc_on_this_chain(self):
        # Guard against someone "helpfully" adding a USDC address here. No USDC
        # is deployed on 4663; a wrong address would send funds nowhere.
        assert get_token_address("USDC", "robinhood") in (None, "")


class TestTokenizedEquities:
    def test_registry_is_populated(self):
        # Sourced from Robinhood's own canonical registry (api.robinhood.com/rhj/
        # assets), which reported 96 active assets on 2026-08-04. Floor rather
        # than exact match since the registry is live and can grow.
        assert len(ROBINHOOD_EQUITIES) >= 90

    @pytest.mark.parametrize("ticker", ["AAPL", "TSLA", "NVDA", "SPY", "MSFT"])
    def test_bellwether_tickers_present(self, ticker):
        entry = get_robinhood_equity(ticker)
        assert entry is not None
        address, decimals, _name = entry
        assert address.startswith("0x") and len(address) == 42
        # Every tokenized equity on this chain is 18dp, unlike the 6dp stablecoin.
        assert decimals == 18

    def test_lookup_is_case_insensitive_and_trims(self):
        assert get_robinhood_equity("  aapl ") == get_robinhood_equity("AAPL")

    def test_unknown_ticker_returns_none(self):
        assert get_robinhood_equity("NOTATICKER") is None
        assert get_robinhood_equity("") is None
        assert is_robinhood_equity("TSLA") is True
        assert is_robinhood_equity("NOTATICKER") is False

    def test_addresses_are_unique(self):
        addrs = [a.lower() for a, _d, _n in ROBINHOOD_EQUITIES.values()]
        assert len(addrs) == len(set(addrs))

    def test_equities_do_not_collide_with_the_stablecoin(self):
        addrs = {a.lower() for a, _d, _n in ROBINHOOD_EQUITIES.values()}
        assert USDG.lower() not in addrs


class TestX402PaymentSurface:
    def test_robinhood_accepts_usdg(self):
        from bot.services.x402_service import X402Service

        tokens = X402Service().payment_tokens["robinhood"]
        assert tokens["USDG"] == USDG

    def test_x402_asset_decimals_match_the_credit_scale(self):
        # The x402 credit -> base-unit conversion assumes 6 decimals.
        from bot.services.x402_service import X402Service

        addr = X402Service().payment_tokens["robinhood"]["USDG"]
        assert get_decimals_by_address(addr, "robinhood") == 6

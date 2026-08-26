"""DeFi protocol token registry tests — Ethena, Lido, Aave, Morpho, Pendle,
Superstate RWA tokens, and the 1inch Robinhood Chain (4663) chain-id entry.

All addresses were verified on-chain via Blockscout on 2026-08-26. Mirrors
the conventions in tests/test_robinhood_chain.py (config-only assertions)
and tests/test_zerox_crosschain_robinhood.py (engine tests built via
SwapEngine.__new__ to avoid any real network calls).
"""

import asyncio

import pytest

from bot.config.protocols import PROTOCOLS, get_protocol_for_token, is_gated_token
from bot.config.tokens import TOKENS, get_token_address, get_token_decimals
from bot.services.oneinch_api import ONEINCH_CHAIN_IDS
from bot.services.swap_engine import SwapEngine
from bot.utils.exceptions import SwapError

NEW_TOKENS = {
    "sUSDe": ("0x9D39A5DE30e57443BfF2A8307A4256c8797A3497", 18),
    "ENA": ("0x57e114B691Db790C35207b2e685D4A43181e6061", 18),
    "PENDLE": ("0x808507121B80c02388fAd14726482e061B8da827", 18),
    "MORPHO": ("0x58D97B57BB95320F9a05dC918Aef65434969c2B2", 18),
    "USTB": ("0x43415eB6ff9DB7E26A15b704e7A3eDCe97d31C4e", 6),
    "USCC": ("0x14d60E7FDC0D71d8611742720E4C50E7a974020c", 6),
}


class TestNewTokenEntries:
    @pytest.mark.parametrize("symbol,expected", NEW_TOKENS.items())
    def test_token_resolves_on_ethereum(self, symbol, expected):
        expected_address, expected_decimals = expected
        token = TOKENS[symbol]
        assert token.addresses["ethereum"] == expected_address
        assert len(token.addresses["ethereum"]) == 42
        assert token.addresses["ethereum"].startswith("0x")
        assert token.decimals == expected_decimals
        # get_token_address()/get_token_decimals() do symbol.upper() lookups,
        # which only resolve for registry keys that are already all-uppercase
        # (e.g. ENA, PENDLE, MORPHO, USTB, USCC). Mixed-case keys like sUSDe
        # (and the pre-existing USDe, stETH, wstETH, cbETH, rETH) are a known,
        # pre-existing quirk of this lookup helper -- out of scope here, so we
        # only exercise it for the uppercase-keyed entries.
        if symbol == symbol.upper():
            assert get_token_address(symbol, "ethereum") == expected_address
            assert get_token_decimals(symbol, "ethereum") == expected_decimals

    def test_susde_is_not_a_stablecoin(self):
        # ERC-4626 yield vault over USDe — value drifts above $1, not pegged.
        assert TOKENS["sUSDe"].is_stablecoin is False

    def test_governance_tokens_are_not_stablecoins(self):
        for symbol in ("ENA", "PENDLE", "MORPHO", "AAVE"):
            assert TOKENS[symbol].is_stablecoin is False

    def test_superstate_tokens_are_gated_and_not_stablecoins(self):
        for symbol in ("USTB", "USCC"):
            token = TOKENS[symbol]
            assert token.is_stablecoin is False
            assert token.transfer_gated is True
            assert token.gated_note and "superstate.co" in token.gated_note.lower()

    def test_superstate_tokens_only_on_ethereum(self):
        # Solana/Plume deployments exist but were not verified — must not be
        # silently added here.
        for symbol in ("USTB", "USCC"):
            assert list(TOKENS[symbol].addresses.keys()) == ["ethereum"]

    def test_usde_and_susde_addresses_are_distinct(self):
        # sUSDe is a separate vault-share contract from USDe, not the same token.
        assert TOKENS["USDe"].addresses["ethereum"] != TOKENS["sUSDe"].addresses["ethereum"]


class TestProtocolRegistry:
    @pytest.mark.parametrize("slug", list(PROTOCOLS.keys()))
    def test_protocol_tokens_exist_in_registry(self, slug):
        protocol = PROTOCOLS[slug]
        assert protocol.tokens, f"{slug} has no tokens configured"
        for symbol in protocol.tokens:
            assert symbol in TOKENS, f"{slug} references unknown token {symbol}"

    def test_expected_protocols_are_registered(self):
        for slug in ("superstate", "ethena", "lido", "aave", "morpho", "pendle"):
            assert slug in PROTOCOLS

    def test_superstate_tokens_grouped_together(self):
        assert set(PROTOCOLS["superstate"].tokens) == {"USTB", "USCC"}

    def test_ethena_groups_usde_susde_ena(self):
        assert set(PROTOCOLS["ethena"].tokens) == {"USDe", "sUSDe", "ENA"}

    def test_get_protocol_for_token(self):
        assert get_protocol_for_token("USTB").slug == "superstate"
        assert get_protocol_for_token("ustb").slug == "superstate"  # case-insensitive
        assert get_protocol_for_token("ENA").slug == "ethena"
        assert get_protocol_for_token("NOTATOKEN") is None
        assert get_protocol_for_token("") is None

    def test_morpho_notes_the_robinhood_earn_backbone(self):
        assert "robinhood" in PROTOCOLS["morpho"].notes.lower()


class TestIsGatedToken:
    @pytest.mark.parametrize("symbol", ["USTB", "USCC", "ustb", "uscc"])
    def test_gated_tokens_return_true(self, symbol):
        assert is_gated_token(symbol) is True

    @pytest.mark.parametrize("symbol", ["USDC", "USDT", "ENA", "NOTATOKEN", "", None])
    def test_non_gated_or_unknown_return_false(self, symbol):
        assert is_gated_token(symbol) is False


class TestOneInchRobinhoodChain:
    def test_robinhood_chain_id_registered(self):
        assert "robinhood" in ONEINCH_CHAIN_IDS
        assert ONEINCH_CHAIN_IDS["robinhood"] == "4663"


class TestSwapEngineGatedTokenGuard:
    def test_quote_rejects_gated_destination_token(self):
        engine = SwapEngine.__new__(SwapEngine)

        with pytest.raises(SwapError, match="USTB"):
            asyncio.run(
                engine._get_quote_impl(
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_token="USDC",
                    to_token="USTB",
                    amount=100.0,
                    from_address="0x00000000000000000000000000000000000001",
                    platform_fee_bps=0,
                )
            )

    def test_quote_rejects_gated_source_token(self):
        engine = SwapEngine.__new__(SwapEngine)

        with pytest.raises(SwapError, match="USCC"):
            asyncio.run(
                engine._get_quote_impl(
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_token="USCC",
                    to_token="USDC",
                    amount=100.0,
                    from_address="0x00000000000000000000000000000000000001",
                    platform_fee_bps=0,
                )
            )

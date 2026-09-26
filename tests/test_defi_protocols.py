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
    # NOTE: TOKENS dict key is "SUSDE" (uppercase) even though the display
    # symbol is "sUSDe" — see the rekey comment in bot/config/tokens.py. This
    # was the dead-button bug: get_token_address/get_token_decimals do
    # symbol.upper() lookups, which never resolved against a "sUSDe" key.
    "SUSDE": ("0x9D39A5DE30e57443BfF2A8307A4256c8797A3497", 18),
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
        # (e.g. SUSDE, ENA, PENDLE, MORPHO, USTB, USCC). Mixed-case keys like
        # the pre-existing USDe, stETH, wstETH, cbETH, rETH are a known,
        # pre-existing quirk of this lookup helper -- out of scope here, so we
        # only exercise it for the uppercase-keyed entries (all of NEW_TOKENS,
        # post sUSDe->SUSDE rekey).
        assert symbol == symbol.upper()
        assert get_token_address(symbol, "ethereum") == expected_address
        assert get_token_decimals(symbol, "ethereum") == expected_decimals

    def test_susde_resolves_via_display_symbol_too(self):
        # get_token_address/get_token_decimals do symbol.upper() lookups, so
        # the natural display-cased "sUSDe" input resolves fine even though
        # the registry key itself is "SUSDE" -- this was the dead-button bug.
        assert (
            get_token_address("sUSDe", "ethereum") == "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497"
        )
        assert get_token_decimals("sUSDe", "ethereum") == 18

    def test_susde_is_not_a_stablecoin(self):
        # ERC-4626 yield vault over USDe — value drifts above $1, not pegged.
        assert TOKENS["SUSDE"].is_stablecoin is False
        assert TOKENS["SUSDE"].symbol == "sUSDe"  # display symbol unaffected by the rekey

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
        assert TOKENS["USDe"].addresses["ethereum"] != TOKENS["SUSDE"].addresses["ethereum"]


class TestProtocolRegistry:
    @pytest.mark.parametrize("slug", list(PROTOCOLS.keys()))
    def test_protocol_tokens_exist_in_registry(self, slug):
        protocol = PROTOCOLS[slug]
        assert protocol.tokens, f"{slug} has no tokens configured"
        # Case-insensitive membership: PROTOCOLS keeps the display-cased
        # symbol (e.g. "sUSDe") while the TOKENS registry key is uppercase
        # ("SUSDE") post-rekey -- exact-string membership would wrongly fail.
        token_keys_lower = {k.lower() for k in TOKENS}
        for symbol in protocol.tokens:
            assert symbol.lower() in token_keys_lower, f"{slug} references unknown token {symbol}"

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


USTB_ADDRESS = "0x43415eB6ff9DB7E26A15b704e7A3eDCe97d31C4e"


class TestIsGatedToken:
    @pytest.mark.parametrize("symbol", ["USTB", "USCC", "ustb", "uscc"])
    def test_gated_tokens_return_true(self, symbol):
        assert is_gated_token(symbol) is True

    @pytest.mark.parametrize("symbol", ["USDC", "USDT", "ENA", "NOTATOKEN", "", None])
    def test_non_gated_or_unknown_return_false(self, symbol):
        assert is_gated_token(symbol) is False

    def test_gated_address_with_chain_returns_true(self):
        assert is_gated_token(USTB_ADDRESS, "ethereum") is True

    def test_gated_address_uppercase_0x_prefix_returns_true(self):
        upper_prefixed = "0X" + USTB_ADDRESS[2:]
        assert is_gated_token(upper_prefixed, "ethereum") is True

    def test_gated_address_without_chain_returns_true(self):
        # No chain given -> checked against gated addresses on any chain.
        assert is_gated_token(USTB_ADDRESS) is True

    def test_gated_address_case_insensitive(self):
        assert is_gated_token(USTB_ADDRESS.lower(), "ethereum") is True
        assert is_gated_token(USTB_ADDRESS.upper(), "ETHEREUM") is True

    def test_unknown_address_returns_false(self):
        assert is_gated_token("0x0000000000000000000000000000000000000001", "ethereum") is False

    def test_gated_address_on_wrong_chain_returns_false(self):
        # USTB is only deployed/gated on ethereum -- asking about arbitrum
        # must not accidentally match via the any-chain fallback.
        assert is_gated_token(USTB_ADDRESS, "arbitrum") is False

    def test_signature_is_backward_compatible_without_chain_arg(self):
        # Callers that never pass `chain` (existing call sites pre-fix) must
        # keep working unchanged for symbol-based lookups.
        assert is_gated_token("USTB") is True
        assert is_gated_token("USDC") is False


class TestOneInchRobinhoodChain:
    def test_robinhood_chain_id_registered(self):
        assert "robinhood" in ONEINCH_CHAIN_IDS
        assert ONEINCH_CHAIN_IDS["robinhood"] == "4663"


class TestAssertNotGatedHelper:
    """Direct tests of the extracted _assert_not_gated guard used by all four
    call sites (_get_quote_impl, get_all_quotes, build_external_evm_swap,
    execute_swap)."""

    def test_raises_for_gated_from_token(self):
        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="USCC"):
            engine._assert_not_gated("USCC", "USDC", "ethereum", "ethereum")

    def test_raises_for_gated_to_token(self):
        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="USTB"):
            engine._assert_not_gated("USDC", "USTB", "ethereum", "ethereum")

    def test_does_not_raise_for_non_gated_tokens(self):
        engine = SwapEngine.__new__(SwapEngine)
        engine._assert_not_gated("USDC", "USDT", "ethereum", "ethereum")  # no raise

    def test_raises_for_gated_pasted_address(self):
        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="allowlist-gated"):
            engine._assert_not_gated(
                USTB_ADDRESS,
                "USDC",
                "ethereum",
                "ethereum",
            )

    def test_gated_pasted_address_on_wrong_chain_does_not_raise(self):
        # Chain-aware: the same address is not gated when checked against a
        # chain it isn't deployed/gated on.
        engine = SwapEngine.__new__(SwapEngine)
        engine._assert_not_gated(USTB_ADDRESS, "USDC", "arbitrum", "ethereum")  # no raise


class TestSwapEngineGatedTokenGuard:
    """Guard must fire BEFORE the quote-cache read (a transfer_gated flip
    must not be maskable by a cached quote) and before providers are raced."""

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

    def test_quote_guard_fires_before_cache_read(self):
        # No cache/quote_cache mocking wired up on this bare __new__ instance
        # -- if the guard ran AFTER the cache read (the pre-fix placement),
        # this would blow up on a missing `quote_cache` attribute access
        # instead of raising the gated-token SwapError. Passing cleanly with
        # only the gated-token error proves the guard is now first.
        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="allowlist-gated"):
            asyncio.run(
                engine._get_quote_impl(
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_token="USTB",
                    to_token="USDC",
                    amount=100.0,
                    from_address="0x00000000000000000000000000000000000001",
                    platform_fee_bps=0,
                )
            )

    def test_get_all_quotes_rejects_gated_token_before_racing_providers(self):
        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="USTB"):
            asyncio.run(
                engine.get_all_quotes(
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_token="USDC",
                    to_token="USTB",
                    amount=100.0,
                    from_address="0x00000000000000000000000000000000000001",
                )
            )

    def test_build_external_evm_swap_rejects_gated_token(self):
        engine = SwapEngine.__new__(SwapEngine)
        with pytest.raises(SwapError, match="USCC"):
            asyncio.run(
                engine.build_external_evm_swap(
                    from_chain="ethereum",
                    to_chain="ethereum",
                    from_token="USCC",
                    to_token="USDC",
                    amount=100.0,
                    from_address="0x00000000000000000000000000000000000000b2",
                    slippage=0.5,
                )
            )

    def test_execute_swap_rejects_gated_token_before_locks(self):
        # provider="lifi" clears the EXECUTABLE_PROVIDERS backstop so this
        # reaches the gated-token guard; must raise before touching
        # self._wallet_locks (unset on a bare __new__ instance) or the DB.
        from bot.services.swap_engine import SwapQuote

        engine = SwapEngine.__new__(SwapEngine)
        quote = SwapQuote(
            provider="lifi",
            from_chain="ethereum",
            to_chain="ethereum",
            from_token="USDC",
            to_token="USTB",
            from_amount="100000000",
            from_amount_human=100.0,
            to_amount="100000000",
            to_amount_human=100.0,
            to_amount_min="99000000",
            gas_cost_usd=0.0,
            fee_cost_usd=0.0,
            total_cost_usd=0.0,
            estimated_time=1,
            price_impact=0.0,
            exchange_rate=1.0,
            raw_quote={},
        )
        with pytest.raises(SwapError, match="USTB"):
            asyncio.run(
                engine.execute_swap(
                    quote=quote,
                    wallet_id=1,
                    user_id=1,
                )
            )

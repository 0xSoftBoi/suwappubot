"""Unit tests for SwapEngine's net-of-gas quote ranking (get_quote at ~L690).

`_rank_quotes` / `_extract_output_usd_price` / `_quote_net_score` are pure,
synchronous, module-level helpers — no network, no SwapEngine instance
needed — so they're tested directly here.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.swap_engine import (
    SwapQuote,
    _extract_output_usd_price,
    _quote_net_score,
    _rank_quotes,
)


def _quote(
    provider: str,
    to_amount_human: float,
    gas_cost_usd: float = 0.0,
    raw_quote: dict | None = None,
) -> SwapQuote:
    return SwapQuote(
        provider=provider,
        from_chain="arbitrum",
        to_chain="arbitrum",
        from_token="USDT",
        to_token="USDC",
        from_amount="1000000",
        from_amount_human=1.0,
        to_amount=str(int(to_amount_human * 1e6)),
        to_amount_human=to_amount_human,
        to_amount_min=str(int(to_amount_human * 1e6)),
        gas_cost_usd=gas_cost_usd,
        fee_cost_usd=0.0,
        total_cost_usd=gas_cost_usd,
        estimated_time=15,
        price_impact=0.0,
        exchange_rate=to_amount_human,
        raw_quote=raw_quote or {},
    )


def _lifi_raw(to_amount_usd: float) -> dict:
    return {"estimate": {"toAmountUSD": str(to_amount_usd)}}


def _kyber_raw(amount_out_usd: float) -> dict:
    return {"kyberswap_quote": {"routeSummary": {"amountOutUsd": amount_out_usd}}}


class TestExtractOutputUsdPrice:
    def test_lifi_price_derived(self):
        # 100 USDC output valued at $100.5 -> price ~1.005/token
        q = _quote("lifi", to_amount_human=100.0, raw_quote=_lifi_raw(100.5))
        price = _extract_output_usd_price(q)
        assert price is not None
        assert abs(price - 1.005) < 1e-9

    def test_kyberswap_price_derived(self):
        q = _quote("kyberswap", to_amount_human=50.0, raw_quote=_kyber_raw(49.5))
        price = _extract_output_usd_price(q)
        assert price is not None
        assert abs(price - 0.99) < 1e-9

    def test_unknown_provider_no_usd_fields_returns_none(self):
        q = _quote("1inch", to_amount_human=10.0, raw_quote={"oneinch_quote": {"foo": "bar"}})
        assert _extract_output_usd_price(q) is None

    def test_zero_output_returns_none(self):
        q = _quote("lifi", to_amount_human=0.0, raw_quote=_lifi_raw(0.0))
        assert _extract_output_usd_price(q) is None

    def test_malformed_usd_value_does_not_raise(self):
        q = _quote("lifi", to_amount_human=10.0, raw_quote={"estimate": {"toAmountUSD": "nope"}})
        assert _extract_output_usd_price(q) is None


class TestRankQuotes:
    def test_higher_gross_but_gas_heavy_loses_to_net_better_quote(self):
        """Provider A: bigger raw output but expensive gas. Provider B: smaller
        raw output but near-zero gas. With a derivable $1/token price, B should
        win net-of-gas even though A wins gross."""
        raw = _lifi_raw(1.0)  # implies ~$1/token from either quote's own math
        quote_a = _quote("lifi", to_amount_human=100.0, gas_cost_usd=50.0, raw_quote=raw)
        quote_b = _quote("kyberswap", to_amount_human=90.0, gas_cost_usd=0.5)

        # quote_a exposes the shared $1/token price used to net both quotes:
        # a: 100 - 50/1 = 50 ; b: 90 - 0.5/1 = 89.5 -> b wins net
        best = _rank_quotes([quote_a, quote_b])
        assert best.provider == "kyberswap"

        # Sanity: gross ranking alone would have picked quote_a.
        assert max([quote_a, quote_b], key=lambda q: q.to_amount_human).provider == "lifi"

    def test_fallback_to_gross_ranking_when_no_usd_price(self):
        quote_a = _quote("1inch", to_amount_human=95.0, gas_cost_usd=10.0)
        quote_b = _quote("0x", to_amount_human=100.0, gas_cost_usd=0.0)

        best = _rank_quotes([quote_a, quote_b])
        assert best.provider == "0x"

    def test_wormhole_excluded_unless_sole_quote(self):
        wormhole_q = _quote("wormhole", to_amount_human=1000.0)  # optimistic 1:1, would "win" gross
        real_q = _quote("lifi", to_amount_human=90.0)

        best = _rank_quotes([wormhole_q, real_q])
        assert best.provider == "lifi"

        # Sole quote: wormhole is used since there's nothing else to route through.
        best_sole = _rank_quotes([wormhole_q])
        assert best_sole.provider == "wormhole"

    def test_single_quote_returned_directly(self):
        only = _quote("cctp", to_amount_human=42.0)
        assert _rank_quotes([only]) is only


class TestQuoteNetScore:
    def test_no_price_falls_back_to_gross(self):
        q = _quote("lifi", to_amount_human=10.0, gas_cost_usd=5.0)
        assert _quote_net_score(q, None) == 10.0

    def test_nets_gas_against_price(self):
        q = _quote("lifi", to_amount_human=10.0, gas_cost_usd=2.0)
        # out_price=$2/token -> gas of $2 costs 1 token -> net = 9
        assert _quote_net_score(q, 2.0) == 9.0

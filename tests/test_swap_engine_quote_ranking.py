"""Unit tests for SwapEngine's net-of-gas quote ranking (get_quote at ~L690).

`_rank_quotes` / `_rank_quotes_with_price` / `_extract_output_usd_price` /
`_derive_median_output_price` / `_quote_net_score` are pure, synchronous,
module-level helpers — no network, no SwapEngine instance needed — so
they're tested directly here.
"""

import os
import random

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.swap_engine import (
    SwapQuote,
    _derive_median_output_price,
    _extract_output_usd_price,
    _quote_net_score,
    _rank_quotes,
    _rank_quotes_with_price,
)


def _quote(
    provider: str,
    to_amount_human: float,
    gas_cost_usd: float = 0.0,
    raw_quote: dict | None = None,
    gas_cost_trusted: bool = False,
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
        gas_cost_trusted=gas_cost_trusted,
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
        raw output but near-zero gas. Both quotes carry TRUSTED gas figures
        and a derivable $1/token price (kept under the 20% clamp for both
        quotes), so B should win net-of-gas even though A wins gross."""
        # toAmountUSD=100.0 on a 100-unit output -> price = 100/100 = $1/token.
        raw = _lifi_raw(100.0)
        quote_a = _quote(
            "lifi", to_amount_human=100.0, gas_cost_usd=19.0, raw_quote=raw, gas_cost_trusted=True
        )
        quote_b = _quote("kyberswap", to_amount_human=98.0, gas_cost_usd=1.0, gas_cost_trusted=True)

        # a: 100 - 19/1 = 81 ; b: 98 - 1/1 = 97 -> b wins net
        best = _rank_quotes([quote_a, quote_b])
        assert best.provider == "kyberswap"

        # Sanity: gross ranking alone would have picked quote_a.
        assert max([quote_a, quote_b], key=lambda q: q.to_amount_human).provider == "lifi"

    def test_fallback_to_gross_ranking_when_no_usd_price(self):
        quote_a = _quote(
            "lifi", to_amount_human=95.0, gas_cost_usd=10.0, gas_cost_trusted=True
        )  # trusted, but no USD field in raw_quote
        quote_b = _quote(
            "kyberswap", to_amount_human=100.0, gas_cost_usd=0.0, gas_cost_trusted=True
        )

        best = _rank_quotes([quote_a, quote_b])
        assert best.provider == "kyberswap"

    def test_mixed_trusted_and_untrusted_gas_falls_back_to_gross(self):
        """One provider's gas figure is a heuristic (untrusted) — even though
        both expose a derivable USD price, the whole race must fall back to
        gross ranking rather than net one honest quote against one guess."""
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=50.0,
            raw_quote=_lifi_raw(1.0),
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "1inch",  # heuristic gas (1 gwei * $2000 estimate) -> untrusted
            to_amount_human=90.0,
            gas_cost_usd=0.5,
            gas_cost_trusted=False,
        )

        best = _rank_quotes([quote_a, quote_b])
        # Gross ranking: 100 > 90 -> lifi wins (net ranking would have picked
        # 1inch: 100 - 50/1 = 50 vs 90 - 0.5/1 = 89.5).
        assert best.provider == "lifi"

    def test_all_trusted_gas_applies_net_ranking(self):
        """Sanity companion to the mixed-trust test: with every quote trusted,
        net ranking is actually used (out_price is not None)."""
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=19.0,
            raw_quote=_lifi_raw(100.0),
            gas_cost_trusted=True,
        )
        quote_b = _quote("kyberswap", to_amount_human=98.0, gas_cost_usd=1.0, gas_cost_trusted=True)
        best, out_price = _rank_quotes_with_price([quote_a, quote_b])
        assert out_price is not None
        assert best.provider == "kyberswap"

    def test_hostile_outlier_usd_field_does_not_flip_winner(self):
        """A malicious/buggy adapter reporting a wildly positive but wrong USD
        price (e.g. 100,000x reality) must be discarded as an outlier rather
        than distorting the shared output-token price used to net every
        quote's gas. Needs >=2 HONEST sources plus the hostile one — with
        only 2 candidates total, an extreme value can drag the median enough
        to survive its own filter (median-of-2 is just their mean), so a
        median-based outlier filter only works with >=3 candidates.
        """
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=19.0,
            raw_quote=_lifi_raw(100.0),  # honest: $1.00/token
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "kyberswap",
            to_amount_human=95.0,
            gas_cost_usd=15.0,
            raw_quote=_kyber_raw(9_500_000.0),  # hostile: $100,000/token
            gas_cost_trusted=True,
        )
        quote_c = _quote(
            "avnu",
            to_amount_human=50.0,
            gas_cost_usd=1.0,
            raw_quote={"toAmountUSD": "50"},  # honest: $1.00/token (generic scan)
            gas_cost_trusted=True,
        )

        best, out_price = _rank_quotes_with_price([quote_a, quote_b, quote_c])
        # The hostile $100,000/token figure must be discarded by the outlier
        # filter — the surviving median price is the honest $1.00/token.
        assert out_price is not None
        assert abs(out_price - 1.0) < 1e-9

        # Honest netting: a=100-19=81, b=95-15=80, c=50-1=49 -> a wins.
        # Had the hostile self-reported price been used instead, b's gas
        # would look nearly free (95 - 15/100_000 ≈ 94.9998) and it would
        # have won — the outlier filter is what prevents that.
        assert best.provider == "lifi"

    def test_clamp_falls_back_to_gross_when_gas_deduction_is_implausible(self):
        """If netting gas against the derived price would eat more than 20%
        of a quote's own output (e.g. a raw-address token whose decimals
        haven't been corrected yet), the price is untrustworthy for the
        whole race -> gross ranking."""
        raw = _lifi_raw(100.0)  # $1/token
        quote_a = _quote(
            "lifi", to_amount_human=100.0, gas_cost_usd=15.0, raw_quote=raw, gas_cost_trusted=True
        )
        # quote_b's gas of $40 against $1/token would eat 40 of its own 90
        # units of output (>20%) -> clamp trips, whole race falls to gross.
        quote_b = _quote(
            "kyberswap", to_amount_human=90.0, gas_cost_usd=40.0, gas_cost_trusted=True
        )

        best, out_price = _rank_quotes_with_price([quote_a, quote_b])
        assert out_price is None
        assert best.provider == "lifi"  # gross: 100 > 90

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

    def test_deterministic_winner_across_shuffled_quote_order(self):
        """asyncio.wait returns a set (non-deterministic iteration order) —
        the winner (and the derived price) must not depend on the order
        quotes are handed to the ranker."""
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=19.0,
            raw_quote=_lifi_raw(100.0),  # $1/token
            gas_cost_trusted=True,
        )
        quote_b = _quote("kyberswap", to_amount_human=98.0, gas_cost_usd=1.0, gas_cost_trusted=True)
        quote_c = _quote(
            "avnu", to_amount_human=80.0, gas_cost_usd=0.1, raw_quote={}, gas_cost_trusted=True
        )

        # a: 100-19=81 ; b: 98-1=97 ; c: 80-0.1=79.9 -> b wins net every time.
        base = [quote_a, quote_b, quote_c]
        winners = set()
        prices = set()
        rng = random.Random(1234)
        for _ in range(20):
            shuffled = base[:]
            rng.shuffle(shuffled)
            best, out_price = _rank_quotes_with_price(shuffled)
            winners.add(best.provider)
            prices.add(round(out_price, 9) if out_price is not None else None)

        assert winners == {"kyberswap"}
        assert len(prices) == 1


class TestDeriveMedianOutputPrice:
    def test_median_of_multiple_sources(self):
        q1 = _quote("lifi", to_amount_human=100.0, raw_quote=_lifi_raw(100.0))  # $1.00
        q2 = _quote("kyberswap", to_amount_human=100.0, raw_quote=_kyber_raw(102.0))  # $1.02
        price = _derive_median_output_price([q1, q2])
        assert price is not None
        assert abs(price - 1.01) < 1e-9  # average of the two for an even count

    def test_no_candidates_returns_none(self):
        q1 = _quote("1inch", to_amount_human=100.0)
        q2 = _quote("0x", to_amount_human=100.0)
        assert _derive_median_output_price([q1, q2]) is None

    def test_outlier_discarded(self):
        # median([1.0, 3.0]) = 2.0; the 0.5x-2x filter keeps [1.0, 4.0], so a
        # 3x gap alone wouldn't trip it — widen to a 10x gap to actually
        # exercise the outlier discard.
        q1 = _quote("lifi", to_amount_human=100.0, raw_quote=_lifi_raw(100.0))  # $1.00
        q3 = _quote("kyberswap", to_amount_human=100.0, raw_quote=_kyber_raw(1000.0))  # $10.00
        price = _derive_median_output_price([q1, q3])
        assert price is not None
        # raw median of [1.0, 10.0] = 5.5; filter keeps [2.75, 11.0] -> only
        # 10.0 survives -> final price is 10.0, not blended with the value
        # discarded on the low side (1.0 is below 2.75).
        assert abs(price - 10.0) < 1e-9


class TestQuoteNetScore:
    def test_no_price_falls_back_to_gross(self):
        q = _quote("lifi", to_amount_human=10.0, gas_cost_usd=5.0)
        assert _quote_net_score(q, None) == 10.0

    def test_nets_gas_against_price(self):
        q = _quote("lifi", to_amount_human=10.0, gas_cost_usd=2.0)
        # out_price=$2/token -> gas of $2 costs 1 token -> net = 9
        assert _quote_net_score(q, 2.0) == 9.0

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
        and expose a derivable $1/token price (>=2 sources, so the price is
        actually trusted; each quote's own gas deduction stays under the 5%
        clamp), so B should win net-of-gas even though A wins gross."""
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=4.9,  # 4.9% of its own 100 -> under the 5% clamp
            raw_quote=_lifi_raw(100.0),  # $1.00/token
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "kyberswap",
            to_amount_human=98.0,
            gas_cost_usd=0.5,  # well under 5% of 98
            raw_quote=_kyber_raw(98.0),  # $1.00/token — 2nd source, price is trusted
            gas_cost_trusted=True,
        )

        # a: 100 - 4.9/1 = 95.1 ; b: 98 - 0.5/1 = 97.5 -> b wins net
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

    def test_single_usd_source_falls_back_to_gross(self):
        """R1 repro: a single-source price ($21 toAmountUSD / 100 units ->
        $0.21/token) combined with a small-looking $4 gas figure implied a
        19.05% deduction — just under the OLD 20% clamp — and flipped the
        winner to the smaller-output route, costing the user ~16%. A price
        derived from exactly one source is never trusted now, so this must
        stay on gross ranking and keep the honest (higher-output) winner."""
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=4.0,
            raw_quote=_lifi_raw(21.0),  # the ONLY USD source in the race
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "kyberswap",
            to_amount_human=84.0,
            gas_cost_usd=0.05,
            gas_cost_trusted=True,  # trusted gas, but no USD field at all
        )

        best, out_price = _rank_quotes_with_price([quote_a, quote_b])
        assert out_price is None  # single-source price is never trusted
        assert best.provider == "lifi"  # gross: 100 > 84 — NOT flipped

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
        # Gross ranking: 100 > 90 -> lifi wins. (This never reaches the price
        # derivation step at all — the trust gate short-circuits first.)
        assert best.provider == "lifi"

    def test_all_trusted_gas_applies_net_ranking(self):
        """Sanity companion to the mixed-trust test: with every quote trusted
        AND >=2 USD price sources, net ranking is actually used (out_price
        is not None)."""
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=4.9,
            raw_quote=_lifi_raw(100.0),
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "kyberswap",
            to_amount_human=98.0,
            gas_cost_usd=0.5,
            raw_quote=_kyber_raw(98.0),
            gas_cost_trusted=True,
        )
        best, out_price = _rank_quotes_with_price([quote_a, quote_b])
        assert out_price is not None
        assert best.provider == "kyberswap"

    def test_hostile_outlier_usd_field_does_not_flip_winner(self):
        """A malicious/buggy adapter reporting a wildly positive but wrong USD
        price (100,000x reality) must be discarded as an outlier rather than
        distorting the shared output-token price used to net every quote's
        gas. Needs >=2 HONEST sources plus the hostile one — with only 2
        candidates total, an extreme value can drag the median enough to
        survive its own filter (median-of-2 is just their mean), so a
        median-based outlier filter only works with >=3 candidates. Every
        quote's own gas deduction is kept under the 5% clamp.
        """
        quote_a = _quote(
            "lifi",
            to_amount_human=90.0,
            gas_cost_usd=0.1,
            raw_quote=_lifi_raw(90.0),  # honest: $1.00/token
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "kyberswap",
            to_amount_human=93.0,
            gas_cost_usd=4.6,  # 4.6/93 = 4.9%, just under the 5% clamp
            raw_quote=_kyber_raw(9_300_000.0),  # hostile: $100,000/token
            gas_cost_trusted=True,
        )
        quote_c = _quote(
            "avnu",
            to_amount_human=50.0,
            gas_cost_usd=0.1,
            raw_quote={"toAmountUSD": "50"},  # honest: $1.00/token (generic scan)
            gas_cost_trusted=True,
        )

        best, out_price = _rank_quotes_with_price([quote_a, quote_b, quote_c])
        # The hostile $100,000/token figure must be discarded by the outlier
        # filter — the surviving median price is the honest $1.00/token.
        assert out_price is not None
        assert abs(out_price - 1.0) < 1e-9

        # Honest netting: a=90-0.1=89.9 ; b=93-4.6=88.4 ; c=50-0.1=49.9 -> a wins.
        # Had the hostile self-reported price been used for b's OWN netting
        # instead, its real $4.60 gas would look nearly free
        # (93 - 4.6/100_000 ≈ 92.99995) and it would have won on a bogus
        # number — the outlier filter is what prevents that.
        assert best.provider == "lifi"

    def test_clamp_falls_back_to_gross_when_gas_deduction_is_implausible(self):
        """If netting gas against the derived (trusted, >=2-source) price
        would eat more than 5% of a quote's own output (e.g. a raw-address
        token whose decimals haven't been corrected yet), the price is
        untrustworthy for the whole race -> gross ranking."""
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=4.0,  # 4% — under the clamp
            raw_quote=_lifi_raw(100.0),  # $1/token
            gas_cost_trusted=True,
        )
        # quote_b's gas of $5 against $1/token would eat 5.56% of its own 90
        # units of output (>5%) -> clamp trips, whole race falls to gross.
        quote_b = _quote(
            "kyberswap",
            to_amount_human=90.0,
            gas_cost_usd=5.0,
            raw_quote=_kyber_raw(90.0),  # $1/token — 2nd source, so the price IS trusted
            gas_cost_trusted=True,
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
            gas_cost_usd=4.9,
            raw_quote=_lifi_raw(100.0),  # $1/token
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "kyberswap",
            to_amount_human=98.0,
            gas_cost_usd=0.5,
            raw_quote=_kyber_raw(98.0),  # 2nd USD source
            gas_cost_trusted=True,
        )
        quote_c = _quote(
            "avnu", to_amount_human=80.0, gas_cost_usd=0.1, raw_quote={}, gas_cost_trusted=True
        )

        # a: 100-4.9=95.1 ; b: 98-0.5=97.5 ; c: 80-0.1=79.9 -> b wins net every time.
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

    def test_single_source_price_not_trusted(self):
        """A price derived from exactly one quote is never used — with one
        data point there's nothing to median against or filter as an
        outlier, honest or not."""
        q1 = _quote("lifi", to_amount_human=100.0, raw_quote=_lifi_raw(21.0))  # $0.21/token
        q2 = _quote("kyberswap", to_amount_human=84.0)  # no USD field at all
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

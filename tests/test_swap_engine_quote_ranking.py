"""Unit tests for SwapEngine's net-of-gas quote ranking (get_quote at ~L690).

`_rank_quotes` / `_rank_quotes_with_price` / `_extract_output_usd_price` /
`_derive_median_output_price` / `_quote_net_score` are pure, synchronous,
module-level helpers — no network, no SwapEngine instance needed — so
they're tested directly here.
"""

import os
import random
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

from bot.services.swap_engine import (
    SwapEngine,
    SwapQuote,
    _derive_input_usd_value,
    _derive_median_output_price,
    _extract_input_usd_value,
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


def _lifi_raw_full(to_amount_usd: float, from_amount_usd: float) -> dict:
    return {"estimate": {"toAmountUSD": str(to_amount_usd), "fromAmountUSD": str(from_amount_usd)}}


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
        """R2 fallback path: when NO input-side USD figure is available at
        all (no Li.Fi fromAmountUSD in the race, no caller-supplied
        input_price_usd), the coarser "gas eats <=5% of output" clamp is
        still used as a guard of last resort."""
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=4.0,  # 4% — under the clamp
            raw_quote=_lifi_raw(100.0),  # $1/token (toAmountUSD only, no fromAmountUSD)
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

    def test_cross_check_agreeing_price_allows_net_ranking_despite_big_gas(self):
        """R2: the input-vs-output USD cross-check REPLACES the clamp as the
        primary guard. A quote whose gas eats 20% of its own output — which
        would have tripped the old 5%-of-output clamp and forced gross
        ranking — must still get net-ranked when its price is independently
        validated against a REAL input USD value (a small swap on an
        expensive chain is a legitimate case where gas can honestly be a
        large fraction of output)."""
        # input_price_usd=100.0 x from_amount_human=1.0 (fixture default) -> $100 input.
        quote_a = _quote(
            "lifi",
            to_amount_human=100.0,
            gas_cost_usd=20.0,  # 20% of its own output — would trip the OLD clamp
            raw_quote=_lifi_raw(100.0),  # $1/token
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "kyberswap",
            to_amount_human=98.0,
            gas_cost_usd=0.5,
            raw_quote=_kyber_raw(98.0),  # $1/token — 2nd source
            gas_cost_trusted=True,
        )

        best, out_price = _rank_quotes_with_price([quote_a, quote_b], input_price_usd=100.0)
        # Cross-check passes for both (implied output ~$100 and ~$98 vs a
        # $100 input — both well within 25%) -> net ranking actually ran.
        assert out_price is not None
        # a: 100-20=80 ; b: 98-0.5=97.5 -> b wins net (gross alone favored a).
        assert best.provider == "kyberswap"

    def test_cross_check_disagreeing_price_falls_back_to_gross(self):
        """R2: two providers can agree WITH EACH OTHER (so the outlier
        filter alone doesn't catch it) while both being wrong relative to
        the swap's real input value — e.g. a shared decimals bug scaling
        every quote's to_amount_human down by the same factor. The
        input-vs-output cross-check catches this precisely because it
        checks against an independent, real number instead of only
        comparing quotes against each other."""
        # Both quotes "agree" at an internally-consistent ~$10/token, but
        # the swap's real input is $100 and their tiny to_amount_human
        # values only imply ~$1 of output each -> wildly inconsistent.
        quote_a = _quote(
            "lifi",
            to_amount_human=0.1,
            gas_cost_usd=0.001,  # negligible — would never trip the 5% clamp
            raw_quote=_lifi_raw(1.0),  # implies $10/token given to_amount_human=0.1
            gas_cost_trusted=True,
        )
        quote_b = _quote(
            "kyberswap",
            to_amount_human=0.098,
            gas_cost_usd=0.0005,
            raw_quote=_kyber_raw(0.98),  # implies ~$10/token too — agrees with a
            gas_cost_trusted=True,
        )

        best, out_price = _rank_quotes_with_price([quote_a, quote_b], input_price_usd=100.0)
        assert out_price is None  # cross-check correctly rejected the price
        assert best.provider == "lifi"  # gross fallback: 0.1 > 0.098

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


class TestExtractInputUsdValue:
    def test_lifi_from_amount_usd_derived(self):
        q = _quote("lifi", to_amount_human=100.0, raw_quote=_lifi_raw_full(100.0, 99.5))
        assert _extract_input_usd_value(q) == 99.5

    def test_lifi_without_from_amount_usd_returns_none(self):
        q = _quote("lifi", to_amount_human=100.0, raw_quote=_lifi_raw(100.0))
        assert _extract_input_usd_value(q) is None

    def test_non_lifi_provider_returns_none(self):
        q = _quote("kyberswap", to_amount_human=100.0, raw_quote=_kyber_raw(100.0))
        assert _extract_input_usd_value(q) is None


class TestDeriveInputUsdValue:
    def test_prefers_lifi_reported_value(self):
        q1 = _quote("lifi", to_amount_human=100.0, raw_quote=_lifi_raw_full(100.0, 99.0))
        q2 = _quote("kyberswap", to_amount_human=98.0)
        assert _derive_input_usd_value([q1, q2], input_price_usd=1.0) == 99.0

    def test_falls_back_to_caller_supplied_price_times_input_amount(self):
        # No provider exposes fromAmountUSD; from_amount_human=1.0 (fixture default).
        q1 = _quote("lifi", to_amount_human=100.0, raw_quote=_lifi_raw(100.0))
        q2 = _quote("kyberswap", to_amount_human=98.0)
        assert _derive_input_usd_value([q1, q2], input_price_usd=1.23) == 1.23

    def test_returns_none_when_nothing_available(self):
        q1 = _quote("1inch", to_amount_human=100.0)
        q2 = _quote("0x", to_amount_human=98.0)
        assert _derive_input_usd_value([q1, q2], input_price_usd=None) is None


class TestRealGasCostUsd:
    """`SwapEngine._real_gas_cost_usd` — OKX/1inch/0x's real gas computation
    (live RPC gas price x cached native-token USD price). A @staticmethod,
    so no SwapEngine instance is needed."""

    async def test_trusted_when_all_inputs_real(self):
        with (
            patch(
                "bot.services.gas_tracker.gas_tracker.get_evm_gas_price",
                new=AsyncMock(return_value=SimpleNamespace(standard=5.0)),
            ),
            patch(
                "bot.services.price_service.price_service.get_price",
                new=AsyncMock(return_value=2000.0),
            ),
        ):
            cost_usd, trusted = await SwapEngine._real_gas_cost_usd("arbitrum", "200000")
        # 200,000 gas units * 5 gwei * 1e-9 * $2000/ETH = $2.00
        assert trusted is True
        assert abs(cost_usd - 2.0) < 1e-9

    async def test_untrusted_when_gas_price_rpc_fails(self):
        with (
            patch(
                "bot.services.gas_tracker.gas_tracker.get_evm_gas_price",
                new=AsyncMock(return_value=None),
            ),
            patch(
                "bot.services.price_service.price_service.get_price",
                new=AsyncMock(return_value=2000.0),
            ),
        ):
            cost_usd, trusted = await SwapEngine._real_gas_cost_usd("arbitrum", "200000")
        assert trusted is False
        assert cost_usd == 0.0

    async def test_untrusted_when_native_price_cache_miss(self):
        with (
            patch(
                "bot.services.gas_tracker.gas_tracker.get_evm_gas_price",
                new=AsyncMock(return_value=SimpleNamespace(standard=5.0)),
            ),
            patch(
                "bot.services.price_service.price_service.get_price",
                new=AsyncMock(return_value=None),
            ),
        ):
            cost_usd, trusted = await SwapEngine._real_gas_cost_usd("arbitrum", "200000")
        assert trusted is False
        assert cost_usd == 0.0

    async def test_untrusted_for_non_evm_chain(self):
        with (
            patch(
                "bot.services.gas_tracker.gas_tracker.get_evm_gas_price",
                new=AsyncMock(return_value=SimpleNamespace(standard=5.0)),
            ) as mock_gas,
            patch(
                "bot.services.price_service.price_service.get_price",
                new=AsyncMock(return_value=2000.0),
            ),
        ):
            cost_usd, trusted = await SwapEngine._real_gas_cost_usd("solana", "200000")
        assert trusted is False
        assert cost_usd == 0.0
        mock_gas.assert_not_called()  # short-circuits before any RPC/price lookup

    async def test_untrusted_when_estimated_gas_unparseable(self):
        cost_usd, trusted = await SwapEngine._real_gas_cost_usd("arbitrum", "not-a-number")
        assert trusted is False
        assert cost_usd == 0.0

    async def test_never_raises_on_unexpected_exception(self):
        """Failures must never break quoting — even an unexpected exception
        deep in the gas-tracker call must degrade to (0.0, False), not
        propagate."""
        with patch(
            "bot.services.gas_tracker.gas_tracker.get_evm_gas_price",
            new=AsyncMock(side_effect=RuntimeError("rpc exploded")),
        ):
            cost_usd, trusted = await SwapEngine._real_gas_cost_usd("arbitrum", "200000")
        assert trusted is False
        assert cost_usd == 0.0

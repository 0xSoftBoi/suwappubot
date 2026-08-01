"""Tests for stablecoin rail-aware routing in bot/services/router.py.

Covers the fix for the bug where `is_usdc` was computed in get_all_routes
but never reached _score_routes, so native 1:1 rails (CCTP, USDT0) got no
scoring preference over pooled/AMM bridges on stable pairs.
"""

from bot.services.router import (
    RouteOption,
    SmartRouter,
    is_native_rail_route,
    is_same_stable,
    is_stable_pair,
    is_stablecoin,
)


def _route(
    provider,
    from_token,
    to_token,
    net_output_usd=100.0,
    total_cost_usd=1.0,
    execution_time_seconds=30,
):
    return RouteOption(
        provider=provider,
        provider_display=provider,
        from_chain="ethereum",
        from_token=from_token,
        from_amount="1000000",
        from_amount_human=1.0,
        to_chain="arbitrum",
        to_token=to_token,
        to_amount="1000000",
        to_amount_human=1.0,
        gas_cost_usd=0.5,
        bridge_fee_usd=0.5,
        total_cost_usd=total_cost_usd,
        output_usd=net_output_usd + total_cost_usd,
        net_output_usd=net_output_usd,
        execution_time_seconds=execution_time_seconds,
        raw_quote={},
    )


# ---------------------------------------------------------------------------
# Stablecoin registry helpers
# ---------------------------------------------------------------------------


def test_is_stablecoin_recognizes_known_symbols():
    assert is_stablecoin("USDC") is True
    assert is_stablecoin("usdt") is True
    assert is_stablecoin("USDT0") is True
    assert is_stablecoin("DAI") is True
    assert is_stablecoin("ETH") is False
    assert is_stablecoin(None) is False
    assert is_stablecoin("") is False


def test_is_stable_pair_same_stable():
    assert is_stable_pair("USDC", "USDC") is True


def test_is_stable_pair_cross_stable():
    # USDC -> USDT is a stable pair even though the symbols differ.
    assert is_stable_pair("USDC", "USDT") is True
    assert is_stable_pair("USDT", "USDT0") is True


def test_is_stable_pair_rejects_non_stable_leg():
    assert is_stable_pair("USDC", "ETH") is False
    assert is_stable_pair("ETH", "SOL") is False


def test_is_same_stable_requires_identical_symbol():
    assert is_same_stable("USDC", "USDC") is True
    assert is_same_stable("USDC", "USDT") is False
    assert is_same_stable(None, "USDC") is False


def test_is_native_rail_route():
    assert is_native_rail_route("cctp") is True
    assert is_native_rail_route("usdt0") is True
    assert is_native_rail_route("across") is False
    assert is_native_rail_route("lifi") is False


# ---------------------------------------------------------------------------
# Scoring: native rail preferred over pooled bridge for stable pairs
# ---------------------------------------------------------------------------


def test_native_rail_preferred_over_pooled_for_equal_net_output():
    router = SmartRouter()
    cctp_route = _route("cctp", "USDC", "USDC", net_output_usd=100.0, total_cost_usd=0.5)
    pooled_route = _route("across", "USDC", "USDC", net_output_usd=100.0, total_cost_usd=0.5)

    scored = router._score_routes([cctp_route, pooled_route])
    scored_by_provider = {r.provider: r for r in scored}

    assert scored_by_provider["cctp"].score > scored_by_provider["across"].score


def test_pooled_bridge_can_still_win_on_meaningfully_better_output():
    """The native-rail preference nudges ranking; it must not blindly
    override an honestly-better net output from a pooled bridge."""
    router = SmartRouter()
    cctp_route = _route("cctp", "USDC", "USDC", net_output_usd=90.0, total_cost_usd=10.0)
    pooled_route = _route("across", "USDC", "USDC", net_output_usd=150.0, total_cost_usd=1.0)

    scored = router._score_routes([cctp_route, pooled_route])
    scored_by_provider = {r.provider: r for r in scored}

    assert scored_by_provider["across"].score > scored_by_provider["cctp"].score


def test_usdt0_preferred_over_pooled_for_cross_stable_pair():
    router = SmartRouter()
    usdt0_route = _route("usdt0", "USDT", "USDT", net_output_usd=100.0, total_cost_usd=0.5)
    pooled_route = _route("symbiosis", "USDT", "USDC", net_output_usd=100.0, total_cost_usd=0.5)

    scored = router._score_routes([usdt0_route, pooled_route])
    scored_by_provider = {r.provider: r for r in scored}

    assert scored_by_provider["usdt0"].score > scored_by_provider["symbiosis"].score


# ---------------------------------------------------------------------------
# Regression guard: non-stable routing scoring unchanged
# ---------------------------------------------------------------------------


def test_non_stable_routing_scoring_unaffected_by_native_rail_logic():
    """For a non-stable pair, a 'cctp'-named route (hypothetically) must get
    no native-rail bonus, and scoring must fall back purely to the existing
    output/cost/speed/reliability/mev weighting untouched by this change."""
    router = SmartRouter()
    route_a = _route("jupiter", "SOL", "ETH", net_output_usd=100.0, total_cost_usd=1.0)
    route_b = _route("lifi", "SOL", "ETH", net_output_usd=100.0, total_cost_usd=1.0)

    scored = router._score_routes([route_a, route_b])
    scored_by_provider = {r.provider: r for r in scored}

    # Reliability table gives jupiter (0.95) > lifi (0.88) already, with no
    # stable-pair adjustment applied to either (pair is not a stablecoin
    # pair) — jupiter should win on the pre-existing reliability delta
    # alone, same as before this change.
    assert scored_by_provider["jupiter"].score > scored_by_provider["lifi"].score


def test_non_stable_pair_with_cctp_provider_name_gets_no_bonus():
    """Defensive: even a route literally named 'cctp' gets no native-rail
    floor if the pair isn't recognized as a stablecoin pair (should never
    happen in practice, but the scoring logic must gate on the pair, not
    just the provider name)."""
    router = SmartRouter()
    cctp_like = _route("cctp", "ETH", "SOL", net_output_usd=100.0, total_cost_usd=1.0)
    other = _route("lifi", "ETH", "SOL", net_output_usd=100.0, total_cost_usd=1.0)

    scored = router._score_routes([cctp_like, other])
    scored_by_provider = {r.provider: r for r in scored}

    # cctp still wins here because its base reliability (0.98) > lifi's
    # (0.88) regardless of the stable-pair bonus — but the delta should
    # match the *unadjusted* reliability gap, not the boosted 0.99 floor
    # nor the 0.9x pooled discount, since ETH/SOL is not a stable pair.
    # Score difference should be driven ONLY by the pre-existing reliability
    # + MEV tables (0.98 vs 0.88 reliability at weight 0.1, plus the mev
    # weighting), NOT by the stable-pair native-rail path (which would push
    # cctp's reliability further to a 0.99 floor) — since ETH/SOL is not a
    # stable pair, that path must not fire here.
    unadjusted_rel_delta = (0.98 - 0.88) * 0.1
    mev_delta = (0.8 - 0.3) * 0.05
    expected_delta = unadjusted_rel_delta + mev_delta
    actual_delta = scored_by_provider["cctp"].score - scored_by_provider["lifi"].score
    assert abs(actual_delta - expected_delta) < 1e-9


def test_swap_routing_regression_full_get_all_routes_import_still_works():
    """Smoke test that router.py still imports and constructs cleanly after
    the stablecoin-registry addition (catches accidental top-level breakage)."""
    router = SmartRouter()
    assert router is not None

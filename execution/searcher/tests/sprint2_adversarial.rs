use suwappu_execution_searcher::capital::{
    optimize_funding, CapitalError, CapitalSource, CapitalSourceKind,
};
use suwappu_execution_searcher::fair_value::{
    estimate, FairValueCoefficients, FairValueFeatures, FairValueHorizon,
};
use suwappu_execution_searcher::hedge::{decide_hedge, HedgeConfig, HedgeState};
use suwappu_execution_searcher::maker::{
    admit_quote, select_mode, MakerEdge, MakerHealth, MakerRiskPolicy,
};
use suwappu_execution_searcher::pamm::{
    control_quote, PammControllerConfig, PammMode, PammState, QuoteDecision,
};
use suwappu_execution_searcher::FIXED_SCALE;

fn policy() -> MakerRiskPolicy {
    MakerRiskPolicy {
        max_fair_value_age_ns: 100_000_000,
        min_price_sources: 3,
        strict_builder_coverage_bps: 8_000,
        protected_builder_coverage_bps: 4_000,
        strict_max_toxicity_bps: 2_500,
        protected_max_toxicity_bps: 5_500,
        close_toxicity_bps: 8_500,
        strict_max_inventory_bps: 5_000,
        protected_max_inventory_bps: 8_000,
        close_inventory_bps: 9_500,
        allow_fallback: true,
    }
}

fn healthy() -> MakerHealth {
    MakerHealth {
        fair_value_age_ns: 1_000_000,
        healthy_price_sources: 5,
        builder_freshness_guaranteed: true,
        builder_coverage_bps: 9_000,
        toxicity_bps: 1_000,
        inventory_abs_bps: 1_000,
        hedge_venue_healthy: true,
    }
}

fn pamm_config() -> PammControllerConfig {
    PammControllerConfig {
        base_half_spread_bps: 4,
        volatility_weight_bps: 2_000,
        toxicity_weight_bps: 100,
        builder_risk_weight_bps: 500,
        hedge_impact_weight_bps: 5_000,
        inventory_spread_weight_bps: 200,
        inventory_skew_weight_bps: 1_000,
        size_linear_weight_bps: 200,
        size_quadratic_weight_bps: 100,
        protected_spread_multiplier_bps: 12_500,
        fallback_spread_multiplier_bps: 20_000,
        protected_size_multiplier_bps: 7_500,
        fallback_size_multiplier_bps: 2_500,
        max_half_spread_bps: 500,
        max_inventory_skew_bps: 200,
        min_quote_change_bps: 2,
        quote_ttl_ns: 1_000_000_000,
        refresh_before_expiry_ns: 100_000_000,
    }
}

fn quote_state(builder_uncertainty_bps: u16) -> PammState {
    PammState {
        fair_value: 4_000 * FIXED_SCALE,
        volatility_bps: 100,
        toxicity_probability_bps: 1_000,
        builder_uncertainty_bps,
        hedge_impact_bps: 5,
        inventory_ratio_bps: 1_000,
        size_ratio_bps: 2_000,
        max_bid_quantity: 100 * FIXED_SCALE,
        max_ask_quantity: 100 * FIXED_SCALE,
        valid_block_min: 100,
        valid_block_max: 100,
        now_ns: 1_000,
    }
}

fn unwrap_quote(decision: QuoteDecision) -> suwappu_execution_searcher::pamm::ControlledQuote {
    match decision {
        QuoteDecision::Replace(quote) => quote,
        other => panic!("expected replacement, got {other:?}"),
    }
}

#[test]
fn builder_freshness_loss_widens_and_throttles_before_full_close() {
    let strict = unwrap_quote(
        control_quote(pamm_config(), PammMode::Strict, 1, quote_state(50), None).unwrap(),
    );
    let protected = unwrap_quote(
        control_quote(
            pamm_config(),
            PammMode::Protected,
            1,
            quote_state(600),
            None,
        )
        .unwrap(),
    );
    let fallback = unwrap_quote(
        control_quote(
            pamm_config(),
            PammMode::Fallback,
            1,
            quote_state(2_000),
            None,
        )
        .unwrap(),
    );

    assert!(protected.half_spread_bps > strict.half_spread_bps);
    assert!(fallback.half_spread_bps > protected.half_spread_bps);
    assert!(protected.max_bid_quantity < strict.max_bid_quantity);
    assert!(fallback.max_bid_quantity < protected.max_bid_quantity);
}

#[test]
fn toxic_only_flow_closes_market_maker() {
    let mode = select_mode(
        policy(),
        MakerHealth {
            toxicity_bps: 9_000,
            ..healthy()
        },
    )
    .unwrap();
    assert_eq!(mode, PammMode::Closed);
}

#[test]
fn inventory_accumulation_degrades_then_closes() {
    let protected = select_mode(
        policy(),
        MakerHealth {
            inventory_abs_bps: 7_000,
            ..healthy()
        },
    )
    .unwrap();
    let closed = select_mode(
        policy(),
        MakerHealth {
            inventory_abs_bps: 9_700,
            ..healthy()
        },
    )
    .unwrap();

    assert_eq!(protected, PammMode::Protected);
    assert_eq!(closed, PammMode::Closed);
}

#[test]
fn hedge_venue_outage_closes_even_with_fresh_prices_and_builder() {
    let mode = select_mode(
        policy(),
        MakerHealth {
            hedge_venue_healthy: false,
            ..healthy()
        },
    )
    .unwrap();
    assert_eq!(mode, PammMode::Closed);
}

#[test]
fn adverse_selection_can_make_healthy_market_economically_unquotable() {
    let admission = admit_quote(
        policy(),
        healthy(),
        MakerEdge {
            spread_capture_bps: 20,
            expected_lvr_bps: 5,
            expected_markout_loss_bps: 12,
            expected_hedge_impact_bps: 3,
            inventory_penalty_bps: 2,
            quote_update_cost_bps: 1,
            safety_margin_bps: 2,
        },
    )
    .unwrap();

    assert_eq!(admission.mode, PammMode::Strict);
    assert!(!admission.quote_allowed);
    assert!(admission.net_edge_bps < 0);
}

#[test]
fn fair_value_price_jump_is_bounded_by_model_guardrail() {
    let estimate = estimate(
        FairValueHorizon::Ms10,
        FairValueCoefficients {
            intercept_bps: 0,
            microprice_weight_bps: 10_000,
            imbalance_weight_bps: 10_000,
            signed_flow_weight_bps: 10_000,
            basis_weight_bps: 10_000,
            cross_venue_weight_bps: 10_000,
            sigma_bps: 200,
            max_abs_adjustment_bps: 300,
        },
        FairValueFeatures {
            mid: 4_000 * FIXED_SCALE,
            microprice_bps: 2_000,
            book_imbalance_bps: 2_000,
            signed_flow_bps: 2_000,
            basis_bps: 2_000,
            cross_venue_bps: 2_000,
        },
    )
    .unwrap();

    assert_eq!(estimate.adjustment_bps, 300);
    assert_eq!(estimate.price, 4_120 * FIXED_SCALE);
}

#[test]
fn depth_collapse_fails_funding_closed_when_no_source_can_cover() {
    let result = optimize_funding(
        &[
            CapitalSource {
                id: "hot".into(),
                kind: CapitalSourceKind::HotInventory,
                capacity: 5 * FIXED_SCALE,
                explicit_fee_bps: 0,
                opportunity_cost_bps: 10,
                failure_risk_bps: 0,
                liquidity_risk_bps: 0,
                fixed_cost_quote: 0,
            },
            CapitalSource {
                id: "flash".into(),
                kind: CapitalSourceKind::FlashLoan,
                capacity: 10 * FIXED_SCALE,
                explicit_fee_bps: 5,
                opportunity_cost_bps: 0,
                failure_risk_bps: 50,
                liquidity_risk_bps: 100,
                fixed_cost_quote: FIXED_SCALE,
            },
        ],
        20 * FIXED_SCALE,
    );

    assert!(matches!(result, Err(CapitalError::InsufficientCapacity)));
}

#[test]
fn inventory_hard_limit_forces_full_hedge_despite_impact() {
    let decision = decide_hedge(
        HedgeConfig {
            base_urgency_bps: 500,
            inventory_weight_bps: 6_000,
            volatility_weight_bps: 2_000,
            impact_penalty_weight_bps: 4_000,
            offsetting_flow_penalty_weight_bps: 5_000,
            hard_inventory_limit_bps: 9_000,
            max_hedge_fraction_bps: 10_000,
        },
        HedgeState {
            inventory_notional: 95 * FIXED_SCALE,
            risk_capacity_notional: 100 * FIXED_SCALE,
            volatility_bps: 500,
            expected_impact_bps: 10_000,
            expected_offsetting_flow_bps: 10_000,
        },
    )
    .unwrap()
    .unwrap();

    assert_eq!(decision.hedge_fraction_bps, 10_000);
    assert_eq!(decision.hedge_notional, 95 * FIXED_SCALE);
}

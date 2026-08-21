use suwappu_execution_searcher::capital::{
    optimize_funding, CapitalSource, CapitalSourceKind,
};
use suwappu_execution_searcher::fair_value::{
    FairValueCoefficients, FairValueFeatures, FairValueHorizon, MultiHorizonFairValue,
};
use suwappu_execution_searcher::hedge::{decide_hedge, HedgeConfig, HedgeSide, HedgeState};
use suwappu_execution_searcher::maker::{
    admit_quote, MakerEdge, MakerHealth, MakerRiskPolicy,
};
use suwappu_execution_searcher::markout::{Horizon, Markout};
use suwappu_execution_searcher::pamm::{
    control_quote, PammControllerConfig, PammMode, PammState, QuoteDecision,
};
use suwappu_execution_searcher::toxicity::estimate_toxicity;
use suwappu_execution_searcher::FIXED_SCALE;

fn fair_model() -> MultiHorizonFairValue {
    let coeff = |micro: i64, flow: i64, sigma: u32| FairValueCoefficients {
        intercept_bps: 0,
        microprice_weight_bps: micro,
        imbalance_weight_bps: 2_000,
        signed_flow_weight_bps: flow,
        basis_weight_bps: 1_000,
        cross_venue_weight_bps: 3_000,
        sigma_bps: sigma,
        max_abs_adjustment_bps: 300,
    };
    MultiHorizonFairValue {
        ms10: coeff(8_000, 5_000, 8),
        ms100: coeff(5_000, 4_000, 12),
        sec1: coeff(2_000, 2_000, 20),
        sec12: coeff(500, 500, 40),
    }
}

fn maker_policy() -> MakerRiskPolicy {
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

fn pamm_config() -> PammControllerConfig {
    PammControllerConfig {
        base_half_spread_bps: 3,
        volatility_weight_bps: 2_000,
        toxicity_weight_bps: 100,
        builder_risk_weight_bps: 500,
        hedge_impact_weight_bps: 4_000,
        inventory_spread_weight_bps: 300,
        inventory_skew_weight_bps: 1_200,
        size_linear_weight_bps: 200,
        size_quadratic_weight_bps: 100,
        protected_spread_multiplier_bps: 12_500,
        fallback_spread_multiplier_bps: 20_000,
        protected_size_multiplier_bps: 7_500,
        fallback_size_multiplier_bps: 2_500,
        max_half_spread_bps: 500,
        max_inventory_skew_bps: 250,
        min_quote_change_bps: 1,
        quote_ttl_ns: 1_000_000_000,
        refresh_before_expiry_ns: 100_000_000,
    }
}

#[test]
fn healthy_market_flows_through_full_sprint2_control_stack() {
    let fair = fair_model()
        .estimate(
            FairValueHorizon::Ms100,
            FairValueFeatures {
                mid: 4_000 * FIXED_SCALE,
                microprice_bps: 12,
                book_imbalance_bps: 8,
                signed_flow_bps: 10,
                basis_bps: 2,
                cross_venue_bps: 4,
            },
        )
        .unwrap();

    let markouts = [
        Markout {
            horizon: Horizon::TimeNs(100_000_000),
            sampled_ts_ns: 1,
            sampled_block: Some(1),
            future_fair: fair.price,
            maker_markout_bps: 5,
        },
        Markout {
            horizon: Horizon::TimeNs(100_000_000),
            sampled_ts_ns: 2,
            sampled_block: Some(1),
            future_fair: fair.price,
            maker_markout_bps: -15,
        },
        Markout {
            horizon: Horizon::TimeNs(100_000_000),
            sampled_ts_ns: 3,
            sampled_block: Some(1),
            future_fair: fair.price,
            maker_markout_bps: 2,
        },
        Markout {
            horizon: Horizon::TimeNs(100_000_000),
            sampled_ts_ns: 4,
            sampled_block: Some(1),
            future_fair: fair.price,
            maker_markout_bps: 1,
        },
    ];
    let toxicity = estimate_toxicity(&markouts, 10).unwrap();

    let admission = admit_quote(
        maker_policy(),
        MakerHealth {
            fair_value_age_ns: 5_000_000,
            healthy_price_sources: 5,
            builder_freshness_guaranteed: true,
            builder_coverage_bps: 9_000,
            toxicity_bps: toxicity.toxic_probability_bps,
            inventory_abs_bps: 3_000,
            hedge_venue_healthy: true,
        },
        MakerEdge {
            spread_capture_bps: 25,
            expected_lvr_bps: 3,
            expected_markout_loss_bps: toxicity.mean_adverse_markout_bps,
            expected_hedge_impact_bps: 2,
            inventory_penalty_bps: 2,
            quote_update_cost_bps: 1,
            safety_margin_bps: 2,
        },
    )
    .unwrap();
    assert_eq!(admission.mode, PammMode::Strict);
    assert!(admission.quote_allowed);

    let hedge = decide_hedge(
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
            inventory_notional: 30 * FIXED_SCALE,
            risk_capacity_notional: 100 * FIXED_SCALE,
            volatility_bps: fair.sigma_bps,
            expected_impact_bps: 2,
            expected_offsetting_flow_bps: 1_000,
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(hedge.side, HedgeSide::Sell);

    let funding = optimize_funding(
        &[
            CapitalSource {
                id: "hot".into(),
                kind: CapitalSourceKind::HotInventory,
                capacity: 50 * FIXED_SCALE,
                explicit_fee_bps: 0,
                opportunity_cost_bps: 12,
                failure_risk_bps: 0,
                liquidity_risk_bps: 0,
                fixed_cost_quote: 0,
            },
            CapitalSource {
                id: "flash".into(),
                kind: CapitalSourceKind::FlashLoan,
                capacity: 100 * FIXED_SCALE,
                explicit_fee_bps: 5,
                opportunity_cost_bps: 0,
                failure_risk_bps: 1,
                liquidity_risk_bps: 0,
                fixed_cost_quote: FIXED_SCALE / 10,
            },
        ],
        60 * FIXED_SCALE,
    )
    .unwrap();
    assert_eq!(funding.amount, 60 * FIXED_SCALE);
    assert!(!funding.legs.is_empty());

    let decision = control_quote(
        pamm_config(),
        admission.mode,
        1,
        PammState {
            fair_value: fair.price,
            volatility_bps: fair.sigma_bps,
            toxicity_probability_bps: toxicity.toxic_probability_bps,
            builder_uncertainty_bps: 100,
            hedge_impact_bps: 2,
            inventory_ratio_bps: 3_000,
            size_ratio_bps: 2_000,
            max_bid_quantity: 100 * FIXED_SCALE,
            max_ask_quantity: 100 * FIXED_SCALE,
            valid_block_min: 100,
            valid_block_max: 100,
            now_ns: 10_000,
        },
        None,
    )
    .unwrap();

    let QuoteDecision::Replace(quote) = decision else {
        panic!("expected a live quote");
    };
    assert!(quote.bid < quote.ask);
    assert_eq!(quote.mode, PammMode::Strict);
    assert!(quote.reservation_price < fair.price);
}

#[test]
fn stale_or_unhedgeable_market_closes_before_quote_generation() {
    let mode = suwappu_execution_searcher::maker::select_mode(
        maker_policy(),
        MakerHealth {
            fair_value_age_ns: 500_000_000,
            healthy_price_sources: 2,
            builder_freshness_guaranteed: false,
            builder_coverage_bps: 1_000,
            toxicity_bps: 1_000,
            inventory_abs_bps: 2_000,
            hedge_venue_healthy: false,
        },
    )
    .unwrap();
    assert_eq!(mode, PammMode::Closed);
}
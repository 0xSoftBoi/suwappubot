use crate::pamm::PammMode;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MakerRiskPolicy {
    pub max_fair_value_age_ns: u64,
    pub min_price_sources: u16,
    pub strict_builder_coverage_bps: u16,
    pub protected_builder_coverage_bps: u16,
    pub strict_max_toxicity_bps: u16,
    pub protected_max_toxicity_bps: u16,
    pub close_toxicity_bps: u16,
    pub strict_max_inventory_bps: u16,
    pub protected_max_inventory_bps: u16,
    pub close_inventory_bps: u16,
    pub allow_fallback: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MakerHealth {
    pub fair_value_age_ns: u64,
    pub healthy_price_sources: u16,
    pub builder_freshness_guaranteed: bool,
    pub builder_coverage_bps: u16,
    pub toxicity_bps: u16,
    pub inventory_abs_bps: u16,
    pub hedge_venue_healthy: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MakerEdge {
    pub spread_capture_bps: i32,
    pub expected_lvr_bps: u32,
    pub expected_markout_loss_bps: u32,
    pub expected_hedge_impact_bps: u32,
    pub inventory_penalty_bps: u32,
    pub quote_update_cost_bps: u32,
    pub safety_margin_bps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MakerAdmission {
    pub mode: PammMode,
    pub net_edge_bps: i32,
    pub quote_allowed: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MakerError {
    #[error("invalid maker risk policy")]
    InvalidPolicy,
    #[error("health basis-point fields exceed 10000")]
    InvalidHealth,
    #[error("maker edge arithmetic overflow")]
    Overflow,
}

pub fn select_mode(policy: MakerRiskPolicy, health: MakerHealth) -> Result<PammMode, MakerError> {
    validate_policy(policy)?;
    validate_health(health)?;

    if health.fair_value_age_ns > policy.max_fair_value_age_ns
        || health.healthy_price_sources < policy.min_price_sources
        || !health.hedge_venue_healthy
        || health.toxicity_bps >= policy.close_toxicity_bps
        || health.inventory_abs_bps >= policy.close_inventory_bps
    {
        return Ok(PammMode::Closed);
    }

    if health.builder_freshness_guaranteed
        && health.builder_coverage_bps >= policy.strict_builder_coverage_bps
        && health.toxicity_bps <= policy.strict_max_toxicity_bps
        && health.inventory_abs_bps <= policy.strict_max_inventory_bps
    {
        return Ok(PammMode::Strict);
    }

    if health.builder_coverage_bps >= policy.protected_builder_coverage_bps
        && health.toxicity_bps <= policy.protected_max_toxicity_bps
        && health.inventory_abs_bps <= policy.protected_max_inventory_bps
    {
        return Ok(PammMode::Protected);
    }

    Ok(if policy.allow_fallback {
        PammMode::Fallback
    } else {
        PammMode::Closed
    })
}

pub fn admit_quote(
    policy: MakerRiskPolicy,
    health: MakerHealth,
    edge: MakerEdge,
) -> Result<MakerAdmission, MakerError> {
    let mode = select_mode(policy, health)?;
    if mode == PammMode::Closed {
        return Ok(MakerAdmission {
            mode,
            net_edge_bps: i32::MIN,
            quote_allowed: false,
        });
    }

    let costs = u64::from(edge.expected_lvr_bps)
        .checked_add(u64::from(edge.expected_markout_loss_bps))
        .and_then(|value| value.checked_add(u64::from(edge.expected_hedge_impact_bps)))
        .and_then(|value| value.checked_add(u64::from(edge.inventory_penalty_bps)))
        .and_then(|value| value.checked_add(u64::from(edge.quote_update_cost_bps)))
        .and_then(|value| value.checked_add(u64::from(edge.safety_margin_bps)))
        .ok_or(MakerError::Overflow)?;
    let costs = i64::try_from(costs).map_err(|_| MakerError::Overflow)?;
    let net = i64::from(edge.spread_capture_bps)
        .checked_sub(costs)
        .ok_or(MakerError::Overflow)?;
    let net_edge_bps = i32::try_from(net).map_err(|_| MakerError::Overflow)?;

    Ok(MakerAdmission {
        mode,
        net_edge_bps,
        quote_allowed: net_edge_bps > 0,
    })
}

fn validate_policy(policy: MakerRiskPolicy) -> Result<(), MakerError> {
    if policy.max_fair_value_age_ns == 0
        || policy.min_price_sources == 0
        || policy.strict_builder_coverage_bps > 10_000
        || policy.protected_builder_coverage_bps > policy.strict_builder_coverage_bps
        || policy.strict_max_toxicity_bps > policy.protected_max_toxicity_bps
        || policy.protected_max_toxicity_bps >= policy.close_toxicity_bps
        || policy.close_toxicity_bps > 10_000
        || policy.strict_max_inventory_bps > policy.protected_max_inventory_bps
        || policy.protected_max_inventory_bps >= policy.close_inventory_bps
        || policy.close_inventory_bps > 10_000
    {
        return Err(MakerError::InvalidPolicy);
    }
    Ok(())
}

fn validate_health(health: MakerHealth) -> Result<(), MakerError> {
    if health.builder_coverage_bps > 10_000
        || health.toxicity_bps > 10_000
        || health.inventory_abs_bps > 10_000
    {
        return Err(MakerError::InvalidHealth);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> MakerRiskPolicy {
        MakerRiskPolicy {
            max_fair_value_age_ns: 100_000_000,
            min_price_sources: 3,
            strict_builder_coverage_bps: 8_000,
            protected_builder_coverage_bps: 4_000,
            strict_max_toxicity_bps: 2_000,
            protected_max_toxicity_bps: 5_000,
            close_toxicity_bps: 8_000,
            strict_max_inventory_bps: 5_000,
            protected_max_inventory_bps: 8_000,
            close_inventory_bps: 9_500,
            allow_fallback: true,
        }
    }

    fn health() -> MakerHealth {
        MakerHealth {
            fair_value_age_ns: 10_000_000,
            healthy_price_sources: 4,
            builder_freshness_guaranteed: true,
            builder_coverage_bps: 9_000,
            toxicity_bps: 1_000,
            inventory_abs_bps: 2_000,
            hedge_venue_healthy: true,
        }
    }

    #[test]
    fn healthy_builder_conditioned_market_is_strict() {
        assert_eq!(select_mode(policy(), health()).unwrap(), PammMode::Strict);
    }

    #[test]
    fn degraded_builder_coverage_moves_to_protected() {
        let degraded = MakerHealth {
            builder_freshness_guaranteed: false,
            builder_coverage_bps: 5_000,
            ..health()
        };
        assert_eq!(
            select_mode(policy(), degraded).unwrap(),
            PammMode::Protected
        );
    }

    #[test]
    fn stale_fair_value_closes_maker() {
        let stale = MakerHealth {
            fair_value_age_ns: 100_000_001,
            ..health()
        };
        assert_eq!(select_mode(policy(), stale).unwrap(), PammMode::Closed);
    }

    #[test]
    fn quote_requires_positive_net_edge_after_lvr_and_hedging() {
        let admitted = admit_quote(
            policy(),
            health(),
            MakerEdge {
                spread_capture_bps: 20,
                expected_lvr_bps: 4,
                expected_markout_loss_bps: 3,
                expected_hedge_impact_bps: 2,
                inventory_penalty_bps: 1,
                quote_update_cost_bps: 1,
                safety_margin_bps: 2,
            },
        )
        .unwrap();
        assert!(admitted.quote_allowed);
        assert_eq!(admitted.net_edge_bps, 7);

        let rejected = admit_quote(
            policy(),
            health(),
            MakerEdge {
                spread_capture_bps: 10,
                expected_lvr_bps: 4,
                expected_markout_loss_bps: 3,
                expected_hedge_impact_bps: 2,
                inventory_penalty_bps: 1,
                quote_update_cost_bps: 1,
                safety_margin_bps: 2,
            },
        )
        .unwrap();
        assert!(!rejected.quote_allowed);
        assert!(rejected.net_edge_bps < 0);
    }
}

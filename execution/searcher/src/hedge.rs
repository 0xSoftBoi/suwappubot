use crate::events::Fixed;
use crate::BPS_SCALE;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HedgeSide {
    Buy,
    Sell,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HedgeConfig {
    pub base_urgency_bps: u32,
    pub inventory_weight_bps: u32,
    pub volatility_weight_bps: u32,
    pub impact_penalty_weight_bps: u32,
    pub offsetting_flow_penalty_weight_bps: u32,
    pub hard_inventory_limit_bps: u32,
    pub max_hedge_fraction_bps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HedgeState {
    /// Signed base inventory notional. Positive means long base.
    pub inventory_notional: Fixed,
    pub risk_capacity_notional: Fixed,
    pub volatility_bps: u32,
    pub expected_impact_bps: u32,
    /// Expected naturally offsetting flow over the hedge horizon, as a fraction of inventory.
    pub expected_offsetting_flow_bps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HedgeDecision {
    pub side: HedgeSide,
    pub inventory_utilization_bps: u32,
    pub urgency_bps: u32,
    pub hedge_fraction_bps: u32,
    pub hedge_notional: Fixed,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum HedgeError {
    #[error("invalid hedge configuration")]
    InvalidConfig,
    #[error("risk capacity must be positive")]
    InvalidCapacity,
    #[error("fixed-point arithmetic overflow")]
    Overflow,
}

pub fn decide_hedge(
    config: HedgeConfig,
    state: HedgeState,
) -> Result<Option<HedgeDecision>, HedgeError> {
    validate_config(config)?;
    if state.risk_capacity_notional <= 0 {
        return Err(HedgeError::InvalidCapacity);
    }
    if state.inventory_notional == 0 {
        return Ok(None);
    }

    let abs_inventory = state
        .inventory_notional
        .checked_abs()
        .ok_or(HedgeError::Overflow)?;
    let utilization = abs_inventory
        .checked_mul(BPS_SCALE)
        .and_then(|value| value.checked_div(state.risk_capacity_notional))
        .ok_or(HedgeError::Overflow)?;
    let utilization_bps =
        u32::try_from(utilization.min(BPS_SCALE)).map_err(|_| HedgeError::Overflow)?;

    let hard_limit = utilization_bps >= config.hard_inventory_limit_bps;
    let urgency: u128 = if hard_limit {
        u128::from(config.max_hedge_fraction_bps)
    } else {
        let positive = u128::from(config.base_urgency_bps)
            .checked_add(weighted(utilization_bps, config.inventory_weight_bps)?)
            .and_then(|value| {
                value
                    .checked_add(weighted(state.volatility_bps, config.volatility_weight_bps).ok()?)
            })
            .ok_or(HedgeError::Overflow)?;
        let penalty = weighted(state.expected_impact_bps, config.impact_penalty_weight_bps)?
            .checked_add(weighted(
                state.expected_offsetting_flow_bps.min(BPS_SCALE as u32),
                config.offsetting_flow_penalty_weight_bps,
            )?)
            .ok_or(HedgeError::Overflow)?;
        positive
            .saturating_sub(penalty)
            .min(u128::from(config.max_hedge_fraction_bps))
    };

    let hedge_fraction_bps = u32::try_from(urgency).map_err(|_| HedgeError::Overflow)?;
    if hedge_fraction_bps == 0 {
        return Ok(None);
    }

    let hedge_notional = abs_inventory
        .checked_mul(i128::from(hedge_fraction_bps))
        .and_then(|value| value.checked_div(BPS_SCALE))
        .ok_or(HedgeError::Overflow)?;
    let side = if state.inventory_notional > 0 {
        HedgeSide::Sell
    } else {
        HedgeSide::Buy
    };

    Ok(Some(HedgeDecision {
        side,
        inventory_utilization_bps: utilization_bps,
        urgency_bps: hedge_fraction_bps,
        hedge_fraction_bps,
        hedge_notional,
    }))
}

fn validate_config(config: HedgeConfig) -> Result<(), HedgeError> {
    if config.hard_inventory_limit_bps == 0
        || config.hard_inventory_limit_bps > BPS_SCALE as u32
        || config.max_hedge_fraction_bps == 0
        || config.max_hedge_fraction_bps > BPS_SCALE as u32
        || config.base_urgency_bps > config.max_hedge_fraction_bps
    {
        return Err(HedgeError::InvalidConfig);
    }
    Ok(())
}

fn weighted(factor_bps: u32, weight_bps: u32) -> Result<u128, HedgeError> {
    u128::from(factor_bps)
        .checked_mul(u128::from(weight_bps))
        .and_then(|value| value.checked_div(BPS_SCALE as u128))
        .ok_or(HedgeError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FIXED_SCALE;

    fn config() -> HedgeConfig {
        HedgeConfig {
            base_urgency_bps: 500,
            inventory_weight_bps: 6_000,
            volatility_weight_bps: 2_000,
            impact_penalty_weight_bps: 4_000,
            offsetting_flow_penalty_weight_bps: 5_000,
            hard_inventory_limit_bps: 9_000,
            max_hedge_fraction_bps: 10_000,
        }
    }

    #[test]
    fn long_inventory_produces_sell_hedge() {
        let decision = decide_hedge(
            config(),
            HedgeState {
                inventory_notional: 50 * FIXED_SCALE,
                risk_capacity_notional: 100 * FIXED_SCALE,
                volatility_bps: 100,
                expected_impact_bps: 10,
                expected_offsetting_flow_bps: 0,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(decision.side, HedgeSide::Sell);
        assert!(decision.hedge_notional > 0);
    }

    #[test]
    fn natural_offsetting_flow_reduces_urgency() {
        let base = HedgeState {
            inventory_notional: 50 * FIXED_SCALE,
            risk_capacity_notional: 100 * FIXED_SCALE,
            volatility_bps: 100,
            expected_impact_bps: 10,
            expected_offsetting_flow_bps: 0,
        };
        let without = decide_hedge(config(), base).unwrap().unwrap();
        let with = decide_hedge(
            config(),
            HedgeState {
                expected_offsetting_flow_bps: 5_000,
                ..base
            },
        )
        .unwrap()
        .unwrap();
        assert!(with.hedge_fraction_bps < without.hedge_fraction_bps);
    }

    #[test]
    fn hard_inventory_limit_forces_full_hedge() {
        let decision = decide_hedge(
            config(),
            HedgeState {
                inventory_notional: 95 * FIXED_SCALE,
                risk_capacity_notional: 100 * FIXED_SCALE,
                volatility_bps: 0,
                expected_impact_bps: 10_000,
                expected_offsetting_flow_bps: 10_000,
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(decision.hedge_fraction_bps, 10_000);
    }

    #[test]
    fn zero_inventory_needs_no_hedge() {
        assert_eq!(
            decide_hedge(
                config(),
                HedgeState {
                    inventory_notional: 0,
                    risk_capacity_notional: 100 * FIXED_SCALE,
                    volatility_bps: 100,
                    expected_impact_bps: 0,
                    expected_offsetting_flow_bps: 0,
                },
            )
            .unwrap(),
            None
        );
    }
}

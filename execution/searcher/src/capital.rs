use crate::events::Fixed;
use crate::BPS_SCALE;
use std::cmp::Ordering;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapitalSourceKind {
    HotInventory,
    WarmYield,
    FlashLoan,
    NativeFlashAccounting,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapitalSource {
    pub id: String,
    pub kind: CapitalSourceKind,
    pub capacity: Fixed,
    pub explicit_fee_bps: u32,
    pub opportunity_cost_bps: u32,
    pub failure_risk_bps: u32,
    pub liquidity_risk_bps: u32,
    pub fixed_cost_quote: Fixed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FundingLeg {
    pub source_id: String,
    pub amount: Fixed,
    pub variable_cost_quote: Fixed,
    pub fixed_cost_quote: Fixed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FundingAllocation {
    pub amount: Fixed,
    pub total_cost_quote: Fixed,
    pub legs: Vec<FundingLeg>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CapitalError {
    #[error("funding amount must be positive")]
    InvalidAmount,
    #[error("capital source capacity and fixed cost must be nonnegative")]
    InvalidSource,
    #[error("too many sources for exact subset optimizer")]
    TooManySources,
    #[error("insufficient aggregate funding capacity")]
    InsufficientCapacity,
    #[error("fixed-point arithmetic overflow")]
    Overflow,
}

/// Exact subset optimizer for a deliberately small set of heterogeneous capital sources.
///
/// Fixed activation costs make a naive marginal-cost greedy policy incorrect. We enumerate
/// source subsets (capped at 16), then fill each subset from its cheapest variable source.
/// This is exact for linear marginal costs + per-source fixed activation cost.
pub fn optimize_funding(
    sources: &[CapitalSource],
    amount: Fixed,
) -> Result<FundingAllocation, CapitalError> {
    if amount <= 0 {
        return Err(CapitalError::InvalidAmount);
    }
    if sources.len() > 16 {
        return Err(CapitalError::TooManySources);
    }
    for source in sources {
        if source.capacity < 0 || source.fixed_cost_quote < 0 {
            return Err(CapitalError::InvalidSource);
        }
    }
    let aggregate = sources.iter().try_fold(0i128, |sum, source| {
        sum.checked_add(source.capacity).ok_or(CapitalError::Overflow)
    })?;
    if aggregate < amount {
        return Err(CapitalError::InsufficientCapacity);
    }

    let mut best: Option<FundingAllocation> = None;
    let subset_count = 1u32
        .checked_shl(u32::try_from(sources.len()).map_err(|_| CapitalError::TooManySources)?)
        .ok_or(CapitalError::TooManySources)?;

    for mask in 1..subset_count {
        let mut capacity = 0i128;
        let mut active = Vec::new();
        for (index, source) in sources.iter().enumerate() {
            if mask & (1u32 << index) != 0 {
                capacity = capacity
                    .checked_add(source.capacity)
                    .ok_or(CapitalError::Overflow)?;
                active.push(source);
            }
        }
        if capacity < amount {
            continue;
        }

        active.sort_by(|left, right| {
            variable_bps(left)
                .cmp(&variable_bps(right))
                .then_with(|| left.id.cmp(&right.id))
        });

        let mut remaining = amount;
        let mut legs = Vec::new();
        let mut total_cost = 0i128;
        for source in active {
            if remaining == 0 {
                break;
            }
            let allocated = remaining.min(source.capacity);
            if allocated == 0 {
                continue;
            }
            let variable = variable_cost(allocated, variable_bps(source))?;
            let leg_cost = variable
                .checked_add(source.fixed_cost_quote)
                .ok_or(CapitalError::Overflow)?;
            total_cost = total_cost
                .checked_add(leg_cost)
                .ok_or(CapitalError::Overflow)?;
            legs.push(FundingLeg {
                source_id: source.id.clone(),
                amount: allocated,
                variable_cost_quote: variable,
                fixed_cost_quote: source.fixed_cost_quote,
            });
            remaining -= allocated;
        }
        if remaining != 0 {
            continue;
        }

        let candidate = FundingAllocation {
            amount,
            total_cost_quote: total_cost,
            legs,
        };
        let replace = best.as_ref().is_none_or(|current| {
            match candidate.total_cost_quote.cmp(&current.total_cost_quote) {
                Ordering::Less => true,
                Ordering::Equal => allocation_key(&candidate) < allocation_key(current),
                Ordering::Greater => false,
            }
        });
        if replace {
            best = Some(candidate);
        }
    }

    best.ok_or(CapitalError::InsufficientCapacity)
}

fn variable_bps(source: &CapitalSource) -> u128 {
    u128::from(source.explicit_fee_bps)
        + u128::from(source.opportunity_cost_bps)
        + u128::from(source.failure_risk_bps)
        + u128::from(source.liquidity_risk_bps)
}

fn variable_cost(amount: Fixed, bps: u128) -> Result<Fixed, CapitalError> {
    let bps = i128::try_from(bps).map_err(|_| CapitalError::Overflow)?;
    amount
        .checked_mul(bps)
        .and_then(|value| value.checked_div(BPS_SCALE))
        .ok_or(CapitalError::Overflow)
}

fn allocation_key(allocation: &FundingAllocation) -> String {
    allocation
        .legs
        .iter()
        .map(|leg| leg.source_id.as_str())
        .collect::<Vec<_>>()
        .join("|")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FIXED_SCALE;

    fn source(
        id: &str,
        kind: CapitalSourceKind,
        capacity: i128,
        variable_bps: u32,
        fixed: i128,
    ) -> CapitalSource {
        CapitalSource {
            id: id.into(),
            kind,
            capacity: capacity * FIXED_SCALE,
            explicit_fee_bps: variable_bps,
            opportunity_cost_bps: 0,
            failure_risk_bps: 0,
            liquidity_risk_bps: 0,
            fixed_cost_quote: fixed * FIXED_SCALE,
        }
    }

    #[test]
    fn high_opportunity_cost_inventory_can_lose_to_flash_liquidity() {
        let mut hot = source("hot", CapitalSourceKind::HotInventory, 1_000, 0, 0);
        hot.opportunity_cost_bps = 80;
        let flash = source("aave", CapitalSourceKind::FlashLoan, 1_000, 5, 1);
        let allocation = optimize_funding(&[hot, flash], 500 * FIXED_SCALE).unwrap();
        assert_eq!(allocation.legs.len(), 1);
        assert_eq!(allocation.legs[0].source_id, "aave");
    }

    #[test]
    fn fixed_activation_cost_keeps_small_trade_on_one_source() {
        let cheap_variable = source("cheap-variable", CapitalSourceKind::WarmYield, 1_000, 1, 20);
        let no_fixed = source("no-fixed", CapitalSourceKind::HotInventory, 1_000, 10, 0);
        let allocation = optimize_funding(&[cheap_variable, no_fixed], 10 * FIXED_SCALE).unwrap();
        assert_eq!(allocation.legs.len(), 1);
        assert_eq!(allocation.legs[0].source_id, "no-fixed");
    }

    #[test]
    fn optimizer_blends_sources_when_capacity_requires_it() {
        let a = source("a", CapitalSourceKind::HotInventory, 100, 1, 0);
        let b = source("b", CapitalSourceKind::FlashLoan, 100, 2, 0);
        let allocation = optimize_funding(&[a, b], 150 * FIXED_SCALE).unwrap();
        assert_eq!(allocation.legs.len(), 2);
        assert_eq!(allocation.legs[0].source_id, "a");
        assert_eq!(allocation.legs[0].amount, 100 * FIXED_SCALE);
        assert_eq!(allocation.legs[1].amount, 50 * FIXED_SCALE);
    }
}
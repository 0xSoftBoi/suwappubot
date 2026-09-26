use crate::events::Fixed;
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SizeSearch {
    pub min_input: Fixed,
    pub max_input: Fixed,
    pub step: Fixed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SizeOptimum {
    pub input: Fixed,
    pub net_pnl_quote: Fixed,
    pub evaluations: u64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SizingError {
    #[error("invalid search bounds or step")]
    InvalidDomain,
    #[error("search domain exceeds evaluation budget")]
    EvaluationBudgetExceeded,
    #[error("no executable point in search domain")]
    NoExecutablePoint,
    #[error("unimodal refinement encountered a non-executable point")]
    NonExecutablePoint,
    #[error("fixed-point arithmetic overflow")]
    Overflow,
}

/// Deterministic exact grid search used as the Sprint 1 correctness oracle.
///
/// This is intentionally not the final low-latency production optimizer. It gives later
/// segmented/convex/local refinements a golden implementation they must match on bounded
/// domains while retaining fixed venue activation costs inside `evaluate`.
pub fn optimize_grid<F>(
    search: SizeSearch,
    max_evaluations: u64,
    mut evaluate: F,
) -> Result<SizeOptimum, SizingError>
where
    F: FnMut(Fixed) -> Option<Fixed>,
{
    let points = grid_point_count(search)?;
    if points > max_evaluations {
        return Err(SizingError::EvaluationBudgetExceeded);
    }

    let mut best: Option<SizeOptimum> = None;
    for index in 0..points {
        let input = input_at(search, points, index)?;
        if let Some(net) = evaluate(input) {
            let replace = best.as_ref().is_none_or(|current| {
                net > current.net_pnl_quote
                    || (net == current.net_pnl_quote && input < current.input)
            });
            if replace {
                best = Some(SizeOptimum {
                    input,
                    net_pnl_quote: net,
                    evaluations: index + 1,
                });
            }
        }
    }

    let mut best = best.ok_or(SizingError::NoExecutablePoint)?;
    best.evaluations = points;
    Ok(best)
}

pub fn optimize_profitable_grid<F>(
    search: SizeSearch,
    max_evaluations: u64,
    evaluate: F,
) -> Result<Option<SizeOptimum>, SizingError>
where
    F: FnMut(Fixed) -> Option<Fixed>,
{
    let best = optimize_grid(search, max_evaluations, evaluate)?;
    Ok((best.net_pnl_quote > 0).then_some(best))
}

/// Faster exact-on-unimodal-grid refinement for a fixed route segment.
///
/// The caller must only use this inside a segment whose net-PnL function is known to be
/// unimodal and executable at every grid point. The exact `optimize_grid` oracle remains
/// the benchmark authority for bounded fixtures.
pub fn optimize_unimodal_grid<F>(
    search: SizeSearch,
    max_evaluations: u64,
    mut evaluate: F,
) -> Result<SizeOptimum, SizingError>
where
    F: FnMut(Fixed) -> Option<Fixed>,
{
    let points = grid_point_count(search)?;
    if max_evaluations == 0 {
        return Err(SizingError::EvaluationBudgetExceeded);
    }

    let mut cache = BTreeMap::<u64, Fixed>::new();
    let mut evaluations = 0u64;
    let mut left = 0u64;
    let mut right = points - 1;

    while right.saturating_sub(left) > 8 {
        let third = (right - left) / 3;
        let m1 = left + third;
        let m2 = right - third;
        let v1 = eval_index(
            search,
            points,
            m1,
            max_evaluations,
            &mut evaluations,
            &mut cache,
            &mut evaluate,
        )?;
        let v2 = eval_index(
            search,
            points,
            m2,
            max_evaluations,
            &mut evaluations,
            &mut cache,
            &mut evaluate,
        )?;

        if v1 < v2 {
            left = m1.saturating_add(1);
        } else {
            right = m2.saturating_sub(1);
        }
    }

    let mut best: Option<(u64, Fixed)> = None;
    for index in left..=right {
        let net = eval_index(
            search,
            points,
            index,
            max_evaluations,
            &mut evaluations,
            &mut cache,
            &mut evaluate,
        )?;
        let replace = best.as_ref().is_none_or(|(current_index, current_net)| {
            net > *current_net || (net == *current_net && index < *current_index)
        });
        if replace {
            best = Some((index, net));
        }
    }

    let (index, net_pnl_quote) = best.ok_or(SizingError::NoExecutablePoint)?;
    Ok(SizeOptimum {
        input: input_at(search, points, index)?,
        net_pnl_quote,
        evaluations,
    })
}

fn eval_index<F>(
    search: SizeSearch,
    points: u64,
    index: u64,
    max_evaluations: u64,
    evaluations: &mut u64,
    cache: &mut BTreeMap<u64, Fixed>,
    evaluate: &mut F,
) -> Result<Fixed, SizingError>
where
    F: FnMut(Fixed) -> Option<Fixed>,
{
    if let Some(value) = cache.get(&index) {
        return Ok(*value);
    }
    if *evaluations >= max_evaluations {
        return Err(SizingError::EvaluationBudgetExceeded);
    }
    let input = input_at(search, points, index)?;
    let net = evaluate(input).ok_or(SizingError::NonExecutablePoint)?;
    *evaluations = (*evaluations).saturating_add(1);
    cache.insert(index, net);
    Ok(net)
}

fn grid_point_count(search: SizeSearch) -> Result<u64, SizingError> {
    if search.min_input < 0 || search.max_input < search.min_input || search.step <= 0 {
        return Err(SizingError::InvalidDomain);
    }
    let span = search
        .max_input
        .checked_sub(search.min_input)
        .ok_or(SizingError::Overflow)?;
    let full_steps = span.checked_div(search.step).ok_or(SizingError::Overflow)?;
    let remainder = span.checked_rem(search.step).ok_or(SizingError::Overflow)?;
    let terminal_point = if remainder == 0 { 0 } else { 1 };
    let points = full_steps
        .checked_add(1)
        .and_then(|value| value.checked_add(terminal_point))
        .ok_or(SizingError::Overflow)?;
    u64::try_from(points).map_err(|_| SizingError::EvaluationBudgetExceeded)
}

fn input_at(search: SizeSearch, points: u64, index: u64) -> Result<Fixed, SizingError> {
    if index >= points {
        return Err(SizingError::InvalidDomain);
    }
    if index == points - 1 {
        return Ok(search.max_input);
    }
    search
        .step
        .checked_mul(i128::from(index))
        .and_then(|offset| search.min_input.checked_add(offset))
        .ok_or(SizingError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn optimizer_finds_exact_discrete_profit_maximum() {
        let optimum = optimize_grid(
            SizeSearch {
                min_input: 0,
                max_input: 20,
                step: 1,
            },
            100,
            |x| Some(100 - (x - 7) * (x - 7)),
        )
        .unwrap();
        assert_eq!(optimum.input, 7);
        assert_eq!(optimum.net_pnl_quote, 100);
        assert_eq!(optimum.evaluations, 21);
    }

    #[test]
    fn non_divisible_terminal_bound_counts_against_budget() {
        let search = SizeSearch {
            min_input: 0,
            max_input: 10,
            step: 3,
        };
        assert_eq!(
            optimize_grid(search, 4, |_| Some(0)).unwrap_err(),
            SizingError::EvaluationBudgetExceeded
        );
        let optimum = optimize_grid(search, 5, Some).unwrap();
        assert_eq!(optimum.input, 10);
        assert_eq!(optimum.evaluations, 5);
    }

    #[test]
    fn unimodal_refinement_matches_oracle_with_fewer_evaluations() {
        let search = SizeSearch {
            min_input: 0,
            max_input: 1_000,
            step: 1,
        };
        let oracle =
            optimize_grid(search, 1_001, |x| Some(1_000_000 - (x - 613) * (x - 613))).unwrap();
        let refined =
            optimize_unimodal_grid(search, 100, |x| Some(1_000_000 - (x - 613) * (x - 613)))
                .unwrap();
        assert_eq!(refined.input, oracle.input);
        assert_eq!(refined.net_pnl_quote, oracle.net_pnl_quote);
        assert!(refined.evaluations < oracle.evaluations);
    }

    #[test]
    fn fixed_activation_cost_can_make_no_trade_optimal() {
        let fixed_activation_cost = 110;
        let optimum = optimize_profitable_grid(
            SizeSearch {
                min_input: 1,
                max_input: 10,
                step: 1,
            },
            20,
            |x| Some(100 + 4 * x - x * x - fixed_activation_cost),
        )
        .unwrap();
        assert!(optimum.is_none());
    }

    #[test]
    fn lower_input_wins_deterministic_ties() {
        let optimum = optimize_grid(
            SizeSearch {
                min_input: 1,
                max_input: 3,
                step: 1,
            },
            3,
            |_x| Some(10),
        )
        .unwrap();
        assert_eq!(optimum.input, 1);
    }

    #[test]
    fn evaluation_budget_is_hard_bound() {
        let error = optimize_grid(
            SizeSearch {
                min_input: 0,
                max_input: 100,
                step: 1,
            },
            100,
            |_| Some(0),
        )
        .unwrap_err();
        assert_eq!(error, SizingError::EvaluationBudgetExceeded);
    }
}

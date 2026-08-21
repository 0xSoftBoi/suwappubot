use crate::events::Fixed;
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
    if search.min_input < 0 || search.max_input < search.min_input || search.step <= 0 {
        return Err(SizingError::InvalidDomain);
    }

    let span = search
        .max_input
        .checked_sub(search.min_input)
        .ok_or(SizingError::Overflow)?;
    let points = span
        .checked_div(search.step)
        .and_then(|value| value.checked_add(1))
        .ok_or(SizingError::Overflow)?;
    let points_u64 = u64::try_from(points).map_err(|_| SizingError::EvaluationBudgetExceeded)?;
    if points_u64 > max_evaluations {
        return Err(SizingError::EvaluationBudgetExceeded);
    }

    let mut best: Option<SizeOptimum> = None;
    let mut input = search.min_input;
    let mut evaluations = 0u64;

    loop {
        evaluations = evaluations.saturating_add(1);
        if let Some(net) = evaluate(input) {
            let replace = best.as_ref().is_none_or(|current| {
                net > current.net_pnl_quote || (net == current.net_pnl_quote && input < current.input)
            });
            if replace {
                best = Some(SizeOptimum {
                    input,
                    net_pnl_quote: net,
                    evaluations,
                });
            }
        }

        if input == search.max_input {
            break;
        }
        let next = input.checked_add(search.step).ok_or(SizingError::Overflow)?;
        input = next.min(search.max_input);
    }

    let mut best = best.ok_or(SizingError::NoExecutablePoint)?;
    best.evaluations = evaluations;
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

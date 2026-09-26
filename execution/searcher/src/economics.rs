use crate::events::{Fixed, Side};
use crate::FIXED_SCALE;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FillEconomics {
    /// Edge captured versus fair value at the instant of the fill.
    pub spread_capture_quote: Fixed,
    /// PnL from fair-value movement after the fill, excluding the initial spread capture.
    pub post_fill_fair_move_pnl_quote: Fixed,
    /// Total edge from the actual fill to future fair value.
    pub markout_pnl_quote: Fixed,
    /// Positive means post-fill fair-value movement adversely selected the maker.
    pub adverse_selection_cost_quote: Fixed,
    /// Conservative clipped empirical proxy for LVR aggregation. Not exact theoretical LVR.
    pub lvr_proxy_quote: Fixed,
    /// Alias of markout PnL for route/portfolio aggregation.
    pub net_edge_quote: Fixed,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EconomicsError {
    #[error("price and quantity must be positive")]
    InvalidInput,
    #[error("fixed-point arithmetic overflow")]
    Overflow,
}

pub fn fill_economics(
    maker_side: Side,
    quantity: Fixed,
    fill_price: Fixed,
    fair_at_fill: Fixed,
    future_fair: Fixed,
) -> Result<FillEconomics, EconomicsError> {
    if quantity <= 0 || fill_price <= 0 || fair_at_fill <= 0 || future_fair <= 0 {
        return Err(EconomicsError::InvalidInput);
    }

    let sign = maker_side.maker_sign();
    let spread_per_unit = signed_delta(fair_at_fill, fill_price, sign)?;
    let fair_move_per_unit = signed_delta(future_fair, fair_at_fill, sign)?;

    let spread_capture_quote = mul_fixed(spread_per_unit, quantity)?;
    let post_fill_fair_move_pnl_quote = mul_fixed(fair_move_per_unit, quantity)?;
    // Sum the decomposition rather than independently rounding a second multiplication.
    // This makes the accounting identity exact at the crate's fixed-point precision.
    let markout_pnl_quote = spread_capture_quote
        .checked_add(post_fill_fair_move_pnl_quote)
        .ok_or(EconomicsError::Overflow)?;
    let adverse_selection_cost_quote = post_fill_fair_move_pnl_quote
        .checked_neg()
        .ok_or(EconomicsError::Overflow)?;
    let lvr_proxy_quote = adverse_selection_cost_quote.max(0);

    Ok(FillEconomics {
        spread_capture_quote,
        post_fill_fair_move_pnl_quote,
        markout_pnl_quote,
        adverse_selection_cost_quote,
        lvr_proxy_quote,
        net_edge_quote: markout_pnl_quote,
    })
}

fn signed_delta(end: Fixed, start: Fixed, sign: i128) -> Result<Fixed, EconomicsError> {
    end.checked_sub(start)
        .and_then(|value| value.checked_mul(sign))
        .ok_or(EconomicsError::Overflow)
}

fn mul_fixed(left: Fixed, right: Fixed) -> Result<Fixed, EconomicsError> {
    left.checked_mul(right)
        .and_then(|value| value.checked_div(FIXED_SCALE))
        .ok_or(EconomicsError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maker_sell_spread_and_toxic_markout_are_decomposed_without_double_counting() {
        let p = FIXED_SCALE;
        let result = fill_economics(Side::Sell, 10 * p, 101 * p, 100 * p, 102 * p).unwrap();
        assert_eq!(result.spread_capture_quote, 10 * p);
        assert_eq!(result.post_fill_fair_move_pnl_quote, -20 * p);
        assert_eq!(result.markout_pnl_quote, -10 * p);
        assert_eq!(result.adverse_selection_cost_quote, 20 * p);
        assert_eq!(result.lvr_proxy_quote, 20 * p);
        assert_eq!(result.net_edge_quote, -10 * p);
    }

    #[test]
    fn maker_buy_favorable_markout_is_not_clipped_into_a_loss() {
        let p = FIXED_SCALE;
        let result = fill_economics(Side::Buy, 5 * p, 99 * p, 100 * p, 101 * p).unwrap();
        assert_eq!(result.spread_capture_quote, 5 * p);
        assert_eq!(result.post_fill_fair_move_pnl_quote, 5 * p);
        assert_eq!(result.markout_pnl_quote, 10 * p);
        assert_eq!(result.adverse_selection_cost_quote, -5 * p);
        assert_eq!(result.lvr_proxy_quote, 0);
        assert_eq!(result.net_edge_quote, 10 * p);
    }

    #[test]
    fn accounting_identity_survives_fractional_fixed_point_rounding() {
        let result = fill_economics(
            Side::Buy,
            333_333_333,
            99_900_000_000,
            100_000_000_000,
            100_050_000_000,
        )
        .unwrap();
        assert_eq!(
            result.markout_pnl_quote,
            result.spread_capture_quote + result.post_fill_fair_move_pnl_quote
        );
    }
}

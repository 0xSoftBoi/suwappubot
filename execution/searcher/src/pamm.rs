use crate::events::Fixed;
use crate::BPS_SCALE;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PammMode {
    Strict,
    Protected,
    Fallback,
    Closed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PammControllerConfig {
    pub base_half_spread_bps: u32,
    pub volatility_weight_bps: u32,
    pub toxicity_weight_bps: u32,
    pub builder_risk_weight_bps: u32,
    pub hedge_impact_weight_bps: u32,
    pub inventory_spread_weight_bps: u32,
    pub inventory_skew_weight_bps: u32,
    pub size_linear_weight_bps: u32,
    pub size_quadratic_weight_bps: u32,
    pub protected_spread_multiplier_bps: u32,
    pub fallback_spread_multiplier_bps: u32,
    pub protected_size_multiplier_bps: u32,
    pub fallback_size_multiplier_bps: u32,
    pub max_half_spread_bps: u32,
    pub max_inventory_skew_bps: u32,
    pub min_quote_change_bps: u32,
    pub quote_ttl_ns: u64,
    pub refresh_before_expiry_ns: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PammState {
    pub fair_value: Fixed,
    pub volatility_bps: u32,
    pub toxicity_probability_bps: u16,
    pub builder_uncertainty_bps: u16,
    pub hedge_impact_bps: u32,
    /// Signed inventory utilization versus configured risk capacity.
    /// +10_000 = fully long the base-asset risk budget; -10_000 = fully short.
    pub inventory_ratio_bps: i32,
    /// Size requested as a fraction of the configured max quote size.
    pub size_ratio_bps: u16,
    pub max_bid_quantity: Fixed,
    pub max_ask_quantity: Fixed,
    pub valid_block_min: u64,
    pub valid_block_max: u64,
    pub now_ns: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ControlledQuote {
    pub epoch: u64,
    pub sequence: u64,
    pub previous_hash: [u8; 32],
    pub hash: [u8; 32],
    pub mode: PammMode,
    pub reservation_price: Fixed,
    pub half_spread_bps: u32,
    pub inventory_skew_bps: i32,
    pub bid: Fixed,
    pub ask: Fixed,
    pub max_bid_quantity: Fixed,
    pub max_ask_quantity: Fixed,
    pub valid_block_min: u64,
    pub valid_block_max: u64,
    pub valid_until_ns: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuoteDecision {
    Keep,
    Replace(ControlledQuote),
    Close,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PammError {
    #[error("invalid controller configuration")]
    InvalidConfig,
    #[error("fair value and quote capacities must be positive")]
    InvalidState,
    #[error("inventory ratio must be within +/-10000 bps")]
    InvalidInventory,
    #[error("size ratio must be at most 10000 bps")]
    InvalidSize,
    #[error("valid block range is inverted")]
    InvalidBlockRange,
    #[error("fixed-point arithmetic overflow")]
    Overflow,
}

impl PammControllerConfig {
    pub fn validate(self) -> Result<Self, PammError> {
        if self.max_half_spread_bps == 0
            || self.max_half_spread_bps >= BPS_SCALE as u32
            || self.max_inventory_skew_bps >= BPS_SCALE as u32
            || self.protected_spread_multiplier_bps < BPS_SCALE as u32
            || self.fallback_spread_multiplier_bps < self.protected_spread_multiplier_bps
            || self.protected_size_multiplier_bps > BPS_SCALE as u32
            || self.fallback_size_multiplier_bps > self.protected_size_multiplier_bps
            || self.quote_ttl_ns == 0
            || self.refresh_before_expiry_ns >= self.quote_ttl_ns
        {
            return Err(PammError::InvalidConfig);
        }
        Ok(self)
    }
}

pub fn control_quote(
    config: PammControllerConfig,
    mode: PammMode,
    epoch: u64,
    state: PammState,
    previous: Option<&ControlledQuote>,
) -> Result<QuoteDecision, PammError> {
    let config = config.validate()?;
    validate_state(state)?;
    if mode == PammMode::Closed {
        return Ok(QuoteDecision::Close);
    }

    let inventory_skew_bps = scaled_signed(
        state.inventory_ratio_bps,
        config.inventory_skew_weight_bps,
    )?
    .clamp(
        -(config.max_inventory_skew_bps as i32),
        config.max_inventory_skew_bps as i32,
    );
    let reservation_price = apply_signed_bps(state.fair_value, -inventory_skew_bps)?;

    let raw_half_spread = u128::from(config.base_half_spread_bps)
        .checked_add(weighted(state.volatility_bps, config.volatility_weight_bps)?)
        .and_then(|value| {
            value.checked_add(weighted(
                u32::from(state.toxicity_probability_bps),
                config.toxicity_weight_bps,
            ).ok()?)
        })
        .and_then(|value| {
            value.checked_add(weighted(
                u32::from(state.builder_uncertainty_bps),
                config.builder_risk_weight_bps,
            ).ok()?)
        })
        .and_then(|value| value.checked_add(weighted(state.hedge_impact_bps, config.hedge_impact_weight_bps).ok()?))
        .and_then(|value| value.checked_add(weighted(state.inventory_ratio_bps.unsigned_abs(), config.inventory_spread_weight_bps).ok()?))
        .and_then(|value| value.checked_add(weighted(u32::from(state.size_ratio_bps), config.size_linear_weight_bps).ok()?))
        .and_then(|value| {
            let size = u128::from(state.size_ratio_bps);
            let squared = size.checked_mul(size)?.checked_div(BPS_SCALE as u128)?;
            value.checked_add(weighted_u128(squared, config.size_quadratic_weight_bps).ok()?)
        })
        .ok_or(PammError::Overflow)?;

    let spread_multiplier = match mode {
        PammMode::Strict => BPS_SCALE as u32,
        PammMode::Protected => config.protected_spread_multiplier_bps,
        PammMode::Fallback => config.fallback_spread_multiplier_bps,
        PammMode::Closed => unreachable!(),
    };
    let half_spread_bps = raw_half_spread
        .checked_mul(u128::from(spread_multiplier))
        .and_then(|value| value.checked_div(BPS_SCALE as u128))
        .ok_or(PammError::Overflow)?
        .min(u128::from(config.max_half_spread_bps));
    let half_spread_bps = u32::try_from(half_spread_bps).map_err(|_| PammError::Overflow)?;

    let bid = apply_signed_bps(reservation_price, -(half_spread_bps as i32))?;
    let ask = apply_signed_bps(reservation_price, half_spread_bps as i32)?;
    if bid <= 0 || ask <= bid {
        return Err(PammError::InvalidState);
    }

    let size_multiplier = match mode {
        PammMode::Strict => BPS_SCALE as u32,
        PammMode::Protected => config.protected_size_multiplier_bps,
        PammMode::Fallback => config.fallback_size_multiplier_bps,
        PammMode::Closed => unreachable!(),
    };
    let max_bid_quantity = scale_quantity(state.max_bid_quantity, size_multiplier)?;
    let max_ask_quantity = scale_quantity(state.max_ask_quantity, size_multiplier)?;
    let valid_until_ns = state
        .now_ns
        .checked_add(config.quote_ttl_ns)
        .ok_or(PammError::Overflow)?;

    let force_refresh = previous.is_some_and(|quote| {
        quote.valid_until_ns <= state.now_ns.saturating_add(config.refresh_before_expiry_ns)
            || quote.epoch != epoch
            || quote.mode != mode
            || quote.valid_block_min != state.valid_block_min
            || quote.valid_block_max != state.valid_block_max
    });
    if let Some(previous) = previous {
        if !force_refresh
            && price_change_bps(previous.bid, bid)? < config.min_quote_change_bps
            && price_change_bps(previous.ask, ask)? < config.min_quote_change_bps
            && quantity_change_bps(previous.max_bid_quantity, max_bid_quantity)? < config.min_quote_change_bps
            && quantity_change_bps(previous.max_ask_quantity, max_ask_quantity)? < config.min_quote_change_bps
        {
            return Ok(QuoteDecision::Keep);
        }
    }

    let (sequence, previous_hash) = match previous.filter(|quote| quote.epoch == epoch) {
        Some(previous) => (
            previous.sequence.checked_add(1).ok_or(PammError::Overflow)?,
            previous.hash,
        ),
        None => (0, [0u8; 32]),
    };

    let mut quote = ControlledQuote {
        epoch,
        sequence,
        previous_hash,
        hash: [0u8; 32],
        mode,
        reservation_price,
        half_spread_bps,
        inventory_skew_bps,
        bid,
        ask,
        max_bid_quantity,
        max_ask_quantity,
        valid_block_min: state.valid_block_min,
        valid_block_max: state.valid_block_max,
        valid_until_ns,
    };
    quote.hash = quote_hash(&quote);
    Ok(QuoteDecision::Replace(quote))
}

#[must_use]
pub fn quote_hash(quote: &ControlledQuote) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"suwappu-pamm-quote-v1");
    hasher.update(&quote.previous_hash);
    hasher.update(&quote.epoch.to_le_bytes());
    hasher.update(&quote.sequence.to_le_bytes());
    hasher.update(&[mode_byte(quote.mode)]);
    hasher.update(&quote.reservation_price.to_le_bytes());
    hasher.update(&quote.half_spread_bps.to_le_bytes());
    hasher.update(&quote.inventory_skew_bps.to_le_bytes());
    hasher.update(&quote.bid.to_le_bytes());
    hasher.update(&quote.ask.to_le_bytes());
    hasher.update(&quote.max_bid_quantity.to_le_bytes());
    hasher.update(&quote.max_ask_quantity.to_le_bytes());
    hasher.update(&quote.valid_block_min.to_le_bytes());
    hasher.update(&quote.valid_block_max.to_le_bytes());
    hasher.update(&quote.valid_until_ns.to_le_bytes());
    *hasher.finalize().as_bytes()
}

fn validate_state(state: PammState) -> Result<(), PammError> {
    if state.fair_value <= 0 || state.max_bid_quantity <= 0 || state.max_ask_quantity <= 0 {
        return Err(PammError::InvalidState);
    }
    if state.inventory_ratio_bps.unsigned_abs() > BPS_SCALE as u32 {
        return Err(PammError::InvalidInventory);
    }
    if u32::from(state.size_ratio_bps) > BPS_SCALE as u32 {
        return Err(PammError::InvalidSize);
    }
    if state.valid_block_max < state.valid_block_min {
        return Err(PammError::InvalidBlockRange);
    }
    Ok(())
}

fn weighted(factor_bps: u32, weight_bps: u32) -> Result<u128, PammError> {
    weighted_u128(u128::from(factor_bps), weight_bps)
}

fn weighted_u128(factor_bps: u128, weight_bps: u32) -> Result<u128, PammError> {
    factor_bps
        .checked_mul(u128::from(weight_bps))
        .and_then(|value| value.checked_div(BPS_SCALE as u128))
        .ok_or(PammError::Overflow)
}

fn scaled_signed(value_bps: i32, weight_bps: u32) -> Result<i32, PammError> {
    let value = i128::from(value_bps)
        .checked_mul(i128::from(weight_bps))
        .and_then(|value| value.checked_div(BPS_SCALE))
        .ok_or(PammError::Overflow)?;
    i32::try_from(value).map_err(|_| PammError::Overflow)
}

fn apply_signed_bps(value: Fixed, adjustment_bps: i32) -> Result<Fixed, PammError> {
    value
        .checked_mul(BPS_SCALE.checked_add(i128::from(adjustment_bps)).ok_or(PammError::Overflow)?)
        .and_then(|value| value.checked_div(BPS_SCALE))
        .ok_or(PammError::Overflow)
}

fn scale_quantity(quantity: Fixed, multiplier_bps: u32) -> Result<Fixed, PammError> {
    quantity
        .checked_mul(i128::from(multiplier_bps))
        .and_then(|value| value.checked_div(BPS_SCALE))
        .ok_or(PammError::Overflow)
}

fn price_change_bps(previous: Fixed, next: Fixed) -> Result<u32, PammError> {
    if previous <= 0 {
        return Err(PammError::InvalidState);
    }
    let diff = previous.abs_diff(next);
    let bps = diff
        .checked_mul(BPS_SCALE as u128)
        .and_then(|value| value.checked_div(previous as u128))
        .ok_or(PammError::Overflow)?;
    u32::try_from(bps).map_err(|_| PammError::Overflow)
}

fn quantity_change_bps(previous: Fixed, next: Fixed) -> Result<u32, PammError> {
    price_change_bps(previous, next)
}

const fn mode_byte(mode: PammMode) -> u8 {
    match mode {
        PammMode::Strict => 0,
        PammMode::Protected => 1,
        PammMode::Fallback => 2,
        PammMode::Closed => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FIXED_SCALE;

    fn config() -> PammControllerConfig {
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

    fn state() -> PammState {
        PammState {
            fair_value: 4_000 * FIXED_SCALE,
            volatility_bps: 100,
            toxicity_probability_bps: 1_000,
            builder_uncertainty_bps: 100,
            hedge_impact_bps: 5,
            inventory_ratio_bps: 0,
            size_ratio_bps: 1_000,
            max_bid_quantity: 100 * FIXED_SCALE,
            max_ask_quantity: 100 * FIXED_SCALE,
            valid_block_min: 100,
            valid_block_max: 100,
            now_ns: 1_000,
        }
    }

    fn quote(decision: QuoteDecision) -> ControlledQuote {
        match decision {
            QuoteDecision::Replace(quote) => quote,
            other => panic!("expected replacement, got {other:?}"),
        }
    }

    #[test]
    fn long_inventory_moves_reservation_price_down() {
        let flat = quote(control_quote(config(), PammMode::Strict, 1, state(), None).unwrap());
        let mut long_state = state();
        long_state.inventory_ratio_bps = 5_000;
        let long = quote(control_quote(config(), PammMode::Strict, 1, long_state, None).unwrap());
        assert!(long.reservation_price < flat.reservation_price);
        assert!(long.inventory_skew_bps > 0);
    }

    #[test]
    fn toxicity_widens_quotes() {
        let low = quote(control_quote(config(), PammMode::Strict, 1, state(), None).unwrap());
        let mut toxic_state = state();
        toxic_state.toxicity_probability_bps = 8_000;
        let high = quote(control_quote(config(), PammMode::Strict, 1, toxic_state, None).unwrap());
        assert!(high.half_spread_bps > low.half_spread_bps);
    }

    #[test]
    fn protected_mode_widens_and_reduces_size() {
        let strict = quote(control_quote(config(), PammMode::Strict, 1, state(), None).unwrap());
        let protected = quote(control_quote(config(), PammMode::Protected, 1, state(), None).unwrap());
        assert!(protected.half_spread_bps > strict.half_spread_bps);
        assert!(protected.max_bid_quantity < strict.max_bid_quantity);
    }

    #[test]
    fn tiny_change_inside_deadband_keeps_quote() {
        let first = quote(control_quote(config(), PammMode::Strict, 1, state(), None).unwrap());
        let mut next_state = state();
        next_state.now_ns += 10_000;
        next_state.fair_value += FIXED_SCALE / 10_000;
        assert_eq!(
            control_quote(config(), PammMode::Strict, 1, next_state, Some(&first)).unwrap(),
            QuoteDecision::Keep
        );
    }

    #[test]
    fn refresh_builds_hash_chain_and_monotonic_sequence() {
        let first = quote(control_quote(config(), PammMode::Strict, 7, state(), None).unwrap());
        let mut next_state = state();
        next_state.now_ns = first.valid_until_ns - config().refresh_before_expiry_ns;
        let second = quote(control_quote(config(), PammMode::Strict, 7, next_state, Some(&first)).unwrap());
        assert_eq!(second.sequence, first.sequence + 1);
        assert_eq!(second.previous_hash, first.hash);
        assert_eq!(second.hash, quote_hash(&second));
    }

    #[test]
    fn new_epoch_resets_sequence_and_hash_parent() {
        let first = quote(control_quote(config(), PammMode::Strict, 7, state(), None).unwrap());
        let second = quote(control_quote(config(), PammMode::Strict, 8, state(), Some(&first)).unwrap());
        assert_eq!(second.sequence, 0);
        assert_eq!(second.previous_hash, [0u8; 32]);
    }

    #[test]
    fn closed_mode_emits_no_quote() {
        assert_eq!(
            control_quote(config(), PammMode::Closed, 1, state(), None).unwrap(),
            QuoteDecision::Close
        );
    }
}
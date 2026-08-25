use crate::markout::Markout;
use crate::BPS_SCALE;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ToxicityEstimate {
    /// Probability in basis points that a maker fill breaches the configured adverse markout threshold.
    pub toxic_probability_bps: u16,
    /// Mean maker-adverse markout magnitude across all observations, in basis points.
    pub mean_adverse_markout_bps: u32,
    /// Conditional mean loss given a toxic observation, in basis points.
    pub conditional_toxic_loss_bps: u32,
    pub observations: usize,
    pub toxic_observations: usize,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ToxicityError {
    #[error("at least one markout observation is required")]
    Empty,
    #[error("loss threshold must be positive")]
    InvalidThreshold,
    #[error("markout magnitude exceeds supported range")]
    Overflow,
}

pub fn estimate_toxicity(
    markouts: &[Markout],
    loss_threshold_bps: u32,
) -> Result<ToxicityEstimate, ToxicityError> {
    if markouts.is_empty() {
        return Err(ToxicityError::Empty);
    }
    if loss_threshold_bps == 0 {
        return Err(ToxicityError::InvalidThreshold);
    }

    let mut adverse_sum = 0u128;
    let mut toxic_sum = 0u128;
    let mut toxic = 0usize;

    for markout in markouts {
        let adverse = if markout.maker_markout_bps < 0 {
            markout
                .maker_markout_bps
                .checked_neg()
                .ok_or(ToxicityError::Overflow)? as u128
        } else {
            0
        };
        adverse_sum = adverse_sum
            .checked_add(adverse)
            .ok_or(ToxicityError::Overflow)?;
        if adverse >= u128::from(loss_threshold_bps) {
            toxic += 1;
            toxic_sum = toxic_sum
                .checked_add(adverse)
                .ok_or(ToxicityError::Overflow)?;
        }
    }

    let observations = markouts.len();
    let toxic_probability = (toxic as u128)
        .checked_mul(BPS_SCALE as u128)
        .and_then(|value| value.checked_div(observations as u128))
        .ok_or(ToxicityError::Overflow)?;
    let mean_adverse = adverse_sum
        .checked_div(observations as u128)
        .ok_or(ToxicityError::Overflow)?;
    let conditional = if toxic == 0 {
        0
    } else {
        toxic_sum
            .checked_div(toxic as u128)
            .ok_or(ToxicityError::Overflow)?
    };

    Ok(ToxicityEstimate {
        toxic_probability_bps: u16::try_from(toxic_probability)
            .map_err(|_| ToxicityError::Overflow)?,
        mean_adverse_markout_bps: u32::try_from(mean_adverse)
            .map_err(|_| ToxicityError::Overflow)?,
        conditional_toxic_loss_bps: u32::try_from(conditional)
            .map_err(|_| ToxicityError::Overflow)?,
        observations,
        toxic_observations: toxic,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::markout::Horizon;

    fn markout(bps: i128) -> Markout {
        Markout {
            horizon: Horizon::TimeNs(100),
            sampled_ts_ns: 100,
            sampled_block: None,
            future_fair: 0,
            maker_markout_bps: bps,
        }
    }

    #[test]
    fn toxicity_probability_and_losses_are_separated() {
        let estimate =
            estimate_toxicity(&[markout(5), markout(-5), markout(-20), markout(-40)], 10).unwrap();
        assert_eq!(estimate.toxic_probability_bps, 5_000);
        assert_eq!(estimate.mean_adverse_markout_bps, 16);
        assert_eq!(estimate.conditional_toxic_loss_bps, 30);
        assert_eq!(estimate.toxic_observations, 2);
    }

    #[test]
    fn no_toxic_observations_has_zero_conditional_loss() {
        let estimate = estimate_toxicity(&[markout(10), markout(-2)], 10).unwrap();
        assert_eq!(estimate.toxic_probability_bps, 0);
        assert_eq!(estimate.conditional_toxic_loss_bps, 0);
    }
}

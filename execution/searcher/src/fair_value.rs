use crate::events::Fixed;
use crate::BPS_SCALE;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FairValueHorizon {
    Ms10,
    Ms100,
    Sec1,
    Sec12,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FairValueFeatures {
    pub mid: Fixed,
    /// Microprice displacement from mid in basis points.
    pub microprice_bps: i64,
    pub book_imbalance_bps: i64,
    pub signed_flow_bps: i64,
    pub basis_bps: i64,
    pub cross_venue_bps: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FairValueCoefficients {
    /// Constant prediction adjustment in basis points.
    pub intercept_bps: i64,
    /// Coefficients are themselves scaled by 10_000: a coefficient of 10_000
    /// passes the corresponding feature through one-for-one.
    pub microprice_weight_bps: i64,
    pub imbalance_weight_bps: i64,
    pub signed_flow_weight_bps: i64,
    pub basis_weight_bps: i64,
    pub cross_venue_weight_bps: i64,
    /// Calibrated one-sigma prediction uncertainty for this horizon.
    pub sigma_bps: u32,
    /// Hard guardrail against an accidentally explosive model.
    pub max_abs_adjustment_bps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FairValueEstimate {
    pub horizon: FairValueHorizon,
    pub price: Fixed,
    pub adjustment_bps: i64,
    pub sigma_bps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MultiHorizonFairValue {
    pub ms10: FairValueCoefficients,
    pub ms100: FairValueCoefficients,
    pub sec1: FairValueCoefficients,
    pub sec12: FairValueCoefficients,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FairValueError {
    #[error("mid price must be positive")]
    InvalidMid,
    #[error("maximum adjustment must be nonzero and below 10000 bps")]
    InvalidGuardrail,
    #[error("fixed-point arithmetic overflow")]
    Overflow,
}

impl MultiHorizonFairValue {
    pub fn estimate(
        &self,
        horizon: FairValueHorizon,
        features: FairValueFeatures,
    ) -> Result<FairValueEstimate, FairValueError> {
        let coefficients = match horizon {
            FairValueHorizon::Ms10 => self.ms10,
            FairValueHorizon::Ms100 => self.ms100,
            FairValueHorizon::Sec1 => self.sec1,
            FairValueHorizon::Sec12 => self.sec12,
        };
        estimate(horizon, coefficients, features)
    }

    pub fn estimate_all(
        &self,
        features: FairValueFeatures,
    ) -> Result<[FairValueEstimate; 4], FairValueError> {
        Ok([
            self.estimate(FairValueHorizon::Ms10, features)?,
            self.estimate(FairValueHorizon::Ms100, features)?,
            self.estimate(FairValueHorizon::Sec1, features)?,
            self.estimate(FairValueHorizon::Sec12, features)?,
        ])
    }
}

pub fn estimate(
    horizon: FairValueHorizon,
    coefficients: FairValueCoefficients,
    features: FairValueFeatures,
) -> Result<FairValueEstimate, FairValueError> {
    if features.mid <= 0 {
        return Err(FairValueError::InvalidMid);
    }
    if coefficients.max_abs_adjustment_bps == 0
        || coefficients.max_abs_adjustment_bps >= BPS_SCALE as u32
    {
        return Err(FairValueError::InvalidGuardrail);
    }

    let mut adjustment = i128::from(coefficients.intercept_bps);
    for (feature, weight) in [
        (features.microprice_bps, coefficients.microprice_weight_bps),
        (
            features.book_imbalance_bps,
            coefficients.imbalance_weight_bps,
        ),
        (
            features.signed_flow_bps,
            coefficients.signed_flow_weight_bps,
        ),
        (features.basis_bps, coefficients.basis_weight_bps),
        (
            features.cross_venue_bps,
            coefficients.cross_venue_weight_bps,
        ),
    ] {
        let term = i128::from(feature)
            .checked_mul(i128::from(weight))
            .and_then(|value| value.checked_div(BPS_SCALE))
            .ok_or(FairValueError::Overflow)?;
        adjustment = adjustment
            .checked_add(term)
            .ok_or(FairValueError::Overflow)?;
    }

    let guardrail = i128::from(coefficients.max_abs_adjustment_bps);
    let adjustment = adjustment.clamp(-guardrail, guardrail);
    let price_delta = features
        .mid
        .checked_mul(adjustment)
        .and_then(|value| value.checked_div(BPS_SCALE))
        .ok_or(FairValueError::Overflow)?;
    let price = features
        .mid
        .checked_add(price_delta)
        .ok_or(FairValueError::Overflow)?;
    // The guardrail is strictly below 100%, so a positive mid must remain positive.
    if price <= 0 {
        return Err(FairValueError::Overflow);
    }

    Ok(FairValueEstimate {
        horizon,
        price,
        adjustment_bps: i64::try_from(adjustment).map_err(|_| FairValueError::Overflow)?,
        sigma_bps: coefficients.sigma_bps,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FIXED_SCALE;

    fn coefficients(weight: i64) -> FairValueCoefficients {
        FairValueCoefficients {
            intercept_bps: 0,
            microprice_weight_bps: weight,
            imbalance_weight_bps: 0,
            signed_flow_weight_bps: 0,
            basis_weight_bps: 0,
            cross_venue_weight_bps: 0,
            sigma_bps: 12,
            max_abs_adjustment_bps: 500,
        }
    }

    #[test]
    fn positive_microprice_signal_lifts_short_horizon_fair() {
        let model = MultiHorizonFairValue {
            ms10: coefficients(10_000),
            ms100: coefficients(5_000),
            sec1: coefficients(1_000),
            sec12: coefficients(0),
        };
        let features = FairValueFeatures {
            mid: 4_000 * FIXED_SCALE,
            microprice_bps: 20,
            book_imbalance_bps: 0,
            signed_flow_bps: 0,
            basis_bps: 0,
            cross_venue_bps: 0,
        };
        let estimates = model.estimate_all(features).unwrap();
        assert_eq!(estimates[0].adjustment_bps, 20);
        assert_eq!(estimates[1].adjustment_bps, 10);
        assert_eq!(estimates[2].adjustment_bps, 2);
        assert_eq!(estimates[3].adjustment_bps, 0);
        assert!(estimates[0].price > estimates[1].price);
    }

    #[test]
    fn model_guardrail_caps_explosive_signal() {
        let mut config = coefficients(10_000);
        config.max_abs_adjustment_bps = 50;
        let estimate = estimate(
            FairValueHorizon::Ms10,
            config,
            FairValueFeatures {
                mid: 100 * FIXED_SCALE,
                microprice_bps: 5_000,
                book_imbalance_bps: 0,
                signed_flow_bps: 0,
                basis_bps: 0,
                cross_venue_bps: 0,
            },
        )
        .unwrap();
        assert_eq!(estimate.adjustment_bps, 50);
    }

    #[test]
    fn non_positive_mid_fails_closed() {
        let error = estimate(
            FairValueHorizon::Ms10,
            coefficients(10_000),
            FairValueFeatures {
                mid: 0,
                microprice_bps: 0,
                book_imbalance_bps: 0,
                signed_flow_bps: 0,
                basis_bps: 0,
                cross_venue_bps: 0,
            },
        )
        .unwrap_err();
        assert_eq!(error, FairValueError::InvalidMid);
    }
}

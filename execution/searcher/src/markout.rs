use crate::events::{BlockNumber, Fixed, Side, TimestampNs};
use crate::BPS_SCALE;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FairValuePoint {
    pub ts_ns: TimestampNs,
    pub block_number: Option<BlockNumber>,
    pub price: Fixed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Horizon {
    TimeNs(u64),
    Blocks(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SamplingPolicy {
    AtOrAfter { max_delay_ns: u64 },
    LastKnown { max_age_ns: u64 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Markout {
    pub horizon: Horizon,
    pub sampled_ts_ns: TimestampNs,
    pub sampled_block: Option<BlockNumber>,
    pub future_fair: Fixed,
    /// Maker-favorable sign convention: positive is favorable to Suwappu.
    pub maker_markout_bps: Fixed,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MarkoutError {
    #[error("fill price must be positive")]
    InvalidFillPrice,
    #[error("fill block required for block horizon")]
    MissingFillBlock,
    #[error("fair-value series must be ordered by timestamp")]
    UnsortedSeries,
    #[error("no fair-value sample satisfies the horizon policy")]
    MissingSample,
    #[error("fixed-point arithmetic overflow")]
    Overflow,
}

pub fn label_markout(
    series: &[FairValuePoint],
    fill_ts_ns: TimestampNs,
    fill_block: Option<BlockNumber>,
    fill_price: Fixed,
    maker_side: Side,
    horizon: Horizon,
    policy: SamplingPolicy,
) -> Result<Markout, MarkoutError> {
    if fill_price <= 0 {
        return Err(MarkoutError::InvalidFillPrice);
    }
    if series.windows(2).any(|window| window[0].ts_ns > window[1].ts_ns) {
        return Err(MarkoutError::UnsortedSeries);
    }

    let sample = match horizon {
        Horizon::TimeNs(delta) => {
            let target = fill_ts_ns.saturating_add(delta);
            sample_time(series, target, policy)?
        }
        Horizon::Blocks(delta) => {
            let base = fill_block.ok_or(MarkoutError::MissingFillBlock)?;
            let target = base.saturating_add(delta);
            series
                .iter()
                .find(|point| point.block_number.is_some_and(|block| block >= target))
                .ok_or(MarkoutError::MissingSample)?
        }
    };

    let diff = sample
        .price
        .checked_sub(fill_price)
        .and_then(|value| value.checked_mul(maker_side.maker_sign()))
        .ok_or(MarkoutError::Overflow)?;
    let maker_markout_bps = diff
        .checked_mul(BPS_SCALE)
        .and_then(|value| value.checked_div(fill_price))
        .ok_or(MarkoutError::Overflow)?;

    Ok(Markout {
        horizon,
        sampled_ts_ns: sample.ts_ns,
        sampled_block: sample.block_number,
        future_fair: sample.price,
        maker_markout_bps,
    })
}

fn sample_time(
    series: &[FairValuePoint],
    target: TimestampNs,
    policy: SamplingPolicy,
) -> Result<&FairValuePoint, MarkoutError> {
    match policy {
        SamplingPolicy::AtOrAfter { max_delay_ns } => series
            .iter()
            .find(|point| point.ts_ns >= target && point.ts_ns - target <= max_delay_ns)
            .ok_or(MarkoutError::MissingSample),
        SamplingPolicy::LastKnown { max_age_ns } => series
            .iter()
            .rev()
            .find(|point| point.ts_ns <= target && target - point.ts_ns <= max_age_ns)
            .ok_or(MarkoutError::MissingSample),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FIXED_SCALE;

    #[test]
    fn maker_buy_has_positive_markout_when_fair_rises() {
        let series = [FairValuePoint {
            ts_ns: 110,
            block_number: Some(101),
            price: 101 * FIXED_SCALE,
        }];
        let markout = label_markout(
            &series,
            100,
            Some(100),
            100 * FIXED_SCALE,
            Side::Buy,
            Horizon::TimeNs(10),
            SamplingPolicy::AtOrAfter { max_delay_ns: 0 },
        )
        .unwrap();
        assert_eq!(markout.maker_markout_bps, 100);
    }

    #[test]
    fn maker_sell_has_positive_markout_when_fair_falls() {
        let series = [FairValuePoint {
            ts_ns: 110,
            block_number: Some(101),
            price: 99 * FIXED_SCALE,
        }];
        let markout = label_markout(
            &series,
            100,
            Some(100),
            100 * FIXED_SCALE,
            Side::Sell,
            Horizon::Blocks(1),
            SamplingPolicy::AtOrAfter { max_delay_ns: 0 },
        )
        .unwrap();
        assert_eq!(markout.maker_markout_bps, 100);
    }

    #[test]
    fn stale_samples_are_rejected() {
        let series = [FairValuePoint {
            ts_ns: 120,
            block_number: None,
            price: 100 * FIXED_SCALE,
        }];
        let error = label_markout(
            &series,
            100,
            None,
            100 * FIXED_SCALE,
            Side::Buy,
            Horizon::TimeNs(10),
            SamplingPolicy::AtOrAfter { max_delay_ns: 5 },
        )
        .unwrap_err();
        assert_eq!(error, MarkoutError::MissingSample);
    }

    #[test]
    fn unsorted_series_is_rejected() {
        let series = [
            FairValuePoint { ts_ns: 120, block_number: None, price: 100 * FIXED_SCALE },
            FairValuePoint { ts_ns: 110, block_number: None, price: 100 * FIXED_SCALE },
        ];
        let error = label_markout(
            &series,
            100,
            None,
            100 * FIXED_SCALE,
            Side::Buy,
            Horizon::TimeNs(10),
            SamplingPolicy::AtOrAfter { max_delay_ns: 20 },
        )
        .unwrap_err();
        assert_eq!(error, MarkoutError::UnsortedSeries);
    }
}

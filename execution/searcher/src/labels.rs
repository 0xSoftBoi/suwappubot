use crate::events::{BlockNumber, Fixed, Side, TimestampNs};
use crate::markout::{
    label_markout, FairValuePoint, Horizon, Markout, MarkoutError, SamplingPolicy,
};

pub const NS_PER_MS: u64 = 1_000_000;
pub const NS_PER_SECOND: u64 = 1_000_000_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StandardHorizon {
    Ms10,
    Ms100,
    Ms500,
    S1,
    Block1,
    Block5,
}

impl StandardHorizon {
    #[must_use]
    pub const fn horizon(self) -> Horizon {
        match self {
            Self::Ms10 => Horizon::TimeNs(10 * NS_PER_MS),
            Self::Ms100 => Horizon::TimeNs(100 * NS_PER_MS),
            Self::Ms500 => Horizon::TimeNs(500 * NS_PER_MS),
            Self::S1 => Horizon::TimeNs(NS_PER_SECOND),
            Self::Block1 => Horizon::Blocks(1),
            Self::Block5 => Horizon::Blocks(5),
        }
    }

    #[must_use]
    pub const fn all() -> [Self; 6] {
        [
            Self::Ms10,
            Self::Ms100,
            Self::Ms500,
            Self::S1,
            Self::Block1,
            Self::Block5,
        ]
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LabelValue {
    Present(Markout),
    Missing(MissingLabelReason),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MissingLabelReason {
    NoSample,
    MissingFillBlock,
    InvalidFill,
    UnsortedSeries,
    Arithmetic,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarkoutLabel {
    pub horizon: StandardHorizon,
    pub value: LabelValue,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FillForLabeling {
    pub ts_ns: TimestampNs,
    pub block_number: Option<BlockNumber>,
    pub price: Fixed,
    pub maker_side: Side,
}

pub fn label_standard_horizons(
    series: &[FairValuePoint],
    fill: FillForLabeling,
    max_time_sample_delay_ns: u64,
) -> Vec<MarkoutLabel> {
    StandardHorizon::all()
        .into_iter()
        .map(|standard| {
            let horizon = standard.horizon();
            let policy = SamplingPolicy::AtOrAfter {
                max_delay_ns: max_time_sample_delay_ns,
            };
            let value = match label_markout(
                series,
                fill.ts_ns,
                fill.block_number,
                fill.price,
                fill.maker_side,
                horizon,
                policy,
            ) {
                Ok(markout) => LabelValue::Present(markout),
                Err(error) => LabelValue::Missing(map_error(error)),
            };
            MarkoutLabel {
                horizon: standard,
                value,
            }
        })
        .collect()
}

fn map_error(error: MarkoutError) -> MissingLabelReason {
    match error {
        MarkoutError::MissingSample => MissingLabelReason::NoSample,
        MarkoutError::MissingFillBlock => MissingLabelReason::MissingFillBlock,
        MarkoutError::InvalidFillPrice => MissingLabelReason::InvalidFill,
        MarkoutError::UnsortedSeries => MissingLabelReason::UnsortedSeries,
        MarkoutError::Overflow => MissingLabelReason::Arithmetic,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FIXED_SCALE;

    #[test]
    fn produces_all_six_standard_horizons_and_preserves_missingness() {
        let p = FIXED_SCALE;
        let fill_ts = 1_000_000_000;
        let series = [
            FairValuePoint {
                ts_ns: fill_ts + 10 * NS_PER_MS,
                block_number: Some(100),
                price: 101 * p,
            },
            FairValuePoint {
                ts_ns: fill_ts + 100 * NS_PER_MS,
                block_number: Some(101),
                price: 102 * p,
            },
            FairValuePoint {
                ts_ns: fill_ts + 500 * NS_PER_MS,
                block_number: Some(102),
                price: 103 * p,
            },
            FairValuePoint {
                ts_ns: fill_ts + NS_PER_SECOND,
                block_number: Some(103),
                price: 104 * p,
            },
        ];
        let labels = label_standard_horizons(
            &series,
            FillForLabeling {
                ts_ns: fill_ts,
                block_number: Some(100),
                price: 100 * p,
                maker_side: Side::Buy,
            },
            0,
        );
        assert_eq!(labels.len(), 6);
        assert!(matches!(labels[0].value, LabelValue::Present(_)));
        assert!(matches!(labels[3].value, LabelValue::Present(_)));
        assert!(matches!(labels[4].value, LabelValue::Present(_)));
        assert_eq!(
            labels[5].value,
            LabelValue::Missing(MissingLabelReason::NoSample)
        );
    }
}

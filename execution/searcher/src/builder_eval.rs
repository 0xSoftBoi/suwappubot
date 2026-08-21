use crate::builder_model::{optimize_bid, BidContext, BidSearch, BuilderInclusionModel, BuilderModelError, BuilderTrainingRow};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ReliabilityBucket {
    pub lower_bound: f64,
    pub upper_bound: f64,
    pub rows: usize,
    pub mean_predicted: f64,
    pub observed_inclusion_rate: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PolicyComparison {
    pub optimized_bid_wei: u128,
    pub fixed_bid_wei: u128,
    pub optimized_expected_retained_wei: f64,
    pub fixed_expected_retained_wei: f64,
    pub expected_improvement_wei: f64,
}

#[must_use]
pub fn reliability_buckets(
    model: &BuilderInclusionModel,
    rows: &[BuilderTrainingRow],
    bucket_count: usize,
) -> Vec<ReliabilityBucket> {
    if bucket_count == 0 {
        return Vec::new();
    }

    let mut counts = vec![0usize; bucket_count];
    let mut predicted = vec![0.0f64; bucket_count];
    let mut positives = vec![0usize; bucket_count];

    for row in rows {
        let probability = model.predict(row).clamp(0.0, 1.0);
        let mut index = (probability * bucket_count as f64).floor() as usize;
        index = index.min(bucket_count - 1);
        counts[index] += 1;
        predicted[index] += probability;
        if row.included {
            positives[index] += 1;
        }
    }

    (0..bucket_count)
        .map(|index| {
            let rows = counts[index];
            let lower = index as f64 / bucket_count as f64;
            let upper = (index + 1) as f64 / bucket_count as f64;
            ReliabilityBucket {
                lower_bound: lower,
                upper_bound: upper,
                rows,
                mean_predicted: if rows == 0 {
                    0.0
                } else {
                    predicted[index] / rows as f64
                },
                observed_inclusion_rate: if rows == 0 {
                    0.0
                } else {
                    positives[index] as f64 / rows as f64
                },
            }
        })
        .collect()
}

/// Compares the optimized policy with a fixed percentage-of-profit bid under the same
/// fitted inclusion model. This is a model-implied counterfactual, not realized causal PnL.
pub fn compare_with_fixed_bid(
    model: &BuilderInclusionModel,
    context: BidContext,
    search: BidSearch,
    fixed_bid_bps: u16,
) -> Result<Option<PolicyComparison>, BuilderModelError> {
    if fixed_bid_bps > 10_000 {
        return Err(BuilderModelError::InvalidBidSearch);
    }
    let Some(optimum) = optimize_bid(model, context, search)? else {
        return Ok(None);
    };

    let fixed_bid = context
        .profit_before_bid_wei
        .saturating_mul(u128::from(fixed_bid_bps))
        / 10_000;
    let fixed_probability = model.predict_context(fixed_bid, context);
    let fixed_retained = (context.profit_before_bid_wei - fixed_bid) as f64;
    let fixed_expected = fixed_probability * fixed_retained;

    Ok(Some(PolicyComparison {
        optimized_bid_wei: optimum.bid_wei,
        fixed_bid_wei: fixed_bid,
        optimized_expected_retained_wei: optimum.expected_retained_wei,
        fixed_expected_retained_wei: fixed_expected,
        expected_improvement_wei: optimum.expected_retained_wei - fixed_expected,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builder_model::{BuilderInclusionModel, LogisticConfig};

    fn rows() -> Vec<BuilderTrainingRow> {
        (0..100)
            .map(|index| {
                let profit = 1_000_000u128;
                let bid_bps = 100 + u128::from(index % 25) * 40;
                BuilderTrainingRow {
                    timestamp_ns: index * 1_000_000,
                    builder: "titan".into(),
                    slot: 1_000 + index,
                    builder_payment_wei: profit * bid_bps / 10_000,
                    profit_before_bid_wei: profit,
                    opportunity_age_ms: 20 + index,
                    slot_phase_ms: 2_000,
                    simulation_confidence_bps: 9_700,
                    relay_top_bid_wei: Some(80_000),
                    included: bid_bps >= 500 || index % 17 == 0,
                }
            })
            .collect()
    }

    #[test]
    fn reliability_buckets_cover_all_rows() {
        let rows = rows();
        let model = BuilderInclusionModel::fit("titan", &rows, LogisticConfig::default()).unwrap();
        let buckets = reliability_buckets(&model, &rows, 10);
        assert_eq!(buckets.iter().map(|bucket| bucket.rows).sum::<usize>(), rows.len());
        assert_eq!(buckets.len(), 10);
    }

    #[test]
    fn optimized_policy_is_not_worse_than_fixed_policy_under_same_model() {
        let rows = rows();
        let model = BuilderInclusionModel::fit("titan", &rows, LogisticConfig::default()).unwrap();
        let context = BidContext {
            profit_before_bid_wei: 1_000_000,
            opportunity_age_ms: 50,
            slot_phase_ms: 2_000,
            simulation_confidence_bps: 9_700,
            relay_top_bid_wei: Some(80_000),
        };
        let comparison = compare_with_fixed_bid(
            &model,
            context,
            BidSearch {
                min_bid_wei: 10_000,
                max_bid_wei: 200_000,
                step_wei: 10_000,
            },
            1_000,
        )
        .unwrap()
        .unwrap();
        assert!(comparison.expected_improvement_wei >= -f64::EPSILON);
    }
}

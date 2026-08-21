use std::cmp::Ordering;
use thiserror::Error;

const FEATURE_COUNT: usize = 6;
const MIN_PROBABILITY: f64 = 1e-9;

/// One labeled Suwappu submission. Relay-market observations are joined into this row as
/// context; relay builder bids themselves are not treated as Suwappu submission labels.
#[derive(Clone, Debug, PartialEq)]
pub struct BuilderTrainingRow {
    pub timestamp_ns: u64,
    pub builder: String,
    pub slot: u64,
    pub builder_payment_wei: u128,
    pub profit_before_bid_wei: u128,
    pub opportunity_age_ms: u64,
    pub slot_phase_ms: u32,
    pub simulation_confidence_bps: u16,
    /// Highest observed builder bid value in the slot, when available. This is market
    /// context, not our own payment.
    pub relay_top_bid_wei: Option<u128>,
    pub included: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LogisticConfig {
    pub learning_rate: f64,
    pub l2: f64,
    pub epochs: u32,
}

impl Default for LogisticConfig {
    fn default() -> Self {
        Self {
            learning_rate: 0.05,
            l2: 1e-3,
            epochs: 400,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct BuilderInclusionModel {
    pub builder: String,
    weights: [f64; FEATURE_COUNT],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PredictionMetrics {
    pub rows: usize,
    pub brier_score: f64,
    pub log_loss: f64,
    pub inclusion_rate: f64,
    pub mean_predicted_probability: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WalkForwardConfig {
    pub min_train_rows: usize,
    pub test_rows: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct WalkForwardFold {
    pub train_rows: usize,
    pub test_rows: usize,
    pub test_start_timestamp_ns: u64,
    pub metrics: PredictionMetrics,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BidSearch {
    pub min_bid_wei: u128,
    pub max_bid_wei: u128,
    pub step_wei: u128,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BidContext {
    pub profit_before_bid_wei: u128,
    pub opportunity_age_ms: u64,
    pub slot_phase_ms: u32,
    pub simulation_confidence_bps: u16,
    pub relay_top_bid_wei: Option<u128>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BidOptimum {
    pub bid_wei: u128,
    pub inclusion_probability: f64,
    pub expected_retained_wei: f64,
    pub evaluations: u64,
}

#[derive(Debug, Error, PartialEq)]
pub enum BuilderModelError {
    #[error("model requires at least two rows with both positive and negative labels")]
    DegenerateLabels,
    #[error("invalid optimizer configuration")]
    InvalidConfig,
    #[error("walk-forward split is too small")]
    InvalidWalkForward,
    #[error("bid search domain is invalid")]
    InvalidBidSearch,
    #[error("no rows for requested builder")]
    NoRowsForBuilder,
}

impl BuilderInclusionModel {
    pub fn fit(
        builder: impl Into<String>,
        rows: &[BuilderTrainingRow],
        config: LogisticConfig,
    ) -> Result<Self, BuilderModelError> {
        if !config.learning_rate.is_finite()
            || config.learning_rate <= 0.0
            || !config.l2.is_finite()
            || config.l2 < 0.0
            || config.epochs == 0
        {
            return Err(BuilderModelError::InvalidConfig);
        }

        let builder = builder.into();
        let selected: Vec<_> = rows.iter().filter(|row| row.builder == builder).collect();
        if selected.is_empty() {
            return Err(BuilderModelError::NoRowsForBuilder);
        }
        let positives = selected.iter().filter(|row| row.included).count();
        if selected.len() < 2 || positives == 0 || positives == selected.len() {
            return Err(BuilderModelError::DegenerateLabels);
        }

        let mut weights = [0.0; FEATURE_COUNT];
        let n = selected.len() as f64;
        for _ in 0..config.epochs {
            let mut gradient = [0.0; FEATURE_COUNT];
            for row in &selected {
                let x = features(row);
                let prediction = sigmoid(dot(&weights, &x));
                let target = if row.included { 1.0 } else { 0.0 };
                let error = prediction - target;
                for (index, value) in x.iter().enumerate() {
                    gradient[index] += error * value;
                }
            }

            for index in 0..FEATURE_COUNT {
                let regularizer = if index == 0 {
                    0.0
                } else {
                    config.l2 * weights[index]
                };
                weights[index] -= config.learning_rate * (gradient[index] / n + regularizer);
            }
        }

        Ok(Self { builder, weights })
    }

    #[must_use]
    pub fn predict(&self, row: &BuilderTrainingRow) -> f64 {
        sigmoid(dot(&self.weights, &features(row)))
    }

    #[must_use]
    pub fn predict_context(&self, bid_wei: u128, context: BidContext) -> f64 {
        let row = BuilderTrainingRow {
            timestamp_ns: 0,
            builder: self.builder.clone(),
            slot: 0,
            builder_payment_wei: bid_wei,
            profit_before_bid_wei: context.profit_before_bid_wei,
            opportunity_age_ms: context.opportunity_age_ms,
            slot_phase_ms: context.slot_phase_ms,
            simulation_confidence_bps: context.simulation_confidence_bps,
            relay_top_bid_wei: context.relay_top_bid_wei,
            included: false,
        };
        self.predict(&row)
    }
}

pub fn evaluate(model: &BuilderInclusionModel, rows: &[BuilderTrainingRow]) -> PredictionMetrics {
    if rows.is_empty() {
        return PredictionMetrics {
            rows: 0,
            brier_score: 0.0,
            log_loss: 0.0,
            inclusion_rate: 0.0,
            mean_predicted_probability: 0.0,
        };
    }

    let mut brier = 0.0;
    let mut log_loss = 0.0;
    let mut positives = 0usize;
    let mut predicted_sum = 0.0;
    for row in rows {
        let p = model
            .predict(row)
            .clamp(MIN_PROBABILITY, 1.0 - MIN_PROBABILITY);
        let y = if row.included { 1.0 } else { 0.0 };
        let error = p - y;
        brier += error * error;
        log_loss -= y * p.ln() + (1.0 - y) * (1.0 - p).ln();
        if row.included {
            positives += 1;
        }
        predicted_sum += p;
    }
    let n = rows.len() as f64;
    PredictionMetrics {
        rows: rows.len(),
        brier_score: brier / n,
        log_loss: log_loss / n,
        inclusion_rate: positives as f64 / n,
        mean_predicted_probability: predicted_sum / n,
    }
}

pub fn walk_forward(
    builder: &str,
    rows: &[BuilderTrainingRow],
    split: WalkForwardConfig,
    model_config: LogisticConfig,
) -> Result<Vec<WalkForwardFold>, BuilderModelError> {
    if split.min_train_rows < 2 || split.test_rows == 0 {
        return Err(BuilderModelError::InvalidWalkForward);
    }

    let mut selected: Vec<_> = rows
        .iter()
        .filter(|row| row.builder == builder)
        .cloned()
        .collect();
    selected.sort_by(|a, b| {
        a.timestamp_ns
            .cmp(&b.timestamp_ns)
            .then_with(|| a.slot.cmp(&b.slot))
            .then_with(|| a.builder_payment_wei.cmp(&b.builder_payment_wei))
    });
    if selected.len() < split.min_train_rows + split.test_rows {
        return Err(BuilderModelError::InvalidWalkForward);
    }

    let mut folds = Vec::new();
    let mut train_end = split.min_train_rows;
    while train_end + split.test_rows <= selected.len() {
        let train = &selected[..train_end];
        let test = &selected[train_end..train_end + split.test_rows];
        let model = BuilderInclusionModel::fit(builder, train, model_config)?;
        folds.push(WalkForwardFold {
            train_rows: train.len(),
            test_rows: test.len(),
            test_start_timestamp_ns: test[0].timestamp_ns,
            metrics: evaluate(&model, test),
        });
        train_end += split.test_rows;
    }
    Ok(folds)
}

pub fn optimize_bid(
    model: &BuilderInclusionModel,
    context: BidContext,
    search: BidSearch,
) -> Result<Option<BidOptimum>, BuilderModelError> {
    if search.step_wei == 0
        || search.max_bid_wei < search.min_bid_wei
        || search.max_bid_wei > context.profit_before_bid_wei
    {
        return Err(BuilderModelError::InvalidBidSearch);
    }

    let mut bid = search.min_bid_wei;
    let mut best: Option<BidOptimum> = None;
    let mut evaluations = 0u64;
    loop {
        evaluations = evaluations.saturating_add(1);
        let probability = model.predict_context(bid, context);
        let retained = (context.profit_before_bid_wei - bid) as f64;
        let expected = probability * retained;
        let replace = best.as_ref().is_none_or(|current| {
            match expected.total_cmp(&current.expected_retained_wei) {
                Ordering::Greater => true,
                Ordering::Equal => bid < current.bid_wei,
                Ordering::Less => false,
            }
        });
        if replace {
            best = Some(BidOptimum {
                bid_wei: bid,
                inclusion_probability: probability,
                expected_retained_wei: expected,
                evaluations,
            });
        }
        if bid == search.max_bid_wei {
            break;
        }
        bid = bid.saturating_add(search.step_wei).min(search.max_bid_wei);
    }

    if let Some(ref mut optimum) = best {
        optimum.evaluations = evaluations;
    }
    Ok(best.filter(|optimum| optimum.expected_retained_wei > 0.0))
}

fn features(row: &BuilderTrainingRow) -> [f64; FEATURE_COUNT] {
    let profit = row.profit_before_bid_wei.max(1) as f64;
    let bid_fraction = row.builder_payment_wei as f64 / profit;
    let relay_pressure = row.relay_top_bid_wei.unwrap_or(0) as f64 / profit;
    [
        1.0,
        bid_fraction.clamp(0.0, 2.0),
        (row.opportunity_age_ms as f64 / 1_000.0).clamp(0.0, 10.0),
        (f64::from(row.slot_phase_ms) / 12_000.0).clamp(0.0, 2.0),
        f64::from(row.simulation_confidence_bps) / 10_000.0,
        relay_pressure.clamp(0.0, 10.0),
    ]
}

fn dot(left: &[f64; FEATURE_COUNT], right: &[f64; FEATURE_COUNT]) -> f64 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

fn sigmoid(value: f64) -> f64 {
    if value >= 0.0 {
        1.0 / (1.0 + (-value).exp())
    } else {
        let exp = value.exp();
        exp / (1.0 + exp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(index: u64, bid_bps: u128, included: bool) -> BuilderTrainingRow {
        let profit = 1_000_000u128;
        BuilderTrainingRow {
            timestamp_ns: index * 1_000_000,
            builder: "titan".into(),
            slot: 100 + index,
            builder_payment_wei: profit * bid_bps / 10_000,
            profit_before_bid_wei: profit,
            opportunity_age_ms: 20 + index,
            slot_phase_ms: 2_000,
            simulation_confidence_bps: 9_500,
            relay_top_bid_wei: Some(100_000),
            included,
        }
    }

    fn sample_rows() -> Vec<BuilderTrainingRow> {
        (0..80)
            .map(|i| {
                let bid_bps = 100 + u128::from(i % 20) * 50;
                let included = bid_bps >= 550 || (i % 11 == 0);
                row(i, bid_bps, included)
            })
            .collect()
    }

    #[test]
    fn model_learns_higher_bid_is_more_includable_on_fixture() {
        let rows = sample_rows();
        let model = BuilderInclusionModel::fit("titan", &rows, LogisticConfig::default()).unwrap();
        let context = BidContext {
            profit_before_bid_wei: 1_000_000,
            opportunity_age_ms: 50,
            slot_phase_ms: 2_000,
            simulation_confidence_bps: 9_500,
            relay_top_bid_wei: Some(100_000),
        };
        assert!(model.predict_context(90_000, context) > model.predict_context(20_000, context));
    }

    #[test]
    fn walk_forward_never_trains_on_future_rows() {
        let rows = sample_rows();
        let folds = walk_forward(
            "titan",
            &rows,
            WalkForwardConfig {
                min_train_rows: 40,
                test_rows: 10,
            },
            LogisticConfig::default(),
        )
        .unwrap();
        assert_eq!(folds.len(), 4);
        assert_eq!(folds[0].train_rows, 40);
        assert_eq!(folds[0].test_start_timestamp_ns, rows[40].timestamp_ns);
        assert_eq!(folds[3].train_rows, 70);
    }

    #[test]
    fn optimizer_maximizes_retained_expected_value_not_inclusion_alone() {
        let rows = sample_rows();
        let model = BuilderInclusionModel::fit("titan", &rows, LogisticConfig::default()).unwrap();
        let optimum = optimize_bid(
            &model,
            BidContext {
                profit_before_bid_wei: 1_000_000,
                opportunity_age_ms: 50,
                slot_phase_ms: 2_000,
                simulation_confidence_bps: 9_500,
                relay_top_bid_wei: Some(100_000),
            },
            BidSearch {
                min_bid_wei: 10_000,
                max_bid_wei: 200_000,
                step_wei: 10_000,
            },
        )
        .unwrap()
        .unwrap();
        assert!(optimum.bid_wei < 200_000);
        assert!(optimum.expected_retained_wei > 0.0);
        assert_eq!(optimum.evaluations, 20);
    }

    #[test]
    fn degenerate_labels_fail_closed() {
        let rows = vec![row(0, 500, true), row(1, 600, true)];
        assert_eq!(
            BuilderInclusionModel::fit("titan", &rows, LogisticConfig::default()).unwrap_err(),
            BuilderModelError::DegenerateLabels
        );
    }
}

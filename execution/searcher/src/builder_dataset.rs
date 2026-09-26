use crate::builder_model::BuilderTrainingRow;
use crate::events::{EventEnvelope, MarketEvent};
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
struct SubmissionRecord {
    timestamp_ns: u64,
    slot: u64,
    builder_payment_wei: u128,
    profit_before_bid_wei: u128,
    opportunity_created_ts_ns: u64,
    slot_phase_ms: u32,
    simulation_confidence_bps: u16,
    replace_sequence: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct OutcomeRecord {
    slot: u64,
    included: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BuilderDatasetError {
    #[error(
        "conflicting submission replacement for builder={builder} opportunity={opportunity_id}"
    )]
    ConflictingSubmission {
        builder: String,
        opportunity_id: String,
    },
    #[error("conflicting outcome for builder={builder} opportunity={opportunity_id}")]
    ConflictingOutcome {
        builder: String,
        opportunity_id: String,
    },
    #[error("submission/outcome slot mismatch for builder={builder} opportunity={opportunity_id}")]
    SlotMismatch {
        builder: String,
        opportunity_id: String,
    },
    #[error("submission timestamp precedes opportunity creation")]
    NegativeOpportunityAge,
}

/// Joins replay-normalized events into labeled builder-model rows.
///
/// Rules:
/// - public `BuilderTrace` observations provide slot-level market pressure only;
/// - only explicit Suwappu `BuilderSubmission` + `BuilderOutcome` pairs create labels;
/// - the highest replacement sequence is the effective submission for one opportunity;
/// - unlabeled/open submissions are skipped rather than assumed lost;
/// - conflicting terminal outcomes fail closed.
pub fn training_rows_from_events(
    events: &[EventEnvelope],
) -> Result<Vec<BuilderTrainingRow>, BuilderDatasetError> {
    let mut relay_top_by_slot = BTreeMap::<u64, u128>::new();
    let mut submissions = BTreeMap::<(String, String), SubmissionRecord>::new();
    let mut outcomes = BTreeMap::<(String, String), OutcomeRecord>::new();

    for event in events {
        match &event.payload {
            MarketEvent::BuilderTrace {
                opportunity_id,
                bid_wei,
                ..
            } => {
                if let Some(slot) = relay_slot(opportunity_id) {
                    relay_top_by_slot
                        .entry(slot)
                        .and_modify(|top| *top = (*top).max(*bid_wei))
                        .or_insert(*bid_wei);
                }
            }
            MarketEvent::BuilderSubmission {
                builder,
                opportunity_id,
                slot,
                builder_payment_wei,
                profit_before_bid_wei,
                opportunity_created_ts_ns,
                slot_phase_ms,
                simulation_confidence_bps,
                replace_sequence,
            } => {
                let key = (builder.clone(), opportunity_id.clone());
                let candidate = SubmissionRecord {
                    timestamp_ns: event.exchange_ts_ns,
                    slot: *slot,
                    builder_payment_wei: *builder_payment_wei,
                    profit_before_bid_wei: *profit_before_bid_wei,
                    opportunity_created_ts_ns: *opportunity_created_ts_ns,
                    slot_phase_ms: *slot_phase_ms,
                    simulation_confidence_bps: *simulation_confidence_bps,
                    replace_sequence: replace_sequence.unwrap_or(0),
                };
                match submissions.get(&key) {
                    None => {
                        submissions.insert(key, candidate);
                    }
                    Some(existing) if candidate.replace_sequence > existing.replace_sequence => {
                        submissions.insert(key, candidate);
                    }
                    Some(existing) if candidate.replace_sequence == existing.replace_sequence => {
                        if existing != &candidate {
                            return Err(BuilderDatasetError::ConflictingSubmission {
                                builder: builder.clone(),
                                opportunity_id: opportunity_id.clone(),
                            });
                        }
                    }
                    Some(_) => {}
                }
            }
            MarketEvent::BuilderOutcome {
                builder,
                opportunity_id,
                slot,
                included,
                ..
            } => {
                let key = (builder.clone(), opportunity_id.clone());
                let candidate = OutcomeRecord {
                    slot: *slot,
                    included: *included,
                };
                if let Some(existing) = outcomes.get(&key) {
                    if existing != &candidate {
                        return Err(BuilderDatasetError::ConflictingOutcome {
                            builder: builder.clone(),
                            opportunity_id: opportunity_id.clone(),
                        });
                    }
                } else {
                    outcomes.insert(key, candidate);
                }
            }
            _ => {}
        }
    }

    let mut rows = Vec::new();
    for ((builder, opportunity_id), submission) in submissions {
        let Some(outcome) = outcomes.get(&(builder.clone(), opportunity_id.clone())) else {
            continue;
        };
        if outcome.slot != submission.slot {
            return Err(BuilderDatasetError::SlotMismatch {
                builder,
                opportunity_id,
            });
        }
        let age_ns = submission
            .timestamp_ns
            .checked_sub(submission.opportunity_created_ts_ns)
            .ok_or(BuilderDatasetError::NegativeOpportunityAge)?;
        rows.push(BuilderTrainingRow {
            timestamp_ns: submission.timestamp_ns,
            builder,
            slot: submission.slot,
            builder_payment_wei: submission.builder_payment_wei,
            profit_before_bid_wei: submission.profit_before_bid_wei,
            opportunity_age_ms: age_ns / 1_000_000,
            slot_phase_ms: submission.slot_phase_ms,
            simulation_confidence_bps: submission.simulation_confidence_bps,
            relay_top_bid_wei: relay_top_by_slot.get(&submission.slot).copied(),
            included: outcome.included,
        });
    }

    rows.sort_by(|a, b| {
        a.timestamp_ns
            .cmp(&b.timestamp_ns)
            .then_with(|| a.builder.cmp(&b.builder))
            .then_with(|| a.slot.cmp(&b.slot))
    });
    Ok(rows)
}

fn relay_slot(opportunity_id: &str) -> Option<u64> {
    let mut parts = opportunity_id.split(':');
    (parts.next()? == "relay").then_some(())?;
    parts.next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{EventId, SourceId};

    fn envelope(id: &str, ts: u64, payload: MarketEvent) -> EventEnvelope {
        EventEnvelope {
            schema_version: 1,
            event_id: EventId(id.into()),
            source: SourceId("test".into()),
            exchange_ts_ns: ts,
            receive_ts_ns: ts,
            sequence: None,
            clock_uncertainty_ns: 0,
            chain: None,
            payload,
        }
    }

    fn submission(sequence: u64, payment: u128) -> MarketEvent {
        MarketEvent::BuilderSubmission {
            builder: "titan".into(),
            opportunity_id: "opp-1".into(),
            slot: 123,
            builder_payment_wei: payment,
            profit_before_bid_wei: 1_000,
            opportunity_created_ts_ns: 1_000_000,
            slot_phase_ms: 3_000,
            simulation_confidence_bps: 9_900,
            replace_sequence: Some(sequence),
        }
    }

    #[test]
    fn latest_replacement_and_relay_pressure_form_training_row() {
        let events = vec![
            envelope(
                "relay-a",
                1,
                MarketEvent::BuilderTrace {
                    builder: "builder-a".into(),
                    opportunity_id: "relay:123:0xaaa".into(),
                    bid_wei: 250,
                    simulated: true,
                    included: false,
                    failure: None,
                },
            ),
            envelope(
                "relay-b",
                2,
                MarketEvent::BuilderTrace {
                    builder: "builder-b".into(),
                    opportunity_id: "relay:123:0xbbb".into(),
                    bid_wei: 300,
                    simulated: true,
                    included: false,
                    failure: None,
                },
            ),
            envelope("submit-1", 2_000_000, submission(1, 100)),
            envelope("submit-2", 3_000_000, submission(2, 150)),
            envelope(
                "outcome",
                4_000_000,
                MarketEvent::BuilderOutcome {
                    builder: "titan".into(),
                    opportunity_id: "opp-1".into(),
                    slot: 123,
                    included: true,
                    failure: None,
                },
            ),
        ];
        let rows = training_rows_from_events(&events).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].builder_payment_wei, 150);
        assert_eq!(rows[0].opportunity_age_ms, 2);
        assert_eq!(rows[0].relay_top_bid_wei, Some(300));
        assert!(rows[0].included);
    }

    #[test]
    fn open_submission_is_not_labeled_as_failure() {
        let rows = training_rows_from_events(&[envelope("submit", 2_000_000, submission(1, 100))])
            .unwrap();
        assert!(rows.is_empty());
    }

    #[test]
    fn conflicting_terminal_outcome_fails_closed() {
        let events = vec![
            envelope("submit", 2_000_000, submission(1, 100)),
            envelope(
                "landed",
                3_000_000,
                MarketEvent::BuilderOutcome {
                    builder: "titan".into(),
                    opportunity_id: "opp-1".into(),
                    slot: 123,
                    included: true,
                    failure: None,
                },
            ),
            envelope(
                "lost",
                4_000_000,
                MarketEvent::BuilderOutcome {
                    builder: "titan".into(),
                    opportunity_id: "opp-1".into(),
                    slot: 123,
                    included: false,
                    failure: Some("not included".into()),
                },
            ),
        ];
        assert_eq!(
            training_rows_from_events(&events).unwrap_err(),
            BuilderDatasetError::ConflictingOutcome {
                builder: "titan".into(),
                opportunity_id: "opp-1".into(),
            }
        );
    }
}

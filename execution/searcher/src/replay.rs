use crate::events::{EventEnvelope, EventId, SourceId};
use blake3::Hasher;
use std::collections::{BTreeMap, HashMap};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SequenceAnomaly {
    Gap {
        source: SourceId,
        expected: u64,
        observed: u64,
    },
    Regression {
        source: SourceId,
        previous: u64,
        observed: u64,
    },
}

#[derive(Clone, Debug)]
pub struct ReplayReport {
    pub events: Vec<EventEnvelope>,
    pub duplicate_count: usize,
    pub sequence_anomalies: Vec<SequenceAnomaly>,
    pub digest_hex: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ReplayError {
    #[error("event id {0:?} was reused with different content")]
    ConflictingDuplicate(EventId),
    #[error("event serialization failed: {0}")]
    Serialization(String),
}

pub fn replay(events: impl IntoIterator<Item = EventEnvelope>) -> Result<ReplayReport, ReplayError> {
    let mut unique: HashMap<EventId, EventEnvelope> = HashMap::new();
    let mut duplicate_count = 0usize;

    for event in events {
        match unique.get(&event.event_id) {
            Some(existing) if existing == &event => duplicate_count += 1,
            Some(_) => return Err(ReplayError::ConflictingDuplicate(event.event_id)),
            None => {
                unique.insert(event.event_id.clone(), event);
            }
        }
    }

    let mut ordered: Vec<_> = unique.into_values().collect();
    ordered.sort_by(EventEnvelope::replay_cmp);

    let mut last_sequence: BTreeMap<SourceId, u64> = BTreeMap::new();
    let mut sequence_anomalies = Vec::new();
    for event in &ordered {
        if let Some(sequence) = event.sequence {
            if let Some(previous) = last_sequence.get(&event.source).copied() {
                let expected = previous.saturating_add(1);
                if sequence > expected {
                    sequence_anomalies.push(SequenceAnomaly::Gap {
                        source: event.source.clone(),
                        expected,
                        observed: sequence,
                    });
                } else if sequence <= previous {
                    sequence_anomalies.push(SequenceAnomaly::Regression {
                        source: event.source.clone(),
                        previous,
                        observed: sequence,
                    });
                }
            }
            last_sequence
                .entry(event.source.clone())
                .and_modify(|previous| *previous = (*previous).max(sequence))
                .or_insert(sequence);
        }
    }

    let mut hasher = Hasher::new();
    for event in &ordered {
        let bytes = serde_json::to_vec(event)
            .map_err(|error| ReplayError::Serialization(error.to_string()))?;
        hasher.update(&(bytes.len() as u64).to_be_bytes());
        hasher.update(&bytes);
    }

    Ok(ReplayReport {
        events: ordered,
        duplicate_count,
        sequence_anomalies,
        digest_hex: hasher.finalize().to_hex().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{EventId, MarketEvent, SourceId};

    fn event(id: &str, ts: u64, receive: u64, seq: u64) -> EventEnvelope {
        EventEnvelope {
            schema_version: 1,
            event_id: EventId(id.into()),
            source: SourceId("feed-a".into()),
            exchange_ts_ns: ts,
            receive_ts_ns: receive,
            sequence: Some(seq),
            clock_uncertainty_ns: 0,
            chain: None,
            payload: MarketEvent::InventorySnapshot {
                asset: "USDC".into(),
                amount: i128::from(seq),
            },
        }
    }

    #[test]
    fn replay_is_independent_of_ingestion_order() {
        let a = event("a", 20, 20, 2);
        let b = event("b", 10, 10, 1);
        let left = replay([a.clone(), b.clone()]).unwrap();
        let right = replay([b, a]).unwrap();
        assert_eq!(left.digest_hex, right.digest_hex);
        assert_eq!(left.events[0].event_id, EventId("b".into()));
    }

    #[test]
    fn exact_duplicates_are_deduplicated() {
        let a = event("a", 10, 10, 1);
        let report = replay([a.clone(), a]).unwrap();
        assert_eq!(report.events.len(), 1);
        assert_eq!(report.duplicate_count, 1);
    }

    #[test]
    fn conflicting_duplicate_is_rejected() {
        let a = event("a", 10, 10, 1);
        let mut b = a.clone();
        b.receive_ts_ns = 11;
        assert_eq!(
            replay([a, b]).unwrap_err(),
            ReplayError::ConflictingDuplicate(EventId("a".into()))
        );
    }

    #[test]
    fn sequence_gaps_are_reported() {
        let report = replay([event("a", 10, 10, 1), event("c", 20, 20, 3)]).unwrap();
        assert_eq!(report.sequence_anomalies.len(), 1);
        assert_eq!(
            report.sequence_anomalies[0],
            SequenceAnomaly::Gap {
                source: SourceId("feed-a".into()),
                expected: 2,
                observed: 3,
            }
        );
    }

    #[test]
    fn sequence_regressions_are_reported() {
        let report = replay([event("b", 10, 10, 2), event("a", 20, 20, 1)]).unwrap();
        assert_eq!(report.sequence_anomalies.len(), 1);
        assert_eq!(
            report.sequence_anomalies[0],
            SequenceAnomaly::Regression {
                source: SourceId("feed-a".into()),
                previous: 2,
                observed: 1,
            }
        );
    }
}

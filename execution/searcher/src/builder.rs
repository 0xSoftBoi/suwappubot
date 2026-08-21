use crate::events::{EventEnvelope, EventId, MarketEvent, SourceId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Standard MEV-Boost relay bid trace fields used by the public Data API.
/// Numeric fields are strings in the relay API to preserve uint256 precision.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelayBidTrace {
    pub slot: String,
    pub parent_hash: String,
    pub block_hash: String,
    pub builder_pubkey: String,
    pub proposer_pubkey: String,
    pub proposer_fee_recipient: String,
    pub gas_limit: String,
    pub gas_used: String,
    pub value: String,
    #[serde(default)]
    pub block_number: Option<String>,
    #[serde(default)]
    pub num_tx: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub timestamp_ms: Option<String>,
}

/// Minimal real-time top-bid shape. Titan may add fields over time, so unknown fields
/// are deliberately tolerated by serde. We retain the raw identifiers needed to join
/// the stream to delivered-payload and execution-attempt datasets.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct TitanTopBidUpdate {
    pub slot: u64,
    #[serde(default)]
    pub block_hash: Option<String>,
    #[serde(default)]
    pub builder_pubkey: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub timestamp_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RelayTraceKind {
    BuilderBidReceived,
    PayloadDelivered,
    TopBid,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BuilderTelemetryError {
    #[error("invalid unsigned integer in field {field}")]
    InvalidInteger { field: &'static str },
    #[error("relay bid value exceeds u128")]
    BidValueOverflow,
    #[error("missing top-bid value")]
    MissingTopBidValue,
}

#[must_use]
pub fn relay_opportunity_id(slot: u64, block_hash: &str) -> String {
    format!("relay:{slot}:{block_hash}")
}

pub fn normalize_relay_trace(
    source: impl Into<String>,
    kind: RelayTraceKind,
    trace: RelayBidTrace,
    receive_ts_ns: u64,
) -> Result<EventEnvelope, BuilderTelemetryError> {
    let slot = parse_u64("slot", &trace.slot)?;
    let block_number = trace
        .block_number
        .as_deref()
        .map(|value| parse_u64("block_number", value))
        .transpose()?;
    let bid_wei = trace
        .value
        .parse::<u128>()
        .map_err(|_| BuilderTelemetryError::BidValueOverflow)?;
    let exchange_ts_ns = relay_exchange_ts_ns(&trace).unwrap_or(receive_ts_ns);
    let opportunity_id = relay_opportunity_id(slot, &trace.block_hash);
    let kind_name = match kind {
        RelayTraceKind::BuilderBidReceived => "builder_bid",
        RelayTraceKind::PayloadDelivered => "payload_delivered",
        RelayTraceKind::TopBid => "top_bid",
    };

    Ok(EventEnvelope {
        schema_version: 1,
        event_id: EventId(format!(
            "{kind_name}:{slot}:{}:{}",
            trace.block_hash, trace.builder_pubkey
        )),
        source: SourceId(source.into()),
        exchange_ts_ns,
        receive_ts_ns,
        // A relay may accept many builder submissions for one slot. Slot is not a
        // monotonic per-message sequence number, so inventing a sequence here would
        // create false replay regressions.
        sequence: None,
        clock_uncertainty_ns: receive_ts_ns.abs_diff(exchange_ts_ns),
        chain: block_number.map(|block_number| crate::events::ChainContext {
            chain_id: 1,
            block_number,
            block_hash: Some(trace.block_hash.clone()),
            tx_hash: None,
            tx_index: None,
            log_index: None,
        }),
        payload: MarketEvent::BuilderTrace {
            builder: trace.builder_pubkey,
            opportunity_id,
            bid_wei,
            simulated: matches!(kind, RelayTraceKind::BuilderBidReceived),
            included: matches!(kind, RelayTraceKind::PayloadDelivered),
            failure: None,
        },
    })
}

pub fn normalize_titan_top_bid(
    source: impl Into<String>,
    update: TitanTopBidUpdate,
    receive_ts_ns: u64,
) -> Result<EventEnvelope, BuilderTelemetryError> {
    let block_hash = update.block_hash.unwrap_or_else(|| "unknown".into());
    let builder = update.builder_pubkey.unwrap_or_else(|| "unknown".into());
    let value = update.value.ok_or(BuilderTelemetryError::MissingTopBidValue)?;
    let bid_wei = value
        .parse::<u128>()
        .map_err(|_| BuilderTelemetryError::BidValueOverflow)?;
    let exchange_ts_ns = update
        .timestamp_ms
        .and_then(|ms| ms.checked_mul(1_000_000))
        .unwrap_or(receive_ts_ns);

    Ok(EventEnvelope {
        schema_version: 1,
        event_id: EventId(format!("top_bid:{}:{block_hash}:{builder}:{bid_wei}", update.slot)),
        source: SourceId(source.into()),
        exchange_ts_ns,
        receive_ts_ns,
        sequence: None,
        clock_uncertainty_ns: receive_ts_ns.abs_diff(exchange_ts_ns),
        chain: None,
        payload: MarketEvent::BuilderTrace {
            builder,
            opportunity_id: relay_opportunity_id(update.slot, &block_hash),
            bid_wei,
            simulated: true,
            included: false,
            failure: None,
        },
    })
}

fn relay_exchange_ts_ns(trace: &RelayBidTrace) -> Option<u64> {
    if let Some(ms) = trace.timestamp_ms.as_deref() {
        return ms.parse::<u64>().ok()?.checked_mul(1_000_000);
    }
    trace
        .timestamp
        .as_deref()?
        .parse::<u64>()
        .ok()?
        .checked_mul(1_000_000_000)
}

fn parse_u64(field: &'static str, value: &str) -> Result<u64, BuilderTelemetryError> {
    value
        .parse::<u64>()
        .map_err(|_| BuilderTelemetryError::InvalidInteger { field })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn trace() -> RelayBidTrace {
        RelayBidTrace {
            slot: "14000000".into(),
            parent_hash: "0xparent".into(),
            block_hash: "0xblock".into(),
            builder_pubkey: "0xbuilder".into(),
            proposer_pubkey: "0xproposer".into(),
            proposer_fee_recipient: "0xfee".into(),
            gas_limit: "36000000".into(),
            gas_used: "22000000".into(),
            value: "123456789000000000".into(),
            block_number: Some("24800000".into()),
            num_tx: Some("250".into()),
            timestamp: None,
            timestamp_ms: Some("1770000000123".into()),
        }
    }

    #[test]
    fn delivered_payload_becomes_included_builder_trace() {
        let event = normalize_relay_trace(
            "titan:data:delivered",
            RelayTraceKind::PayloadDelivered,
            trace(),
            1_770_000_000_124_000_000,
        )
        .unwrap();
        assert_eq!(event.exchange_ts_ns, 1_770_000_000_123_000_000);
        assert_eq!(event.clock_uncertainty_ns, 1_000_000);
        assert_eq!(event.sequence, None);
        match event.payload {
            MarketEvent::BuilderTrace { included, bid_wei, .. } => {
                assert!(included);
                assert_eq!(bid_wei, 123_456_789_000_000_000);
            }
            _ => panic!("wrong event type"),
        }
    }

    #[test]
    fn top_bid_requires_precise_value() {
        let error = normalize_titan_top_bid(
            "titan:ws:top_bid",
            TitanTopBidUpdate {
                slot: 1,
                block_hash: None,
                builder_pubkey: None,
                value: None,
                timestamp_ms: None,
            },
            1,
        )
        .unwrap_err();
        assert_eq!(error, BuilderTelemetryError::MissingTopBidValue);
    }

    #[test]
    fn opportunity_key_joins_bid_and_delivery() {
        let bid = normalize_relay_trace(
            "titan:data:bids",
            RelayTraceKind::BuilderBidReceived,
            trace(),
            10,
        )
        .unwrap();
        let delivered = normalize_relay_trace(
            "titan:data:delivered",
            RelayTraceKind::PayloadDelivered,
            trace(),
            11,
        )
        .unwrap();
        let opportunity = |event: EventEnvelope| match event.payload {
            MarketEvent::BuilderTrace { opportunity_id, .. } => opportunity_id,
            _ => unreachable!(),
        };
        assert_eq!(opportunity(bid), opportunity(delivered));
    }
}

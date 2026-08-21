use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

pub type TimestampNs = u64;
pub type BlockNumber = u64;
pub type Fixed = i128;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct EventId(pub String);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SourceId(pub String);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct VenueId(pub String);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct InstrumentId(pub String);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ChainContext {
    pub chain_id: u64,
    pub block_number: BlockNumber,
    pub block_hash: Option<String>,
    pub tx_hash: Option<String>,
    pub tx_index: Option<u32>,
    pub log_index: Option<u32>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    #[must_use]
    pub const fn maker_sign(self) -> i128 {
        match self {
            Self::Buy => 1,
            Self::Sell => -1,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MarketEvent {
    FairValue {
        instrument: InstrumentId,
        price: Fixed,
    },
    Trade {
        venue: VenueId,
        instrument: InstrumentId,
        side: Side,
        price: Fixed,
        quantity: Fixed,
    },
    Fill {
        venue: VenueId,
        instrument: InstrumentId,
        side: Side,
        price: Fixed,
        quantity: Fixed,
        strategy_id: String,
        opportunity_id: Option<String>,
        quote_sequence: Option<u64>,
    },
    PammQuote {
        venue: VenueId,
        instrument: InstrumentId,
        quote_sequence: u64,
        bid: Fixed,
        ask: Fixed,
        max_bid_quantity: Fixed,
        max_ask_quantity: Fixed,
        valid_block: Option<BlockNumber>,
        valid_until_ns: TimestampNs,
    },
    BuilderTrace {
        builder: String,
        opportunity_id: String,
        bid_wei: u128,
        simulated: bool,
        included: bool,
        failure: Option<String>,
    },
    ExecutionAttempt {
        opportunity_id: String,
        strategy_id: String,
        gross_pnl: Fixed,
        gas_used: Option<u64>,
        calldata_bytes: u32,
        success: bool,
    },
    InventorySnapshot {
        asset: String,
        amount: Fixed,
    },
    CapitalState {
        asset: String,
        hot: Fixed,
        warm: Fixed,
        cold: Fixed,
        synchronously_withdrawable: Fixed,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventEnvelope {
    pub schema_version: u16,
    pub event_id: EventId,
    pub source: SourceId,
    pub exchange_ts_ns: TimestampNs,
    pub receive_ts_ns: TimestampNs,
    pub sequence: Option<u64>,
    pub clock_uncertainty_ns: u64,
    pub chain: Option<ChainContext>,
    pub payload: MarketEvent,
}

impl EventEnvelope {
    /// Deterministic total ordering. Exchange time is economic time; receive time and
    /// source/sequence/id are tie-breakers so replay is stable across ingestion order.
    #[must_use]
    pub fn replay_cmp(&self, other: &Self) -> Ordering {
        self.exchange_ts_ns
            .cmp(&other.exchange_ts_ns)
            .then_with(|| self.receive_ts_ns.cmp(&other.receive_ts_ns))
            .then_with(|| self.source.cmp(&other.source))
            .then_with(|| {
                self.sequence
                    .unwrap_or(u64::MAX)
                    .cmp(&other.sequence.unwrap_or(u64::MAX))
            })
            .then_with(|| self.event_id.cmp(&other.event_id))
    }
}

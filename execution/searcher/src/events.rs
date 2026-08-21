use serde::{de, Deserialize, Deserializer, Serialize};
use std::cmp::Ordering;
use std::fmt;

pub type TimestampNs = u64;
pub type BlockNumber = u64;
pub type Fixed = i128;

fn deserialize_i128<'de, D>(deserializer: D) -> Result<i128, D::Error>
where
    D: Deserializer<'de>,
{
    struct I128Visitor;

    impl<'de> de::Visitor<'de> for I128Visitor {
        type Value = i128;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter
                .write_str("a signed 128-bit integer encoded as a JSON integer or decimal string")
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(i128::from(value))
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(i128::from(value))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            value.parse::<i128>().map_err(E::custom)
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            self.visit_str(&value)
        }
    }

    deserializer.deserialize_any(I128Visitor)
}

fn deserialize_u128<'de, D>(deserializer: D) -> Result<u128, D::Error>
where
    D: Deserializer<'de>,
{
    struct U128Visitor;

    impl<'de> de::Visitor<'de> for U128Visitor {
        type Value = u128;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str(
                "an unsigned 128-bit integer encoded as a JSON integer or decimal string",
            )
        }

        fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            u128::try_from(value).map_err(E::custom)
        }

        fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            Ok(u128::from(value))
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            value.parse::<u128>().map_err(E::custom)
        }

        fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            self.visit_str(&value)
        }
    }

    deserializer.deserialize_any(U128Visitor)
}

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
        #[serde(deserialize_with = "deserialize_i128")]
        price: Fixed,
    },
    Trade {
        venue: VenueId,
        instrument: InstrumentId,
        side: Side,
        #[serde(deserialize_with = "deserialize_i128")]
        price: Fixed,
        #[serde(deserialize_with = "deserialize_i128")]
        quantity: Fixed,
    },
    Fill {
        venue: VenueId,
        instrument: InstrumentId,
        side: Side,
        #[serde(deserialize_with = "deserialize_i128")]
        price: Fixed,
        #[serde(deserialize_with = "deserialize_i128")]
        quantity: Fixed,
        strategy_id: String,
        opportunity_id: Option<String>,
        quote_sequence: Option<u64>,
    },
    PammQuote {
        venue: VenueId,
        instrument: InstrumentId,
        quote_sequence: u64,
        #[serde(deserialize_with = "deserialize_i128")]
        bid: Fixed,
        #[serde(deserialize_with = "deserialize_i128")]
        ask: Fixed,
        #[serde(deserialize_with = "deserialize_i128")]
        max_bid_quantity: Fixed,
        #[serde(deserialize_with = "deserialize_i128")]
        max_ask_quantity: Fixed,
        valid_block: Option<BlockNumber>,
        valid_until_ns: TimestampNs,
    },
    /// Public builder/relay market telemetry. These observations describe builder-market
    /// pressure and delivered payloads; they are not labels for Suwappu submissions.
    BuilderTrace {
        builder: String,
        opportunity_id: String,
        #[serde(deserialize_with = "deserialize_u128")]
        bid_wei: u128,
        simulated: bool,
        included: bool,
        failure: Option<String>,
    },
    /// A Suwappu bundle/order submitted to one builder. This is the feature-side record
    /// used by the builder inclusion model.
    BuilderSubmission {
        builder: String,
        opportunity_id: String,
        slot: u64,
        #[serde(deserialize_with = "deserialize_u128")]
        builder_payment_wei: u128,
        #[serde(deserialize_with = "deserialize_u128")]
        profit_before_bid_wei: u128,
        opportunity_created_ts_ns: TimestampNs,
        slot_phase_ms: u32,
        simulation_confidence_bps: u16,
        replace_sequence: Option<u64>,
    },
    /// Terminal or observed outcome for a previously submitted Suwappu opportunity.
    BuilderOutcome {
        builder: String,
        opportunity_id: String,
        slot: u64,
        included: bool,
        failure: Option<String>,
    },
    ExecutionAttempt {
        opportunity_id: String,
        strategy_id: String,
        #[serde(deserialize_with = "deserialize_i128")]
        gross_pnl: Fixed,
        gas_used: Option<u64>,
        calldata_bytes: u32,
        success: bool,
    },
    InventorySnapshot {
        asset: String,
        #[serde(deserialize_with = "deserialize_i128")]
        amount: Fixed,
    },
    CapitalState {
        asset: String,
        #[serde(deserialize_with = "deserialize_i128")]
        hot: Fixed,
        #[serde(deserialize_with = "deserialize_i128")]
        warm: Fixed,
        #[serde(deserialize_with = "deserialize_i128")]
        cold: Fixed,
        #[serde(deserialize_with = "deserialize_i128")]
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

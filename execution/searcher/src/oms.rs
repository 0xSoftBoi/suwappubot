use crate::events::{EventEnvelope, EventId, MarketEvent, SourceId};
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OrderState {
    New,
    Submitted,
    Live,
    ReplacePending,
    Replaced,
    CancelPending,
    Landed,
    Reverted,
    Expired,
    Dropped,
}

impl OrderState {
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Landed | Self::Reverted | Self::Expired | Self::Dropped)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SubmissionRequest {
    pub builder: String,
    pub opportunity_id: String,
    pub slot: u64,
    pub builder_payment_wei: u128,
    pub profit_before_bid_wei: u128,
    pub opportunity_created_ts_ns: u64,
    pub submit_ts_ns: u64,
    pub slot_phase_ms: u32,
    pub simulation_confidence_bps: u16,
    pub replace_sequence: u64,
    pub signed_transactions: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CancelRequest {
    pub builder: String,
    pub opportunity_id: String,
    pub slot: u64,
    pub replace_sequence: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransportAck {
    pub submission_id: String,
}

pub trait BuilderTransport {
    type Error: std::error::Error + Send + Sync + 'static;

    fn submit(&mut self, request: &SubmissionRequest) -> Result<TransportAck, Self::Error>;
    fn cancel(&mut self, request: &CancelRequest) -> Result<(), Self::Error>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedOrder {
    pub builder: String,
    pub opportunity_id: String,
    pub slot: u64,
    pub state: OrderState,
    pub replace_sequence: u64,
    pub builder_payment_wei: u128,
    pub profit_before_bid_wei: u128,
    pub opportunity_created_ts_ns: u64,
    pub last_submit_ts_ns: u64,
    pub slot_phase_ms: u32,
    pub simulation_confidence_bps: u16,
    pub submission_id: Option<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum OmsError {
    #[error("order already exists")]
    AlreadyExists,
    #[error("order not found")]
    NotFound,
    #[error("order is already terminal")]
    Terminal,
    #[error("replacement sequence must strictly increase")]
    NonMonotonicReplacement,
    #[error("replacement cannot change builder, opportunity, or slot")]
    ReplacementIdentityMismatch,
    #[error("outcome slot does not match submission slot")]
    OutcomeSlotMismatch,
    #[error("simulation confidence exceeds 10000 bps")]
    InvalidSimulationConfidence,
    #[error("builder payment exceeds profit before bid")]
    PaymentExceedsProfit,
    #[error("submission timestamp precedes opportunity creation")]
    InvalidTimestamp,
    #[error("transport error: {0}")]
    Transport(String),
}

#[derive(Default)]
pub struct BuilderOms {
    orders: BTreeMap<(String, String), ManagedOrder>,
}

impl BuilderOms {
    #[must_use]
    pub fn order(&self, builder: &str, opportunity_id: &str) -> Option<&ManagedOrder> {
        self.orders
            .get(&(builder.to_owned(), opportunity_id.to_owned()))
    }

    pub fn submit<T: BuilderTransport>(
        &mut self,
        transport: &mut T,
        request: SubmissionRequest,
    ) -> Result<EventEnvelope, OmsError> {
        validate_request(&request)?;
        let key = (request.builder.clone(), request.opportunity_id.clone());
        if self.orders.contains_key(&key) {
            return Err(OmsError::AlreadyExists);
        }

        let ack = transport
            .submit(&request)
            .map_err(|error| OmsError::Transport(error.to_string()))?;
        self.orders.insert(
            key,
            ManagedOrder {
                builder: request.builder.clone(),
                opportunity_id: request.opportunity_id.clone(),
                slot: request.slot,
                state: OrderState::Live,
                replace_sequence: request.replace_sequence,
                builder_payment_wei: request.builder_payment_wei,
                profit_before_bid_wei: request.profit_before_bid_wei,
                opportunity_created_ts_ns: request.opportunity_created_ts_ns,
                last_submit_ts_ns: request.submit_ts_ns,
                slot_phase_ms: request.slot_phase_ms,
                simulation_confidence_bps: request.simulation_confidence_bps,
                submission_id: Some(ack.submission_id),
            },
        );

        Ok(submission_event(&request))
    }

    pub fn replace<T: BuilderTransport>(
        &mut self,
        transport: &mut T,
        request: SubmissionRequest,
    ) -> Result<EventEnvelope, OmsError> {
        validate_request(&request)?;
        let key = (request.builder.clone(), request.opportunity_id.clone());
        let current = self.orders.get(&key).ok_or(OmsError::NotFound)?;
        if current.state.is_terminal() {
            return Err(OmsError::Terminal);
        }
        if current.slot != request.slot {
            return Err(OmsError::ReplacementIdentityMismatch);
        }
        if request.replace_sequence <= current.replace_sequence {
            return Err(OmsError::NonMonotonicReplacement);
        }

        let previous_state = current.state;
        let previous_sequence = current.replace_sequence;
        if let Some(order) = self.orders.get_mut(&key) {
            order.state = OrderState::ReplacePending;
        }

        let ack = match transport.submit(&request) {
            Ok(ack) => ack,
            Err(error) => {
                if let Some(order) = self.orders.get_mut(&key) {
                    order.state = previous_state;
                    order.replace_sequence = previous_sequence;
                }
                return Err(OmsError::Transport(error.to_string()));
            }
        };

        let order = self.orders.get_mut(&key).ok_or(OmsError::NotFound)?;
        order.state = OrderState::Replaced;
        order.replace_sequence = request.replace_sequence;
        order.builder_payment_wei = request.builder_payment_wei;
        order.profit_before_bid_wei = request.profit_before_bid_wei;
        order.last_submit_ts_ns = request.submit_ts_ns;
        order.slot_phase_ms = request.slot_phase_ms;
        order.simulation_confidence_bps = request.simulation_confidence_bps;
        order.submission_id = Some(ack.submission_id);
        order.state = OrderState::Live;

        Ok(submission_event(&request))
    }

    pub fn cancel<T: BuilderTransport>(
        &mut self,
        transport: &mut T,
        builder: &str,
        opportunity_id: &str,
    ) -> Result<(), OmsError> {
        let key = (builder.to_owned(), opportunity_id.to_owned());
        let current = self.orders.get(&key).ok_or(OmsError::NotFound)?;
        if current.state.is_terminal() {
            return Err(OmsError::Terminal);
        }
        let request = CancelRequest {
            builder: current.builder.clone(),
            opportunity_id: current.opportunity_id.clone(),
            slot: current.slot,
            replace_sequence: current.replace_sequence,
        };
        let previous_state = current.state;
        if let Some(order) = self.orders.get_mut(&key) {
            order.state = OrderState::CancelPending;
        }
        if let Err(error) = transport.cancel(&request) {
            if let Some(order) = self.orders.get_mut(&key) {
                order.state = previous_state;
            }
            return Err(OmsError::Transport(error.to_string()));
        }
        if let Some(order) = self.orders.get_mut(&key) {
            order.state = OrderState::Dropped;
        }
        Ok(())
    }

    pub fn observe_outcome(
        &mut self,
        builder: &str,
        opportunity_id: &str,
        slot: u64,
        included: bool,
        failure: Option<String>,
        observed_ts_ns: u64,
    ) -> Result<EventEnvelope, OmsError> {
        let key = (builder.to_owned(), opportunity_id.to_owned());
        let order = self.orders.get_mut(&key).ok_or(OmsError::NotFound)?;
        if order.state.is_terminal() {
            return Err(OmsError::Terminal);
        }
        if order.slot != slot {
            return Err(OmsError::OutcomeSlotMismatch);
        }
        order.state = if included {
            OrderState::Landed
        } else {
            OrderState::Reverted
        };

        Ok(EventEnvelope {
            schema_version: 1,
            event_id: EventId(format!(
                "oms:outcome:{builder}:{opportunity_id}:{slot}:{}",
                u8::from(included)
            )),
            source: SourceId("suwappu:oms".into()),
            exchange_ts_ns: observed_ts_ns,
            receive_ts_ns: observed_ts_ns,
            sequence: None,
            clock_uncertainty_ns: 0,
            chain: None,
            payload: MarketEvent::BuilderOutcome {
                builder: builder.to_owned(),
                opportunity_id: opportunity_id.to_owned(),
                slot,
                included,
                failure,
            },
        })
    }

    pub fn expire(
        &mut self,
        builder: &str,
        opportunity_id: &str,
        observed_ts_ns: u64,
    ) -> Result<EventEnvelope, OmsError> {
        let key = (builder.to_owned(), opportunity_id.to_owned());
        let order = self.orders.get_mut(&key).ok_or(OmsError::NotFound)?;
        if order.state.is_terminal() {
            return Err(OmsError::Terminal);
        }
        order.state = OrderState::Expired;
        Ok(EventEnvelope {
            schema_version: 1,
            event_id: EventId(format!(
                "oms:outcome:{builder}:{opportunity_id}:{}:expired",
                order.slot
            )),
            source: SourceId("suwappu:oms".into()),
            exchange_ts_ns: observed_ts_ns,
            receive_ts_ns: observed_ts_ns,
            sequence: None,
            clock_uncertainty_ns: 0,
            chain: None,
            payload: MarketEvent::BuilderOutcome {
                builder: builder.to_owned(),
                opportunity_id: opportunity_id.to_owned(),
                slot: order.slot,
                included: false,
                failure: Some("expired".into()),
            },
        })
    }
}

fn validate_request(request: &SubmissionRequest) -> Result<(), OmsError> {
    if request.simulation_confidence_bps > 10_000 {
        return Err(OmsError::InvalidSimulationConfidence);
    }
    if request.builder_payment_wei > request.profit_before_bid_wei {
        return Err(OmsError::PaymentExceedsProfit);
    }
    if request.submit_ts_ns < request.opportunity_created_ts_ns {
        return Err(OmsError::InvalidTimestamp);
    }
    Ok(())
}

fn submission_event(request: &SubmissionRequest) -> EventEnvelope {
    EventEnvelope {
        schema_version: 1,
        event_id: EventId(format!(
            "oms:submission:{}:{}:{}:{}",
            request.builder, request.opportunity_id, request.slot, request.replace_sequence
        )),
        source: SourceId("suwappu:oms".into()),
        exchange_ts_ns: request.submit_ts_ns,
        receive_ts_ns: request.submit_ts_ns,
        sequence: None,
        clock_uncertainty_ns: 0,
        chain: None,
        payload: MarketEvent::BuilderSubmission {
            builder: request.builder.clone(),
            opportunity_id: request.opportunity_id.clone(),
            slot: request.slot,
            builder_payment_wei: request.builder_payment_wei,
            profit_before_bid_wei: request.profit_before_bid_wei,
            opportunity_created_ts_ns: request.opportunity_created_ts_ns,
            slot_phase_ms: request.slot_phase_ms,
            simulation_confidence_bps: request.simulation_confidence_bps,
            replace_sequence: Some(request.replace_sequence),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt;

    #[derive(Debug)]
    struct MockTransportError;

    impl fmt::Display for MockTransportError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "transport failed")
        }
    }

    impl std::error::Error for MockTransportError {}

    #[derive(Default)]
    struct MockTransport {
        fail_submit: bool,
        fail_cancel: bool,
        submissions: Vec<SubmissionRequest>,
        cancellations: Vec<CancelRequest>,
    }

    impl BuilderTransport for MockTransport {
        type Error = MockTransportError;

        fn submit(&mut self, request: &SubmissionRequest) -> Result<TransportAck, Self::Error> {
            if self.fail_submit {
                return Err(MockTransportError);
            }
            self.submissions.push(request.clone());
            Ok(TransportAck {
                submission_id: format!("ack-{}", request.replace_sequence),
            })
        }

        fn cancel(&mut self, request: &CancelRequest) -> Result<(), Self::Error> {
            if self.fail_cancel {
                return Err(MockTransportError);
            }
            self.cancellations.push(request.clone());
            Ok(())
        }
    }

    fn request(sequence: u64, payment: u128) -> SubmissionRequest {
        SubmissionRequest {
            builder: "titan".into(),
            opportunity_id: "opp-1".into(),
            slot: 123,
            builder_payment_wei: payment,
            profit_before_bid_wei: 1_000,
            opportunity_created_ts_ns: 1_000_000,
            submit_ts_ns: 2_000_000 + sequence,
            slot_phase_ms: 2_000,
            simulation_confidence_bps: 9_900,
            replace_sequence: sequence,
            signed_transactions: vec!["0xabc".into()],
        }
    }

    #[test]
    fn submit_replace_land_produces_model_events() {
        let mut oms = BuilderOms::default();
        let mut transport = MockTransport::default();
        let first = oms.submit(&mut transport, request(1, 100)).unwrap();
        let second = oms.replace(&mut transport, request(2, 150)).unwrap();
        let outcome = oms
            .observe_outcome("titan", "opp-1", 123, true, None, 3_000_000)
            .unwrap();
        assert!(matches!(first.payload, MarketEvent::BuilderSubmission { .. }));
        assert!(matches!(second.payload, MarketEvent::BuilderSubmission { .. }));
        assert!(matches!(outcome.payload, MarketEvent::BuilderOutcome { included: true, .. }));
        assert_eq!(oms.order("titan", "opp-1").unwrap().state, OrderState::Landed);
        assert_eq!(transport.submissions.len(), 2);
    }

    #[test]
    fn replacement_sequence_is_monotonic() {
        let mut oms = BuilderOms::default();
        let mut transport = MockTransport::default();
        oms.submit(&mut transport, request(2, 100)).unwrap();
        assert_eq!(
            oms.replace(&mut transport, request(2, 150)).unwrap_err(),
            OmsError::NonMonotonicReplacement
        );
    }

    #[test]
    fn failed_replace_restores_live_state() {
        let mut oms = BuilderOms::default();
        let mut transport = MockTransport::default();
        oms.submit(&mut transport, request(1, 100)).unwrap();
        transport.fail_submit = true;
        assert!(matches!(
            oms.replace(&mut transport, request(2, 150)),
            Err(OmsError::Transport(_))
        ));
        let order = oms.order("titan", "opp-1").unwrap();
        assert_eq!(order.state, OrderState::Live);
        assert_eq!(order.replace_sequence, 1);
    }

    #[test]
    fn failed_cancel_restores_live_state() {
        let mut oms = BuilderOms::default();
        let mut transport = MockTransport::default();
        oms.submit(&mut transport, request(1, 100)).unwrap();
        transport.fail_cancel = true;
        assert!(matches!(
            oms.cancel(&mut transport, "titan", "opp-1"),
            Err(OmsError::Transport(_))
        ));
        assert_eq!(oms.order("titan", "opp-1").unwrap().state, OrderState::Live);
    }

    #[test]
    fn expiration_creates_terminal_negative_label() {
        let mut oms = BuilderOms::default();
        let mut transport = MockTransport::default();
        oms.submit(&mut transport, request(1, 100)).unwrap();
        let event = oms.expire("titan", "opp-1", 5_000_000).unwrap();
        assert!(matches!(
            event.payload,
            MarketEvent::BuilderOutcome {
                included: false,
                failure: Some(_),
                ..
            }
        ));
        assert_eq!(oms.order("titan", "opp-1").unwrap().state, OrderState::Expired);
    }

    #[test]
    fn invalid_economics_fail_before_transport() {
        let mut oms = BuilderOms::default();
        let mut transport = MockTransport::default();
        let mut bad = request(1, 1_001);
        bad.profit_before_bid_wei = 1_000;
        assert_eq!(oms.submit(&mut transport, bad).unwrap_err(), OmsError::PaymentExceedsProfit);
        assert!(transport.submissions.is_empty());
    }
}

use crate::oms::{BuilderTransport, CancelRequest, SubmissionRequest, TransportAck};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fmt;

pub trait JsonRpcSender {
    fn send(&mut self, request: Value) -> Result<Value, TitanRpcError>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TitanRpcError(pub String);

impl fmt::Display for TitanRpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for TitanRpcError {}

pub struct TitanBuilderTransport<S> {
    sender: S,
    target_block_by_slot: BTreeMap<u64, u64>,
    request_id: u64,
}

impl<S> TitanBuilderTransport<S> {
    #[must_use]
    pub fn new(sender: S) -> Self {
        Self {
            sender,
            target_block_by_slot: BTreeMap::new(),
            request_id: 1,
        }
    }

    pub fn set_target_block(&mut self, slot: u64, block_number: u64) {
        self.target_block_by_slot.insert(slot, block_number);
    }

    #[must_use]
    pub fn into_inner(self) -> S {
        self.sender
    }
}

impl<S: JsonRpcSender> BuilderTransport for TitanBuilderTransport<S> {
    type Error = TitanRpcError;

    fn submit(&mut self, request: &SubmissionRequest) -> Result<TransportAck, Self::Error> {
        let block_number = self
            .target_block_by_slot
            .get(&request.slot)
            .copied()
            .ok_or_else(|| {
                TitanRpcError(format!(
                    "missing target execution block for slot {}",
                    request.slot
                ))
            })?;
        let replacement_uuid = replacement_uuid(&request.builder, &request.opportunity_id);
        let rpc = json!({
            "jsonrpc": "2.0",
            "id": self.next_id(),
            "method": "eth_sendBundle",
            "params": [{
                "txs": request.signed_transactions.clone(),
                "blockNumber": format!("0x{block_number:x}"),
                "replacementUuid": replacement_uuid
            }]
        });
        let response = self.sender.send(rpc)?;
        parse_submit_response(response)
    }

    fn cancel(&mut self, request: &CancelRequest) -> Result<(), Self::Error> {
        let replacement_uuid = replacement_uuid(&request.builder, &request.opportunity_id);
        let rpc = json!({
            "jsonrpc": "2.0",
            "id": self.next_id(),
            "method": "eth_cancelBundle",
            "params": [{"replacementUuid": replacement_uuid}]
        });
        let response = self.sender.send(rpc)?;
        parse_cancel_response(response)
    }
}

impl<S> TitanBuilderTransport<S> {
    fn next_id(&mut self) -> u64 {
        let id = self.request_id;
        self.request_id = self.request_id.saturating_add(1);
        id
    }
}

#[must_use]
pub fn replacement_uuid(builder: &str, opportunity_id: &str) -> String {
    let digest = blake3::hash(format!("suwappu:{builder}:{opportunity_id}").as_bytes());
    let hex = digest.to_hex().to_string();
    hex[..32].to_owned()
}

fn parse_submit_response(response: Value) -> Result<TransportAck, TitanRpcError> {
    if let Some(error) = response.get("error").filter(|value| !value.is_null()) {
        return Err(TitanRpcError(format!(
            "Titan eth_sendBundle error: {error}"
        )));
    }
    let result = response
        .get("result")
        .ok_or_else(|| TitanRpcError("Titan eth_sendBundle response missing result".into()))?;
    let submission_id = match result {
        Value::String(value) => value.clone(),
        other => other.to_string(),
    };
    Ok(TransportAck { submission_id })
}

fn parse_cancel_response(response: Value) -> Result<(), TitanRpcError> {
    if let Some(error) = response.get("error").filter(|value| !value.is_null()) {
        return Err(TitanRpcError(format!(
            "Titan eth_cancelBundle error: {error}"
        )));
    }
    if response.get("result").is_none() {
        return Err(TitanRpcError(
            "Titan eth_cancelBundle response missing result".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oms::{BuilderOms, SubmissionRequest};

    #[derive(Default)]
    struct RecordingSender {
        requests: Vec<Value>,
        responses: Vec<Value>,
    }

    impl JsonRpcSender for RecordingSender {
        fn send(&mut self, request: Value) -> Result<Value, TitanRpcError> {
            self.requests.push(request);
            if self.responses.is_empty() {
                return Err(TitanRpcError("no fixture response".into()));
            }
            Ok(self.responses.remove(0))
        }
    }

    fn request(sequence: u64) -> SubmissionRequest {
        SubmissionRequest {
            builder: "titan".into(),
            opportunity_id: "opp-1".into(),
            slot: 14_000_000,
            builder_payment_wei: 100,
            profit_before_bid_wei: 1_000,
            opportunity_created_ts_ns: 1,
            submit_ts_ns: 2,
            slot_phase_ms: 2_000,
            simulation_confidence_bps: 9_900,
            replace_sequence: sequence,
            signed_transactions: vec!["0xabc".into(), "0xdef".into()],
        }
    }

    #[test]
    fn submit_uses_titan_bundle_wire_shape() {
        let sender = RecordingSender {
            responses: vec![json!({"jsonrpc":"2.0","id":1,"result":"0xbundle","error":null})],
            ..Default::default()
        };
        let mut transport = TitanBuilderTransport::new(sender);
        transport.set_target_block(14_000_000, 24_800_000);
        let mut oms = BuilderOms::default();
        oms.submit(&mut transport, request(1)).unwrap();
        let sender = transport.into_inner();
        let rpc = &sender.requests[0];
        assert_eq!(rpc["method"], "eth_sendBundle");
        assert_eq!(rpc["params"][0]["blockNumber"], "0x17a7840");
        assert_eq!(rpc["params"][0]["txs"][1], "0xdef");
        assert_eq!(
            rpc["params"][0]["replacementUuid"],
            replacement_uuid("titan", "opp-1")
        );
    }

    #[test]
    fn cancel_reuses_same_replacement_uuid() {
        let sender = RecordingSender {
            responses: vec![
                json!({"jsonrpc":"2.0","id":1,"result":"0xbundle","error":null}),
                json!({"jsonrpc":"2.0","id":2,"result":200,"error":null}),
            ],
            ..Default::default()
        };
        let mut transport = TitanBuilderTransport::new(sender);
        transport.set_target_block(14_000_000, 24_800_000);
        let mut oms = BuilderOms::default();
        oms.submit(&mut transport, request(1)).unwrap();
        oms.cancel(&mut transport, "titan", "opp-1").unwrap();
        let sender = transport.into_inner();
        assert_eq!(sender.requests[1]["method"], "eth_cancelBundle");
        assert_eq!(
            sender.requests[0]["params"][0]["replacementUuid"],
            sender.requests[1]["params"][0]["replacementUuid"]
        );
    }

    #[test]
    fn missing_slot_to_block_mapping_fails_closed() {
        let sender = RecordingSender {
            responses: vec![json!({"result":"0xbundle"})],
            ..Default::default()
        };
        let mut transport = TitanBuilderTransport::new(sender);
        let mut oms = BuilderOms::default();
        assert!(matches!(
            oms.submit(&mut transport, request(1)),
            Err(crate::oms::OmsError::Transport(_))
        ));
    }
}

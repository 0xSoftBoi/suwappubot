use suwappu_execution_searcher::builder::{normalize_relay_trace, RelayBidTrace, RelayTraceKind};
use suwappu_execution_searcher::events::MarketEvent;

#[test]
fn frozen_live_titan_deliveries_normalize_as_included() {
    let raw = include_str!("../fixtures/titan_delivered_payloads_2026-08-21.json");
    let traces: Vec<RelayBidTrace> = serde_json::from_str(raw).unwrap();
    assert_eq!(traces.len(), 3);

    for trace in traces {
        let event = normalize_relay_trace(
            "titan:data:delivered",
            RelayTraceKind::PayloadDelivered,
            trace,
            1_776_000_000_000_000_000,
        )
        .unwrap();

        match event.payload {
            MarketEvent::BuilderTrace { included, bid_wei, .. } => {
                assert!(included);
                assert!(bid_wei > 0);
            }
            other => panic!("expected builder trace, got {other:?}"),
        }
    }
}

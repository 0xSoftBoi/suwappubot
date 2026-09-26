use suwappu_execution_searcher::economics::fill_economics;
use suwappu_execution_searcher::events::{MarketEvent, Side};
use suwappu_execution_searcher::labels::{
    label_standard_horizons, FillForLabeling, LabelValue, MissingLabelReason, StandardHorizon,
};
use suwappu_execution_searcher::markout::FairValuePoint;
use suwappu_execution_searcher::replay::{parse_jsonl, replay};
use suwappu_execution_searcher::FIXED_SCALE;

const FIXTURE: &str = include_str!("../fixtures/replay_events.jsonl");

#[test]
fn persisted_fixture_replays_deterministically_and_labels_fill() {
    let events = parse_jsonl(FIXTURE).unwrap();
    let forward = replay(events.clone()).unwrap();
    let reverse = replay(events.into_iter().rev()).unwrap();

    assert_eq!(forward.digest_hex, reverse.digest_hex);
    assert!(forward.sequence_anomalies.is_empty());
    assert_eq!(forward.events.len(), 4);

    let fair_values: Vec<_> = forward
        .events
        .iter()
        .filter_map(|event| match &event.payload {
            MarketEvent::FairValue { price, .. } => Some(FairValuePoint {
                ts_ns: event.exchange_ts_ns,
                block_number: event.chain.as_ref().map(|chain| chain.block_number),
                price: *price,
            }),
            _ => None,
        })
        .collect();

    let fill = forward
        .events
        .iter()
        .find_map(|event| match &event.payload {
            MarketEvent::Fill {
                side,
                price,
                quantity,
                ..
            } => Some((event, *side, *price, *quantity)),
            _ => None,
        })
        .unwrap();

    let labels = label_standard_horizons(
        &fair_values,
        FillForLabeling {
            ts_ns: fill.0.exchange_ts_ns,
            block_number: fill.0.chain.as_ref().map(|chain| chain.block_number),
            price: fill.2,
            maker_side: fill.1,
        },
        90_000_000,
    );

    assert_eq!(labels.len(), 6);
    assert_eq!(labels[0].horizon, StandardHorizon::Ms10);
    assert!(matches!(labels[0].value, LabelValue::Present(_)));
    assert_eq!(labels[4].horizon, StandardHorizon::Block1);
    assert!(matches!(labels[4].value, LabelValue::Present(_)));
    assert_eq!(labels[5].horizon, StandardHorizon::Block5);
    assert_eq!(
        labels[5].value,
        LabelValue::Missing(MissingLabelReason::NoSample)
    );

    let p = FIXED_SCALE;
    let economics = fill_economics(Side::Sell, fill.3, fill.2, 100 * p, 102 * p).unwrap();
    assert_eq!(economics.spread_capture_quote, 10 * p);
    assert_eq!(economics.post_fill_fair_move_pnl_quote, -20 * p);
    assert_eq!(economics.lvr_proxy_quote, 20 * p);
    assert_eq!(economics.net_edge_quote, -10 * p);
}

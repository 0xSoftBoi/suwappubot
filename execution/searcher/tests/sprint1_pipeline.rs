use suwappu_execution_searcher::cost::{
    execution_cost, CostCoefficients, ExecutionShape, RouteEconomics,
};
use suwappu_execution_searcher::economics::fill_economics;
use suwappu_execution_searcher::events::{Side, VenueId};
use suwappu_execution_searcher::graph::{AssetId, EdgeId, RouteGraph, VenueEdge};
use suwappu_execution_searcher::sizing::{optimize_profitable_grid, SizeSearch};
use suwappu_execution_searcher::FIXED_SCALE;

#[test]
fn gas_aware_sizing_prefers_realized_ev_not_gross_edge() {
    let p = FIXED_SCALE;
    let cheap_shape = ExecutionShape {
        gas_units: 100_000,
        calldata_bytes: 100,
        external_calls: 2,
        token_transfers: 2,
    };
    let expensive_shape = ExecutionShape {
        gas_units: 300_000,
        calldata_bytes: 800,
        external_calls: 6,
        token_transfers: 6,
    };
    let costs = CostCoefficients {
        quote_per_gas_unit: p / 100_000,
        quote_per_calldata_byte: p / 1_000,
        quote_per_external_call: p / 10,
        quote_per_token_transfer: p / 20,
    };
    let cheap_cost = execution_cost(cheap_shape, costs).unwrap();
    let expensive_cost = execution_cost(expensive_shape, costs).unwrap();
    assert!(expensive_cost > cheap_cost);

    // Expensive route has better gross edge at every size, but worse realized EV after
    // execution resources. This is the core Sprint 1 routing invariant.
    let cheap = optimize_profitable_grid(
        SizeSearch {
            min_input: 1,
            max_input: 10,
            step: 1,
        },
        10,
        |x| {
            RouteEconomics {
                gross_pnl_quote: (20 + 5 * x - x * x / 4) * p,
                execution_cost_quote: cheap_cost,
                ..RouteEconomics::default()
            }
            .net_pnl_quote()
            .ok()
        },
    )
    .unwrap()
    .unwrap();

    let expensive = optimize_profitable_grid(
        SizeSearch {
            min_input: 1,
            max_input: 10,
            step: 1,
        },
        10,
        |x| {
            RouteEconomics {
                gross_pnl_quote: (22 + 5 * x - x * x / 4) * p,
                execution_cost_quote: expensive_cost,
                ..RouteEconomics::default()
            }
            .net_pnl_quote()
            .ok()
        },
    )
    .unwrap()
    .unwrap();

    assert!(cheap.net_pnl_quote > expensive.net_pnl_quote);
}

#[test]
fn fill_toxicity_and_route_freshness_are_fail_closed_inputs() {
    let p = FIXED_SCALE;
    let fill = fill_economics(Side::Sell, 10 * p, 101 * p, 100 * p, 102 * p).unwrap();
    assert_eq!(fill.lvr_proxy_quote, 20 * p);
    assert_eq!(fill.net_edge_quote, -10 * p);

    let mut graph = RouteGraph::default();
    let id = EdgeId("pamm-usdc-weth".into());
    let edge = |version| VenueEdge {
        id: id.clone(),
        venue: VenueId("titan-pamm".into()),
        from: AssetId("USDC".into()),
        to: AssetId("WETH".into()),
        state_version: version,
        fixed_activation_cost_quote: 0,
        min_input: p,
        max_input: 1_000_000 * p,
    };

    graph.upsert_edge(edge(1)).unwrap();
    let route = graph.snapshot(std::slice::from_ref(&id)).unwrap();
    assert!(graph.is_fresh(&route));
    graph.upsert_edge(edge(2)).unwrap();
    assert!(!graph.is_fresh(&route));
}

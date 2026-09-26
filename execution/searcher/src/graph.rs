use crate::events::{Fixed, VenueId};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AssetId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct EdgeId(pub String);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VenueEdge {
    pub id: EdgeId,
    pub venue: VenueId,
    pub from: AssetId,
    pub to: AssetId,
    pub state_version: u64,
    pub fixed_activation_cost_quote: Fixed,
    pub min_input: Fixed,
    pub max_input: Fixed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteSnapshot {
    pub edges: Vec<(EdgeId, u64)>,
}

#[derive(Clone, Debug, Default)]
pub struct RouteGraph {
    edges: BTreeMap<EdgeId, VenueEdge>,
    outgoing: BTreeMap<AssetId, BTreeSet<EdgeId>>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GraphError {
    #[error("edge has invalid input bounds")]
    InvalidBounds,
    #[error("edge activation cost cannot be negative")]
    NegativeActivationCost,
    #[error("edge version must strictly increase on update")]
    StaleVersion,
    #[error("unknown edge")]
    UnknownEdge,
    #[error("maximum route depth must be positive")]
    InvalidDepth,
}

impl RouteGraph {
    pub fn upsert_edge(&mut self, edge: VenueEdge) -> Result<BTreeSet<AssetId>, GraphError> {
        if edge.min_input < 0 || edge.max_input < edge.min_input {
            return Err(GraphError::InvalidBounds);
        }
        if edge.fixed_activation_cost_quote < 0 {
            return Err(GraphError::NegativeActivationCost);
        }

        let mut affected = BTreeSet::from([edge.from.clone(), edge.to.clone()]);
        if let Some(previous) = self.edges.get(&edge.id) {
            if edge.state_version <= previous.state_version {
                return Err(GraphError::StaleVersion);
            }
            affected.insert(previous.from.clone());
            affected.insert(previous.to.clone());
            if let Some(set) = self.outgoing.get_mut(&previous.from) {
                set.remove(&edge.id);
            }
        }

        self.outgoing
            .entry(edge.from.clone())
            .or_default()
            .insert(edge.id.clone());
        self.edges.insert(edge.id.clone(), edge);
        Ok(affected)
    }

    pub fn edge(&self, id: &EdgeId) -> Option<&VenueEdge> {
        self.edges.get(id)
    }

    pub fn outgoing(&self, asset: &AssetId) -> impl Iterator<Item = &VenueEdge> {
        self.outgoing
            .get(asset)
            .into_iter()
            .flat_map(|ids| ids.iter())
            .filter_map(|id| self.edges.get(id))
    }

    /// Enumerate deterministic simple routes up to `max_hops`.
    ///
    /// For `start == goal`, returning to the start is allowed only as the terminal hop,
    /// which makes this suitable for bounded arbitrage-cycle fixtures without admitting
    /// arbitrary repeated-asset loops.
    pub fn enumerate_simple_paths(
        &self,
        start: &AssetId,
        goal: &AssetId,
        max_hops: usize,
    ) -> Result<Vec<Vec<EdgeId>>, GraphError> {
        if max_hops == 0 {
            return Err(GraphError::InvalidDepth);
        }
        let mut routes = Vec::new();
        let mut path = Vec::new();
        let mut visited = BTreeSet::from([start.clone()]);
        self.walk_paths(start, goal, max_hops, &mut visited, &mut path, &mut routes);
        Ok(routes)
    }

    pub fn snapshot(&self, route: &[EdgeId]) -> Result<RouteSnapshot, GraphError> {
        let edges = route
            .iter()
            .map(|id| {
                self.edges
                    .get(id)
                    .map(|edge| (id.clone(), edge.state_version))
                    .ok_or(GraphError::UnknownEdge)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(RouteSnapshot { edges })
    }

    #[must_use]
    pub fn is_fresh(&self, snapshot: &RouteSnapshot) -> bool {
        snapshot.edges.iter().all(|(id, version)| {
            self.edges
                .get(id)
                .is_some_and(|edge| edge.state_version == *version)
        })
    }

    #[must_use]
    pub fn route_contains_edge(route: &[EdgeId], edge_id: &EdgeId) -> bool {
        route.iter().any(|id| id == edge_id)
    }

    fn walk_paths(
        &self,
        current: &AssetId,
        goal: &AssetId,
        max_hops: usize,
        visited: &mut BTreeSet<AssetId>,
        path: &mut Vec<EdgeId>,
        routes: &mut Vec<Vec<EdgeId>>,
    ) {
        if path.len() >= max_hops {
            return;
        }

        let edges: Vec<_> = self.outgoing(current).cloned().collect();
        for edge in edges {
            path.push(edge.id.clone());
            if &edge.to == goal {
                routes.push(path.clone());
            } else if path.len() < max_hops && !visited.contains(&edge.to) {
                visited.insert(edge.to.clone());
                self.walk_paths(&edge.to, goal, max_hops, visited, path, routes);
                visited.remove(&edge.to);
            }
            path.pop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edge(version: u64) -> VenueEdge {
        VenueEdge {
            id: EdgeId("uni-usdc-weth".into()),
            venue: VenueId("uniswap-v4".into()),
            from: AssetId("USDC".into()),
            to: AssetId("WETH".into()),
            state_version: version,
            fixed_activation_cost_quote: 0,
            min_input: 1,
            max_input: 1_000_000,
        }
    }

    fn route_edge(id: &str, from: &str, to: &str, version: u64) -> VenueEdge {
        VenueEdge {
            id: EdgeId(id.into()),
            venue: VenueId(id.into()),
            from: AssetId(from.into()),
            to: AssetId(to.into()),
            state_version: version,
            fixed_activation_cost_quote: 0,
            min_input: 1,
            max_input: 1_000_000,
        }
    }

    #[test]
    fn updating_one_edge_invalidates_routes_that_reference_it() {
        let mut graph = RouteGraph::default();
        graph.upsert_edge(edge(1)).unwrap();
        let snapshot = graph.snapshot(&[EdgeId("uni-usdc-weth".into())]).unwrap();
        assert!(graph.is_fresh(&snapshot));
        graph.upsert_edge(edge(2)).unwrap();
        assert!(!graph.is_fresh(&snapshot));
    }

    #[test]
    fn stale_edge_versions_fail_closed() {
        let mut graph = RouteGraph::default();
        graph.upsert_edge(edge(2)).unwrap();
        assert_eq!(
            graph.upsert_edge(edge(2)).unwrap_err(),
            GraphError::StaleVersion
        );
        assert_eq!(
            graph.upsert_edge(edge(1)).unwrap_err(),
            GraphError::StaleVersion
        );
    }

    #[test]
    fn affected_assets_are_local_to_changed_edge() {
        let mut graph = RouteGraph::default();
        let affected = graph.upsert_edge(edge(1)).unwrap();
        assert_eq!(
            affected,
            BTreeSet::from([AssetId("USDC".into()), AssetId("WETH".into())])
        );
    }

    #[test]
    fn cycle_enumeration_is_deterministic_and_bounded() {
        let mut graph = RouteGraph::default();
        graph
            .upsert_edge(route_edge("a", "USDC", "WETH", 1))
            .unwrap();
        graph
            .upsert_edge(route_edge("b", "WETH", "USDC", 1))
            .unwrap();
        graph
            .upsert_edge(route_edge("c", "USDC", "DAI", 1))
            .unwrap();
        graph
            .upsert_edge(route_edge("d", "DAI", "USDC", 1))
            .unwrap();

        let routes = graph
            .enumerate_simple_paths(&AssetId("USDC".into()), &AssetId("USDC".into()), 2)
            .unwrap();
        assert_eq!(
            routes,
            vec![
                vec![EdgeId("a".into()), EdgeId("b".into())],
                vec![EdgeId("c".into()), EdgeId("d".into())],
            ]
        );
    }

    #[test]
    fn incremental_staleness_matches_full_route_membership() {
        let mut graph = RouteGraph::default();
        for edge in [
            route_edge("a", "USDC", "WETH", 1),
            route_edge("b", "WETH", "USDC", 1),
            route_edge("c", "USDC", "DAI", 1),
            route_edge("d", "DAI", "USDC", 1),
        ] {
            graph.upsert_edge(edge).unwrap();
        }
        let routes = graph
            .enumerate_simple_paths(&AssetId("USDC".into()), &AssetId("USDC".into()), 2)
            .unwrap();
        let snapshots = routes
            .iter()
            .map(|route| graph.snapshot(route).unwrap())
            .collect::<Vec<_>>();

        let changed = EdgeId("a".into());
        graph
            .upsert_edge(route_edge("a", "USDC", "WETH", 2))
            .unwrap();

        for (route, snapshot) in routes.iter().zip(&snapshots) {
            assert_eq!(
                !graph.is_fresh(snapshot),
                RouteGraph::route_contains_edge(route, &changed)
            );
        }

        let recomputed = graph
            .enumerate_simple_paths(&AssetId("USDC".into()), &AssetId("USDC".into()), 2)
            .unwrap();
        assert_eq!(routes, recomputed);
    }
}

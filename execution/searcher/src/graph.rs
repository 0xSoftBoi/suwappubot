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
        assert_eq!(graph.upsert_edge(edge(2)).unwrap_err(), GraphError::StaleVersion);
        assert_eq!(graph.upsert_edge(edge(1)).unwrap_err(), GraphError::StaleVersion);
    }

    #[test]
    fn affected_assets_are_local_to_changed_edge() {
        let mut graph = RouteGraph::default();
        let affected = graph.upsert_edge(edge(1)).unwrap();
        assert_eq!(affected, BTreeSet::from([AssetId("USDC".into()), AssetId("WETH".into())]));
    }
}

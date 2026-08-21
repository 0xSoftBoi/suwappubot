//! Quantitative measurement and route-economics substrate for Suwappu execution.
//!
//! The dependency order is intentional:
//! normalized events -> deterministic replay -> markouts/economics -> execution costs
//! -> versioned venue graph -> deterministic route sizing -> builder dataset -> inclusion/bid model.

pub mod builder;
pub mod builder_dataset;
pub mod builder_model;
pub mod cost;
pub mod economics;
pub mod events;
pub mod graph;
pub mod markout;
pub mod replay;
pub mod sizing;

pub const FIXED_SCALE: i128 = 1_000_000_000;
pub const BPS_SCALE: i128 = 10_000;

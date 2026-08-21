//! Quantitative measurement and route-economics substrate for Suwappu execution.
//!
//! The dependency order is intentional:
//! normalized events -> deterministic replay -> markouts/economics -> execution costs
//! -> versioned venue graph -> deterministic route sizing -> builder dataset -> inclusion/bid model
//! -> builder order-management lifecycle -> builder transport adapters -> policy evaluation
//! -> shared fair value -> toxicity -> maker risk gate -> pAMM quote control -> EIP-712 wire quote
//! -> capital + hedge control.

pub mod builder;
pub mod builder_dataset;
pub mod builder_eval;
pub mod builder_model;
pub mod capital;
pub mod cost;
pub mod economics;
pub mod events;
pub mod fair_value;
pub mod graph;
pub mod hedge;
pub mod labels;
pub mod maker;
pub mod markout;
pub mod oms;
pub mod pamm;
pub mod pamm_wire;
pub mod replay;
pub mod sizing;
pub mod titan_rpc;
pub mod toxicity;

pub const FIXED_SCALE: i128 = 1_000_000_000;
pub const BPS_SCALE: i128 = 10_000;

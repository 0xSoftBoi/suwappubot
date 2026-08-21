//! Quantitative measurement substrate for Suwappu maker/searcher execution.
//!
//! This crate intentionally starts with deterministic measurement rather than execution:
//! normalized events -> deterministic replay -> markouts -> per-fill economics.

pub mod economics;
pub mod events;
pub mod markout;
pub mod replay;

pub const FIXED_SCALE: i128 = 1_000_000_000;
pub const BPS_SCALE: i128 = 10_000;

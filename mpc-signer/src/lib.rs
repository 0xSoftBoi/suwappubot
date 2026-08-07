//! Suwappu's experimental native threshold signer.
//!
//! This crate intentionally implements the protocol state machines instead of
//! delegating them to an MPC/FROST library.  It still relies on audited-ish,
//! conventional primitive crates for curve arithmetic, hashing, entropy and
//! signature verification.  That distinction is important: owning the MPC
//! protocol does not mean reimplementing SHA-512 or Edwards arithmetic.
//!
//! Nothing in this crate is production-enabled yet.  In particular, the DKG
//! implemented here is the first joint-Feldman milestone and does not yet have
//! the complaint/recovery machinery required for a malicious-production DKG.

pub mod dkg;
pub mod frost_ed25519;
pub mod ledger;

/// This is a deliberately hard-coded safety claim, not a feature flag.
/// Production integration must refuse to activate while this is false.
pub const PRODUCTION_READY: bool = false;

/// The first DKG milestone verifies every distributed share, but does not yet
/// implement a fully analysed malicious DKG with complaints and recovery.
pub const MALICIOUS_DKG_READY: bool = false;

/// Threshold ECDSA is not implemented in this milestone.
pub const MALICIOUS_ECDSA_READY: bool = false;

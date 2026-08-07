//! Suwappu's experimental native threshold signer.
//!
//! This crate intentionally implements the protocol state machines instead of
//! delegating them to an MPC/FROST library. It still relies on audited-ish,
//! conventional primitive crates for curve/Paillier arithmetic, hashing,
//! entropy and signature verification. That distinction is important: owning
//! the MPC protocol does not mean reimplementing SHA-512 or big-integer math.
//!
//! Nothing in this crate is production-enabled yet. The Ed25519 DKG is still
//! the joint-Feldman milestone, while the secp256k1 path is being hardened
//! against the CGGMP24 construction one state boundary at a time.

pub mod cggmp_aux;
pub mod dkg;
pub mod ecdsa_cggmp;
pub mod frost_ed25519;
pub mod ledger;
pub mod secp256k1_dkg;

/// This is a deliberately hard-coded safety claim, not a feature flag.
/// Production integration must refuse to activate while this is false.
pub const PRODUCTION_READY: bool = false;

/// The first DKG milestone verifies every distributed share, but does not yet
/// implement a fully analysed malicious DKG with complaints and recovery.
pub const MALICIOUS_DKG_READY: bool = false;

/// The secp256k1 DKG, signing-set conversion, final ECDSA equations, and the
/// auxiliary-provisioning proof cores and reliable state transitions are
/// implemented, but authenticated wire transport and malicious presigning
/// proofs are not. There is deliberately no public way to manufacture a
/// presignature.
pub const MALICIOUS_ECDSA_READY: bool = false;

//! The quadratic-flow router's hot path (spec §5.4), in Rust.
//!
//! Scope is deliberately narrow: the active-set QP and the primitives it runs
//! once per pivot.  Everything above it -- candidate generation, calibration,
//! realisation, verification -- stays in Python, where it is still changing.
//! This is the part that is numerically settled and measured to dominate.
//!
//! It runs unchanged in CPython, in Pyodide, and in a bare Web Worker, which
//! is why there is no I/O, no threading, no clock and no BLAS anywhere in it.
//! See `README.md` for what each of those would break.

pub mod chol;
pub mod lu;
pub mod solve;

#[cfg(feature = "python")]
mod py;
pub mod calibrate;
pub mod seed;
pub mod cycles;
pub mod split;

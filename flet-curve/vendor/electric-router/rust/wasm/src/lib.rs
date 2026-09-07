//! The router's compiled half, as one wasm module.
//!
//! The Flet frontend runs Python in a Web Worker under Pyodide, which cannot
//! load a PyO3 wheel without matching Pyodide's own Emscripten ABI and a pyo3
//! that supports its CPython.  A wasm-bindgen module has neither constraint:
//! it is the same Rust, built for the browser's own target, and the Python
//! side reaches it through a shim that presents the PyO3 spelling -- so
//! `core/accel.py` and the transport never learn which one answered.
//!
//! Both halves are here rather than in two modules because they are loaded
//! together, and one instantiation is one fetch.

mod evm;
mod solve;

pub use evm::{BatchResult, CallResult, Evm, MissReport};
pub use solve::{
    calibrate, cancel_cycles, find_cycle, split_ascend, AscendResult, CalibrationOut,
    CycleResult, PathResult, Problem, SolveResult,
};

use wasm_bindgen::prelude::*;

/// Send a panic's message to the console before the trap takes the instance
/// down.  `panic = "abort"` is deliberate -- unwinding across the FFI is not
/// something to rely on -- so this is the only chance to say what happened,
/// and without it a bug reads as a bare `RuntimeError: unreachable`.
#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(|info| {
        error(&format!("erouter-wasm panicked: {info}"));
    }));
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn error(text: &str);
}

/// What the module is, so a shim can refuse a stale copy.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

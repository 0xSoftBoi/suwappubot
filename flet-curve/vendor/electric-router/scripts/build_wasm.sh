#!/bin/sh
# The browser half: one wasm module carrying the solver and the EVM.
#
# Needs rustup (the system rust-bin has no wasm32 std) and a wasm-bindgen CLI
# whose version *equals* the wasm-bindgen crate's -- it refuses a mismatch, so
# `rust/wasm/Cargo.toml` pins the crate with `=`.  See rust/README.md.
#
#     ~/.cargo/bin      rustup, cargo
#     ~/.local/bin      wasm-bindgen
set -eu

cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT=${1:-"$ROOT/rust/wasm/pkg"}

PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
export PATH

command -v wasm-bindgen >/dev/null || {
    echo "wasm-bindgen not on PATH -- see rust/README.md" >&2
    exit 1
}

cargo build \
    --manifest-path "$ROOT/rust/Cargo.toml" \
    -p erouter-wasm --release --target wasm32-unknown-unknown

# `--target web`: the Flet worker is a *module* worker, so the glue is loaded
# with a dynamic `import()` and initialises itself by fetching the .wasm beside
# it.  `no-modules` is for classic workers, which Pyodide refuses to run in.
wasm-bindgen \
    --target web \
    --out-dir "$OUT" \
    --out-name erouter_wasm \
    --remove-name-section \
    --remove-producers-section \
    "$ROOT/rust/target/wasm32-unknown-unknown/release/erouter_wasm.wasm"

ls -l "$OUT"

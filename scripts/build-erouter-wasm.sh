#!/usr/bin/env bash
# Rebuild electric-router's wasm module from the vendored fork and refresh the
# committed artifact in terminal/src/lib/erouter/wasm/.
#
# Requirements (both pinned by upstream — do not float them):
#   - Rust 1.96.1 with the wasm32-unknown-unknown target
#     (flet-curve/vendor/electric-router/rust/rust-toolchain.toml installs it)
#   - wasm-bindgen-cli 0.2.127:  cargo install wasm-bindgen-cli --version 0.2.127 --locked
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CRATE="$ROOT/flet-curve/vendor/electric-router/rust"
OUT="$ROOT/terminal/src/lib/erouter/wasm"

cd "$CRATE"
cargo build --release --target wasm32-unknown-unknown -p erouter-wasm
wasm-bindgen --target web --out-dir "$OUT" \
  "$CRATE/target/wasm32-unknown-unknown/release/erouter_wasm.wasm"

echo "regenerated $OUT:"
ls -la "$OUT"
echo "now run: cd terminal && bun test src/lib/erouter"

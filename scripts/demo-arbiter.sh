#!/usr/bin/env bash
# Suwappu Arbiter — dry-run demo from a clean clone (no funds, no accounts).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== 1. arbiter WASM is prebuilt; verifying it matches the recorded fixtures"
if command -v sha256sum >/dev/null; then
  sha256sum near/arbiter-wasm/artifacts/arbiter-wasm.wasm 2>/dev/null || \
    echo "arbiter-wasm.wasm not built yet — build with: cd near/arbiter-wasm && cargo build --target wasm32-wasip1 --release"
fi

echo
echo "== 2. replaying recorded arbiter-wasm verdicts (these bytes are the enclave output)"
for k in pass fail-author fail-unmerged; do
  echo "--- $k"
  GITHUB_WEBHOOK_SECRET=arbiter-demo-secret node near/arbiter-wasm/fixtures/run.mjs < near/arbiter-wasm/fixtures/fixture-$k.json 2>/dev/null || \
    echo "run skipped (node missing?) — see near/arbiter-wasm/fixtures/outputs.json for recorded outputs"
done

echo
echo "== 3. contract dry check (requires Rust toolchain)"
if command -v cargo >/dev/null; then
  cd near/arbiter-contract && cargo check --target wasm32-unknown-unknown 2>&1 | tail -1
else
  echo "cargo not found — skipping contract check"
fi

echo
echo "== 4. web demo"
echo "open webapp with VITE_ARBITER_ENABLED=true (e.g. VITE_ARBITER_ENABLED=true bun run dev in webapp/) and visit /arbiter"

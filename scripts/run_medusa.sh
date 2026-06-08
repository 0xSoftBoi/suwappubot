#!/usr/bin/env bash
# Run Medusa coverage-guided fuzzing on the staking solvency invariant.
# Medusa's crytic-compile chokes on forge-std's LibVariable when building the
# full project, so we fuzz in a clean-room project containing only the harness +
# SuwppuStaking + OpenZeppelin (no forge-std). See contracts/SECURITY.md.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
C="$ROOT/contracts"
MZ=$(mktemp -d)
export PYTHONWARNINGS=ignore
mkdir -p "$MZ/src" "$MZ/lib"
ln -s "$C/lib/openzeppelin-contracts" "$MZ/lib/openzeppelin-contracts"
cp "$C/SuwppuStaking.sol" "$MZ/src/SuwppuStaking.sol"
sed 's|"../SuwppuStaking.sol"|"./SuwppuStaking.sol"|' "$C/MedusaHarness.sol" > "$MZ/src/MedusaHarness.sol"
cat > "$MZ/foundry.toml" <<EOF
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.27"
optimizer = true
optimizer_runs = 200
remappings = ["@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/"]
EOF
cat > "$MZ/medusa.json" <<EOF
{ "fuzzing": { "workers": 6, "testLimit": 100000, "timeout": 180, "callSequenceLength": 50,
    "targetContracts": ["MedusaHarness"], "testPrefixes": ["property_"], "corpusDirectory": "corpus",
    "deployerAddress": "0x30000", "senderAddresses": ["0x30000"] },
  "compilation": { "platform": "crytic-compile", "platformConfig": { "target": ".", "args": [] } },
  "slither": { "useSlither": false } }
EOF
cd "$MZ"
medusa fuzz --config medusa.json

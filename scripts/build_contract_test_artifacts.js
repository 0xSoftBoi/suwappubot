#!/usr/bin/env node
/**
 * Compile the contracts the Python EVM tests deploy, into
 * contracts/test/artifacts.json.
 *
 * tests/test_membership_evm.py deploys REAL bytecode on eth-tester. Without a
 * checked-in build path that blob could drift from the .sol sources and the
 * tests would go green against stale bytecode — so this script is the build,
 * and the test suite verifies the artifacts are fresh (see
 * test_artifacts_match_current_sources).
 *
 *   node scripts/build_contract_test_artifacts.js
 *
 * Requires solc 0.8.27 (npm i solc@0.8.27). foundry/forge is not available in
 * the container this was developed in; if you have forge, `forge build` is the
 * canonical path and this script is only for the Python tests.
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const ROOT = path.join(REPO, "contracts");
const OUT = path.join(ROOT, "test", "artifacts.json");

const TARGETS = {
  "SuwappuMembership.sol": "SuwappuMembership.sol",
  "MockUSDG.sol": "test/MockUSDG.sol",
};

let solc;
try {
  solc = require("solc");
} catch (e) {
  console.error("solc not found. Install it: npm i solc@0.8.27");
  process.exit(2);
}

const sources = {};
for (const [key, rel] of Object.entries(TARGETS)) {
  sources[key] = { content: fs.readFileSync(path.join(ROOT, rel), "utf8") };
}

function resolveImport(importPath) {
  const p = importPath.startsWith("@openzeppelin/contracts/")
    ? path.join(ROOT, "lib/openzeppelin-contracts/contracts", importPath.slice("@openzeppelin/contracts/".length))
    : path.join(ROOT, importPath);
  try {
    return { contents: fs.readFileSync(p, "utf8") };
  } catch (e) {
    return { error: "not found: " + importPath };
  }
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }));
const errors = (out.errors || []).filter((e) => e.severity === "error");
for (const e of errors) console.error(e.formattedMessage);
if (errors.length) process.exit(1);

// Only the contracts the tests actually deploy — keeps the blob small and the
// diff readable when it changes.
const WANTED = new Set(["SuwappuMembership", "MockUSDG"]);
const artifacts = {};
for (const file of Object.keys(out.contracts)) {
  for (const name of Object.keys(out.contracts[file])) {
    if (!WANTED.has(name)) continue;
    artifacts[name] = {
      abi: out.contracts[file][name].abi,
      bytecode: "0x" + out.contracts[file][name].evm.bytecode.object,
    };
  }
}

const sourceHashes = {};
const crypto = require("crypto");
for (const [key, rel] of Object.entries(TARGETS)) {
  sourceHashes[key] = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, rel)))
    .digest("hex");
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({ solc: solc.version(), sourceHashes, artifacts }, null, 1)
);
console.log(`wrote ${path.relative(REPO, OUT)} (${Object.keys(artifacts).join(", ")})`);

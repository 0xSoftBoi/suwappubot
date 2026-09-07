// Runs a state dump and a list of calls through the wasm EVM.
//
// The question is whether the browser's EVM is the desktop's: same crate, two
// bindings.  The state and the calls are produced by the native side, so a
// disagreement here is the marshalling, not revm.
//
//     node tests/js/evm_harness.mjs <pkg-dir> < job.json
//
// See tests/test_evm_wrapper.py.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = resolve(process.argv[2]);
const glue = await import(pkg + "/erouter_wasm.js");
await glue.default({ module_or_path: readFileSync(pkg + "/erouter_wasm_bg.wasm") });

const job = JSON.parse(readFileSync(0, "utf8"));
const evm = new glue.Evm(job.spec ?? "Osaka", job.chain_id ?? 1);
const b = job.block ?? {};
evm.setBlock(
  b.number ?? 0, b.timestamp ?? 0, b.basefee ?? 0, b.gas_limit ?? 30000000,
  b.coinbase ?? "0x" + "00".repeat(20),
  b.prevrandao ?? "0x" + "00".repeat(32),
  b.excess_blob_gas ?? undefined,
);
for (const a of job.accounts ?? []) {
  evm.insertAccount(
    a.address, a.nonce ?? 1, a.balance ?? "0x0",
    a.code ? Uint8Array.from(Buffer.from(a.code, "hex")) : undefined,
  );
}
for (const s of job.storage ?? []) evm.insertStorage(s[0], s[1], s[2]);

const results = [];
for (const c of job.calls ?? []) {
  const r = evm.call(
    c.caller, c.to, Uint8Array.from(Buffer.from(c.data ?? "", "hex")),
    c.value ?? "0x0", c.gas_limit ?? 1e9,
  );
  results.push({
    success: r.success,
    output: Buffer.from(r.output).toString("hex"),
    gasUsed: r.gasUsed,
    revertReason: r.revertReason ?? null,
    haltReason: r.haltReason ?? null,
  });
  r.free();
}

const m = evm.takeMisses();
const out = {
  results,
  misses: { accounts: m.accounts, slots: m.slots, blocks: m.blocks },
  slotCount: evm.slotCount,
  accountCount: evm.accountCount,
};
m.free();
evm.free();
process.stdout.write(JSON.stringify(out));

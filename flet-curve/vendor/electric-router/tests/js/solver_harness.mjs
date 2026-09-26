// Runs one solve through the wasm module and prints the answer as hex.
//
// The point is byte equality with the native extension: same crate, same
// compiler, two targets.  Only `sqrt` is a non-trivially-rounded operation in
// the solver and IEEE requires it be correctly rounded on both, so anything
// other than an exact match is a marshalling bug -- which is what this is
// here to catch.  Hex rather than JSON numbers because a float printed as
// text and read back is not the question being asked.
//
//     node tests/js/solver_harness.mjs <pkg-dir> < problem.json
//
// stdin is `{op, ...}`; stdout is one JSON object.  See
// tests/test_wasm_differential.py, which is the only caller.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = resolve(process.argv[2]);
const glue = await import(pkg + "/erouter_wasm.js");
// Node's fetch has no `file:` scheme, so the bytes are handed over directly
// rather than letting the glue fetch them the way a browser does.
await glue.default({ module_or_path: readFileSync(pkg + "/erouter_wasm_bg.wasm") });

const hex = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString("hex");

const job = JSON.parse(readFileSync(0, "utf8"));
const out = {};

if (job.op === "solve") {
  const p = new glue.Problem(
    Int32Array.from(job.tau), Int32Array.from(job.sig),
    Float64Array.from(job.g), Float64Array.from(job.eps),
    Float64Array.from(job.cap.map((v) => (v === null ? Infinity : v))),
    job.n_nodes,
  );
  const r = p.solve(
    job.src, job.dst, job.psi_total,
    Uint8Array.from(job.a0 ?? []), Uint8Array.from(job.forbidden ?? []),
    Uint32Array.from((job.pinned ?? []).map((e) => e[0])),
    Float64Array.from((job.pinned ?? []).map((e) => e[1])),
    job.tol, job.maxit, job.min_flow, job.gas_cost, job.partial_ok, job.rank1,
  );
  Object.assign(out, {
    psi: hex(r.psi), u: hex(r.u), psiUpper: hex(r.psiUpper), rho: hex(r.rho),
    active: hex(r.active), upper: hex(r.upper),
    pivots: r.pivots, cholFailures: r.cholFailures, keepChanges: r.keepChanges,
    refits: r.refits, feasible: r.feasible, reason: r.reason,
  });
  r.free();
  p.free();
} else if (job.op === "calibrate") {
  const nan = (v) => (v === null || v === undefined ? NaN : v);
  const c = glue.calibrate(
    Float64Array.from(job.deltas), Float64Array.from(job.quotes),
    nan(job.delta_bar), job.structural_flag, job.drift_tol,
    nan(job.cap), nan(job.f_at_cap), job.quantum,
  );
  Object.assign(out, {
    a: hex(Float64Array.of(c.a)), b: hex(Float64Array.of(c.b)),
    cap: hex(Float64Array.of(c.cap)), clamped: c.clamped,
    convexFlag: c.convexFlag, flag: c.flag,
    drift: hex(Float64Array.of(c.drift)), eta: hex(Float64Array.of(c.eta)),
    splitHint: c.splitHint,
    calibDelta: hex(Float64Array.of(c.calibDelta)),
    tangentDelta: hex(Float64Array.of(c.tangentDelta)),
    note: c.note,
  });
  c.free();
} else if (job.op === "cancel_cycles") {
  const r = glue.cancelCycles(
    Int32Array.from(job.tau), Int32Array.from(job.sig),
    Float64Array.from(job.psi), job.tol, job.n_nodes ?? 0,
  );
  Object.assign(out, { flow: hex(r.flow), removed: r.removed });
  r.free();
} else if (job.op === "find_cycle") {
  const arcs = glue.findCycle(
    Int32Array.from(job.tau), Int32Array.from(job.sig), job.n_nodes ?? 0,
  );
  out.arcs = Array.from(arcs);
} else if (job.op === "shortest_path") {
  const p = new glue.Problem(
    Int32Array.from(job.tau), Int32Array.from(job.sig),
    Float64Array.from(job.g), Float64Array.from(job.eps),
    Float64Array.from(job.cap.map((v) => (v === null ? Infinity : v))),
    job.n_nodes,
  );
  const r = p.shortestPath(
    job.src, job.dst,
    job.banned_arcs ? Uint32Array.from(job.banned_arcs) : undefined,
    job.banned_nodes ? Uint32Array.from(job.banned_nodes) : undefined,
    job.weights ? Float64Array.from(job.weights) : undefined,
    job.max_hops,
  );
  Object.assign(out, {
    arcs: Array.from(r.arcs), length: hex(Float64Array.of(r.length)),
    found: r.found, negativeCycle: Array.from(r.negativeCycle),
  });
  r.free();
  p.free();
} else {
  throw new Error(`unknown op: ${job.op}`);
}

process.stdout.write(JSON.stringify(out));

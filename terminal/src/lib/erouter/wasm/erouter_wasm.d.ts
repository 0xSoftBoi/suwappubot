/* tslint:disable */
/* eslint-disable */

export class AscendResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly best: number;
    readonly evaluations: number;
    readonly offsets: Uint32Array;
    /**
     * Every slot's weights, end to end; `offsets` says where each begins.
     */
    readonly weights: Float64Array;
}

/**
 * Many calls' answers, flattened.  `gasUsed` is `f64` rather than `u64` so it
 * arrives as a plain number array instead of `BigInt64Array`; gas fits in 53
 * bits many times over.
 */
export class BatchResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly gasUsed: Float64Array;
    readonly halted: Uint8Array;
    readonly offsets: Uint32Array;
    readonly output: Uint8Array;
    readonly reasons: string[];
    readonly success: Uint8Array;
}

/**
 * One arc's ladder, fitted.  The twelve `Calibration` fields, in declaration
 * order, so the Python side builds the dataclass and keeps its own
 * postconditions -- exactly as the PyO3 tuple does.
 */
export class CalibrationOut {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly a: number;
    readonly b: number;
    readonly calibDelta: number;
    readonly cap: number;
    readonly clamped: boolean;
    readonly convexFlag: boolean;
    readonly drift: number;
    readonly eta: number;
    readonly flag: string;
    readonly note: string;
    readonly splitHint: boolean;
    readonly tangentDelta: number;
}

export class CallResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly gasUsed: number;
    readonly haltReason: string | undefined;
    readonly output: Uint8Array;
    readonly revertReason: string | undefined;
    readonly success: boolean;
}

export class CycleResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly flow: Float64Array;
    readonly removed: number;
}

export class Evm {
    free(): void;
    [Symbol.dispose](): void;
    call(caller: string, to: string, data: Uint8Array, value: string, gas_limit: number): CallResult;
    /**
     * A probe batch is hundreds of calls, and crossing per call cost a
     * measurable share of a warm quote.  Targets arrive as one array of
     * addresses, calldata as one flat byte array with offsets beside it, and
     * the answers come back the same way.
     */
    callMany(caller: string, to: string[], data: Uint8Array, offsets: Uint32Array, gas_limit: number): BatchResult;
    hasAccount(address: string): boolean;
    insertAccount(address: string, nonce: number, balance: string, code?: Uint8Array | null): void;
    insertBlockHash(number: number, hash: string): void;
    insertStorage(address: string, slot: string, value: string): void;
    /**
     * The sweep inserts thousands at a time, so they arrive as three parallel
     * arrays of strings rather than as three thousand calls.
     */
    insertStorageMany(addresses: string[], slots: string[], values: string[]): void;
    /**
     * `[addr, slot, addr, slot, ...]`, flat, because a JS array of pairs is
     * an array of arrays and this is read at every refresh.
     */
    knownSlots(): string[];
    constructor(spec: string, chain_id: number);
    setBalance(address: string, balance: string): void;
    setBlock(number: number, timestamp: number, basefee: number, gas_limit: number, coinbase: string, prevrandao: string, excess_blob_gas?: number | null): void;
    /**
     * Everything the calls since the last drain read and did not find.
     */
    takeMisses(): MissReport;
    readonly accountCount: number;
    readonly slotCount: number;
}

/**
 * What a run of calls read and did not find.  `slots` is flat --
 * `[address, slot, address, slot, ...]` -- because a JS array of pairs is an
 * array of arrays, and this is read after every stage of the warm.
 */
export class MissReport {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly accounts: string[];
    readonly blocks: Float64Array;
    readonly slots: string[];
}

export class PathResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly arcs: Uint32Array;
    readonly found: boolean;
    readonly length: number;
    readonly negativeCycle: Uint32Array;
}

/**
 * The graph, held across a quote's 45-106 solves.  Same reason as the PyO3
 * `Problem`: only the warm start, the forbidden mask and the pins change.
 */
export class Problem {
    free(): void;
    [Symbol.dispose](): void;
    constructor(tau: Int32Array, sig: Int32Array, g: Float64Array, eps: Float64Array, cap: Float64Array, n_nodes: number);
    /**
     * `{arcs, length, found, negativeCycle}` as four getters on one struct --
     * see `PathResult`.
     */
    shortestPath(src: number, dst: number, banned_arcs: Uint32Array | null | undefined, banned_nodes: Uint32Array | null | undefined, weights: Float64Array | null | undefined, max_hops: number): PathResult;
    /**
     * `a0` and `forbidden` are `Uint8Array` masks; empty means absent, which
     * is how a JS caller says `None` without a nullable typed array.
     * `pinned` is two parallel arrays for the same reason.
     */
    solve(src: number, dst: number, psi_total: number, a0: Uint8Array, forbidden: Uint8Array, pinned_arc: Uint32Array, pinned_value: Float64Array, tol: number, maxit: number, min_flow: number, gas_cost: number, partial_ok: boolean, rank1: boolean): SolveResult;
    readonly m: number;
}

/**
 * A solve's answer.  Getters rather than fields so the vectors are only
 * materialised as JS arrays when the caller asks for them.
 */
export class SolveResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly active: Uint8Array;
    readonly cholFailures: number;
    readonly feasible: boolean;
    readonly keepChanges: number;
    readonly pivots: number;
    readonly psi: Float64Array;
    readonly psiUpper: Float64Array;
    readonly reason: string;
    readonly refits: number;
    readonly rho: Float64Array;
    /**
     * Nanoseconds per section of the pivot loop, and all zero unless the
     * crate was built with `--features bench` -- which the browser build
     * never is, since a Worker has no clock to read.  `f64` rather than
     * `u64` so it arrives as a number array instead of `BigInt64Array`.
     */
    readonly timings: Float64Array;
    readonly u: Float64Array;
    readonly upper: Uint8Array;
}

/**
 * `delta_bar`, `cap` and `f_at_cap` are optional; NaN says absent, which is
 * how an `f64` parameter carries `None` without a boxed value per call.
 */
export function calibrate(deltas: Float64Array, quotes: Float64Array, delta_bar: number, structural_flag: boolean, drift_tol: number, cap: number, f_at_cap: number, quantum: number): CalibrationOut;

/**
 * `n_nodes` of 0 means "work it out from the arcs", as `None` does in Python.
 */
export function cancelCycles(tau: Int32Array, sig: Int32Array, psi: Float64Array, tol: number, n_nodes: number): CycleResult;

/**
 * The cycle's arcs, or an empty array when there is none.
 */
export function findCycle(tau: Int32Array, sig: Int32Array, n_nodes: number): Uint32Array;

/**
 * Coordinate ascent over a route's split.
 *
 * Everything ragged arrives flattened with an offsets array beside it --
 * curves, heads, starting weights.  A JSON payload would be simpler to write
 * and this runs on the per-keystroke path, where a 200 kB parse per quote is
 * not free.  `static_share` uses NaN for "not fixed".
 */
export function splitAscend(curve_x: Float64Array, curve_u: Float64Array, curve_slope: Float64Array, curve_off: Uint32Array, slope_off: Uint32Array, curve_rate0: Float64Array, curve_tail: Float64Array, src_of: Uint32Array, dst_of: Uint32Array, static_share: Float64Array, heads_flat: Uint32Array, heads_off: Uint32Array, tails: Uint32Array, slots: number, dst_slot: number, amount_in: number, start_flat: Float64Array, start_off: Uint32Array, free_slot: Uint32Array, free_index: Uint32Array, min_weight: number, iters: number, sweeps: number, window: number, sweep_tol: number): AscendResult;

/**
 * Send a panic's message to the console before the trap takes the instance
 * down.  `panic = "abort"` is deliberate -- unwinding across the FFI is not
 * something to rely on -- so this is the only chance to say what happened,
 * and without it a bug reads as a bare `RuntimeError: unreachable`.
 */
export function start(): void;

/**
 * What the module is, so a shim can refuse a stale copy.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_ascendresult_free: (a: number, b: number) => void;
    readonly __wbg_batchresult_free: (a: number, b: number) => void;
    readonly __wbg_calibrationout_free: (a: number, b: number) => void;
    readonly __wbg_callresult_free: (a: number, b: number) => void;
    readonly __wbg_cycleresult_free: (a: number, b: number) => void;
    readonly __wbg_evm_free: (a: number, b: number) => void;
    readonly __wbg_missreport_free: (a: number, b: number) => void;
    readonly __wbg_pathresult_free: (a: number, b: number) => void;
    readonly __wbg_problem_free: (a: number, b: number) => void;
    readonly __wbg_solveresult_free: (a: number, b: number) => void;
    readonly ascendresult_best: (a: number) => number;
    readonly ascendresult_evaluations: (a: number) => number;
    readonly ascendresult_offsets: (a: number) => [number, number];
    readonly ascendresult_weights: (a: number) => [number, number];
    readonly batchresult_gasUsed: (a: number) => [number, number];
    readonly batchresult_halted: (a: number) => [number, number];
    readonly batchresult_offsets: (a: number) => [number, number];
    readonly batchresult_output: (a: number) => [number, number];
    readonly batchresult_reasons: (a: number) => [number, number];
    readonly batchresult_success: (a: number) => [number, number];
    readonly calibrate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly calibrationout_b: (a: number) => number;
    readonly calibrationout_calibDelta: (a: number) => number;
    readonly calibrationout_cap: (a: number) => number;
    readonly calibrationout_clamped: (a: number) => number;
    readonly calibrationout_convexFlag: (a: number) => number;
    readonly calibrationout_drift: (a: number) => number;
    readonly calibrationout_eta: (a: number) => number;
    readonly calibrationout_flag: (a: number) => [number, number];
    readonly calibrationout_note: (a: number) => [number, number];
    readonly calibrationout_splitHint: (a: number) => number;
    readonly calibrationout_tangentDelta: (a: number) => number;
    readonly callresult_gasUsed: (a: number) => number;
    readonly callresult_haltReason: (a: number) => [number, number];
    readonly callresult_output: (a: number) => [number, number];
    readonly callresult_revertReason: (a: number) => [number, number];
    readonly callresult_success: (a: number) => number;
    readonly cancelCycles: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly cycleresult_flow: (a: number) => [number, number];
    readonly cycleresult_removed: (a: number) => number;
    readonly evm_accountCount: (a: number) => number;
    readonly evm_call: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly evm_callMany: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly evm_hasAccount: (a: number, b: number, c: number) => [number, number, number];
    readonly evm_insertAccount: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly evm_insertBlockHash: (a: number, b: number, c: number, d: number) => [number, number];
    readonly evm_insertStorage: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly evm_insertStorageMany: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly evm_knownSlots: (a: number) => [number, number];
    readonly evm_new: (a: number, b: number, c: number) => [number, number, number];
    readonly evm_setBalance: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly evm_setBlock: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number];
    readonly evm_slotCount: (a: number) => number;
    readonly evm_takeMisses: (a: number) => number;
    readonly findCycle: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly missreport_accounts: (a: number) => [number, number];
    readonly missreport_blocks: (a: number) => [number, number];
    readonly missreport_slots: (a: number) => [number, number];
    readonly pathresult_arcs: (a: number) => [number, number];
    readonly pathresult_found: (a: number) => number;
    readonly pathresult_negativeCycle: (a: number) => [number, number];
    readonly problem_m: (a: number) => number;
    readonly problem_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
    readonly problem_shortestPath: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly problem_solve: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number) => [number, number, number];
    readonly solveresult_active: (a: number) => [number, number];
    readonly solveresult_cholFailures: (a: number) => number;
    readonly solveresult_feasible: (a: number) => number;
    readonly solveresult_keepChanges: (a: number) => number;
    readonly solveresult_pivots: (a: number) => number;
    readonly solveresult_psi: (a: number) => [number, number];
    readonly solveresult_psiUpper: (a: number) => [number, number];
    readonly solveresult_reason: (a: number) => [number, number];
    readonly solveresult_refits: (a: number) => number;
    readonly solveresult_rho: (a: number) => [number, number];
    readonly solveresult_timings: (a: number) => [number, number];
    readonly solveresult_u: (a: number) => [number, number];
    readonly solveresult_upper: (a: number) => [number, number];
    readonly splitAscend: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number, f1: number, g1: number, h1: number, i1: number, j1: number, k1: number, l1: number, m1: number, n1: number, o1: number, p1: number) => [number, number, number];
    readonly version: () => [number, number];
    readonly calibrationout_a: (a: number) => number;
    readonly pathresult_length: (a: number) => number;
    readonly start: () => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

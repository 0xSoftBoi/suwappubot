/* @ts-self-types="./erouter_wasm.d.ts" */

export class AscendResult {
    static __wrap(ptr) {
        const obj = Object.create(AscendResult.prototype);
        obj.__wbg_ptr = ptr;
        AscendResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AscendResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_ascendresult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get best() {
        const ret = wasm.ascendresult_best(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get evaluations() {
        const ret = wasm.ascendresult_evaluations(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint32Array}
     */
    get offsets() {
        const ret = wasm.ascendresult_offsets(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Every slot's weights, end to end; `offsets` says where each begins.
     * @returns {Float64Array}
     */
    get weights() {
        const ret = wasm.ascendresult_weights(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
}
if (Symbol.dispose) AscendResult.prototype[Symbol.dispose] = AscendResult.prototype.free;

/**
 * Many calls' answers, flattened.  `gasUsed` is `f64` rather than `u64` so it
 * arrives as a plain number array instead of `BigInt64Array`; gas fits in 53
 * bits many times over.
 */
export class BatchResult {
    static __wrap(ptr) {
        const obj = Object.create(BatchResult.prototype);
        obj.__wbg_ptr = ptr;
        BatchResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BatchResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_batchresult_free(ptr, 0);
    }
    /**
     * @returns {Float64Array}
     */
    get gasUsed() {
        const ret = wasm.batchresult_gasUsed(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get halted() {
        const ret = wasm.batchresult_halted(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    get offsets() {
        const ret = wasm.batchresult_offsets(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get output() {
        const ret = wasm.batchresult_output(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {string[]}
     */
    get reasons() {
        const ret = wasm.batchresult_reasons(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get success() {
        const ret = wasm.batchresult_success(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) BatchResult.prototype[Symbol.dispose] = BatchResult.prototype.free;

/**
 * One arc's ladder, fitted.  The twelve `Calibration` fields, in declaration
 * order, so the Python side builds the dataclass and keeps its own
 * postconditions -- exactly as the PyO3 tuple does.
 */
export class CalibrationOut {
    static __wrap(ptr) {
        const obj = Object.create(CalibrationOut.prototype);
        obj.__wbg_ptr = ptr;
        CalibrationOutFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CalibrationOutFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_calibrationout_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get a() {
        const ret = wasm.calibrationout_a(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get b() {
        const ret = wasm.calibrationout_b(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get calibDelta() {
        const ret = wasm.calibrationout_calibDelta(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get cap() {
        const ret = wasm.calibrationout_cap(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get clamped() {
        const ret = wasm.calibrationout_clamped(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get convexFlag() {
        const ret = wasm.calibrationout_convexFlag(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get drift() {
        const ret = wasm.calibrationout_drift(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get eta() {
        const ret = wasm.calibrationout_eta(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    get flag() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.calibrationout_flag(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get note() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.calibrationout_note(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    get splitHint() {
        const ret = wasm.calibrationout_splitHint(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get tangentDelta() {
        const ret = wasm.calibrationout_tangentDelta(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) CalibrationOut.prototype[Symbol.dispose] = CalibrationOut.prototype.free;

export class CallResult {
    static __wrap(ptr) {
        const obj = Object.create(CallResult.prototype);
        obj.__wbg_ptr = ptr;
        CallResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CallResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_callresult_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get gasUsed() {
        const ret = wasm.callresult_gasUsed(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string | undefined}
     */
    get haltReason() {
        const ret = wasm.callresult_haltReason(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get output() {
        const ret = wasm.callresult_output(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {string | undefined}
     */
    get revertReason() {
        const ret = wasm.callresult_revertReason(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]);
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @returns {boolean}
     */
    get success() {
        const ret = wasm.callresult_success(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) CallResult.prototype[Symbol.dispose] = CallResult.prototype.free;

export class CycleResult {
    static __wrap(ptr) {
        const obj = Object.create(CycleResult.prototype);
        obj.__wbg_ptr = ptr;
        CycleResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CycleResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_cycleresult_free(ptr, 0);
    }
    /**
     * @returns {Float64Array}
     */
    get flow() {
        const ret = wasm.cycleresult_flow(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {number}
     */
    get removed() {
        const ret = wasm.cycleresult_removed(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) CycleResult.prototype[Symbol.dispose] = CycleResult.prototype.free;

export class Evm {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EvmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_evm_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get accountCount() {
        const ret = wasm.evm_accountCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {string} caller
     * @param {string} to
     * @param {Uint8Array} data
     * @param {string} value
     * @param {number} gas_limit
     * @returns {CallResult}
     */
    call(caller, to, data, value, gas_limit) {
        const ptr0 = passStringToWasm0(caller, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(to, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.evm_call(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, gas_limit);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return CallResult.__wrap(ret[0]);
    }
    /**
     * A probe batch is hundreds of calls, and crossing per call cost a
     * measurable share of a warm quote.  Targets arrive as one array of
     * addresses, calldata as one flat byte array with offsets beside it, and
     * the answers come back the same way.
     * @param {string} caller
     * @param {string[]} to
     * @param {Uint8Array} data
     * @param {Uint32Array} offsets
     * @param {number} gas_limit
     * @returns {BatchResult}
     */
    callMany(caller, to, data, offsets, gas_limit) {
        const ptr0 = passStringToWasm0(caller, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(to, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArray32ToWasm0(offsets, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.evm_callMany(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, gas_limit);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BatchResult.__wrap(ret[0]);
    }
    /**
     * @param {string} address
     * @returns {boolean}
     */
    hasAccount(address) {
        const ptr0 = passStringToWasm0(address, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.evm_hasAccount(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {string} address
     * @param {number} nonce
     * @param {string} balance
     * @param {Uint8Array | null} [code]
     */
    insertAccount(address, nonce, balance, code) {
        const ptr0 = passStringToWasm0(address, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(balance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(code) ? 0 : passArray8ToWasm0(code, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.evm_insertAccount(this.__wbg_ptr, ptr0, len0, nonce, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} number
     * @param {string} hash
     */
    insertBlockHash(number, hash) {
        const ptr0 = passStringToWasm0(hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.evm_insertBlockHash(this.__wbg_ptr, number, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} address
     * @param {string} slot
     * @param {string} value
     */
    insertStorage(address, slot, value) {
        const ptr0 = passStringToWasm0(address, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(slot, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.evm_insertStorage(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * The sweep inserts thousands at a time, so they arrive as three parallel
     * arrays of strings rather than as three thousand calls.
     * @param {string[]} addresses
     * @param {string[]} slots
     * @param {string[]} values
     */
    insertStorageMany(addresses, slots, values) {
        const ptr0 = passArrayJsValueToWasm0(addresses, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(slots, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(values, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.evm_insertStorageMany(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * `[addr, slot, addr, slot, ...]`, flat, because a JS array of pairs is
     * an array of arrays and this is read at every refresh.
     * @returns {string[]}
     */
    knownSlots() {
        const ret = wasm.evm_knownSlots(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {string} spec
     * @param {number} chain_id
     */
    constructor(spec, chain_id) {
        const ptr0 = passStringToWasm0(spec, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.evm_new(ptr0, len0, chain_id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        EvmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {string} address
     * @param {string} balance
     */
    setBalance(address, balance) {
        const ptr0 = passStringToWasm0(address, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(balance, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.evm_setBalance(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} number
     * @param {number} timestamp
     * @param {number} basefee
     * @param {number} gas_limit
     * @param {string} coinbase
     * @param {string} prevrandao
     * @param {number | null} [excess_blob_gas]
     */
    setBlock(number, timestamp, basefee, gas_limit, coinbase, prevrandao, excess_blob_gas) {
        const ptr0 = passStringToWasm0(coinbase, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(prevrandao, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.evm_setBlock(this.__wbg_ptr, number, timestamp, basefee, gas_limit, ptr0, len0, ptr1, len1, !isLikeNone(excess_blob_gas), isLikeNone(excess_blob_gas) ? 0 : excess_blob_gas);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {number}
     */
    get slotCount() {
        const ret = wasm.evm_slotCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Everything the calls since the last drain read and did not find.
     * @returns {MissReport}
     */
    takeMisses() {
        const ret = wasm.evm_takeMisses(this.__wbg_ptr);
        return MissReport.__wrap(ret);
    }
}
if (Symbol.dispose) Evm.prototype[Symbol.dispose] = Evm.prototype.free;

/**
 * What a run of calls read and did not find.  `slots` is flat --
 * `[address, slot, address, slot, ...]` -- because a JS array of pairs is an
 * array of arrays, and this is read after every stage of the warm.
 */
export class MissReport {
    static __wrap(ptr) {
        const obj = Object.create(MissReport.prototype);
        obj.__wbg_ptr = ptr;
        MissReportFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MissReportFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_missreport_free(ptr, 0);
    }
    /**
     * @returns {string[]}
     */
    get accounts() {
        const ret = wasm.missreport_accounts(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get blocks() {
        const ret = wasm.missreport_blocks(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {string[]}
     */
    get slots() {
        const ret = wasm.missreport_slots(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) MissReport.prototype[Symbol.dispose] = MissReport.prototype.free;

export class PathResult {
    static __wrap(ptr) {
        const obj = Object.create(PathResult.prototype);
        obj.__wbg_ptr = ptr;
        PathResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PathResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_pathresult_free(ptr, 0);
    }
    /**
     * @returns {Uint32Array}
     */
    get arcs() {
        const ret = wasm.pathresult_arcs(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {boolean}
     */
    get found() {
        const ret = wasm.pathresult_found(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get length() {
        const ret = wasm.pathresult_length(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint32Array}
     */
    get negativeCycle() {
        const ret = wasm.pathresult_negativeCycle(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) PathResult.prototype[Symbol.dispose] = PathResult.prototype.free;

/**
 * The graph, held across a quote's 45-106 solves.  Same reason as the PyO3
 * `Problem`: only the warm start, the forbidden mask and the pins change.
 */
export class Problem {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProblemFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_problem_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get m() {
        const ret = wasm.problem_m(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {Int32Array} tau
     * @param {Int32Array} sig
     * @param {Float64Array} g
     * @param {Float64Array} eps
     * @param {Float64Array} cap
     * @param {number} n_nodes
     */
    constructor(tau, sig, g, eps, cap, n_nodes) {
        const ptr0 = passArray32ToWasm0(tau, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray32ToWasm0(sig, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayF64ToWasm0(g, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(eps, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passArrayF64ToWasm0(cap, wasm.__wbindgen_malloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.problem_new(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, n_nodes);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ProblemFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * `{arcs, length, found, negativeCycle}` as four getters on one struct --
     * see `PathResult`.
     * @param {number} src
     * @param {number} dst
     * @param {Uint32Array | null | undefined} banned_arcs
     * @param {Uint32Array | null | undefined} banned_nodes
     * @param {Float64Array | null | undefined} weights
     * @param {number} max_hops
     * @returns {PathResult}
     */
    shortestPath(src, dst, banned_arcs, banned_nodes, weights, max_hops) {
        var ptr0 = isLikeNone(banned_arcs) ? 0 : passArray32ToWasm0(banned_arcs, wasm.__wbindgen_malloc);
        var len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(banned_nodes) ? 0 : passArray32ToWasm0(banned_nodes, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        var ptr2 = isLikeNone(weights) ? 0 : passArrayF64ToWasm0(weights, wasm.__wbindgen_malloc);
        var len2 = WASM_VECTOR_LEN;
        const ret = wasm.problem_shortestPath(this.__wbg_ptr, src, dst, ptr0, len0, ptr1, len1, ptr2, len2, max_hops);
        return PathResult.__wrap(ret);
    }
    /**
     * `a0` and `forbidden` are `Uint8Array` masks; empty means absent, which
     * is how a JS caller says `None` without a nullable typed array.
     * `pinned` is two parallel arrays for the same reason.
     * @param {number} src
     * @param {number} dst
     * @param {number} psi_total
     * @param {Uint8Array} a0
     * @param {Uint8Array} forbidden
     * @param {Uint32Array} pinned_arc
     * @param {Float64Array} pinned_value
     * @param {number} tol
     * @param {number} maxit
     * @param {number} min_flow
     * @param {number} gas_cost
     * @param {boolean} partial_ok
     * @param {boolean} rank1
     * @returns {SolveResult}
     */
    solve(src, dst, psi_total, a0, forbidden, pinned_arc, pinned_value, tol, maxit, min_flow, gas_cost, partial_ok, rank1) {
        const ptr0 = passArray8ToWasm0(a0, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(forbidden, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray32ToWasm0(pinned_arc, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passArrayF64ToWasm0(pinned_value, wasm.__wbindgen_malloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.problem_solve(this.__wbg_ptr, src, dst, psi_total, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, tol, maxit, min_flow, gas_cost, partial_ok, rank1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return SolveResult.__wrap(ret[0]);
    }
}
if (Symbol.dispose) Problem.prototype[Symbol.dispose] = Problem.prototype.free;

/**
 * A solve's answer.  Getters rather than fields so the vectors are only
 * materialised as JS arrays when the caller asks for them.
 */
export class SolveResult {
    static __wrap(ptr) {
        const obj = Object.create(SolveResult.prototype);
        obj.__wbg_ptr = ptr;
        SolveResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SolveResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_solveresult_free(ptr, 0);
    }
    /**
     * @returns {Uint8Array}
     */
    get active() {
        const ret = wasm.solveresult_active(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {number}
     */
    get cholFailures() {
        const ret = wasm.solveresult_cholFailures(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    get feasible() {
        const ret = wasm.solveresult_feasible(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get keepChanges() {
        const ret = wasm.solveresult_keepChanges(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get pivots() {
        const ret = wasm.solveresult_pivots(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Float64Array}
     */
    get psi() {
        const ret = wasm.solveresult_psi(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get psiUpper() {
        const ret = wasm.solveresult_psiUpper(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {string}
     */
    get reason() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.solveresult_reason(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get refits() {
        const ret = wasm.solveresult_refits(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Float64Array}
     */
    get rho() {
        const ret = wasm.solveresult_rho(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Nanoseconds per section of the pivot loop, and all zero unless the
     * crate was built with `--features bench` -- which the browser build
     * never is, since a Worker has no clock to read.  `f64` rather than
     * `u64` so it arrives as a number array instead of `BigInt64Array`.
     * @returns {Float64Array}
     */
    get timings() {
        const ret = wasm.solveresult_timings(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Float64Array}
     */
    get u() {
        const ret = wasm.solveresult_u(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    get upper() {
        const ret = wasm.solveresult_upper(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) SolveResult.prototype[Symbol.dispose] = SolveResult.prototype.free;

/**
 * `delta_bar`, `cap` and `f_at_cap` are optional; NaN says absent, which is
 * how an `f64` parameter carries `None` without a boxed value per call.
 * @param {Float64Array} deltas
 * @param {Float64Array} quotes
 * @param {number} delta_bar
 * @param {boolean} structural_flag
 * @param {number} drift_tol
 * @param {number} cap
 * @param {number} f_at_cap
 * @param {number} quantum
 * @returns {CalibrationOut}
 */
export function calibrate(deltas, quotes, delta_bar, structural_flag, drift_tol, cap, f_at_cap, quantum) {
    const ptr0 = passArrayF64ToWasm0(deltas, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(quotes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.calibrate(ptr0, len0, ptr1, len1, delta_bar, structural_flag, drift_tol, cap, f_at_cap, quantum);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return CalibrationOut.__wrap(ret[0]);
}

/**
 * `n_nodes` of 0 means "work it out from the arcs", as `None` does in Python.
 * @param {Int32Array} tau
 * @param {Int32Array} sig
 * @param {Float64Array} psi
 * @param {number} tol
 * @param {number} n_nodes
 * @returns {CycleResult}
 */
export function cancelCycles(tau, sig, psi, tol, n_nodes) {
    const ptr0 = passArray32ToWasm0(tau, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(sig, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(psi, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.cancelCycles(ptr0, len0, ptr1, len1, ptr2, len2, tol, n_nodes);
    return CycleResult.__wrap(ret);
}

/**
 * The cycle's arcs, or an empty array when there is none.
 * @param {Int32Array} tau
 * @param {Int32Array} sig
 * @param {number} n_nodes
 * @returns {Uint32Array}
 */
export function findCycle(tau, sig, n_nodes) {
    const ptr0 = passArray32ToWasm0(tau, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(sig, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.findCycle(ptr0, len0, ptr1, len1, n_nodes);
    var v3 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * Coordinate ascent over a route's split.
 *
 * Everything ragged arrives flattened with an offsets array beside it --
 * curves, heads, starting weights.  A JSON payload would be simpler to write
 * and this runs on the per-keystroke path, where a 200 kB parse per quote is
 * not free.  `static_share` uses NaN for "not fixed".
 * @param {Float64Array} curve_x
 * @param {Float64Array} curve_u
 * @param {Float64Array} curve_slope
 * @param {Uint32Array} curve_off
 * @param {Uint32Array} slope_off
 * @param {Float64Array} curve_rate0
 * @param {Float64Array} curve_tail
 * @param {Uint32Array} src_of
 * @param {Uint32Array} dst_of
 * @param {Float64Array} static_share
 * @param {Uint32Array} heads_flat
 * @param {Uint32Array} heads_off
 * @param {Uint32Array} tails
 * @param {number} slots
 * @param {number} dst_slot
 * @param {number} amount_in
 * @param {Float64Array} start_flat
 * @param {Uint32Array} start_off
 * @param {Uint32Array} free_slot
 * @param {Uint32Array} free_index
 * @param {number} min_weight
 * @param {number} iters
 * @param {number} sweeps
 * @param {number} window
 * @param {number} sweep_tol
 * @returns {AscendResult}
 */
export function splitAscend(curve_x, curve_u, curve_slope, curve_off, slope_off, curve_rate0, curve_tail, src_of, dst_of, static_share, heads_flat, heads_off, tails, slots, dst_slot, amount_in, start_flat, start_off, free_slot, free_index, min_weight, iters, sweeps, window, sweep_tol) {
    const ptr0 = passArrayF64ToWasm0(curve_x, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(curve_u, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(curve_slope, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray32ToWasm0(curve_off, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray32ToWasm0(slope_off, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArrayF64ToWasm0(curve_rate0, wasm.__wbindgen_malloc);
    const len5 = WASM_VECTOR_LEN;
    const ptr6 = passArrayF64ToWasm0(curve_tail, wasm.__wbindgen_malloc);
    const len6 = WASM_VECTOR_LEN;
    const ptr7 = passArray32ToWasm0(src_of, wasm.__wbindgen_malloc);
    const len7 = WASM_VECTOR_LEN;
    const ptr8 = passArray32ToWasm0(dst_of, wasm.__wbindgen_malloc);
    const len8 = WASM_VECTOR_LEN;
    const ptr9 = passArrayF64ToWasm0(static_share, wasm.__wbindgen_malloc);
    const len9 = WASM_VECTOR_LEN;
    const ptr10 = passArray32ToWasm0(heads_flat, wasm.__wbindgen_malloc);
    const len10 = WASM_VECTOR_LEN;
    const ptr11 = passArray32ToWasm0(heads_off, wasm.__wbindgen_malloc);
    const len11 = WASM_VECTOR_LEN;
    const ptr12 = passArray32ToWasm0(tails, wasm.__wbindgen_malloc);
    const len12 = WASM_VECTOR_LEN;
    const ptr13 = passArrayF64ToWasm0(start_flat, wasm.__wbindgen_malloc);
    const len13 = WASM_VECTOR_LEN;
    const ptr14 = passArray32ToWasm0(start_off, wasm.__wbindgen_malloc);
    const len14 = WASM_VECTOR_LEN;
    const ptr15 = passArray32ToWasm0(free_slot, wasm.__wbindgen_malloc);
    const len15 = WASM_VECTOR_LEN;
    const ptr16 = passArray32ToWasm0(free_index, wasm.__wbindgen_malloc);
    const len16 = WASM_VECTOR_LEN;
    const ret = wasm.splitAscend(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8, ptr9, len9, ptr10, len10, ptr11, len11, ptr12, len12, slots, dst_slot, amount_in, ptr13, len13, ptr14, len14, ptr15, len15, ptr16, len16, min_weight, iters, sweeps, window, sweep_tol);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return AscendResult.__wrap(ret[0]);
}

/**
 * Send a panic's message to the console before the trap takes the instance
 * down.  `panic = "abort"` is deliberate -- unwinding across the FFI is not
 * something to rely on -- so this is the only chance to say what happened,
 * and without it a bug reads as a bare `RuntimeError: unreachable`.
 */
export function start() {
    wasm.start();
}

/**
 * What the module is, so a shim can refuse a stale copy.
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_408e67f47ca7b58b: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_string_get_d154f1e671052120: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_70ffa8d6e18c9d6d: function(arg0, arg1) {
            console.error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./erouter_wasm_bg.js": import0,
    };
}

const AscendResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_ascendresult_free(ptr, 1));
const BatchResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_batchresult_free(ptr, 1));
const CalibrationOutFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_calibrationout_free(ptr, 1));
const CallResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_callresult_free(ptr, 1));
const CycleResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_cycleresult_free(ptr, 1));
const EvmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_evm_free(ptr, 1));
const MissReportFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_missreport_free(ptr, 1));
const PathResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_pathresult_free(ptr, 1));
const ProblemFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_problem_free(ptr, 1));
const SolveResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_solveresult_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('erouter_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

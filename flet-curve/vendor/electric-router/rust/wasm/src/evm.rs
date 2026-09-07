//! The EVM's exports.
//!
//! Same surface as `rust/evm/src/py.rs`, spelled the same way, because one
//! Python module drives either: hex strings for addresses, slots and values,
//! byte arrays for code and calldata, plain numbers for gas.

use erouter_evm::Evm as Core;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct CallResult {
    success: bool,
    output: Vec<u8>,
    gas_used: u64,
    revert_reason: Option<String>,
    halt_reason: Option<String>,
}

#[wasm_bindgen]
impl CallResult {
    #[wasm_bindgen(getter)]
    pub fn success(&self) -> bool { self.success }
    #[wasm_bindgen(getter)]
    pub fn output(&self) -> Vec<u8> { self.output.clone() }
    #[wasm_bindgen(getter, js_name = gasUsed)]
    pub fn gas_used(&self) -> f64 { self.gas_used as f64 }
    #[wasm_bindgen(getter, js_name = revertReason)]
    pub fn revert_reason(&self) -> Option<String> { self.revert_reason.clone() }
    #[wasm_bindgen(getter, js_name = haltReason)]
    pub fn halt_reason(&self) -> Option<String> { self.halt_reason.clone() }
}

#[wasm_bindgen]
pub struct Evm {
    inner: Core,
}

#[wasm_bindgen]
impl Evm {
    #[wasm_bindgen(constructor)]
    pub fn new(spec: &str, chain_id: f64) -> Result<Evm, JsError> {
        Core::new(spec, chain_id as u64)
            .map(|inner| Evm { inner })
            .map_err(|e| JsError::new(&e))
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = setBlock)]
    pub fn set_block(
        &mut self,
        number: f64,
        timestamp: f64,
        basefee: f64,
        gas_limit: f64,
        coinbase: &str,
        prevrandao: &str,
        excess_blob_gas: Option<f64>,
    ) -> Result<(), JsError> {
        self.inner.set_block(
            number as u64,
            timestamp as u64,
            basefee as u64,
            gas_limit as u64,
            parse_address(coinbase)?,
            parse_hash(prevrandao)?,
            excess_blob_gas.map(|v| v as u64),
        );
        Ok(())
    }

    #[wasm_bindgen(js_name = insertAccount)]
    pub fn insert_account(
        &mut self,
        address: &str,
        nonce: f64,
        balance: &str,
        code: Option<Vec<u8>>,
    ) -> Result<(), JsError> {
        self.inner.insert_account(
            parse_address(address)?,
            nonce as u64,
            parse_word(balance)?,
            code.as_deref(),
        );
        Ok(())
    }

    #[wasm_bindgen(js_name = setBalance)]
    pub fn set_balance(&mut self, address: &str, balance: &str) -> Result<(), JsError> {
        self.inner.set_balance(parse_address(address)?, parse_word(balance)?);
        Ok(())
    }

    #[wasm_bindgen(js_name = insertStorage)]
    pub fn insert_storage(&mut self, address: &str, slot: &str, value: &str) -> Result<(), JsError> {
        self.inner
            .insert_storage(parse_address(address)?, parse_word(slot)?, parse_word(value)?);
        Ok(())
    }

    /// The sweep inserts thousands at a time, so they arrive as three parallel
    /// arrays of strings rather than as three thousand calls.
    #[wasm_bindgen(js_name = insertStorageMany)]
    pub fn insert_storage_many(
        &mut self,
        addresses: Vec<String>,
        slots: Vec<String>,
        values: Vec<String>,
    ) -> Result<(), JsError> {
        if addresses.len() != slots.len() || slots.len() != values.len() {
            return Err(JsError::new("addresses, slots and values must be the same length"));
        }
        for k in 0..addresses.len() {
            self.inner.insert_storage(
                parse_address(&addresses[k])?,
                parse_word(&slots[k])?,
                parse_word(&values[k])?,
            );
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = insertBlockHash)]
    pub fn insert_block_hash(&mut self, number: f64, hash: &str) -> Result<(), JsError> {
        self.inner.insert_block_hash(number as u64, parse_hash(hash)?);
        Ok(())
    }

    #[wasm_bindgen(js_name = hasAccount)]
    pub fn has_account(&self, address: &str) -> Result<bool, JsError> {
        Ok(self.inner.has_account(&parse_address(address)?))
    }

    /// `[addr, slot, addr, slot, ...]`, flat, because a JS array of pairs is
    /// an array of arrays and this is read at every refresh.
    #[wasm_bindgen(js_name = knownSlots)]
    pub fn known_slots(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (address, slot) in self.inner.known_slots() {
            out.push(format!("{address:?}"));
            out.push(format!("{slot:#x}"));
        }
        out
    }

    #[wasm_bindgen(getter, js_name = slotCount)]
    pub fn slot_count(&self) -> usize {
        self.inner.slot_count()
    }

    #[wasm_bindgen(getter, js_name = accountCount)]
    pub fn account_count(&self) -> usize {
        self.inner.account_count()
    }

    /// Everything the calls since the last drain read and did not find.
    #[wasm_bindgen(js_name = takeMisses)]
    pub fn take_misses(&mut self) -> MissReport {
        let misses = self.inner.take_misses();
        let mut slots = Vec::with_capacity(misses.slots.len() * 2);
        for (address, slot) in &misses.slots {
            slots.push(format!("{address:?}"));
            slots.push(format!("{slot:#x}"));
        }
        MissReport {
            accounts: misses.accounts.iter().map(|a| format!("{a:?}")).collect(),
            slots,
            blocks: misses.blocks.iter().map(|&v| v as f64).collect(),
        }
    }

    #[wasm_bindgen]
    pub fn call(
        &mut self,
        caller: &str,
        to: &str,
        data: &[u8],
        value: &str,
        gas_limit: f64,
    ) -> Result<CallResult, JsError> {
        let out = self.inner.call(
            parse_address(caller)?,
            parse_address(to)?,
            data,
            parse_word(value)?,
            gas_limit as u64,
        );
        Ok(CallResult {
            success: out.success,
            output: out.output,
            gas_used: out.gas_used,
            revert_reason: out.revert_reason,
            halt_reason: out.halt_reason,
        })
    }

    /// A probe batch is hundreds of calls, and crossing per call cost a
    /// measurable share of a warm quote.  Targets arrive as one array of
    /// addresses, calldata as one flat byte array with offsets beside it, and
    /// the answers come back the same way.
    #[wasm_bindgen(js_name = callMany)]
    pub fn call_many(
        &mut self,
        caller: &str,
        to: Vec<String>,
        data: &[u8],
        offsets: &[u32],
        gas_limit: f64,
    ) -> Result<BatchResult, JsError> {
        if offsets.len() != to.len() + 1 {
            return Err(JsError::new("offsets must have one more entry than there are calls"));
        }
        let caller = parse_address(caller)?;
        let mut out = BatchResult {
            success: Vec::with_capacity(to.len()),
            halted: Vec::with_capacity(to.len()),
            gas_used: Vec::with_capacity(to.len()),
            output: Vec::new(),
            offsets: Vec::with_capacity(to.len() + 1),
            reasons: Vec::with_capacity(to.len()),
        };
        out.offsets.push(0);
        for (k, target) in to.iter().enumerate() {
            let (lo, hi) = (offsets[k] as usize, offsets[k + 1] as usize);
            if lo > hi || hi > data.len() {
                return Err(JsError::new("offsets run past the flattened calldata"));
            }
            let one = self.inner.call(
                caller,
                parse_address(target)?,
                &data[lo..hi],
                U256_ZERO,
                gas_limit as u64,
            );
            out.success.push(one.success as u8);
            out.gas_used.push(one.gas_used as f64);
            out.output.extend_from_slice(&one.output);
            out.offsets.push(out.output.len() as u32);
            // Which of the two the reason is, kept apart here so the Python
            // side sees the same two fields a single `call` gives it.  A
            // reverting pool and a call that ran out of gas are different
            // facts, and only one of them says anything about the pool.
            out.halted.push(one.halt_reason.is_some() as u8);
            out.reasons.push(
                one.halt_reason
                    .or(one.revert_reason)
                    .unwrap_or_default(),
            );
        }
        Ok(out)
    }
}

/// What a run of calls read and did not find.  `slots` is flat --
/// `[address, slot, address, slot, ...]` -- because a JS array of pairs is an
/// array of arrays, and this is read after every stage of the warm.
#[wasm_bindgen]
pub struct MissReport {
    accounts: Vec<String>,
    slots: Vec<String>,
    blocks: Vec<f64>,
}

#[wasm_bindgen]
impl MissReport {
    #[wasm_bindgen(getter)]
    pub fn accounts(&self) -> Vec<String> { self.accounts.clone() }
    #[wasm_bindgen(getter)]
    pub fn slots(&self) -> Vec<String> { self.slots.clone() }
    #[wasm_bindgen(getter)]
    pub fn blocks(&self) -> Vec<f64> { self.blocks.clone() }
}

/// Many calls' answers, flattened.  `gasUsed` is `f64` rather than `u64` so it
/// arrives as a plain number array instead of `BigInt64Array`; gas fits in 53
/// bits many times over.
#[wasm_bindgen]
pub struct BatchResult {
    success: Vec<u8>,
    halted: Vec<u8>,
    gas_used: Vec<f64>,
    output: Vec<u8>,
    offsets: Vec<u32>,
    reasons: Vec<String>,
}

#[wasm_bindgen]
impl BatchResult {
    #[wasm_bindgen(getter)]
    pub fn success(&self) -> Vec<u8> { self.success.clone() }
    #[wasm_bindgen(getter)]
    pub fn halted(&self) -> Vec<u8> { self.halted.clone() }
    #[wasm_bindgen(getter, js_name = gasUsed)]
    pub fn gas_used(&self) -> Vec<f64> { self.gas_used.clone() }
    #[wasm_bindgen(getter)]
    pub fn output(&self) -> Vec<u8> { self.output.clone() }
    #[wasm_bindgen(getter)]
    pub fn offsets(&self) -> Vec<u32> { self.offsets.clone() }
    #[wasm_bindgen(getter)]
    pub fn reasons(&self) -> Vec<String> { self.reasons.clone() }
}

const U256_ZERO: erouter_evm::U256 = erouter_evm::U256::ZERO;

fn parse_address(text: &str) -> Result<erouter_evm::Address, JsError> {
    erouter_evm::parse_address(text).map_err(|e| JsError::new(&e))
}

fn parse_word(text: &str) -> Result<erouter_evm::U256, JsError> {
    erouter_evm::parse_word(text).map_err(|e| JsError::new(&e))
}

fn parse_hash(text: &str) -> Result<erouter_evm::B256, JsError> {
    erouter_evm::parse_hash(text).map_err(|e| JsError::new(&e))
}

//! A read-only EVM at a pinned block, with no network under it.
//!
//! `dev/local_evm.py` established what this is for: sweep the universe's
//! storage once and a `get_dy` costs tens of microseconds instead of a round
//! trip, which is what makes probing a thousand arcs and gating every exact
//! model affordable.  That one is pyrevm, a CPython wheel with no wasm build.
//! This is the same idea written so the identical code answers in CPython and
//! in a browser: revm with pure-Rust precompiles, over `MemDb`, behind a
//! surface small enough to mirror in a wasm-bindgen shim.
//!
//! Calls are `eth_call`, not transactions: nothing is committed, the caller is
//! nobody, and the balance, nonce, fee and gas-limit gates are off -- a quote
//! must not depend on who is asking.

pub mod db;
#[cfg(feature = "python")]
mod py;

pub use db::{MemDb, Misses};
// Re-exported so a binding does not have to depend on revm directly to name
// the types its parsers return.
pub use revm::primitives::{Address, B256, U256};

use revm::context::{BlockEnv, CfgEnv, Context, TxEnv};
use revm::context_interface::result::{ExecutionResult, Output};
use revm::primitives::hardfork::SpecId;
use revm::primitives::{Bytes, TxKind};
use revm::state::Bytecode;
use revm::{ExecuteEvm, MainBuilder, MainContext};
use std::str::FromStr;

/// What one call produced.
#[derive(Debug, Clone, Default)]
pub struct CallOut {
    pub success: bool,
    pub output: Vec<u8>,
    pub gas_used: u64,
    /// The revert reason where the contract gave one -- a decoded
    /// `Error(string)` or `Panic(uint256)`, else the raw data as hex.
    pub revert_reason: Option<String>,
    /// A halt is not a revert: out of gas, a bad opcode, a stack overflow.
    /// Kept apart because it says the call was wrong, not that the pool said no.
    pub halt_reason: Option<String>,
}

/// The state a quote reads, and the machine that reads it.
pub struct Evm {
    db: MemDb,
    block: BlockEnv,
    spec: SpecId,
    chain_id: u64,
}

/// `Error(string)`.
const ERROR_SELECTOR: [u8; 4] = [0x08, 0xc3, 0x79, 0xa0];
/// `Panic(uint256)`.
const PANIC_SELECTOR: [u8; 4] = [0x4e, 0x48, 0x7b, 0x71];

/// Ethereum's own value; every chain we route on uses it.
const BLOB_BASE_FEE_UPDATE_FRACTION: u64 = 5_007_716;

impl Evm {
    /// `spec` is a hardfork name as revm spells it (`"Osaka"`, `"Cancun"`),
    /// case-insensitively.  It is a per-chain fact rather than a constant: a
    /// pool compiled for a newer EVM meets an invalid opcode under an older
    /// spec, and the quote reads as a revert.
    pub fn new(spec: &str, chain_id: u64) -> Result<Self, String> {
        Ok(Self {
            db: MemDb::default(),
            block: BlockEnv::default(),
            spec: parse_spec(spec)?,
            chain_id,
        })
    }

    /// The header the calls run against.  Zero is not a harmless default:
    /// 3pool's `A()` ramps off `block.timestamp` and underflows there, so every
    /// call would revert (`dev/local_evm.py` learned this the hard way).
    #[allow(clippy::too_many_arguments)]
    pub fn set_block(
        &mut self,
        number: u64,
        timestamp: u64,
        basefee: u64,
        gas_limit: u64,
        coinbase: Address,
        prevrandao: B256,
        excess_blob_gas: Option<u64>,
    ) {
        self.block.number = U256::from(number);
        self.block.timestamp = U256::from(timestamp);
        self.block.basefee = basefee;
        self.block.gas_limit = gas_limit;
        self.block.beneficiary = coinbase;
        self.block.prevrandao = Some(prevrandao);
        if let Some(excess) = excess_blob_gas {
            self.block
                .set_blob_excess_gas_and_price(excess, BLOB_BASE_FEE_UPDATE_FRACTION);
        }
    }

    pub fn insert_account(&mut self, address: Address, nonce: u64, balance: U256, code: Option<&[u8]>) {
        let code = code.map(|raw| Bytecode::new_raw(Bytes::copy_from_slice(raw)));
        self.db.insert_account(address, nonce, balance, code);
    }

    pub fn set_balance(&mut self, address: Address, balance: U256) {
        self.db.set_balance(address, balance);
    }

    pub fn insert_storage(&mut self, address: Address, slot: U256, value: U256) {
        self.db.insert_storage(address, slot, value);
    }

    pub fn insert_block_hash(&mut self, number: u64, hash: B256) {
        self.db.insert_block_hash(number, hash);
    }

    pub fn has_account(&self, address: &Address) -> bool {
        self.db.has_account(address)
    }

    pub fn storage_at(&self, address: &Address, slot: U256) -> Option<U256> {
        self.db.storage_at(address, slot)
    }

    pub fn code_size(&self, address: &Address) -> Option<usize> {
        self.db.code_size(address)
    }

    pub fn known_slots(&self) -> Vec<(Address, U256)> {
        self.db.known_slots()
    }

    pub fn slot_count(&self) -> usize {
        self.db.slot_count()
    }

    pub fn account_count(&self) -> usize {
        self.db.account_count()
    }

    /// What the calls since the last drain read and did not find.
    pub fn take_misses(&mut self) -> Misses {
        self.db.take_misses()
    }

    pub fn call(
        &mut self,
        caller: Address,
        to: Address,
        data: &[u8],
        value: U256,
        gas_limit: u64,
    ) -> CallOut {
        let spec = self.spec;
        let chain_id = self.chain_id;
        // The context is rebuilt per call so the borrow of `db` ends with it.
        // Measured against an EVM execution this is noise, and it keeps the
        // alternative -- naming `MainnetEvm<Context<..>>` in a struct field --
        // out of the code.
        // `with_spec_and_mainnet_gas_params` rather than `with_spec`: the
        // Amsterdam gas split (EIP-8037) is a property of the spec, and the
        // plain setter leaves the old gas params behind.
        let cfg = CfgEnv::new()
            .with_chain_id(chain_id)
            .with_spec_and_mainnet_gas_params(spec);
        let mut evm = Context::mainnet()
            .with_db(&mut self.db)
            .with_block(self.block.clone())
            .with_cfg(cfg)
            .modify_cfg_chained(|cfg| {
                // `eth_call` semantics.  A quote is asked by an account that
                // holds nothing and pays nothing; every one of these would
                // otherwise refuse a call a node answers.
                cfg.disable_balance_check = true;
                cfg.disable_nonce_check = true;
                cfg.disable_base_fee = true;
                cfg.disable_block_gas_limit = true;
                cfg.disable_eip3607 = true;
                cfg.disable_priority_fee_check = true;
                cfg.disable_fee_charge = true;
                // EIP-7825 caps a *transaction* at 16.7M gas from Osaka on.
                // A quote is not a transaction: one probe batch runs several
                // hundred sub-calls in a single `eth_call`, and a node answers
                // it because `eth_call` has no such cap.  `None` here means
                // "whatever the spec says", which is the cap -- so it is
                // lifted explicitly.
                cfg.tx_gas_limit_cap = Some(u64::MAX);
            })
            .build_mainnet();

        let tx = TxEnv::builder()
            .caller(caller)
            .kind(TxKind::Call(to))
            .data(Bytes::copy_from_slice(data))
            .value(value)
            .gas_limit(gas_limit)
            .gas_price(0)
            .chain_id(Some(chain_id))
            .build_fill();

        match evm.transact(tx) {
            Ok(done) => call_out(done.result),
            // A database that cannot fail leaves only malformed transactions
            // here, which is a bug in the caller rather than a pool saying no.
            Err(err) => CallOut {
                halt_reason: Some(format!("{err:?}")),
                ..Default::default()
            },
        }
    }
}

fn call_out<H: std::fmt::Debug>(result: ExecutionResult<H>) -> CallOut {
    let gas_used = result.tx_gas_used();
    match result {
        ExecutionResult::Success { output, .. } => CallOut {
            success: true,
            output: match output {
                Output::Call(bytes) => bytes.to_vec(),
                Output::Create(bytes, _) => bytes.to_vec(),
            },
            gas_used,
            ..Default::default()
        },
        ExecutionResult::Revert { output, .. } => CallOut {
            success: false,
            revert_reason: Some(revert_reason(&output)),
            output: output.to_vec(),
            gas_used,
            ..Default::default()
        },
        ExecutionResult::Halt { reason, .. } => CallOut {
            success: false,
            halt_reason: Some(format!("{reason:?}")),
            gas_used,
            ..Default::default()
        },
    }
}

/// A revert's data as something a person can read.
fn revert_reason(data: &[u8]) -> String {
    if data.len() >= 4 && data[..4] == ERROR_SELECTOR {
        if let Some(text) = decode_string(&data[4..]) {
            return text;
        }
    }
    if data.len() == 36 && data[..4] == PANIC_SELECTOR {
        let code = U256::from_be_slice(&data[4..36]);
        return format!("Panic({code:#x})");
    }
    if data.is_empty() {
        return String::new();
    }
    format!("0x{}", hex(data))
}

/// The one ABI shape worth decoding here: a lone `string` at offset 0x20.
fn decode_string(body: &[u8]) -> Option<String> {
    if body.len() < 64 {
        return None;
    }
    let offset = U256::from_be_slice(&body[..32]);
    let offset = usize::try_from(offset).ok()?;
    let length = U256::from_be_slice(body.get(offset..offset + 32)?);
    let length = usize::try_from(length).ok()?;
    let start = offset + 32;
    let text = body.get(start..start.checked_add(length)?)?;
    Some(String::from_utf8_lossy(text).into_owned())
}

fn hex(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len() * 2);
    for byte in data {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn parse_spec(spec: &str) -> Result<SpecId, String> {
    let wanted = spec.trim().to_ascii_lowercase();
    // revm spells them title case ("Osaka"); callers write them however they
    // like, and a chain table that says "OSAKA" should not be a runtime error.
    for candidate in [
        SpecId::FRONTIER, SpecId::HOMESTEAD, SpecId::TANGERINE, SpecId::SPURIOUS_DRAGON,
        SpecId::BYZANTIUM, SpecId::PETERSBURG, SpecId::ISTANBUL, SpecId::BERLIN,
        SpecId::LONDON, SpecId::MERGE, SpecId::SHANGHAI, SpecId::CANCUN,
        SpecId::PRAGUE, SpecId::OSAKA, SpecId::AMSTERDAM,
    ] {
        if candidate.to_string().to_ascii_lowercase() == wanted {
            return Ok(candidate);
        }
    }
    SpecId::from_str(spec).map_err(|_| format!("unknown hardfork: {spec}"))
}

// ------------------------------------------------------------------ parsing
//
// Addresses, slots and values cross every binding as hex strings.  JSON-RPC
// already speaks that; a 256-bit integer has no representation that survives
// both a Python and a JavaScript round trip; and the cost is microseconds
// against a call that takes hundreds of them.  The parsers live here so the
// two bindings cannot drift on what they accept.

pub fn parse_address(text: &str) -> Result<Address, String> {
    Address::from_str(text).map_err(|_| format!("not an address: {text}"))
}

pub fn parse_word(text: &str) -> Result<U256, String> {
    let trimmed = text.strip_prefix("0x").unwrap_or(text);
    if trimmed.is_empty() {
        return Ok(U256::ZERO);
    }
    U256::from_str_radix(trimmed, 16).map_err(|_| format!("not a 256-bit word: {text}"))
}

pub fn parse_hash(text: &str) -> Result<B256, String> {
    B256::from_str(text).map_err(|_| format!("not a hash: {text}"))
}

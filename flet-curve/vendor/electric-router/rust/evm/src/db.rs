//! The state a quote reads, held in memory -- and the reads it could not answer.
//!
//! Everything the router asks is a read at one pinned block, so the state is
//! fetched once and inserted here.  What makes this different from revm's own
//! `CacheDB` is the miss sets: a slot that was never inserted reads as **zero**
//! rather than as an error, which is a plausible fee, rate or balance and gives
//! a quote that is silently wrong.  `CacheDB` would remember that zero and stop
//! asking.  Here every miss is recorded, so the caller can go and fetch exactly
//! what was touched and run the call again -- which is also how a pool that has
//! begun reading a slot it was not reading before (an oracle round advancing, a
//! LLAMMA band moving) gets discovered without an access list.

use revm::database_interface::Database;
use revm::primitives::{Address, StorageKey, StorageValue, B256, U256};
use revm::state::{AccountInfo, Bytecode};
use std::collections::{BTreeSet, HashMap};
use std::convert::Infallible;

/// What a run of calls read and did not find.
#[derive(Debug, Default, Clone)]
pub struct Misses {
    pub accounts: Vec<Address>,
    pub slots: Vec<(Address, U256)>,
    pub blocks: Vec<u64>,
}

impl Misses {
    pub fn is_empty(&self) -> bool {
        self.accounts.is_empty() && self.slots.is_empty() && self.blocks.is_empty()
    }
}

#[derive(Debug, Default)]
pub struct MemDb {
    accounts: HashMap<Address, AccountInfo>,
    /// Code by hash, for the rare caller that reads it that way; `AccountInfo`
    /// carries the bytecode inline, which is the path an ordinary call takes.
    codes: HashMap<B256, Bytecode>,
    storage: HashMap<Address, HashMap<U256, U256>>,
    block_hashes: HashMap<u64, B256>,
    missed_accounts: BTreeSet<Address>,
    missed_slots: BTreeSet<(Address, U256)>,
    missed_blocks: BTreeSet<u64>,
}

impl MemDb {
    pub fn insert_account(&mut self, address: Address, nonce: u64, balance: U256, code: Option<Bytecode>) {
        let mut info = AccountInfo::default();
        info.nonce = nonce;
        info.balance = balance;
        if let Some(code) = code {
            info.code_hash = code.hash_slow();
            self.codes.insert(info.code_hash, code.clone());
            info.code = Some(code);
        }
        self.accounts.insert(address, info);
        self.missed_accounts.remove(&address);
    }

    pub fn set_balance(&mut self, address: Address, balance: U256) {
        self.accounts.entry(address).or_default().balance = balance;
        self.missed_accounts.remove(&address);
    }

    pub fn insert_storage(&mut self, address: Address, slot: U256, value: U256) {
        self.storage.entry(address).or_default().insert(slot, value);
        self.missed_slots.remove(&(address, slot));
    }

    pub fn insert_block_hash(&mut self, number: u64, hash: B256) {
        self.block_hashes.insert(number, hash);
        self.missed_blocks.remove(&number);
    }

    pub fn has_account(&self, address: &Address) -> bool {
        self.accounts.contains_key(address)
    }

    /// What this holds for a slot, without counting the read as a miss.
    /// For tests and for saying why a quote came out wrong.
    pub fn storage_at(&self, address: &Address, slot: U256) -> Option<U256> {
        self.storage.get(address).and_then(|s| s.get(&slot)).copied()
    }

    /// How much code an account has, or `None` if there is no account.
    pub fn code_size(&self, address: &Address) -> Option<usize> {
        self.accounts.get(address).map(|info| {
            info.code.as_ref().map(|c| c.original_bytes().len()).unwrap_or(0)
        })
    }

    pub fn slot_count(&self) -> usize {
        self.storage.values().map(|s| s.len()).sum()
    }

    pub fn account_count(&self) -> usize {
        self.accounts.len()
    }

    /// Every slot inserted so far, so a caller can re-read the same set at a
    /// new block without having to remember what it asked for.
    pub fn known_slots(&self) -> Vec<(Address, U256)> {
        let mut out = Vec::with_capacity(self.slot_count());
        for (address, slots) in &self.storage {
            for slot in slots.keys() {
                out.push((*address, *slot));
            }
        }
        out.sort_unstable();
        out
    }

    pub fn take_misses(&mut self) -> Misses {
        Misses {
            accounts: std::mem::take(&mut self.missed_accounts).into_iter().collect(),
            slots: std::mem::take(&mut self.missed_slots).into_iter().collect(),
            blocks: std::mem::take(&mut self.missed_blocks).into_iter().collect(),
        }
    }
}

impl Database for MemDb {
    type Error = Infallible;

    fn basic(&mut self, address: Address) -> Result<Option<AccountInfo>, Infallible> {
        match self.accounts.get(&address) {
            Some(info) => Ok(Some(info.clone())),
            None => {
                self.missed_accounts.insert(address);
                Ok(None)
            }
        }
    }

    fn code_by_hash(&mut self, code_hash: B256) -> Result<Bytecode, Infallible> {
        Ok(self.codes.get(&code_hash).cloned().unwrap_or_default())
    }

    fn storage(&mut self, address: Address, index: StorageKey) -> Result<StorageValue, Infallible> {
        match self.storage.get(&address).and_then(|s| s.get(&index)) {
            Some(value) => Ok(*value),
            None => {
                // An account with no code cannot have storage worth reading;
                // recording those would send the caller after slots no node
                // holds.  A missing *account* is reported by `basic` already.
                if self.accounts.contains_key(&address) {
                    self.missed_slots.insert((address, index));
                }
                Ok(U256::ZERO)
            }
        }
    }

    fn block_hash(&mut self, number: u64) -> Result<B256, Infallible> {
        match self.block_hashes.get(&number) {
            Some(hash) => Ok(*hash),
            None => {
                self.missed_blocks.insert(number);
                Ok(B256::ZERO)
            }
        }
    }
}

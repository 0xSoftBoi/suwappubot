//! Crash-safe one-shot execution ledger.
//!
//! A signing execution is durably tombstoned *before* round-one nonce creation.
//! Tombstones are never deleted, including after success.  A crash can therefore
//! strand an execution (availability loss), but cannot silently make its nonce
//! namespace reusable.

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha512};
use thiserror::Error;

const RECORD_MAGIC: &[u8] = b"SUWAPPU-MPC-EXEC-v1\n";

#[derive(Debug, Error)]
pub enum LedgerError {
    #[error("key id and execution id must be non-empty and bounded")]
    InvalidIdentifier,
    #[error("ledger parent directory must already exist")]
    MissingParent,
    #[error("signing execution has already been reserved")]
    Replay,
    #[error("ledger I/O failed: {0}")]
    Io(#[from] io::Error),
}

#[derive(Debug)]
pub struct ExecutionLedger {
    root: PathBuf,
}

#[derive(Debug)]
pub struct Reservation {
    path: PathBuf,
    root: PathBuf,
}

impl ExecutionLedger {
    /// Open or create the ledger directory.  We deliberately refuse to create
    /// missing parents: callers must provision the durability boundary
    /// explicitly rather than accidentally falling back to a transient path.
    pub fn open(root: impl AsRef<Path>) -> Result<Self, LedgerError> {
        let root = root.as_ref();
        if root.exists() {
            if !root.is_dir() {
                return Err(LedgerError::Io(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "ledger path is not a directory",
                )));
            }
        } else {
            let parent = root.parent().ok_or(LedgerError::MissingParent)?;
            if !parent.is_dir() {
                return Err(LedgerError::MissingParent);
            }
            fs::create_dir(root)?;
            // Persist the directory entry itself.  Otherwise a power loss can
            // erase the ledger directory and with it the replay history.
            fsync_dir(parent)?;
        }
        Ok(Self {
            root: root.to_path_buf(),
        })
    }

    /// Persist a one-shot execution tombstone.  The caller MUST wait for this
    /// function to return before asking the cryptographic core for nonces.
    pub fn reserve(
        &self,
        key_id: &str,
        execution_id: &str,
        intent_hash: [u8; 32],
    ) -> Result<Reservation, LedgerError> {
        validate_identifier(key_id)?;
        validate_identifier(execution_id)?;

        let record_id = record_id(key_id, execution_id);
        let path = self.root.join(format!("{record_id}.exec"));
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                return Err(LedgerError::Replay)
            }
            Err(error) => return Err(LedgerError::Io(error)),
        };

        // The record contains hashes/identifiers only, never key shares or
        // nonces.  An incomplete record is still a tombstone and stays blocked.
        file.write_all(RECORD_MAGIC)?;
        file.write_all(b"intent=")?;
        file.write_all(to_hex(&intent_hash).as_bytes())?;
        file.write_all(b"\nstate=reserved\n")?;
        file.sync_all()?;
        fsync_dir(&self.root)?;

        Ok(Reservation {
            path,
            root: self.root.clone(),
        })
    }
}

impl Reservation {
    /// Mark completion for auditability.  The tombstone is intentionally kept
    /// forever, so even a successful execution id can never be replayed.
    pub fn mark_completed(self) -> Result<(), LedgerError> {
        let mut file = OpenOptions::new().append(true).open(&self.path)?;
        file.write_all(b"state=completed\n")?;
        file.sync_all()?;
        fsync_dir(&self.root)?;
        Ok(())
    }
}

fn validate_identifier(value: &str) -> Result<(), LedgerError> {
    if value.is_empty() || value.len() > 256 {
        return Err(LedgerError::InvalidIdentifier);
    }
    Ok(())
}

fn record_id(key_id: &str, execution_id: &str) -> String {
    let mut hasher = Sha512::new();
    hasher.update(b"suwappu/native-mpc/execution-ledger/v1\0");
    hasher.update((key_id.len() as u64).to_be_bytes());
    hasher.update(key_id.as_bytes());
    hasher.update((execution_id.len() as u64).to_be_bytes());
    hasher.update(execution_id.as_bytes());
    let digest: [u8; 64] = hasher.finalize().into();
    to_hex(&digest[..32])
}

fn to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn fsync_dir(path: &Path) -> Result<(), io::Error> {
    File::open(path)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_id_is_one_shot_even_after_success() {
        let temp = tempfile::tempdir().unwrap();
        let ledger = ExecutionLedger::open(temp.path().join("ledger")).unwrap();
        let reservation = ledger
            .reserve("key-1", "execution-1", [7u8; 32])
            .unwrap();
        assert!(matches!(
            ledger.reserve("key-1", "execution-1", [7u8; 32]),
            Err(LedgerError::Replay)
        ));
        reservation.mark_completed().unwrap();
        assert!(matches!(
            ledger.reserve("key-1", "execution-1", [7u8; 32]),
            Err(LedgerError::Replay)
        ));
    }

    #[test]
    fn crash_before_completion_still_tombstones_execution() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("ledger");
        {
            let ledger = ExecutionLedger::open(&root).unwrap();
            let _reservation = ledger
                .reserve("key-1", "execution-crashed", [9u8; 32])
                .unwrap();
            // Drop without marking completion, modelling a process crash after
            // reservation and before/while signing.
        }
        let reopened = ExecutionLedger::open(&root).unwrap();
        assert!(matches!(
            reopened.reserve("key-1", "execution-crashed", [9u8; 32]),
            Err(LedgerError::Replay)
        ));
    }

    #[test]
    fn refuses_to_invent_a_missing_durability_parent() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("missing-parent").join("ledger");
        assert!(matches!(
            ExecutionLedger::open(root),
            Err(LedgerError::MissingParent)
        ));
    }
}

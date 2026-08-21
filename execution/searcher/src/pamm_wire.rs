use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use thiserror::Error;

const QUOTE_TYPE: &str = "Quote(uint64 epoch,uint64 sequence,bytes32 previousHash,uint64 validBlockMin,uint64 validBlockMax,uint64 validUntil,uint160 bidRateX96,uint160 askRateX96,uint96 maxBaseIn,uint96 maxBaseOut)";
const DOMAIN_TYPE: &str =
    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const NAME: &str = "SuwappuPropAMM";
const VERSION: &str = "1";
const U96_MAX: u128 = (1u128 << 96) - 1;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WireQuote {
    pub epoch: u64,
    pub sequence: u64,
    pub previous_hash: [u8; 32],
    pub valid_block_min: u64,
    pub valid_block_max: u64,
    pub valid_until: u64,
    /// This first implementation intentionally bounds Q96 rates to u128 even though the
    /// contract accepts uint160. Pairs that exceed this range fail closed until the
    /// signer path is upgraded to a full-width integer type.
    pub bid_rate_x96: u128,
    pub ask_rate_x96: u128,
    pub max_base_in: u128,
    pub max_base_out: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct QuoteTerms {
    pub target_block: u64,
    pub valid_until: u64,
    pub bid_rate_x96: u128,
    pub ask_rate_x96: u128,
    pub max_base_in: u128,
    pub max_base_out: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Eip712Domain {
    pub chain_id: u64,
    pub verifying_contract: [u8; 20],
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WireQuoteError {
    #[error("epoch must be nonzero")]
    InvalidEpoch,
    #[error("quote must target exactly one block")]
    InvalidBlock,
    #[error("bid/ask rate is invalid")]
    InvalidRate,
    #[error("base capacity exceeds uint96 or is zero")]
    InvalidCapacity,
    #[error("new epoch must strictly increase and reset sequence/parent")]
    InvalidEpochTransition,
    #[error("same-epoch sequence overflow")]
    SequenceOverflow,
}

pub fn chain_quote(
    epoch: u64,
    terms: QuoteTerms,
    previous: Option<&WireQuote>,
) -> Result<WireQuote, WireQuoteError> {
    if epoch == 0 {
        return Err(WireQuoteError::InvalidEpoch);
    }
    if terms.bid_rate_x96 == 0
        || terms.ask_rate_x96 == 0
        || terms.bid_rate_x96 > terms.ask_rate_x96
    {
        return Err(WireQuoteError::InvalidRate);
    }
    if terms.max_base_in == 0
        || terms.max_base_out == 0
        || terms.max_base_in > U96_MAX
        || terms.max_base_out > U96_MAX
    {
        return Err(WireQuoteError::InvalidCapacity);
    }

    let (sequence, previous_hash) = match previous {
        None => (0, [0u8; 32]),
        Some(previous) if previous.epoch == epoch => (
            previous
                .sequence
                .checked_add(1)
                .ok_or(WireQuoteError::SequenceOverflow)?,
            quote_struct_hash(previous),
        ),
        Some(previous) if epoch > previous.epoch => (0, [0u8; 32]),
        Some(_) => return Err(WireQuoteError::InvalidEpochTransition),
    };

    Ok(WireQuote {
        epoch,
        sequence,
        previous_hash,
        valid_block_min: terms.target_block,
        valid_block_max: terms.target_block,
        valid_until: terms.valid_until,
        bid_rate_x96: terms.bid_rate_x96,
        ask_rate_x96: terms.ask_rate_x96,
        max_base_in: terms.max_base_in,
        max_base_out: terms.max_base_out,
    })
}

#[must_use]
pub fn quote_typehash() -> [u8; 32] {
    keccak(QUOTE_TYPE.as_bytes())
}

#[must_use]
pub fn quote_struct_hash(quote: &WireQuote) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(32 * 11);
    encoded.extend_from_slice(&quote_typehash());
    encoded.extend_from_slice(&word_u64(quote.epoch));
    encoded.extend_from_slice(&word_u64(quote.sequence));
    encoded.extend_from_slice(&quote.previous_hash);
    encoded.extend_from_slice(&word_u64(quote.valid_block_min));
    encoded.extend_from_slice(&word_u64(quote.valid_block_max));
    encoded.extend_from_slice(&word_u64(quote.valid_until));
    encoded.extend_from_slice(&word_u128(quote.bid_rate_x96));
    encoded.extend_from_slice(&word_u128(quote.ask_rate_x96));
    encoded.extend_from_slice(&word_u128(quote.max_base_in));
    encoded.extend_from_slice(&word_u128(quote.max_base_out));
    keccak(&encoded)
}

#[must_use]
pub fn domain_separator(domain: Eip712Domain) -> [u8; 32] {
    let mut encoded = Vec::with_capacity(32 * 5);
    encoded.extend_from_slice(&keccak(DOMAIN_TYPE.as_bytes()));
    encoded.extend_from_slice(&keccak(NAME.as_bytes()));
    encoded.extend_from_slice(&keccak(VERSION.as_bytes()));
    encoded.extend_from_slice(&word_u64(domain.chain_id));
    let mut address_word = [0u8; 32];
    address_word[12..].copy_from_slice(&domain.verifying_contract);
    encoded.extend_from_slice(&address_word);
    keccak(&encoded)
}

#[must_use]
pub fn quote_digest(domain: Eip712Domain, quote: &WireQuote) -> [u8; 32] {
    let domain_hash = domain_separator(domain);
    let struct_hash = quote_struct_hash(quote);
    let mut encoded = [0u8; 66];
    encoded[0] = 0x19;
    encoded[1] = 0x01;
    encoded[2..34].copy_from_slice(&domain_hash);
    encoded[34..66].copy_from_slice(&struct_hash);
    keccak(&encoded)
}

fn word_u64(value: u64) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[24..].copy_from_slice(&value.to_be_bytes());
    word
}

fn word_u128(value: u128) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[16..].copy_from_slice(&value.to_be_bytes());
    word
}

fn keccak(bytes: &[u8]) -> [u8; 32] {
    let digest = Keccak256::digest(bytes);
    let mut out = [0u8; 32];
    out.copy_from_slice(&digest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terms(target_block: u64, valid_until: u64) -> QuoteTerms {
        QuoteTerms {
            target_block,
            valid_until,
            bid_rate_x96: 100,
            ask_rate_x96: 101,
            max_base_in: 1_000,
            max_base_out: 1_000,
        }
    }

    #[test]
    fn same_epoch_quote_chains_to_previous_struct_hash() {
        let first = chain_quote(1, terms(100, 200), None).unwrap();
        let second = chain_quote(1, terms(101, 201), Some(&first)).unwrap();
        assert_eq!(second.sequence, 1);
        assert_eq!(second.previous_hash, quote_struct_hash(&first));
    }

    #[test]
    fn new_epoch_resets_sequence_and_parent() {
        let first = chain_quote(1, terms(100, 200), None).unwrap();
        let second = chain_quote(2, terms(101, 201), Some(&first)).unwrap();
        assert_eq!(second.sequence, 0);
        assert_eq!(second.previous_hash, [0u8; 32]);
    }

    #[test]
    fn digest_changes_with_contract_domain() {
        let quote = chain_quote(1, terms(100, 200), None).unwrap();
        let a = quote_digest(
            Eip712Domain {
                chain_id: 1,
                verifying_contract: [0x11; 20],
            },
            &quote,
        );
        let b = quote_digest(
            Eip712Domain {
                chain_id: 1,
                verifying_contract: [0x22; 20],
            },
            &quote,
        );
        assert_ne!(a, b);
    }

    #[test]
    fn capacity_above_uint96_fails_closed() {
        let mut invalid = terms(100, 200);
        invalid.max_base_in = U96_MAX + 1;
        assert_eq!(
            chain_quote(1, invalid, None).unwrap_err(),
            WireQuoteError::InvalidCapacity
        );
    }
}

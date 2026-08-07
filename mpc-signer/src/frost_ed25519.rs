//! RFC 9591 FROST(Ed25519, SHA-512), implemented at the protocol layer.
//!
//! The curve and hash operations come from primitive crates; commitment-list
//! construction, binding factors, Lagrange interpolation, share generation,
//! share verification and aggregation live here.  Nonces are deliberately
//! non-cloneable and are consumed by [`KeyPackage::sign_share`].

use std::collections::{BTreeMap, BTreeSet};

use curve25519_dalek::{
    constants::ED25519_BASEPOINT_POINT,
    edwards::{CompressedEdwardsY, EdwardsPoint},
    scalar::Scalar,
    traits::Identity,
};
use ed25519_dalek::{Signature as Ed25519Signature, VerifyingKey};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha512};
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

const CONTEXT: &[u8] = b"FROST-ED25519-SHA512-v1";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum FrostError {
    #[error("participant identifier must be non-zero")]
    InvalidIdentifier,
    #[error("commitment list must contain at least two unique, sorted participants")]
    InvalidCommitmentList,
    #[error("invalid or non-canonical scalar encoding")]
    InvalidScalar,
    #[error("invalid, identity, non-canonical, or non-prime-order Edwards point")]
    InvalidElement,
    #[error("participant {0} is missing from the signing package")]
    MissingParticipant(u16),
    #[error("round-one commitment does not match the signer's one-shot nonce")]
    CommitmentMismatch,
    #[error("invalid signature share from participant {0}")]
    InvalidSignatureShare(u16),
    #[error("aggregate signature failed verification")]
    InvalidSignature,
    #[error("signing share does not match its verification share")]
    InvalidKeyPackage,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct ParticipantIdentifier(u16);

impl ParticipantIdentifier {
    pub fn new(value: u16) -> Result<Self, FrostError> {
        if value == 0 {
            return Err(FrostError::InvalidIdentifier);
        }
        Ok(Self(value))
    }

    pub fn get(self) -> u16 {
        self.0
    }

    fn scalar(self) -> Scalar {
        Scalar::from(u64::from(self.0))
    }

    fn serialize(self) -> [u8; 32] {
        self.scalar().to_bytes()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct SigningCommitments {
    hiding: EdwardsPoint,
    binding: EdwardsPoint,
}

impl SigningCommitments {
    pub fn from_bytes(hiding: [u8; 32], binding: [u8; 32]) -> Result<Self, FrostError> {
        Ok(Self {
            hiding: deserialize_element(hiding)?,
            binding: deserialize_element(binding)?,
        })
    }

    pub fn hiding_bytes(&self) -> [u8; 32] {
        self.hiding.compress().to_bytes()
    }

    pub fn binding_bytes(&self) -> [u8; 32] {
        self.binding.compress().to_bytes()
    }
}

/// Secret round-one state.  It is intentionally not `Clone`; signing consumes
/// it so the safe API cannot accidentally reuse a nonce pair.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SigningNonces {
    hiding: Scalar,
    binding: Scalar,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParticipantCommitment {
    pub identifier: ParticipantIdentifier,
    pub commitments: SigningCommitments,
}

impl ParticipantCommitment {
    pub fn new(identifier: ParticipantIdentifier, commitments: SigningCommitments) -> Self {
        Self {
            identifier,
            commitments,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VerificationShare {
    pub identifier: ParticipantIdentifier,
    point: EdwardsPoint,
}

impl VerificationShare {
    pub fn from_bytes(
        identifier: ParticipantIdentifier,
        encoded: [u8; 32],
    ) -> Result<Self, FrostError> {
        Ok(Self {
            identifier,
            point: deserialize_element(encoded)?,
        })
    }

    pub fn to_bytes(self) -> [u8; 32] {
        self.point.compress().to_bytes()
    }

    pub(crate) fn from_point(identifier: ParticipantIdentifier, point: EdwardsPoint) -> Self {
        Self { identifier, point }
    }
}

pub struct KeyPackage {
    identifier: ParticipantIdentifier,
    signing_share: Scalar,
    verification_share: VerificationShare,
    group_public_key: EdwardsPoint,
}

impl Drop for KeyPackage {
    fn drop(&mut self) {
        self.signing_share.zeroize();
    }
}

impl KeyPackage {
    pub fn from_parts(
        identifier: ParticipantIdentifier,
        signing_share_bytes: [u8; 32],
        verification_share_bytes: [u8; 32],
        group_public_key_bytes: [u8; 32],
    ) -> Result<Self, FrostError> {
        let signing_share = deserialize_scalar(signing_share_bytes)?;
        let verification_share = VerificationShare::from_bytes(identifier, verification_share_bytes)?;
        let group_public_key = deserialize_element(group_public_key_bytes)?;
        Self::from_scalars(identifier, signing_share, verification_share.point, group_public_key)
    }

    pub(crate) fn from_scalars(
        identifier: ParticipantIdentifier,
        signing_share: Scalar,
        verification_share: EdwardsPoint,
        group_public_key: EdwardsPoint,
    ) -> Result<Self, FrostError> {
        validate_element(&verification_share)?;
        validate_element(&group_public_key)?;
        if ED25519_BASEPOINT_POINT * signing_share != verification_share {
            return Err(FrostError::InvalidKeyPackage);
        }
        Ok(Self {
            identifier,
            signing_share,
            verification_share: VerificationShare::from_point(identifier, verification_share),
            group_public_key,
        })
    }

    pub fn identifier(&self) -> ParticipantIdentifier {
        self.identifier
    }

    pub fn verification_share(&self) -> VerificationShare {
        self.verification_share
    }

    pub fn group_public_key_bytes(&self) -> [u8; 32] {
        self.group_public_key.compress().to_bytes()
    }

    /// RFC 9591 round one.  Both nonces mix fresh OS randomness with the secret
    /// signing share through H3, exactly as section 4.1 specifies.
    pub fn commit(&self) -> (SigningNonces, SigningCommitments) {
        let mut rng = OsRng;
        loop {
            let mut hiding_randomness = [0u8; 32];
            let mut binding_randomness = [0u8; 32];
            rng.fill_bytes(&mut hiding_randomness);
            rng.fill_bytes(&mut binding_randomness);
            let result = commit_with_randomness(
                self.signing_share,
                hiding_randomness,
                binding_randomness,
            );
            hiding_randomness.zeroize();
            binding_randomness.zeroize();
            if let Some(result) = result {
                return result;
            }
        }
    }

    /// RFC 9591 round two.  `nonces` is consumed regardless of whether the
    /// operation succeeds, making nonce reuse harder to express accidentally.
    pub fn sign_share(
        &self,
        nonces: SigningNonces,
        message: &[u8],
        commitment_list: &[ParticipantCommitment],
    ) -> Result<SignatureShare, FrostError> {
        validate_commitment_list(commitment_list)?;
        let own = commitment_list
            .iter()
            .find(|entry| entry.identifier == self.identifier)
            .ok_or(FrostError::MissingParticipant(self.identifier.get()))?;

        let expected = SigningCommitments {
            hiding: ED25519_BASEPOINT_POINT * nonces.hiding,
            binding: ED25519_BASEPOINT_POINT * nonces.binding,
        };
        if own.commitments != expected {
            return Err(FrostError::CommitmentMismatch);
        }

        let rho = binding_factor(
            &self.group_public_key,
            commitment_list,
            message,
            self.identifier,
        )?;
        let group_commitment = compute_group_commitment(
            &self.group_public_key,
            commitment_list,
            message,
        )?;
        let lambda = derive_interpolating_value(commitment_list, self.identifier)?;
        let challenge = compute_challenge(&group_commitment, &self.group_public_key, message);
        let z = nonces.hiding
            + (nonces.binding * rho)
            + (lambda * self.signing_share * challenge);

        Ok(SignatureShare {
            identifier: self.identifier,
            scalar: z,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SignatureShare {
    pub identifier: ParticipantIdentifier,
    scalar: Scalar,
}

impl SignatureShare {
    pub fn from_bytes(
        identifier: ParticipantIdentifier,
        encoded: [u8; 32],
    ) -> Result<Self, FrostError> {
        Ok(Self {
            identifier,
            scalar: deserialize_scalar(encoded)?,
        })
    }

    pub fn to_bytes(self) -> [u8; 32] {
        self.scalar.to_bytes()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FrostSignature {
    commitment: EdwardsPoint,
    response: Scalar,
}

impl FrostSignature {
    pub fn from_bytes(encoded: [u8; 64]) -> Result<Self, FrostError> {
        let mut commitment = [0u8; 32];
        let mut response = [0u8; 32];
        commitment.copy_from_slice(&encoded[..32]);
        response.copy_from_slice(&encoded[32..]);
        Ok(Self {
            commitment: deserialize_element(commitment)?,
            response: deserialize_scalar(response)?,
        })
    }

    pub fn to_bytes(&self) -> [u8; 64] {
        let mut encoded = [0u8; 64];
        encoded[..32].copy_from_slice(&self.commitment.compress().to_bytes());
        encoded[32..].copy_from_slice(&self.response.to_bytes());
        encoded
    }
}

/// Verify a signature share before aggregation.  The verification share must
/// come from the key-generation transcript, never from the signing peer.
pub fn verify_signature_share(
    verification_share: VerificationShare,
    signature_share: SignatureShare,
    group_public_key_bytes: [u8; 32],
    message: &[u8],
    commitment_list: &[ParticipantCommitment],
) -> Result<(), FrostError> {
    if verification_share.identifier != signature_share.identifier {
        return Err(FrostError::InvalidSignatureShare(signature_share.identifier.get()));
    }
    validate_commitment_list(commitment_list)?;
    let group_public_key = deserialize_element(group_public_key_bytes)?;
    let own = commitment_list
        .iter()
        .find(|entry| entry.identifier == signature_share.identifier)
        .ok_or(FrostError::MissingParticipant(signature_share.identifier.get()))?;
    let rho = binding_factor(
        &group_public_key,
        commitment_list,
        message,
        signature_share.identifier,
    )?;
    let group_commitment =
        compute_group_commitment(&group_public_key, commitment_list, message)?;
    let lambda = derive_interpolating_value(commitment_list, signature_share.identifier)?;
    let challenge = compute_challenge(&group_commitment, &group_public_key, message);

    let left = ED25519_BASEPOINT_POINT * signature_share.scalar;
    let commitment_share = own.commitments.hiding + (own.commitments.binding * rho);
    let right = commitment_share + (verification_share.point * (challenge * lambda));
    if left != right {
        return Err(FrostError::InvalidSignatureShare(signature_share.identifier.get()));
    }
    Ok(())
}

/// Validate every share, aggregate it, then verify the final Ed25519-compatible
/// signature before returning bytes to a caller.
pub fn aggregate(
    group_public_key_bytes: [u8; 32],
    message: &[u8],
    commitment_list: &[ParticipantCommitment],
    verification_shares: &[VerificationShare],
    signature_shares: &[SignatureShare],
) -> Result<FrostSignature, FrostError> {
    validate_commitment_list(commitment_list)?;
    if verification_shares.len() != commitment_list.len()
        || signature_shares.len() != commitment_list.len()
    {
        return Err(FrostError::InvalidCommitmentList);
    }

    let verifying_by_id: BTreeMap<_, _> = verification_shares
        .iter()
        .copied()
        .map(|share| (share.identifier, share))
        .collect();
    let signature_by_id: BTreeMap<_, _> = signature_shares
        .iter()
        .copied()
        .map(|share| (share.identifier, share))
        .collect();
    if verifying_by_id.len() != commitment_list.len()
        || signature_by_id.len() != commitment_list.len()
    {
        return Err(FrostError::InvalidCommitmentList);
    }

    for commitment in commitment_list {
        let verification_share = verifying_by_id
            .get(&commitment.identifier)
            .copied()
            .ok_or(FrostError::MissingParticipant(commitment.identifier.get()))?;
        let signature_share = signature_by_id
            .get(&commitment.identifier)
            .copied()
            .ok_or(FrostError::MissingParticipant(commitment.identifier.get()))?;
        verify_signature_share(
            verification_share,
            signature_share,
            group_public_key_bytes,
            message,
            commitment_list,
        )?;
    }

    let group_public_key = deserialize_element(group_public_key_bytes)?;
    let group_commitment =
        compute_group_commitment(&group_public_key, commitment_list, message)?;
    let response = signature_shares
        .iter()
        .fold(Scalar::from(0u64), |acc, share| acc + share.scalar);
    let signature = FrostSignature {
        commitment: group_commitment,
        response,
    };
    verify_signature(group_public_key_bytes, message, &signature)?;
    Ok(signature)
}

/// Verify using the exact cofactored equation required by RFC 9591 section 6.1.
pub fn verify_signature(
    group_public_key_bytes: [u8; 32],
    message: &[u8],
    signature: &FrostSignature,
) -> Result<(), FrostError> {
    let group_public_key = deserialize_element(group_public_key_bytes)?;
    let challenge = compute_challenge(&signature.commitment, &group_public_key, message);
    let left = (ED25519_BASEPOINT_POINT * signature.response).mul_by_cofactor();
    let right = (signature.commitment + (group_public_key * challenge)).mul_by_cofactor();
    if left != right {
        return Err(FrostError::InvalidSignature);
    }
    Ok(())
}

/// A second, independent compatibility check through an ordinary Ed25519
/// verifier.  Solana sees the result as a normal 64-byte Ed25519 signature.
pub fn verify_with_ed25519(
    group_public_key_bytes: [u8; 32],
    message: &[u8],
    signature: &FrostSignature,
) -> Result<(), FrostError> {
    let verifying_key =
        VerifyingKey::from_bytes(&group_public_key_bytes).map_err(|_| FrostError::InvalidElement)?;
    let signature = Ed25519Signature::from_bytes(&signature.to_bytes());
    verifying_key
        .verify_strict(message, &signature)
        .map_err(|_| FrostError::InvalidSignature)
}

pub(crate) fn deserialize_scalar(encoded: [u8; 32]) -> Result<Scalar, FrostError> {
    Option::<Scalar>::from(Scalar::from_canonical_bytes(encoded)).ok_or(FrostError::InvalidScalar)
}

pub(crate) fn deserialize_element(encoded: [u8; 32]) -> Result<EdwardsPoint, FrostError> {
    let point = CompressedEdwardsY(encoded)
        .decompress()
        .ok_or(FrostError::InvalidElement)?;
    if point.compress().to_bytes() != encoded {
        return Err(FrostError::InvalidElement);
    }
    validate_element(&point)?;
    Ok(point)
}

pub(crate) fn validate_element(point: &EdwardsPoint) -> Result<(), FrostError> {
    if *point == EdwardsPoint::identity() || !point.is_torsion_free() {
        return Err(FrostError::InvalidElement);
    }
    Ok(())
}

fn hash_to_scalar(parts: &[&[u8]]) -> Scalar {
    let mut hasher = Sha512::new();
    for part in parts {
        hasher.update(part);
    }
    let digest: [u8; 64] = hasher.finalize().into();
    Scalar::from_bytes_mod_order_wide(&digest)
}

fn h1(message: &[u8]) -> Scalar {
    hash_to_scalar(&[CONTEXT, b"rho", message])
}

fn h2(message: &[u8]) -> Scalar {
    // Domain separation is deliberately omitted here for Ed25519 compatibility;
    // this is the special case required by RFC 9591 section 6.1.
    hash_to_scalar(&[message])
}

fn h3(randomness: [u8; 32], secret: Scalar) -> Scalar {
    let mut secret = secret.to_bytes();
    let nonce = hash_to_scalar(&[CONTEXT, b"nonce", &randomness, &secret]);
    secret.zeroize();
    nonce
}

fn h4(message: &[u8]) -> [u8; 64] {
    let mut hasher = Sha512::new();
    hasher.update(CONTEXT);
    hasher.update(b"msg");
    hasher.update(message);
    hasher.finalize().into()
}

fn h5(message: &[u8]) -> [u8; 64] {
    let mut hasher = Sha512::new();
    hasher.update(CONTEXT);
    hasher.update(b"com");
    hasher.update(message);
    hasher.finalize().into()
}

/// Returns `None` only for the negligible case where H3 reduces to zero and
/// would therefore create an identity commitment, which RFC serialization
/// rejects.  The public `commit()` method simply resamples fresh randomness.
fn commit_with_randomness(
    signing_share: Scalar,
    hiding_randomness: [u8; 32],
    binding_randomness: [u8; 32],
) -> Option<(SigningNonces, SigningCommitments)> {
    let hiding = h3(hiding_randomness, signing_share);
    let binding = h3(binding_randomness, signing_share);
    if hiding == Scalar::from(0u64) || binding == Scalar::from(0u64) {
        return None;
    }
    let commitments = SigningCommitments {
        hiding: ED25519_BASEPOINT_POINT * hiding,
        binding: ED25519_BASEPOINT_POINT * binding,
    };
    Some((SigningNonces { hiding, binding }, commitments))
}

fn validate_commitment_list(
    commitment_list: &[ParticipantCommitment],
) -> Result<(), FrostError> {
    if commitment_list.len() < 2 {
        return Err(FrostError::InvalidCommitmentList);
    }
    let mut prior = None;
    let mut seen = BTreeSet::new();
    for entry in commitment_list {
        validate_element(&entry.commitments.hiding)?;
        validate_element(&entry.commitments.binding)?;
        if let Some(prior_id) = prior {
            if entry.identifier <= prior_id {
                return Err(FrostError::InvalidCommitmentList);
            }
        }
        if !seen.insert(entry.identifier) {
            return Err(FrostError::InvalidCommitmentList);
        }
        prior = Some(entry.identifier);
    }
    Ok(())
}

fn encode_commitment_list(
    commitment_list: &[ParticipantCommitment],
) -> Result<Vec<u8>, FrostError> {
    validate_commitment_list(commitment_list)?;
    let mut encoded = Vec::with_capacity(commitment_list.len() * 96);
    for entry in commitment_list {
        encoded.extend_from_slice(&entry.identifier.serialize());
        encoded.extend_from_slice(&entry.commitments.hiding.compress().to_bytes());
        encoded.extend_from_slice(&entry.commitments.binding.compress().to_bytes());
    }
    Ok(encoded)
}

fn binding_factor_input(
    group_public_key: &EdwardsPoint,
    commitment_list: &[ParticipantCommitment],
    message: &[u8],
    identifier: ParticipantIdentifier,
) -> Result<Vec<u8>, FrostError> {
    validate_element(group_public_key)?;
    if !commitment_list
        .iter()
        .any(|entry| entry.identifier == identifier)
    {
        return Err(FrostError::MissingParticipant(identifier.get()));
    }
    let encoded_commitments = encode_commitment_list(commitment_list)?;
    let mut input = Vec::with_capacity(32 + 64 + 64 + 32);
    input.extend_from_slice(&group_public_key.compress().to_bytes());
    input.extend_from_slice(&h4(message));
    input.extend_from_slice(&h5(&encoded_commitments));
    input.extend_from_slice(&identifier.serialize());
    Ok(input)
}

fn binding_factor(
    group_public_key: &EdwardsPoint,
    commitment_list: &[ParticipantCommitment],
    message: &[u8],
    identifier: ParticipantIdentifier,
) -> Result<Scalar, FrostError> {
    Ok(h1(&binding_factor_input(
        group_public_key,
        commitment_list,
        message,
        identifier,
    )?))
}

fn compute_group_commitment(
    group_public_key: &EdwardsPoint,
    commitment_list: &[ParticipantCommitment],
    message: &[u8],
) -> Result<EdwardsPoint, FrostError> {
    validate_commitment_list(commitment_list)?;
    let mut group_commitment = EdwardsPoint::identity();
    for entry in commitment_list {
        let rho = binding_factor(
            group_public_key,
            commitment_list,
            message,
            entry.identifier,
        )?;
        group_commitment += entry.commitments.hiding + (entry.commitments.binding * rho);
    }
    validate_element(&group_commitment)?;
    Ok(group_commitment)
}

fn compute_challenge(
    group_commitment: &EdwardsPoint,
    group_public_key: &EdwardsPoint,
    message: &[u8],
) -> Scalar {
    let mut input = Vec::with_capacity(64 + message.len());
    input.extend_from_slice(&group_commitment.compress().to_bytes());
    input.extend_from_slice(&group_public_key.compress().to_bytes());
    input.extend_from_slice(message);
    h2(&input)
}

fn derive_interpolating_value(
    commitment_list: &[ParticipantCommitment],
    identifier: ParticipantIdentifier,
) -> Result<Scalar, FrostError> {
    validate_commitment_list(commitment_list)?;
    if !commitment_list
        .iter()
        .any(|entry| entry.identifier == identifier)
    {
        return Err(FrostError::MissingParticipant(identifier.get()));
    }

    let x_i = identifier.scalar();
    let mut numerator = Scalar::from(1u64);
    let mut denominator = Scalar::from(1u64);
    for entry in commitment_list {
        if entry.identifier == identifier {
            continue;
        }
        let x_j = entry.identifier.scalar();
        numerator *= x_j;
        denominator *= x_j - x_i;
    }
    Ok(numerator * denominator.invert())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes32(value: &str) -> [u8; 32] {
        let decoded = hex::decode(value).expect("valid hex fixture");
        decoded.try_into().expect("32-byte fixture")
    }

    fn scalar(value: &str) -> Scalar {
        deserialize_scalar(bytes32(value)).expect("canonical scalar fixture")
    }

    fn point(value: &str) -> EdwardsPoint {
        deserialize_element(bytes32(value)).expect("canonical point fixture")
    }

    #[test]
    fn matches_rfc9591_ed25519_vector_byte_for_byte() {
        // RFC 9591 Appendix E.1: 2-of-3, signers 1 and 3, message "test".
        let message = b"test";
        let group_public_key = point(
            "15d21ccd7ee42959562fc8aa63224c8851fb3ec85a3faf66040d380fb9738673",
        );
        let p1_id = ParticipantIdentifier::new(1).unwrap();
        let p3_id = ParticipantIdentifier::new(3).unwrap();
        let p1_share = scalar(
            "929dcc590407aae7d388761cddb0c0db6f5627aea8e217f4a033f2ec83d93509",
        );
        let p3_share = scalar(
            "d3cb090a075eb154e82fdb4b3cb507f110040905468bb9c46da8bdea643a9a02",
        );

        let (p1_nonces, p1_commitments) = commit_with_randomness(
            p1_share,
            bytes32("0fd2e39e111cdc266f6c0f4d0fd45c947761f1f5d3cb583dfcb9bbaf8d4c9fec"),
            bytes32("69cd85f631d5f7f2721ed5e40519b1366f340a87c2f6856363dbdcda348a7501"),
        )
        .unwrap();
        let (p3_nonces, p3_commitments) = commit_with_randomness(
            p3_share,
            bytes32("86d64a260059e495d0fb4fcc17ea3da7452391baa494d4b00321098ed2a0062f"),
            bytes32("13e6b25afb2eba51716a9a7d44130c0dbae0004a9ef8d7b5550c8a0e07c61775"),
        )
        .unwrap();

        assert_eq!(
            p1_commitments.hiding_bytes(),
            bytes32("b5aa8ab305882a6fc69cbee9327e5a45e54c08af61ae77cb8207be3d2ce13de3")
        );
        assert_eq!(
            p1_commitments.binding_bytes(),
            bytes32("67e98ab55aa310c3120418e5050c9cf76cf387cb20ac9e4b6fdb6f82a469f932")
        );
        assert_eq!(
            p3_commitments.hiding_bytes(),
            bytes32("cfbdb165bd8aad6eb79deb8d287bcc0ab6658ae57fdcc98ed12c0669e90aec91")
        );
        assert_eq!(
            p3_commitments.binding_bytes(),
            bytes32("7487bc41a6e712eea2f2af24681b58b1cf1da278ea11fe4e8b78398965f13552")
        );

        let commitment_list = vec![
            ParticipantCommitment::new(p1_id, p1_commitments),
            ParticipantCommitment::new(p3_id, p3_commitments),
        ];
        assert_eq!(
            binding_factor(&group_public_key, &commitment_list, message, p1_id)
                .unwrap()
                .to_bytes(),
            bytes32("f2cb9d7dd9beff688da6fcc83fa89046b3479417f47f55600b106760eb3b5603")
        );
        assert_eq!(
            binding_factor(&group_public_key, &commitment_list, message, p3_id)
                .unwrap()
                .to_bytes(),
            bytes32("b087686bf35a13f3dc78e780a34b0fe8a77fef1b9938c563f5573d71d8d7890f")
        );

        let p1_key = KeyPackage::from_scalars(
            p1_id,
            p1_share,
            ED25519_BASEPOINT_POINT * p1_share,
            group_public_key,
        )
        .unwrap();
        let p3_key = KeyPackage::from_scalars(
            p3_id,
            p3_share,
            ED25519_BASEPOINT_POINT * p3_share,
            group_public_key,
        )
        .unwrap();
        let p1_sig_share = p1_key
            .sign_share(p1_nonces, message, &commitment_list)
            .unwrap();
        let p3_sig_share = p3_key
            .sign_share(p3_nonces, message, &commitment_list)
            .unwrap();

        assert_eq!(
            p1_sig_share.to_bytes(),
            bytes32("001719ab5a53ee1a12095cd088fd149702c0720ce5fd2f29dbecf24b7281b603")
        );
        assert_eq!(
            p3_sig_share.to_bytes(),
            bytes32("bd86125de990acc5e1f13781d8e32c03a9bbd4c53539bbc106058bfd14326007")
        );

        let signature = aggregate(
            group_public_key.compress().to_bytes(),
            message,
            &commitment_list,
            &[p1_key.verification_share(), p3_key.verification_share()],
            &[p1_sig_share, p3_sig_share],
        )
        .unwrap();
        assert_eq!(
            hex::encode(signature.to_bytes()),
            concat!(
                "36282629c383bb820a88b71cae937d41f2f2adfcc3d02e55507e2fb9e2dd3cbe",
                "bd9d2b0844e49ae0f3fa935161e1419aab7b47d21a37ebeae1f17d4987b3160b"
            )
        );
        verify_with_ed25519(group_public_key.compress().to_bytes(), message, &signature).unwrap();
    }

    #[test]
    fn rejects_unsorted_or_duplicate_commitment_lists() {
        let id1 = ParticipantIdentifier::new(1).unwrap();
        let id2 = ParticipantIdentifier::new(2).unwrap();
        let commitments = SigningCommitments {
            hiding: ED25519_BASEPOINT_POINT * Scalar::from(3u64),
            binding: ED25519_BASEPOINT_POINT * Scalar::from(4u64),
        };
        let unsorted = vec![
            ParticipantCommitment::new(id2, commitments.clone()),
            ParticipantCommitment::new(id1, commitments.clone()),
        ];
        assert_eq!(
            validate_commitment_list(&unsorted),
            Err(FrostError::InvalidCommitmentList)
        );
        let duplicate = vec![
            ParticipantCommitment::new(id1, commitments.clone()),
            ParticipantCommitment::new(id1, commitments),
        ];
        assert_eq!(
            validate_commitment_list(&duplicate),
            Err(FrostError::InvalidCommitmentList)
        );
    }
}

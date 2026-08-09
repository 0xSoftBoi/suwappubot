//! Fixed 2-of-3 secp256k1 DKG core for the threshold-ECDSA path.
//!
//! The state machine follows the threshold key-generation construction in
//! CGGMP24 section 4.2.2: commit before reveal, reliable-echo agreement,
//! private Shamir shares checked against public coefficient commitments, and
//! a final Schnorr proof that each participant knows its resulting share.
//!
//! Network authentication/encryption and durable execution-ID reservation are
//! deployment responsibilities.  Callers must reserve the execution ID in the
//! one-shot ledger before `round1` because this function generates secrets.

use std::collections::BTreeSet;

use k256::{
    elliptic_curve::{bigint::U256, ff::PrimeField, ops::Reduce, sec1::ToEncodedPoint},
    FieldBytes, ProjectivePoint, Scalar,
};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroize;

pub const THRESHOLD: usize = 2;
pub const PARTICIPANT_COUNT: usize = 3;
pub const PROTOCOL_VERSION: &str = "suwappu-cggmp24-secp256k1-dkg-v1";

const EXECUTION_TAG: &[u8] = b"suwappu/cggmp24/secp256k1-dkg/execution/v1";
const COMMIT_TAG: &[u8] = b"suwappu/cggmp24/secp256k1-dkg/commit/v1";
const ECHO_TAG: &[u8] = b"suwappu/cggmp24/secp256k1-dkg/echo/v1";
const SCHNORR_TAG: &[u8] = b"suwappu/cggmp24/secp256k1-dkg/schnorr/v1";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DkgError {
    #[error("execution ID must not be empty")]
    EmptyExecutionId,
    #[error("participant must be one of 1, 2, or 3")]
    InvalidParticipant,
    #[error("package belongs to a different DKG execution")]
    ExecutionMismatch,
    #[error("expected exactly one canonical package from participants 1, 2, and 3")]
    InvalidPackageSet,
    #[error("reliable-echo digests do not all match")]
    EchoMismatch,
    #[error("participant {0} opened a different value than it committed")]
    CommitmentOpeningMismatch(u16),
    #[error("participant {0} supplied an invalid or identity curve point")]
    InvalidPoint(u16),
    #[error("private share is addressed to a different participant")]
    WrongRecipient,
    #[error("participant {0}'s private Shamir share failed Feldman verification")]
    InvalidShare(u16),
    #[error("final signing share does not match the public verification share")]
    FinalShareMismatch,
    #[error("participant {0}'s final Schnorr knowledge proof failed")]
    InvalidKnowledgeProof(u16),
    #[error("non-canonical scalar encoding")]
    InvalidScalar,
}

/// Canonical application-facing participant ID. CGGMP's zero-based party
/// index `i` is represented here as `i + 1`, which is also the nonzero Shamir
/// evaluation point.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ParticipantId(u16);

impl ParticipantId {
    pub fn new(raw: u16) -> Result<Self, DkgError> {
        if (1..=PARTICIPANT_COUNT as u16).contains(&raw) {
            Ok(Self(raw))
        } else {
            Err(DkgError::InvalidParticipant)
        }
    }

    pub fn get(self) -> u16 {
        self.0
    }

    fn scalar(self) -> Scalar {
        Scalar::from(u64::from(self.0))
    }
}

/// Hashed protocol context derived from a caller-supplied globally unique ID.
/// Reusing the caller input is forbidden; reserve it durably before `round1`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExecutionId([u8; 32]);

impl ExecutionId {
    pub fn new(unique_bytes: &[u8]) -> Result<Self, DkgError> {
        if unique_bytes.is_empty() {
            return Err(DkgError::EmptyExecutionId);
        }
        let mut hasher = Sha256::new();
        hasher.update(EXECUTION_TAG);
        hasher.update((unique_bytes.len() as u64).to_be_bytes());
        hasher.update(unique_bytes);
        Ok(Self(hasher.finalize().into()))
    }

    pub fn digest(self) -> [u8; 32] {
        self.0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Round1Commitment {
    pub identifier: ParticipantId,
    execution: [u8; 32],
    digest: [u8; 32],
}

impl Round1Commitment {
    pub fn digest(&self) -> [u8; 32] {
        self.digest
    }
}

/// Secret round-one state. It is intentionally non-cloneable and zeroizes all
/// scalar material on drop.
pub struct Round1State {
    identifier: ParticipantId,
    execution: [u8; 32],
    coefficients: [Scalar; THRESHOLD],
    rid: [u8; 32],
    schnorr_nonce: Scalar,
    schnorr_commitment: ProjectivePoint,
    commitment_blind: [u8; 32],
}

impl Drop for Round1State {
    fn drop(&mut self) {
        self.coefficients.zeroize();
        self.schnorr_nonce.zeroize();
        self.rid.zeroize();
        self.commitment_blind.zeroize();
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Round2Reveal {
    pub identifier: ParticipantId,
    execution: [u8; 32],
    rid: [u8; 32],
    coefficient_commitments: [ProjectivePoint; THRESHOLD],
    schnorr_commitment: ProjectivePoint,
    commitment_blind: [u8; 32],
}

impl Round2Reveal {
    pub fn commitment_bytes(&self) -> [[u8; 33]; THRESHOLD] {
        [
            encode_nonidentity_point(&self.coefficient_commitments[0])
                .expect("round-two reveal invariant"),
            encode_nonidentity_point(&self.coefficient_commitments[1])
                .expect("round-two reveal invariant"),
        ]
    }

    pub fn schnorr_commitment_bytes(&self) -> [u8; 33] {
        encode_nonidentity_point(&self.schnorr_commitment).expect("round-two reveal invariant")
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EchoPackage {
    pub identifier: ParticipantId,
    execution: [u8; 32],
    digest: [u8; 32],
}

impl EchoPackage {
    pub fn digest(&self) -> [u8; 32] {
        self.digest
    }
}

pub struct PrivateShare {
    pub sender: ParticipantId,
    pub recipient: ParticipantId,
    execution: [u8; 32],
    value: Scalar,
}

impl Drop for PrivateShare {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

impl PrivateShare {
    pub fn to_bytes(&self) -> [u8; 32] {
        self.value.to_bytes().into()
    }

    pub fn from_bytes(
        execution: ExecutionId,
        sender: ParticipantId,
        recipient: ParticipantId,
        encoded: [u8; 32],
    ) -> Result<Self, DkgError> {
        let value: Option<Scalar> = Scalar::from_repr(encoded.into()).into();
        Ok(Self {
            sender,
            recipient,
            execution: execution.0,
            value: value.ok_or(DkgError::InvalidScalar)?,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KnowledgeProof {
    pub identifier: ParticipantId,
    execution: [u8; 32],
    response: Scalar,
}

impl KnowledgeProof {
    pub fn response_bytes(&self) -> [u8; 32] {
        self.response.to_bytes().into()
    }
}

/// Holds a verified share while the final all-party Schnorr proofs are still
/// outstanding. No signing API is exposed from this state.
pub struct PendingKeyPackage {
    identifier: ParticipantId,
    execution: [u8; 32],
    signing_share: Option<Scalar>,
    verification_shares: [ProjectivePoint; PARTICIPANT_COUNT],
    group_public_key: ProjectivePoint,
    schnorr_commitments: [ProjectivePoint; PARTICIPANT_COUNT],
    combined_rid: [u8; 32],
    local_proof: KnowledgeProof,
}

impl Drop for PendingKeyPackage {
    fn drop(&mut self) {
        if let Some(share) = &mut self.signing_share {
            share.zeroize();
        }
    }
}

impl PendingKeyPackage {
    pub fn proof(&self) -> KnowledgeProof {
        self.local_proof.clone()
    }
}

/// A 2-of-3 Shamir key share. There is deliberately no API to interpolate the
/// three secret shares or reconstruct the group secret.
pub struct KeyPackage {
    identifier: ParticipantId,
    signing_share: Scalar,
    verification_shares: [ProjectivePoint; PARTICIPANT_COUNT],
    group_public_key: ProjectivePoint,
}

impl Drop for KeyPackage {
    fn drop(&mut self) {
        self.signing_share.zeroize();
    }
}

impl KeyPackage {
    pub fn identifier(&self) -> ParticipantId {
        self.identifier
    }

    pub fn group_public_key_bytes(&self) -> [u8; 33] {
        encode_nonidentity_point(&self.group_public_key).expect("final key invariant")
    }

    pub fn verification_share_bytes(&self, id: ParticipantId) -> [u8; 33] {
        encode_nonidentity_point(&self.verification_shares[usize::from(id.get() - 1)])
            .expect("verification-share invariant")
    }

    pub(crate) fn signing_share(&self) -> Scalar {
        self.signing_share
    }

    pub(crate) fn verification_share(&self, id: ParticipantId) -> ProjectivePoint {
        self.verification_shares[usize::from(id.get() - 1)]
    }

    pub(crate) fn group_public_key(&self) -> ProjectivePoint {
        self.group_public_key
    }
}

/// CGGMP24 threshold DKG round 1. The commitment is the only value that may be
/// broadcast in this round; opening values stay inside `Round1State`.
pub fn round1(
    execution: ExecutionId,
    identifier: ParticipantId,
) -> Result<(Round1State, Round1Commitment), DkgError> {
    let coefficients = [random_nonzero_scalar(), random_nonzero_scalar()];
    let commitments = [
        ProjectivePoint::GENERATOR * coefficients[0],
        ProjectivePoint::GENERATOR * coefficients[1],
    ];
    let mut rid = [0u8; 32];
    let mut commitment_blind = [0u8; 32];
    OsRng.fill_bytes(&mut rid);
    OsRng.fill_bytes(&mut commitment_blind);
    let schnorr_nonce = random_nonzero_scalar();
    let schnorr_commitment = ProjectivePoint::GENERATOR * schnorr_nonce;

    let reveal = Round2Reveal {
        identifier,
        execution: execution.0,
        rid,
        coefficient_commitments: commitments,
        schnorr_commitment,
        commitment_blind,
    };
    let digest = opening_digest(&reveal)?;
    let state = Round1State {
        identifier,
        execution: execution.0,
        coefficients,
        rid,
        schnorr_nonce,
        schnorr_commitment,
        commitment_blind,
    };
    Ok((
        state,
        Round1Commitment {
            identifier,
            execution: execution.0,
            digest,
        },
    ))
}

/// CGGMP24 round 2. A participant opens its committed public state only after
/// receiving all three round-one commitments. The returned private shares must
/// be sent over authenticated, confidential point-to-point channels.
pub fn round2(
    state: &Round1State,
    commitments: &[Round1Commitment],
) -> Result<(EchoPackage, Round2Reveal, Vec<PrivateShare>), DkgError> {
    validate_commitment_set(state.execution, commitments)?;
    let reveal = Round2Reveal {
        identifier: state.identifier,
        execution: state.execution,
        rid: state.rid,
        coefficient_commitments: [
            ProjectivePoint::GENERATOR * state.coefficients[0],
            ProjectivePoint::GENERATOR * state.coefficients[1],
        ],
        schnorr_commitment: state.schnorr_commitment,
        commitment_blind: state.commitment_blind,
    };
    let own_commitment = &commitments[usize::from(state.identifier.get() - 1)];
    if opening_digest(&reveal)? != own_commitment.digest {
        return Err(DkgError::CommitmentOpeningMismatch(state.identifier.get()));
    }

    let echo = EchoPackage {
        identifier: state.identifier,
        execution: state.execution,
        digest: expected_echo_digest(state.execution, commitments),
    };
    let mut shares = Vec::with_capacity(PARTICIPANT_COUNT);
    for raw_id in 1..=PARTICIPANT_COUNT as u16 {
        let recipient = ParticipantId::new(raw_id)?;
        let x = recipient.scalar();
        shares.push(PrivateShare {
            sender: state.identifier,
            recipient,
            execution: state.execution,
            value: state.coefficients[0] + state.coefficients[1] * x,
        });
    }
    Ok((echo, reveal, shares))
}

/// Validate all reveal/share material and generate this participant's final
/// Schnorr proof. The returned key remains pending until `finalize` verifies
/// the complete set of knowledge proofs.
pub fn round3(
    mut state: Round1State,
    commitments: &[Round1Commitment],
    echoes: &[EchoPackage],
    reveals: &[Round2Reveal],
    shares: Vec<PrivateShare>,
) -> Result<PendingKeyPackage, DkgError> {
    validate_commitment_set(state.execution, commitments)?;
    validate_echoes(state.execution, commitments, echoes)?;
    validate_reveals(state.execution, commitments, reveals)?;
    if shares.len() != PARTICIPANT_COUNT {
        return Err(DkgError::InvalidPackageSet);
    }

    let mut seen = BTreeSet::new();
    let mut signing_share = Scalar::ZERO;
    for share in &shares {
        if share.execution != state.execution {
            return Err(DkgError::ExecutionMismatch);
        }
        if share.recipient != state.identifier {
            return Err(DkgError::WrongRecipient);
        }
        if !seen.insert(share.sender) {
            return Err(DkgError::InvalidPackageSet);
        }
        let reveal = &reveals[usize::from(share.sender.get() - 1)];
        verify_private_share(share, reveal)?;
        signing_share += share.value;
    }
    if seen.len() != PARTICIPANT_COUNT {
        signing_share.zeroize();
        return Err(DkgError::InvalidPackageSet);
    }

    let aggregate_commitments =
        reveals
            .iter()
            .fold([ProjectivePoint::IDENTITY; THRESHOLD], |mut acc, reveal| {
                acc[0] += reveal.coefficient_commitments[0];
                acc[1] += reveal.coefficient_commitments[1];
                acc
            });
    let group_public_key = aggregate_commitments[0];
    if group_public_key == ProjectivePoint::IDENTITY {
        signing_share.zeroize();
        return Err(DkgError::InvalidPoint(state.identifier.get()));
    }
    let verification_shares = [
        aggregate_commitments[0] + aggregate_commitments[1] * Scalar::from(1u64),
        aggregate_commitments[0] + aggregate_commitments[1] * Scalar::from(2u64),
        aggregate_commitments[0] + aggregate_commitments[1] * Scalar::from(3u64),
    ];
    if verification_shares.contains(&ProjectivePoint::IDENTITY) {
        signing_share.zeroize();
        return Err(DkgError::InvalidPoint(state.identifier.get()));
    }
    let own_verification = verification_shares[usize::from(state.identifier.get() - 1)];
    if ProjectivePoint::GENERATOR * signing_share != own_verification {
        signing_share.zeroize();
        return Err(DkgError::FinalShareMismatch);
    }

    let mut combined_rid = [0u8; 32];
    for reveal in reveals {
        for (dst, src) in combined_rid.iter_mut().zip(reveal.rid) {
            *dst ^= src;
        }
    }
    let challenge = schnorr_challenge(
        state.execution,
        state.identifier,
        combined_rid,
        &own_verification,
        &state.schnorr_commitment,
    )?;
    let response = state.schnorr_nonce + challenge * signing_share;
    state.schnorr_nonce.zeroize();
    let local_proof = KnowledgeProof {
        identifier: state.identifier,
        execution: state.execution,
        response,
    };
    let schnorr_commitments = [
        reveals[0].schnorr_commitment,
        reveals[1].schnorr_commitment,
        reveals[2].schnorr_commitment,
    ];
    Ok(PendingKeyPackage {
        identifier: state.identifier,
        execution: state.execution,
        signing_share: Some(signing_share),
        verification_shares,
        group_public_key,
        schnorr_commitments,
        combined_rid,
        local_proof,
    })
}

/// Finish DKG only after every participant has proven knowledge of its final
/// secret share. This is the state boundary after which the key may enter the
/// still-experimental threshold-ECDSA presigning path.
pub fn finalize(
    mut pending: PendingKeyPackage,
    proofs: &[KnowledgeProof],
) -> Result<KeyPackage, DkgError> {
    if proofs.len() != PARTICIPANT_COUNT {
        return Err(DkgError::InvalidPackageSet);
    }
    for (index, proof) in proofs.iter().enumerate() {
        let expected_id = ParticipantId::new((index + 1) as u16)?;
        if proof.identifier != expected_id {
            return Err(DkgError::InvalidPackageSet);
        }
        if proof.execution != pending.execution {
            return Err(DkgError::ExecutionMismatch);
        }
        let public_share = pending.verification_shares[index];
        let nonce_commitment = pending.schnorr_commitments[index];
        let challenge = schnorr_challenge(
            pending.execution,
            expected_id,
            pending.combined_rid,
            &public_share,
            &nonce_commitment,
        )?;
        if ProjectivePoint::GENERATOR * proof.response
            != nonce_commitment + public_share * challenge
        {
            return Err(DkgError::InvalidKnowledgeProof(expected_id.get()));
        }
    }
    let mut signing_share = pending
        .signing_share
        .take()
        .ok_or(DkgError::FinalShareMismatch)?;
    let key = KeyPackage {
        identifier: pending.identifier,
        signing_share,
        verification_shares: pending.verification_shares,
        group_public_key: pending.group_public_key,
    };
    signing_share.zeroize();
    Ok(key)
}

fn validate_commitment_set(
    execution: [u8; 32],
    commitments: &[Round1Commitment],
) -> Result<(), DkgError> {
    if commitments.len() != PARTICIPANT_COUNT {
        return Err(DkgError::InvalidPackageSet);
    }
    for (index, commitment) in commitments.iter().enumerate() {
        if commitment.execution != execution {
            return Err(DkgError::ExecutionMismatch);
        }
        if commitment.identifier.get() != (index + 1) as u16 {
            return Err(DkgError::InvalidPackageSet);
        }
    }
    Ok(())
}

fn validate_echoes(
    execution: [u8; 32],
    commitments: &[Round1Commitment],
    echoes: &[EchoPackage],
) -> Result<(), DkgError> {
    if echoes.len() != PARTICIPANT_COUNT {
        return Err(DkgError::InvalidPackageSet);
    }
    let expected = expected_echo_digest(execution, commitments);
    for (index, echo) in echoes.iter().enumerate() {
        if echo.execution != execution {
            return Err(DkgError::ExecutionMismatch);
        }
        if echo.identifier.get() != (index + 1) as u16 {
            return Err(DkgError::InvalidPackageSet);
        }
        if echo.digest != expected {
            return Err(DkgError::EchoMismatch);
        }
    }
    Ok(())
}

fn validate_reveals(
    execution: [u8; 32],
    commitments: &[Round1Commitment],
    reveals: &[Round2Reveal],
) -> Result<(), DkgError> {
    if reveals.len() != PARTICIPANT_COUNT {
        return Err(DkgError::InvalidPackageSet);
    }
    for (index, reveal) in reveals.iter().enumerate() {
        let expected_id = (index + 1) as u16;
        if reveal.execution != execution {
            return Err(DkgError::ExecutionMismatch);
        }
        if reveal.identifier.get() != expected_id {
            return Err(DkgError::InvalidPackageSet);
        }
        for point in reveal
            .coefficient_commitments
            .iter()
            .chain(std::iter::once(&reveal.schnorr_commitment))
        {
            if *point == ProjectivePoint::IDENTITY {
                return Err(DkgError::InvalidPoint(expected_id));
            }
        }
        if opening_digest(reveal)? != commitments[index].digest {
            return Err(DkgError::CommitmentOpeningMismatch(expected_id));
        }
    }
    Ok(())
}

fn verify_private_share(share: &PrivateShare, reveal: &Round2Reveal) -> Result<(), DkgError> {
    if share.sender != reveal.identifier {
        return Err(DkgError::InvalidShare(share.sender.get()));
    }
    let x = share.recipient.scalar();
    let expected = reveal.coefficient_commitments[0] + reveal.coefficient_commitments[1] * x;
    if ProjectivePoint::GENERATOR * share.value != expected {
        return Err(DkgError::InvalidShare(share.sender.get()));
    }
    Ok(())
}

fn opening_digest(reveal: &Round2Reveal) -> Result<[u8; 32], DkgError> {
    let mut hasher = Sha256::new();
    hasher.update(COMMIT_TAG);
    hasher.update(reveal.execution);
    hasher.update(reveal.identifier.get().to_be_bytes());
    hasher.update(reveal.rid);
    for point in &reveal.coefficient_commitments {
        hasher.update(
            encode_nonidentity_point(point)
                .map_err(|_| DkgError::InvalidPoint(reveal.identifier.get()))?,
        );
    }
    hasher.update(
        encode_nonidentity_point(&reveal.schnorr_commitment)
            .map_err(|_| DkgError::InvalidPoint(reveal.identifier.get()))?,
    );
    hasher.update(reveal.commitment_blind);
    Ok(hasher.finalize().into())
}

fn expected_echo_digest(execution: [u8; 32], commitments: &[Round1Commitment]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ECHO_TAG);
    hasher.update(execution);
    hasher.update((commitments.len() as u32).to_be_bytes());
    for commitment in commitments {
        hasher.update(commitment.identifier.get().to_be_bytes());
        hasher.update(commitment.digest);
    }
    hasher.finalize().into()
}

fn schnorr_challenge(
    execution: [u8; 32],
    identifier: ParticipantId,
    combined_rid: [u8; 32],
    public_share: &ProjectivePoint,
    nonce_commitment: &ProjectivePoint,
) -> Result<Scalar, DkgError> {
    let mut hasher = Sha256::new();
    hasher.update(SCHNORR_TAG);
    hasher.update(execution);
    hasher.update(identifier.get().to_be_bytes());
    hasher.update(combined_rid);
    hasher.update(
        encode_nonidentity_point(public_share)
            .map_err(|_| DkgError::InvalidPoint(identifier.get()))?,
    );
    hasher.update(
        encode_nonidentity_point(nonce_commitment)
            .map_err(|_| DkgError::InvalidPoint(identifier.get()))?,
    );
    let digest: [u8; 32] = hasher.finalize().into();
    let bytes: FieldBytes = digest.into();
    Ok(<Scalar as Reduce<U256>>::reduce_bytes(&bytes))
}

fn encode_nonidentity_point(point: &ProjectivePoint) -> Result<[u8; 33], ()> {
    if *point == ProjectivePoint::IDENTITY {
        return Err(());
    }
    let encoded = point.to_affine().to_encoded_point(true);
    encoded.as_bytes().try_into().map_err(|_| ())
}

fn random_nonzero_scalar() -> Scalar {
    loop {
        let scalar = Scalar::generate_vartime(&mut OsRng);
        if scalar != Scalar::ZERO {
            return scalar;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_dkg(execution_label: &[u8]) -> Vec<KeyPackage> {
        let execution = ExecutionId::new(execution_label).unwrap();
        let mut states = Vec::new();
        let mut commitments = Vec::new();
        for raw_id in 1..=3 {
            let (state, commitment) =
                round1(execution, ParticipantId::new(raw_id).unwrap()).unwrap();
            states.push(state);
            commitments.push(commitment);
        }

        let mut echoes = Vec::new();
        let mut reveals = Vec::new();
        let mut inboxes: [Vec<PrivateShare>; 3] = [Vec::new(), Vec::new(), Vec::new()];
        for state in &states {
            let (echo, reveal, shares) = round2(state, &commitments).unwrap();
            echoes.push(echo);
            reveals.push(reveal);
            for share in shares {
                inboxes[usize::from(share.recipient.get() - 1)].push(share);
            }
        }

        let pendings: Vec<_> = states
            .into_iter()
            .zip(inboxes)
            .map(|(state, shares)| round3(state, &commitments, &echoes, &reveals, shares).unwrap())
            .collect();
        let proofs: Vec<_> = pendings.iter().map(PendingKeyPackage::proof).collect();
        pendings
            .into_iter()
            .map(|pending| finalize(pending, &proofs).unwrap())
            .collect()
    }

    #[test]
    fn threshold_dkg_produces_consistent_public_shares_without_group_secret() {
        let keys = run_dkg(b"secp-dkg-consistency-1");
        let group = keys[0].group_public_key_bytes();
        assert_eq!(keys[1].group_public_key_bytes(), group);
        assert_eq!(keys[2].group_public_key_bytes(), group);

        for key in &keys {
            assert_eq!(
                ProjectivePoint::GENERATOR * key.signing_share(),
                key.verification_share(key.identifier())
            );
        }
    }

    #[test]
    fn split_view_echo_aborts_before_private_shares_are_accepted() {
        let execution = ExecutionId::new(b"split-view").unwrap();
        let mut states = Vec::new();
        let mut commitments = Vec::new();
        for raw_id in 1..=3 {
            let (state, commitment) =
                round1(execution, ParticipantId::new(raw_id).unwrap()).unwrap();
            states.push(state);
            commitments.push(commitment);
        }
        let mut echoes = Vec::new();
        let mut reveals = Vec::new();
        let mut inbox = Vec::new();
        for state in &states {
            let (echo, reveal, shares) = round2(state, &commitments).unwrap();
            echoes.push(echo);
            reveals.push(reveal);
            inbox.push(shares.into_iter().next().unwrap());
        }
        echoes[1].digest[0] ^= 1;
        assert_eq!(
            round3(states.remove(0), &commitments, &echoes, &reveals, inbox)
                .err()
                .unwrap(),
            DkgError::EchoMismatch
        );
    }

    #[test]
    fn adaptive_reveal_after_commit_is_rejected() {
        let execution = ExecutionId::new(b"adaptive-reveal").unwrap();
        let mut states = Vec::new();
        let mut commitments = Vec::new();
        for raw_id in 1..=3 {
            let (state, commitment) =
                round1(execution, ParticipantId::new(raw_id).unwrap()).unwrap();
            states.push(state);
            commitments.push(commitment);
        }
        let mut reveals = Vec::new();
        for state in &states {
            let (_, reveal, _) = round2(state, &commitments).unwrap();
            reveals.push(reveal);
        }
        reveals[2].commitment_blind[0] ^= 1;
        assert_eq!(
            validate_reveals(execution.0, &commitments, &reveals),
            Err(DkgError::CommitmentOpeningMismatch(3))
        );
    }

    #[test]
    fn corrupted_private_share_is_rejected() {
        let execution = ExecutionId::new(b"bad-share").unwrap();
        let mut states = Vec::new();
        let mut commitments = Vec::new();
        for raw_id in 1..=3 {
            let (state, commitment) =
                round1(execution, ParticipantId::new(raw_id).unwrap()).unwrap();
            states.push(state);
            commitments.push(commitment);
        }
        let mut echoes = Vec::new();
        let mut reveals = Vec::new();
        let mut inbox = Vec::new();
        for state in &states {
            let (echo, reveal, shares) = round2(state, &commitments).unwrap();
            echoes.push(echo);
            reveals.push(reveal);
            inbox.push(shares.into_iter().next().unwrap());
        }
        inbox[1].value += Scalar::ONE;
        assert_eq!(
            round3(states.remove(0), &commitments, &echoes, &reveals, inbox)
                .err()
                .unwrap(),
            DkgError::InvalidShare(2)
        );
    }

    #[test]
    fn final_knowledge_proof_is_bound_to_execution_and_participant() {
        let execution = ExecutionId::new(b"proof-binding").unwrap();
        let mut states = Vec::new();
        let mut commitments = Vec::new();
        for raw_id in 1..=3 {
            let (state, commitment) =
                round1(execution, ParticipantId::new(raw_id).unwrap()).unwrap();
            states.push(state);
            commitments.push(commitment);
        }
        let mut echoes = Vec::new();
        let mut reveals = Vec::new();
        let mut inboxes: [Vec<PrivateShare>; 3] = [Vec::new(), Vec::new(), Vec::new()];
        for state in &states {
            let (echo, reveal, shares) = round2(state, &commitments).unwrap();
            echoes.push(echo);
            reveals.push(reveal);
            for share in shares {
                inboxes[usize::from(share.recipient.get() - 1)].push(share);
            }
        }
        let pendings: Vec<_> = states
            .into_iter()
            .zip(inboxes)
            .map(|(state, shares)| round3(state, &commitments, &echoes, &reveals, shares).unwrap())
            .collect();
        let mut proofs: Vec<_> = pendings.iter().map(PendingKeyPackage::proof).collect();
        proofs[1].response += Scalar::ONE;
        assert_eq!(
            finalize(pendings.into_iter().next().unwrap(), &proofs)
                .err()
                .unwrap(),
            DkgError::InvalidKnowledgeProof(2)
        );
    }
}

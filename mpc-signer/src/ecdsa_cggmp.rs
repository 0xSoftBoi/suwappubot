//! Threshold secp256k1/ECDSA state boundaries from CGGMP24.
//!
//! This module deliberately stops before malicious presigning. It implements:
//! - the t-of-n -> t-of-t Lagrange conversion from CGGMP24 section 4.3.2;
//! - the consumed-on-use partial-signature equation from section 4.4; and
//! - per-partial verification, final ECDSA verification, low-s normalization,
//!   and recovery-ID derivation.
//!
//! `PresignatureShare` has no public constructor. That is a security boundary:
//! the future Paillier/Ring-Pedersen presigning state machine must construct it
//! only after all CGGMP zero-knowledge proofs and consistency equations pass.

use k256::{
    ecdsa::{signature::hazmat::PrehashVerifier, RecoveryId, Signature, VerifyingKey},
    elliptic_curve::{bigint::U256, ops::Reduce, sec1::ToEncodedPoint},
    FieldBytes, ProjectivePoint, Scalar,
};
use thiserror::Error;
use zeroize::Zeroize;

use crate::secp256k1_dkg::{KeyPackage, ParticipantId, PARTICIPANT_COUNT, THRESHOLD};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum EcdsaError {
    #[error("signing set must contain exactly two distinct participants in canonical order")]
    InvalidSigningSet,
    #[error("this key share is not a member of the requested signing set")]
    KeyNotInSigningSet,
    #[error("DKG public and secret share invariants disagree")]
    DkgInvariant,
    #[error("presignature public and private material disagree")]
    PresignatureMismatch,
    #[error("partial signatures do not exactly match the presignature signing set")]
    InvalidPartialSet,
    #[error("partial signature from participant {0} failed the CGGMP verification equation")]
    InvalidPartialSignature(u16),
    #[error("final ECDSA signature is invalid")]
    InvalidSignature,
    #[error("could not derive the secp256k1 public-key recovery ID")]
    RecoveryFailure,
}

/// A Lagrange-weighted additive share for one selected 2-of-3 signing pair.
/// It is non-cloneable and keeps the weighted secret private.
pub struct AdditiveSigningShare {
    identifier: ParticipantId,
    signing_pair: [ParticipantId; THRESHOLD],
    secret_share: Scalar,
    public_share: ProjectivePoint,
    group_public_key: ProjectivePoint,
}

impl Drop for AdditiveSigningShare {
    fn drop(&mut self) {
        self.secret_share.zeroize();
    }
}

impl AdditiveSigningShare {
    pub fn identifier(&self) -> ParticipantId {
        self.identifier
    }

    pub fn signing_pair(&self) -> [ParticipantId; THRESHOLD] {
        self.signing_pair
    }

    pub fn public_share_bytes(&self) -> [u8; 33] {
        encode_point(&self.public_share).expect("additive public-share invariant")
    }

    pub fn group_public_key_bytes(&self) -> [u8; 33] {
        encode_point(&self.group_public_key).expect("group-key invariant")
    }
}

/// Convert a Shamir share to the additive share used by the two parties taking
/// part in this particular CGGMP signing execution. This is the exact
/// Lagrange-at-zero transformation; it never reconstructs the secret key.
pub fn to_additive_signing_share(
    key: &KeyPackage,
    signing_pair: [ParticipantId; THRESHOLD],
) -> Result<AdditiveSigningShare, EcdsaError> {
    validate_signing_pair(signing_pair)?;
    let identifier = key.identifier();
    if !signing_pair.contains(&identifier) {
        return Err(EcdsaError::KeyNotInSigningSet);
    }

    let other = if signing_pair[0] == identifier {
        signing_pair[1]
    } else {
        signing_pair[0]
    };
    // lambda_i = x_j / (x_j - x_i), evaluated at x=0.
    let denominator = other.scalar_for_ecdsa() - identifier.scalar_for_ecdsa();
    let inverse: Option<Scalar> = denominator.invert().into();
    let lambda = other.scalar_for_ecdsa()
        * inverse.expect("distinct nonzero participant identifiers have invertible difference");
    let mut secret_share = key.signing_share() * lambda;
    let public_share = key.verification_share(identifier) * lambda;
    if ProjectivePoint::GENERATOR * secret_share != public_share {
        secret_share.zeroize();
        return Err(EcdsaError::DkgInvariant);
    }

    Ok(AdditiveSigningShare {
        identifier,
        signing_pair,
        secret_share,
        public_share,
        group_public_key: key.group_public_key(),
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PresignatureCommitment {
    identifier: ParticipantId,
    delta_tilde: ProjectivePoint,
    s_tilde: ProjectivePoint,
}

/// Public output of a successfully verified presigning execution.
pub struct PresignaturePublic {
    execution: [u8; 32],
    signing_pair: [ParticipantId; THRESHOLD],
    gamma: ProjectivePoint,
    commitments: [PresignatureCommitment; THRESHOLD],
    group_public_key: ProjectivePoint,
}

/// Secret output for one signer. This type is consumed when a partial
/// signature is issued, making accidental in-memory presignature reuse
/// impossible. Crash/retry reuse is separately prevented by the durable ledger.
pub struct PresignatureShare {
    execution: [u8; 32],
    identifier: ParticipantId,
    k_tilde: Scalar,
    chi_tilde: Scalar,
}

impl Drop for PresignatureShare {
    fn drop(&mut self) {
        self.k_tilde.zeroize();
        self.chi_tilde.zeroize();
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PartialSignature {
    execution: [u8; 32],
    pub identifier: ParticipantId,
    r: Scalar,
    sigma: Scalar,
}

impl PartialSignature {
    pub fn r_bytes(&self) -> [u8; 32] {
        self.r.to_bytes().into()
    }

    pub fn sigma_bytes(&self) -> [u8; 32] {
        self.sigma.to_bytes().into()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThresholdSignature {
    bytes: [u8; 64],
    recovery_id: u8,
}

impl ThresholdSignature {
    pub fn to_bytes(&self) -> [u8; 64] {
        self.bytes
    }

    /// SEC1 recovery identifier in [0, 3]. Ethereum integrations usually
    /// consume its parity bit after applying their transaction-specific v rule.
    pub fn recovery_id(&self) -> u8 {
        self.recovery_id
    }
}

/// Issue one CGGMP partial signature. `prehash` is already the 32-byte digest
/// required by the target chain; this function does not hash it again.
pub fn issue_partial_signature(
    mut share: PresignatureShare,
    public: &PresignaturePublic,
    prehash: [u8; 32],
) -> Result<PartialSignature, EcdsaError> {
    validate_presignature_public(public)?;
    if share.execution != public.execution || !public.signing_pair.contains(&share.identifier) {
        return Err(EcdsaError::PresignatureMismatch);
    }
    let commitment = public
        .commitments
        .iter()
        .find(|commitment| commitment.identifier == share.identifier)
        .ok_or(EcdsaError::PresignatureMismatch)?;
    if public.gamma * share.k_tilde != commitment.delta_tilde
        || public.gamma * share.chi_tilde != commitment.s_tilde
    {
        return Err(EcdsaError::PresignatureMismatch);
    }

    let r = x_coordinate_to_scalar(&public.gamma)?;
    let m = prehash_to_scalar(prehash);
    let sigma = share.k_tilde * m + r * share.chi_tilde;
    share.k_tilde.zeroize();
    share.chi_tilde.zeroize();
    if sigma == Scalar::ZERO {
        return Err(EcdsaError::InvalidSignature);
    }
    Ok(PartialSignature {
        execution: public.execution,
        identifier: share.identifier,
        r,
        sigma,
    })
}

/// Verify every partial before aggregation, produce a normal 64-byte ECDSA
/// signature, normalize s to the low half of the curve order, independently
/// verify it with k256, then derive the recovery ID against the DKG group key.
pub fn aggregate_partial_signatures(
    public: &PresignaturePublic,
    prehash: [u8; 32],
    partials: &[PartialSignature],
) -> Result<ThresholdSignature, EcdsaError> {
    validate_presignature_public(public)?;
    if partials.len() != THRESHOLD {
        return Err(EcdsaError::InvalidPartialSet);
    }
    let r = x_coordinate_to_scalar(&public.gamma)?;
    let m = prehash_to_scalar(prehash);
    let mut sigma = Scalar::ZERO;
    for (index, partial) in partials.iter().enumerate() {
        let expected_id = public.signing_pair[index];
        if partial.execution != public.execution
            || partial.identifier != expected_id
            || partial.r != r
        {
            return Err(EcdsaError::InvalidPartialSet);
        }
        let commitment = &public.commitments[index];
        if commitment.identifier != expected_id {
            return Err(EcdsaError::InvalidPartialSet);
        }
        if public.gamma * partial.sigma != commitment.delta_tilde * m + commitment.s_tilde * r {
            return Err(EcdsaError::InvalidPartialSignature(expected_id.get()));
        }
        sigma += partial.sigma;
    }
    if sigma == Scalar::ZERO || r == Scalar::ZERO {
        return Err(EcdsaError::InvalidSignature);
    }

    let signature = Signature::from_scalars(r.to_bytes(), sigma.to_bytes())
        .map_err(|_| EcdsaError::InvalidSignature)?;
    let signature = signature.normalize_s().unwrap_or(signature);
    let group_bytes = encode_point(&public.group_public_key)?;
    let verifying_key =
        VerifyingKey::from_sec1_bytes(&group_bytes).map_err(|_| EcdsaError::InvalidSignature)?;
    verifying_key
        .verify_prehash(&prehash, &signature)
        .map_err(|_| EcdsaError::InvalidSignature)?;
    let recovery_id = RecoveryId::trial_recovery_from_prehash(&verifying_key, &prehash, &signature)
        .map_err(|_| EcdsaError::RecoveryFailure)?;

    Ok(ThresholdSignature {
        bytes: signature.to_bytes().into(),
        recovery_id: recovery_id.to_byte(),
    })
}

fn validate_signing_pair(pair: [ParticipantId; THRESHOLD]) -> Result<(), EcdsaError> {
    if pair[0].get() >= pair[1].get()
        || pair
            .iter()
            .any(|id| !(1..=PARTICIPANT_COUNT as u16).contains(&id.get()))
    {
        return Err(EcdsaError::InvalidSigningSet);
    }
    Ok(())
}

fn validate_presignature_public(public: &PresignaturePublic) -> Result<(), EcdsaError> {
    validate_signing_pair(public.signing_pair)?;
    if public.gamma == ProjectivePoint::IDENTITY
        || public.group_public_key == ProjectivePoint::IDENTITY
    {
        return Err(EcdsaError::PresignatureMismatch);
    }
    for (index, commitment) in public.commitments.iter().enumerate() {
        if commitment.identifier != public.signing_pair[index]
            || commitment.delta_tilde == ProjectivePoint::IDENTITY
            || commitment.s_tilde == ProjectivePoint::IDENTITY
        {
            return Err(EcdsaError::PresignatureMismatch);
        }
    }
    Ok(())
}

fn prehash_to_scalar(prehash: [u8; 32]) -> Scalar {
    let bytes: FieldBytes = prehash.into();
    <Scalar as Reduce<U256>>::reduce_bytes(&bytes)
}

fn x_coordinate_to_scalar(point: &ProjectivePoint) -> Result<Scalar, EcdsaError> {
    if *point == ProjectivePoint::IDENTITY {
        return Err(EcdsaError::PresignatureMismatch);
    }
    let encoded = point.to_affine().to_encoded_point(false);
    let x = encoded.x().ok_or(EcdsaError::PresignatureMismatch)?;
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(x);
    Ok(prehash_to_scalar(bytes))
}

fn encode_point(point: &ProjectivePoint) -> Result<[u8; 33], EcdsaError> {
    if *point == ProjectivePoint::IDENTITY {
        return Err(EcdsaError::PresignatureMismatch);
    }
    point
        .to_affine()
        .to_encoded_point(true)
        .as_bytes()
        .try_into()
        .map_err(|_| EcdsaError::PresignatureMismatch)
}

trait ParticipantScalar {
    fn scalar_for_ecdsa(self) -> Scalar;
}

impl ParticipantScalar for ParticipantId {
    fn scalar_for_ecdsa(self) -> Scalar {
        Scalar::from(u64::from(self.get()))
    }
}

#[cfg(test)]
mod tests {
    use sha2::{Digest, Sha256};

    use super::*;

    fn simulated_verified_presignature(
    ) -> (PresignaturePublic, [PresignatureShare; THRESHOLD], [u8; 32]) {
        let id1 = ParticipantId::new(1).unwrap();
        let id2 = ParticipantId::new(2).unwrap();
        let signing_pair = [id1, id2];
        let execution = [0x42; 32];
        let secret_key = Scalar::from(7u64);
        let gamma_scalar = Scalar::from(11u64);
        let gamma = ProjectivePoint::GENERATOR * gamma_scalar;
        let gamma_inverse: Scalar = gamma_scalar.invert().unwrap();

        // CGGMP's post-presign invariant is sum(k_tilde_i) = gamma^-1 and
        // sum(chi_tilde_i) = x * gamma^-1. We construct only that verified
        // output here; no test helper is compiled into production code.
        let k1 = Scalar::from(3u64);
        let k2 = gamma_inverse - k1;
        let chi1 = Scalar::from(5u64);
        let chi2 = secret_key * gamma_inverse - chi1;
        let commitments = [
            PresignatureCommitment {
                identifier: id1,
                delta_tilde: gamma * k1,
                s_tilde: gamma * chi1,
            },
            PresignatureCommitment {
                identifier: id2,
                delta_tilde: gamma * k2,
                s_tilde: gamma * chi2,
            },
        ];
        let public = PresignaturePublic {
            execution,
            signing_pair,
            gamma,
            commitments,
            group_public_key: ProjectivePoint::GENERATOR * secret_key,
        };
        let shares = [
            PresignatureShare {
                execution,
                identifier: id1,
                k_tilde: k1,
                chi_tilde: chi1,
            },
            PresignatureShare {
                execution,
                identifier: id2,
                k_tilde: k2,
                chi_tilde: chi2,
            },
        ];
        let prehash: [u8; 32] = Sha256::digest(b"native threshold ECDSA equation test").into();
        (public, shares, prehash)
    }

    #[test]
    fn verified_presignature_outputs_a_standard_recoverable_ecdsa_signature() {
        let (public, shares, prehash) = simulated_verified_presignature();
        let partials: Vec<_> = shares
            .into_iter()
            .map(|share| issue_partial_signature(share, &public, prehash).unwrap())
            .collect();
        let signature = aggregate_partial_signatures(&public, prehash, &partials).unwrap();
        assert!(signature.recovery_id() <= 3);
        assert_ne!(signature.to_bytes(), [0u8; 64]);
    }

    #[test]
    fn tampered_partial_is_rejected_before_aggregation() {
        let (public, shares, prehash) = simulated_verified_presignature();
        let mut partials: Vec<_> = shares
            .into_iter()
            .map(|share| issue_partial_signature(share, &public, prehash).unwrap())
            .collect();
        partials[1].sigma += Scalar::ONE;
        assert_eq!(
            aggregate_partial_signatures(&public, prehash, &partials),
            Err(EcdsaError::InvalidPartialSignature(2))
        );
    }

    #[test]
    fn private_presignature_must_match_its_public_commitments() {
        let (mut public, shares, prehash) = simulated_verified_presignature();
        public.commitments[0].delta_tilde += ProjectivePoint::GENERATOR;
        let mut shares = shares.into_iter();
        assert_eq!(
            issue_partial_signature(shares.next().unwrap(), &public, prehash),
            Err(EcdsaError::PresignatureMismatch)
        );
    }
}

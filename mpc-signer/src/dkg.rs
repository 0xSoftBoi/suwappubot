//! First native 2-of-3 distributed-key-generation milestone.
//!
//! Every participant contributes a fresh degree-one polynomial.  Feldman
//! commitments make every delivered share publicly checkable; final signing
//! shares are the sum of the three verified contributions, so no process ever
//! constructs the group signing secret.  A Schnorr proof binds each dealer to
//! knowledge of its constant coefficient.
//!
//! This is intentionally *not* marked malicious-production-ready yet.  The
//! next DKG hardening milestone needs a formally pinned complaint,
//! disqualification and recovery protocol.  Until then `PRODUCTION_READY` in
//! the crate root remains false.

use std::collections::BTreeSet;

use curve25519_dalek::{
    constants::ED25519_BASEPOINT_POINT, edwards::EdwardsPoint, scalar::Scalar, traits::Identity,
};
use rand_core::OsRng;
use sha2::{Digest, Sha512};
use thiserror::Error;
use zeroize::Zeroize;

use crate::frost_ed25519::{
    deserialize_scalar, validate_element, FrostError, KeyPackage, ParticipantIdentifier,
};

pub const THRESHOLD: usize = 2;
pub const PARTICIPANT_COUNT: usize = 3;
const DKG_CONTEXT: &[u8] = b"suwappu/native-mpc/dkg/ed25519/v1";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DkgError {
    #[error("native DKG is fixed to participants 1, 2 and 3 in this milestone")]
    InvalidParticipantSet,
    #[error("round-one proof of knowledge failed for participant {0}")]
    InvalidProof(u16),
    #[error("round-one secret does not match participant {0}'s public commitment")]
    SecretCommitmentMismatch(u16),
    #[error("round-two share is addressed to a different participant")]
    WrongRecipient,
    #[error("missing or duplicate round-two share")]
    InvalidShareSet,
    #[error("round-two Feldman verification failed for participant {0}")]
    InvalidShare(u16),
    #[error(transparent)]
    Frost(#[from] FrostError),
}

#[derive(Clone, Debug, PartialEq)]
pub struct KnowledgeProof {
    commitment: EdwardsPoint,
    response: Scalar,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Round1Package {
    pub identifier: ParticipantIdentifier,
    commitments: [EdwardsPoint; THRESHOLD],
    proof_of_knowledge: KnowledgeProof,
}

impl Round1Package {
    pub fn commitment_bytes(&self) -> [[u8; 32]; THRESHOLD] {
        [
            self.commitments[0].compress().to_bytes(),
            self.commitments[1].compress().to_bytes(),
        ]
    }

    pub fn proof_bytes(&self) -> ([u8; 32], [u8; 32]) {
        (
            self.proof_of_knowledge.commitment.compress().to_bytes(),
            self.proof_of_knowledge.response.to_bytes(),
        )
    }
}

pub struct Round1Secret {
    identifier: ParticipantIdentifier,
    coefficients: [Scalar; THRESHOLD],
}

impl Drop for Round1Secret {
    fn drop(&mut self) {
        self.coefficients[0].zeroize();
        self.coefficients[1].zeroize();
    }
}

pub struct Round2Share {
    pub sender: ParticipantIdentifier,
    pub recipient: ParticipantIdentifier,
    value: Scalar,
}

impl Drop for Round2Share {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}

impl Round2Share {
    /// Secret-share wire encoding.  The transport layer must encrypt and
    /// authenticate these bytes to the intended participant.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.value.to_bytes()
    }

    pub fn from_bytes(
        sender: ParticipantIdentifier,
        recipient: ParticipantIdentifier,
        encoded: [u8; 32],
    ) -> Result<Self, DkgError> {
        Ok(Self {
            sender,
            recipient,
            value: deserialize_scalar(encoded)?,
        })
    }
}

/// Start a DKG contribution.  The participant's constant and linear
/// coefficients are independently sampled; neither is ever returned.
pub fn round1(
    identifier: ParticipantIdentifier,
) -> Result<(Round1Secret, Round1Package), DkgError> {
    validate_identifier(identifier)?;
    let mut constant = random_nonzero_scalar();
    let mut linear = random_nonzero_scalar();
    let coefficients = [constant, linear];
    let commitments = [
        ED25519_BASEPOINT_POINT * constant,
        ED25519_BASEPOINT_POINT * linear,
    ];

    let mut nonce = random_nonzero_scalar();
    let proof_commitment = ED25519_BASEPOINT_POINT * nonce;
    let challenge = proof_challenge(identifier, &commitments, &proof_commitment);
    let proof = KnowledgeProof {
        commitment: proof_commitment,
        response: nonce + (challenge * constant),
    };

    let result = (
        Round1Secret {
            identifier,
            coefficients,
        },
        Round1Package {
            identifier,
            commitments,
            proof_of_knowledge: proof,
        },
    );
    constant.zeroize();
    linear.zeroize();
    nonce.zeroize();
    Ok(result)
}

/// Validate the complete commit-first transcript before any secret shares are
/// accepted or finalized.  Requiring exactly [1,2,3] also makes transcript
/// ordering canonical for this first 2-of-3 deployment profile.
pub fn validate_round1_packages(packages: &[Round1Package]) -> Result<(), DkgError> {
    if packages.len() != PARTICIPANT_COUNT {
        return Err(DkgError::InvalidParticipantSet);
    }
    let expected = [1u16, 2, 3];
    let mut seen = BTreeSet::new();
    for (package, expected_id) in packages.iter().zip(expected) {
        if package.identifier.get() != expected_id || !seen.insert(package.identifier) {
            return Err(DkgError::InvalidParticipantSet);
        }
        validate_element(&package.commitments[0])?;
        validate_element(&package.commitments[1])?;
        validate_element(&package.proof_of_knowledge.commitment)?;
        verify_proof(package)?;
    }
    Ok(())
}

/// Produce one participant-to-participant Feldman share.  This may only be
/// called against a complete, validated round-one transcript.
pub fn round2_share(
    secret: &Round1Secret,
    packages: &[Round1Package],
    recipient: ParticipantIdentifier,
) -> Result<Round2Share, DkgError> {
    validate_round1_packages(packages)?;
    validate_identifier(recipient)?;
    let own_package = packages
        .iter()
        .find(|package| package.identifier == secret.identifier)
        .ok_or(DkgError::InvalidParticipantSet)?;
    if own_package.commitments[0] != ED25519_BASEPOINT_POINT * secret.coefficients[0]
        || own_package.commitments[1] != ED25519_BASEPOINT_POINT * secret.coefficients[1]
    {
        return Err(DkgError::SecretCommitmentMismatch(secret.identifier.get()));
    }

    let x = Scalar::from(u64::from(recipient.get()));
    let mut value = secret.coefficients[0] + (secret.coefficients[1] * x);
    let share = Round2Share {
        sender: secret.identifier,
        recipient,
        value,
    };
    value.zeroize();
    Ok(share)
}

pub fn verify_round2_share(
    share: &Round2Share,
    sender_package: &Round1Package,
) -> Result<(), DkgError> {
    if share.sender != sender_package.identifier {
        return Err(DkgError::InvalidShare(share.sender.get()));
    }
    validate_identifier(share.recipient)?;
    let x = Scalar::from(u64::from(share.recipient.get()));
    let expected = sender_package.commitments[0] + (sender_package.commitments[1] * x);
    let actual = ED25519_BASEPOINT_POINT * share.value;
    if actual != expected {
        return Err(DkgError::InvalidShare(share.sender.get()));
    }
    Ok(())
}

/// Finalize one participant's key package from exactly one verified
/// contribution from each DKG peer.  There is intentionally no function that
/// interpolates these shares back into the group secret.
pub fn finalize(
    secret: Round1Secret,
    packages: &[Round1Package],
    shares: Vec<Round2Share>,
) -> Result<KeyPackage, DkgError> {
    validate_round1_packages(packages)?;
    if shares.len() != PARTICIPANT_COUNT {
        return Err(DkgError::InvalidShareSet);
    }

    let mut seen = BTreeSet::new();
    let mut signing_share = Scalar::from(0u64);
    for share in &shares {
        if share.recipient != secret.identifier {
            return Err(DkgError::WrongRecipient);
        }
        if !seen.insert(share.sender) {
            return Err(DkgError::InvalidShareSet);
        }
        let sender_package = packages
            .iter()
            .find(|package| package.identifier == share.sender)
            .ok_or(DkgError::InvalidShareSet)?;
        verify_round2_share(share, sender_package)?;
        signing_share += share.value;
    }
    if seen.len() != PARTICIPANT_COUNT {
        return Err(DkgError::InvalidShareSet);
    }

    let group_public_key = packages
        .iter()
        .fold(EdwardsPoint::identity(), |acc, package| {
            acc + package.commitments[0]
        });
    validate_element(&group_public_key)?;

    // Derive the participant public share independently from the public
    // commitments, then prove it matches the summed secret contribution.
    let x = Scalar::from(u64::from(secret.identifier.get()));
    let verification_share = packages
        .iter()
        .fold(EdwardsPoint::identity(), |acc, package| {
            acc + package.commitments[0] + (package.commitments[1] * x)
        });
    if verification_share != ED25519_BASEPOINT_POINT * signing_share {
        signing_share.zeroize();
        return Err(DkgError::InvalidShareSet);
    }

    let key_package = KeyPackage::from_scalars(
        secret.identifier,
        signing_share,
        verification_share,
        group_public_key,
    );
    signing_share.zeroize();
    Ok(key_package?)
}

fn validate_identifier(identifier: ParticipantIdentifier) -> Result<(), DkgError> {
    if !(1..=PARTICIPANT_COUNT as u16).contains(&identifier.get()) {
        return Err(DkgError::InvalidParticipantSet);
    }
    Ok(())
}

fn random_nonzero_scalar() -> Scalar {
    let mut rng = OsRng;
    loop {
        let scalar = Scalar::random(&mut rng);
        if scalar != Scalar::from(0u64) {
            return scalar;
        }
    }
}

fn proof_challenge(
    identifier: ParticipantIdentifier,
    commitments: &[EdwardsPoint; THRESHOLD],
    proof_commitment: &EdwardsPoint,
) -> Scalar {
    let mut hasher = Sha512::new();
    hasher.update(DKG_CONTEXT);
    hasher.update(b"/coefficient-knowledge");
    hasher.update(identifier.get().to_le_bytes());
    hasher.update(commitments[0].compress().as_bytes());
    hasher.update(commitments[1].compress().as_bytes());
    hasher.update(proof_commitment.compress().as_bytes());
    let digest: [u8; 64] = hasher.finalize().into();
    Scalar::from_bytes_mod_order_wide(&digest)
}

fn verify_proof(package: &Round1Package) -> Result<(), DkgError> {
    let challenge = proof_challenge(
        package.identifier,
        &package.commitments,
        &package.proof_of_knowledge.commitment,
    );
    let left = ED25519_BASEPOINT_POINT * package.proof_of_knowledge.response;
    let right = package.proof_of_knowledge.commitment + (package.commitments[0] * challenge);
    if left != right {
        return Err(DkgError::InvalidProof(package.identifier.get()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frost_ed25519::{
        aggregate, verify_with_ed25519, ParticipantCommitment, SignatureShare, VerificationShare,
    };

    fn build_dkg() -> (Vec<KeyPackage>, Vec<Round1Package>) {
        let mut secrets = Vec::new();
        let mut packages = Vec::new();
        for raw_id in 1..=3 {
            let id = ParticipantIdentifier::new(raw_id).unwrap();
            let (secret, package) = round1(id).unwrap();
            secrets.push(secret);
            packages.push(package);
        }
        validate_round1_packages(&packages).unwrap();

        let mut inboxes: [Vec<Round2Share>; 3] = [Vec::new(), Vec::new(), Vec::new()];
        for secret in &secrets {
            for raw_recipient in 1..=3 {
                let recipient = ParticipantIdentifier::new(raw_recipient).unwrap();
                inboxes[usize::from(raw_recipient - 1)]
                    .push(round2_share(secret, &packages, recipient).unwrap());
            }
        }

        let keys = secrets
            .into_iter()
            .zip(inboxes)
            .map(|(secret, shares)| finalize(secret, &packages, shares).unwrap())
            .collect();
        (keys, packages)
    }

    #[test]
    fn dealerless_dkg_never_needs_a_group_secret_and_all_pairs_can_sign() {
        let (keys, _packages) = build_dkg();
        let group_public_key = keys[0].group_public_key_bytes();
        assert_eq!(keys[1].group_public_key_bytes(), group_public_key);
        assert_eq!(keys[2].group_public_key_bytes(), group_public_key);

        for pair in [[0usize, 1usize], [0, 2], [1, 2]] {
            let message = format!("native-mpc-pair-{}-{}", pair[0] + 1, pair[1] + 1);
            let (nonces_a, commitments_a) = keys[pair[0]].commit();
            let (nonces_b, commitments_b) = keys[pair[1]].commit();
            let commitment_list = vec![
                ParticipantCommitment::new(keys[pair[0]].identifier(), commitments_a),
                ParticipantCommitment::new(keys[pair[1]].identifier(), commitments_b),
            ];
            let share_a = keys[pair[0]]
                .sign_share(nonces_a, message.as_bytes(), &commitment_list)
                .unwrap();
            let share_b = keys[pair[1]]
                .sign_share(nonces_b, message.as_bytes(), &commitment_list)
                .unwrap();
            let verification_shares: [VerificationShare; 2] = [
                keys[pair[0]].verification_share(),
                keys[pair[1]].verification_share(),
            ];
            let signature_shares: [SignatureShare; 2] = [share_a, share_b];
            let signature = aggregate(
                group_public_key,
                message.as_bytes(),
                &commitment_list,
                &verification_shares,
                &signature_shares,
            )
            .unwrap();
            verify_with_ed25519(group_public_key, message.as_bytes(), &signature).unwrap();
        }
    }

    #[test]
    fn corrupted_round_two_share_is_rejected_before_key_finalization() {
        let id1 = ParticipantIdentifier::new(1).unwrap();
        let id2 = ParticipantIdentifier::new(2).unwrap();
        let id3 = ParticipantIdentifier::new(3).unwrap();
        let (secret1, package1) = round1(id1).unwrap();
        let (_secret2, package2) = round1(id2).unwrap();
        let (_secret3, package3) = round1(id3).unwrap();
        let packages = vec![package1, package2, package3];
        let mut share = round2_share(&secret1, &packages, id2).unwrap();
        share.value += Scalar::from(1u64);
        assert_eq!(
            verify_round2_share(&share, &packages[0]),
            Err(DkgError::InvalidShare(1))
        );
    }
}

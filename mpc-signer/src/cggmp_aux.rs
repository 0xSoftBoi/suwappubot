//! CGGMP24 auxiliary-key provisioning foundation.
//!
//! This module owns the first malicious-presigning prerequisite: Paillier key
//! material, Ring-Pedersen parameters, and the `Pi_prm` proof that the prover
//! knows the discrete-log relation between those public parameters. It does
//! not promote this material to a presigning-capable state: `Pi_mod` and
//! `Pi_fac` are still required before peers may trust a candidate.
//!
//! `fast-paillier` is used only as the low-level Paillier/big-integer primitive.
//! The protocol transcript, state boundary, and proof below are implemented in
//! this crate and use an explicitly domain-separated Suwappu encoding.

use fast_paillier::{
    backend::Integer, DecryptionKey, EncryptionKey,
};
use rand_core::{CryptoRng, OsRng, RngCore};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::secp256k1_dkg::{ExecutionId, ParticipantId};

/// CGGMP24's 128-bit profile uses two 1536-bit safe primes per RSA modulus.
pub const RSA_PRIME_BITS: u32 = 1536;
/// A product of two 1536-bit primes may be 3071 bits, so this is the minimum
/// accepted public-modulus size in the reference 128-bit profile.
pub const RSA_PUBLIC_MIN_BITS: u64 = 3071;
/// Soundness repetitions for the Ring-Pedersen parameter proof.
pub const PI_PRM_REPETITIONS: usize = 128;

const PI_PRM_TAG: &[u8] = b"suwappu/cggmp24/pi-prm/challenge/v1";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AuxError {
    #[error("Paillier primitive operation failed")]
    Paillier,
    #[error("RSA/Ring-Pedersen modulus is below the required security size")]
    ModulusTooSmall,
    #[error("Ring-Pedersen public parameters are outside the required domains")]
    InvalidParameters,
    #[error("Ring-Pedersen parameter proof is invalid")]
    InvalidPiPrm,
    #[error("auxiliary material belongs to a different execution")]
    ExecutionMismatch,
    #[error("modular exponentiation failed")]
    ModularExponentiation,
}

/// Public Ring-Pedersen parameters `(N_hat, s, t)`.
#[derive(Clone, Debug)]
pub struct RingPedersenParams {
    modulus: Integer,
    s: Integer,
    t: Integer,
}

impl RingPedersenParams {
    pub fn modulus_bytes(&self) -> Vec<u8> {
        self.modulus.to_bytes_msf()
    }

    pub fn s_bytes(&self) -> Vec<u8> {
        self.s.to_bytes_msf()
    }

    pub fn t_bytes(&self) -> Vec<u8> {
        self.t.to_bytes_msf()
    }
}

/// Fiat-Shamir `Pi_prm` proof with 128 one-bit challenges.
///
/// The proof is public. Secret exponents used to create it never appear in
/// this type.
#[derive(Clone, Debug)]
pub struct PiPrmProof {
    commitments: [Integer; PI_PRM_REPETITIONS],
    responses: [Integer; PI_PRM_REPETITIONS],
}

impl PiPrmProof {
    pub fn commitment_bytes(&self) -> Vec<Vec<u8>> {
        self.commitments
            .iter()
            .map(Integer::to_bytes_msf)
            .collect()
    }

    pub fn response_bytes(&self) -> Vec<Vec<u8>> {
        self.responses
            .iter()
            .map(Integer::to_bytes_msf)
            .collect()
    }
}

/// Public auxiliary data after local generation but before `Pi_mod` and
/// `Pi_fac` verification. Keeping "Candidate" in the type name is deliberate:
/// this state cannot be used to manufacture a CGGMP presignature.
pub struct CandidateAuxPublic {
    execution: [u8; 32],
    participant: ParticipantId,
    paillier: EncryptionKey,
    ring_pedersen: RingPedersenParams,
    pi_prm: PiPrmProof,
}

impl CandidateAuxPublic {
    pub fn participant(&self) -> ParticipantId {
        self.participant
    }

    pub fn paillier_modulus_bytes(&self) -> Vec<u8> {
        self.paillier.n().to_bytes_msf()
    }

    pub fn ring_pedersen(&self) -> &RingPedersenParams {
        &self.ring_pedersen
    }

    pub fn pi_prm(&self) -> &PiPrmProof {
        &self.pi_prm
    }

    /// Verify this candidate's `Pi_prm` proof with production size checks.
    /// Success proves only the Ring-Pedersen parameter relation; it does not
    /// mark the complete auxiliary package trusted for presigning.
    pub fn verify_pi_prm(&self, execution: ExecutionId) -> Result<(), AuxError> {
        if self.execution != execution.digest() {
            return Err(AuxError::ExecutionMismatch);
        }
        if self.paillier.n().significant_bits() < RSA_PUBLIC_MIN_BITS {
            return Err(AuxError::ModulusTooSmall);
        }
        verify_pi_prm_inner(
            execution,
            self.participant,
            &self.ring_pedersen,
            &self.pi_prm,
            RSA_PUBLIC_MIN_BITS,
        )
    }
}

/// Private auxiliary material retained by one signer for future `Pi_mod`,
/// `Pi_fac`, and presigning. It is intentionally non-cloneable.
///
/// The current bigint backend does not promise constant-time arithmetic or
/// zeroizing deallocation. That is recorded as a production hardening gate;
/// this wrapper therefore makes no stronger memory-erasure claim.
pub struct AuxPrivate {
    paillier: DecryptionKey,
}

impl AuxPrivate {
    pub fn paillier_modulus_bytes(&self) -> Vec<u8> {
        self.paillier.n().to_bytes_msf()
    }
}

/// Generate the local part of CGGMP24 auxiliary provisioning at the 128-bit
/// profile. This intentionally performs four fresh 1536-bit safe-prime
/// generations and can be expensive; it belongs off the transaction hot path.
pub fn generate_candidate(
    execution: ExecutionId,
    participant: ParticipantId,
) -> Result<(AuxPrivate, CandidateAuxPublic), AuxError> {
    let mut rng = OsRng;
    let paillier = DecryptionKey::generate(&mut rng).map_err(|_| AuxError::Paillier)?;
    if paillier.bits_length() < u64::from(RSA_PRIME_BITS)
        || paillier.n().significant_bits() < RSA_PUBLIC_MIN_BITS
    {
        return Err(AuxError::ModulusTooSmall);
    }

    let hat_p = Integer::generate_safe_prime(&mut rng, RSA_PRIME_BITS);
    let hat_q = Integer::generate_safe_prime(&mut rng, RSA_PRIME_BITS);
    let (ring_pedersen, pedersen_phi, pedersen_lambda) =
        build_ring_pedersen(&mut rng, hat_p, hat_q)?;
    let pi_prm = prove_pi_prm_inner(
        execution,
        participant,
        &ring_pedersen,
        &pedersen_phi,
        &pedersen_lambda,
        &mut rng,
        RSA_PUBLIC_MIN_BITS,
    )?;

    let public = CandidateAuxPublic {
        execution: execution.digest(),
        participant,
        paillier: paillier.encryption_key().clone(),
        ring_pedersen,
        pi_prm,
    };
    let private = AuxPrivate { paillier };
    Ok((private, public))
}

fn build_ring_pedersen(
    rng: &mut (impl RngCore + CryptoRng),
    p: Integer,
    q: Integer,
) -> Result<(RingPedersenParams, Integer, Integer), AuxError> {
    if p == q {
        return Err(AuxError::InvalidParameters);
    }
    let modulus = &p * &q;
    let phi = (&p - 1u8) * (&q - 1u8);
    if phi == Integer::from(0u8) {
        return Err(AuxError::InvalidParameters);
    }

    let r = Integer::sample_in_mult_group_of(rng, &modulus);
    let t = r.square().modulo(&modulus);
    let lambda_range = phi.clone() >> 2u32;
    if lambda_range == Integer::from(0u8) {
        return Err(AuxError::InvalidParameters);
    }
    let lambda = loop {
        let candidate = Integer::random_below(lambda_range.clone(), rng);
        if candidate != Integer::from(0u8) {
            break candidate;
        }
    };
    let s = t
        .pow_mod_ref(&lambda, &modulus)
        .ok_or(AuxError::ModularExponentiation)?;
    let params = RingPedersenParams { modulus, s, t };
    validate_ring_pedersen(&params, 1)?;
    Ok((params, phi, lambda))
}

fn prove_pi_prm_inner(
    execution: ExecutionId,
    participant: ParticipantId,
    params: &RingPedersenParams,
    phi: &Integer,
    lambda: &Integer,
    rng: &mut (impl RngCore + CryptoRng),
    min_modulus_bits: u64,
) -> Result<PiPrmProof, AuxError> {
    validate_ring_pedersen(params, min_modulus_bits)?;
    if phi.cmp0().is_le() || lambda.cmp0().is_le() || lambda >= phi {
        return Err(AuxError::InvalidParameters);
    }

    let private_commitments: [Integer; PI_PRM_REPETITIONS] =
        [(); PI_PRM_REPETITIONS].map(|()| phi.random_below_ref(rng));
    let commitments: [Integer; PI_PRM_REPETITIONS] = private_commitments
        .iter()
        .map(|exponent| params.t.pow_mod_ref(exponent, &params.modulus))
        .collect::<Option<Vec<_>>>()
        .ok_or(AuxError::ModularExponentiation)?
        .try_into()
        .map_err(|_| AuxError::InvalidPiPrm)?;
    let challenges = pi_prm_challenges(execution, participant, params, &commitments);
    let mut responses = private_commitments;
    for (response, challenged) in responses.iter_mut().zip(challenges) {
        if challenged {
            *response += lambda;
            response.modulo_mut(phi);
        }
    }
    Ok(PiPrmProof {
        commitments,
        responses,
    })
}

fn verify_pi_prm_inner(
    execution: ExecutionId,
    participant: ParticipantId,
    params: &RingPedersenParams,
    proof: &PiPrmProof,
    min_modulus_bits: u64,
) -> Result<(), AuxError> {
    // Domain checks deliberately happen before any proof-body exponentiation.
    validate_ring_pedersen(params, min_modulus_bits)?;
    for (commitment, response) in proof.commitments.iter().zip(&proof.responses) {
        if !commitment.in_mult_group_of(&params.modulus)
            || response.cmp0().is_lt()
            || response >= &params.modulus
        {
            return Err(AuxError::InvalidPiPrm);
        }
    }

    let challenges = pi_prm_challenges(execution, participant, params, &proof.commitments);
    for ((response, commitment), challenged) in proof
        .responses
        .iter()
        .zip(&proof.commitments)
        .zip(challenges)
    {
        let lhs = params
            .t
            .pow_mod_ref(response, &params.modulus)
            .ok_or(AuxError::InvalidPiPrm)?;
        let rhs = if challenged {
            (&params.s * commitment).modulo(&params.modulus)
        } else {
            commitment.clone()
        };
        if lhs != rhs {
            return Err(AuxError::InvalidPiPrm);
        }
    }
    Ok(())
}

fn validate_ring_pedersen(
    params: &RingPedersenParams,
    min_modulus_bits: u64,
) -> Result<(), AuxError> {
    if params.modulus.significant_bits() < min_modulus_bits {
        return Err(AuxError::ModulusTooSmall);
    }
    if params.modulus.is_even()
        || !params.s.in_mult_group_of(&params.modulus)
        || !params.t.in_mult_group_of(&params.modulus)
    {
        return Err(AuxError::InvalidParameters);
    }
    Ok(())
}

fn pi_prm_challenges(
    execution: ExecutionId,
    participant: ParticipantId,
    params: &RingPedersenParams,
    commitments: &[Integer; PI_PRM_REPETITIONS],
) -> [bool; PI_PRM_REPETITIONS] {
    let mut hasher = Sha256::new();
    hasher.update(PI_PRM_TAG);
    hasher.update(execution.digest());
    hasher.update(participant.get().to_be_bytes());
    transcript_integer(&mut hasher, &params.modulus);
    transcript_integer(&mut hasher, &params.s);
    transcript_integer(&mut hasher, &params.t);
    hasher.update((PI_PRM_REPETITIONS as u64).to_be_bytes());
    for commitment in commitments {
        transcript_integer(&mut hasher, commitment);
    }
    let digest = hasher.finalize();
    std::array::from_fn(|index| ((digest[index / 8] >> (index % 8)) & 1) == 1)
}

fn transcript_integer(hasher: &mut Sha256, value: &Integer) {
    let bytes = value.to_bytes_msf();
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_candidate(
        execution: ExecutionId,
    ) -> (AuxPrivate, CandidateAuxPublic) {
        let mut rng = OsRng;
        // Tiny safe primes are test-only. Production construction never calls
        // this helper and always enforces the 1536/3071-bit profile above.
        let paillier = DecryptionKey::from_primes(Integer::from(47u8), Integer::from(59u8))
            .unwrap();
        let (ring_pedersen, pedersen_phi, pedersen_lambda) = build_ring_pedersen(
            &mut rng,
            Integer::from(83u8),
            Integer::from(107u8),
        )
        .unwrap();
        let participant = ParticipantId::new(1).unwrap();
        let pi_prm = prove_pi_prm_inner(
            execution,
            participant,
            &ring_pedersen,
            &pedersen_phi,
            &pedersen_lambda,
            &mut rng,
            1,
        )
        .unwrap();
        let public = CandidateAuxPublic {
            execution: execution.digest(),
            participant,
            paillier: paillier.encryption_key().clone(),
            ring_pedersen,
            pi_prm,
        };
        let private = AuxPrivate { paillier };
        (private, public)
    }

    #[test]
    fn pi_prm_accepts_honest_relation_and_rejects_wrong_context() {
        let execution = ExecutionId::new(b"aux-pi-prm").unwrap();
        let (_, public) = small_candidate(execution);
        verify_pi_prm_inner(
            execution,
            public.participant,
            &public.ring_pedersen,
            &public.pi_prm,
            1,
        )
        .unwrap();

        let wrong_execution = ExecutionId::new(b"aux-pi-prm-other").unwrap();
        assert_eq!(
            verify_pi_prm_inner(
                wrong_execution,
                public.participant,
                &public.ring_pedersen,
                &public.pi_prm,
                1,
            ),
            Err(AuxError::InvalidPiPrm)
        );
    }

    #[test]
    fn pi_prm_rejects_tampered_public_relation() {
        let execution = ExecutionId::new(b"aux-pi-prm-tamper").unwrap();
        let (_, mut public) = small_candidate(execution);
        public.ring_pedersen.s += Integer::from(1u8);
        assert!(verify_pi_prm_inner(
            execution,
            public.participant,
            &public.ring_pedersen,
            &public.pi_prm,
            1,
        )
        .is_err());
    }

    #[test]
    fn paillier_signed_plaintexts_and_homomorphic_addition_round_trip() {
        let execution = ExecutionId::new(b"aux-paillier-algebra").unwrap();
        let (private, _) = small_candidate(execution);
        let ek = private.paillier.encryption_key();
        let mut rng = OsRng;
        let (left, _) = ek
            .encrypt_with_random(&mut rng, &Integer::from(-7i8))
            .unwrap();
        let (right, _) = ek
            .encrypt_with_random(&mut rng, &Integer::from(11i8))
            .unwrap();
        let sum = ek.oadd(&left, &right).unwrap();
        assert_eq!(private.paillier.decrypt(&sum).unwrap(), Integer::from(4u8));
    }

    #[test]
    fn production_verifier_rejects_tiny_test_moduli() {
        let execution = ExecutionId::new(b"aux-size-gate").unwrap();
        let (_, public) = small_candidate(execution);
        assert_eq!(
            public.verify_pi_prm(execution),
            Err(AuxError::ModulusTooSmall)
        );
    }

    #[test]
    fn security_constants_match_cggmp24_128_bit_profile() {
        assert_eq!(RSA_PRIME_BITS, 1536);
        assert_eq!(RSA_PUBLIC_MIN_BITS, 3071);
        assert_eq!(PI_PRM_REPETITIONS, 128);
    }
}

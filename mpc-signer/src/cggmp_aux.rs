//! CGGMP24 auxiliary-key provisioning foundation.
//!
//! This module owns the first malicious-presigning prerequisite: Paillier key
//! material, Ring-Pedersen parameters, the `Pi_prm` parameter-relation proof,
//! the `Pi_mod` Paillier-Blum modulus proof, and the peer-specific `Pi_fac`
//! no-small-factor proof. It does not promote this material to a
//! presigning-capable state: the reliable auxiliary provisioning state machine
//! is still required before peers may trust it.
//!
//! `fast-paillier` is used only as the low-level Paillier/big-integer primitive.
//! The protocol transcript, state boundary, and proof below are implemented in
//! this crate and use an explicitly domain-separated Suwappu encoding.

use fast_paillier::{
    backend::{Integer, IsPrime},
    utils::CrtExp,
    DecryptionKey, EncryptionKey,
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
/// Soundness repetitions for the Paillier-Blum modulus proof.
pub const PI_MOD_REPETITIONS: usize = 128;
/// CGGMP24's 128-bit profile `ell` parameter for the no-small-factor proof.
pub const PI_FAC_L_BITS: usize = 256;
/// CGGMP24's 128-bit profile statistical slack for the no-small-factor proof.
pub const PI_FAC_EPSILON_BITS: usize = 512;
/// Collective random seed mixed from every participant's committed `rho_i`.
pub const SHARED_RANDOMNESS_BYTES: usize = 32;

const PI_PRM_TAG: &[u8] = b"suwappu/cggmp24/pi-prm/challenge/v1";
const PI_MOD_TAG: &[u8] = b"suwappu/cggmp24/pi-mod/challenge/v1";
const PI_FAC_TAG: &[u8] = b"suwappu/cggmp24/pi-fac/challenge/v1";
const HASH_STREAM_TAG: &[u8] = b"suwappu/cggmp24/hash-stream/v1";

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
    #[error("Paillier-Blum modulus proof is invalid")]
    InvalidPiMod,
    #[error("Paillier no-small-factor proof is invalid")]
    InvalidPiFac,
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

#[derive(Clone, Debug)]
struct PiModProofPoint {
    x: Integer,
    negate: bool,
    multiply_w: bool,
    z: Integer,
}

/// Fiat-Shamir proof that a public Paillier modulus satisfies the CGGMP24
/// Paillier-Blum relation. The 128 challenges are derived from the execution,
/// prover, collective `rho`, modulus, and proof commitment.
#[derive(Clone, Debug)]
pub struct PiModProof {
    w: Integer,
    points: [PiModProofPoint; PI_MOD_REPETITIONS],
}

#[derive(Clone, Debug)]
struct PiFacCommitment {
    p: Integer,
    q: Integer,
    a: Integer,
    b: Integer,
    t: Integer,
}

/// Fiat-Shamir `Pi_fac` proof that the prover's public Paillier modulus does
/// not contain a factor below the CGGMP24 bound. Each proof is specific to one
/// verifier because it is constructed with that verifier's Ring-Pedersen
/// parameters.
#[derive(Clone, Debug)]
pub struct PiFacProof {
    commitment: PiFacCommitment,
    z1: Integer,
    z2: Integer,
    w1: Integer,
    w2: Integer,
    v: Integer,
}

impl PiFacProof {
    pub fn commitment_bytes(&self) -> [Vec<u8>; 5] {
        [
            self.commitment.p.to_bytes_msf(),
            self.commitment.q.to_bytes_msf(),
            self.commitment.a.to_bytes_msf(),
            self.commitment.b.to_bytes_msf(),
            self.commitment.t.to_bytes_msf(),
        ]
    }
}

impl PiModProof {
    pub fn commitment_bytes(&self) -> Vec<u8> {
        self.w.to_bytes_msf()
    }

    pub fn point_count(&self) -> usize {
        self.points.len()
    }
}

impl PiPrmProof {
    pub fn commitment_bytes(&self) -> Vec<Vec<u8>> {
        self.commitments.iter().map(Integer::to_bytes_msf).collect()
    }

    pub fn response_bytes(&self) -> Vec<Vec<u8>> {
        self.responses.iter().map(Integer::to_bytes_msf).collect()
    }
}

/// Public auxiliary data after local generation but before the complete peer
/// proof set has been verified. Keeping "Candidate" in the type name is
/// deliberate: this state cannot be used to manufacture a CGGMP presignature.
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

    /// Verify `Pi_mod` after the commit/echo/reveal phase has fixed the
    /// collective random seed. This still does not promote the candidate to a
    /// presigning-capable auxiliary package: `Pi_fac` remains mandatory.
    pub fn verify_pi_mod(
        &self,
        execution: ExecutionId,
        shared_randomness: [u8; SHARED_RANDOMNESS_BYTES],
        proof: &PiModProof,
    ) -> Result<(), AuxError> {
        if self.execution != execution.digest() {
            return Err(AuxError::ExecutionMismatch);
        }
        verify_pi_mod_inner(
            execution,
            self.participant,
            &shared_randomness,
            self.paillier.n(),
            proof,
            RSA_PUBLIC_MIN_BITS,
        )
    }

    /// Verify this candidate/prover's peer-specific `Pi_fac` using the local
    /// verifier's Ring-Pedersen parameters. The proof is also bound to the
    /// collective random seed fixed by the earlier commitment round.
    ///
    /// Success is not a trusted-auxiliary transition. The complete auxiliary
    /// protocol must verify every peer's `Pi_prm`, `Pi_mod`, and `Pi_fac`
    /// before any resulting material can become presigning-capable.
    pub fn verify_pi_fac(
        &self,
        execution: ExecutionId,
        verifier: ParticipantId,
        verifier_params: &RingPedersenParams,
        shared_randomness: [u8; SHARED_RANDOMNESS_BYTES],
        proof: &PiFacProof,
    ) -> Result<(), AuxError> {
        if self.execution != execution.digest() {
            return Err(AuxError::ExecutionMismatch);
        }
        verify_pi_fac_inner(
            execution,
            self.participant,
            verifier,
            &shared_randomness,
            self.paillier.n(),
            verifier_params,
            proof,
            PiFacSecurity::PRODUCTION,
            RSA_PUBLIC_MIN_BITS,
        )
    }
}

/// Private auxiliary material retained by one signer for auxiliary proofs and
/// future presigning. It is intentionally non-cloneable.
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

    /// Construct `Pi_mod` only after the protocol has committed to and mixed
    /// every participant's `rho_i`. The proof is bound to that collective seed.
    pub fn prove_pi_mod(
        &self,
        execution: ExecutionId,
        participant: ParticipantId,
        shared_randomness: [u8; SHARED_RANDOMNESS_BYTES],
    ) -> Result<PiModProof, AuxError> {
        prove_pi_mod_inner(
            execution,
            participant,
            &shared_randomness,
            self.paillier.n(),
            self.paillier.p(),
            self.paillier.q(),
            &mut OsRng,
            RSA_PUBLIC_MIN_BITS,
        )
    }

    /// Construct the peer-specific `Pi_fac` proof for `verifier`. Callers must
    /// supply that verifier's committed Ring-Pedersen parameters and the
    /// collective seed produced by the auxiliary commitment round.
    pub fn prove_pi_fac(
        &self,
        execution: ExecutionId,
        participant: ParticipantId,
        verifier: ParticipantId,
        verifier_params: &RingPedersenParams,
        shared_randomness: [u8; SHARED_RANDOMNESS_BYTES],
    ) -> Result<PiFacProof, AuxError> {
        let mut rng = OsRng;
        prove_pi_fac_inner(
            execution,
            participant,
            verifier,
            &shared_randomness,
            self.paillier.n(),
            self.paillier.p(),
            self.paillier.q(),
            verifier_params,
            &mut rng,
            PiFacSecurity::PRODUCTION,
            RSA_PUBLIC_MIN_BITS,
        )
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

#[allow(clippy::too_many_arguments)]
fn prove_pi_mod_inner(
    execution: ExecutionId,
    participant: ParticipantId,
    shared_randomness: &[u8; SHARED_RANDOMNESS_BYTES],
    modulus: &Integer,
    p: &Integer,
    q: &Integer,
    rng: &mut (impl RngCore + CryptoRng),
    min_modulus_bits: u64,
) -> Result<PiModProof, AuxError> {
    validate_pi_mod_witness(modulus, p, q, rng, min_modulus_bits)?;
    let phi = (p - 1u8) * (q - 1u8);
    let n_inverse = modulus
        .invert_ref(&phi)
        .ok_or(AuxError::InvalidParameters)?;
    let crt = CrtExp::build_n(p, q).ok_or(AuxError::InvalidParameters)?;
    let prepared_inverse = crt.prepare_exponent(&n_inverse);

    // The commitment must be fixed before Fiat-Shamir challenges are derived.
    let w = sample_negative_jacobi(modulus, rng);
    let challenges = pi_mod_challenges(execution, participant, shared_randomness, modulus, &w);
    let points: [PiModProofPoint; PI_MOD_REPETITIONS] = challenges
        .iter()
        .map(|challenge| {
            let z = crt
                .exp(challenge, &prepared_inverse)
                .ok_or(AuxError::ModularExponentiation)?;
            let (negate, multiply_w, residue) =
                find_quadratic_residue(challenge, &w, p, q, modulus)
                    .ok_or(AuxError::InvalidParameters)?;
            let first_root = blum_square_root(&residue, p, q, modulus)?;
            let x = blum_square_root(&first_root, p, q, modulus)?;
            Ok(PiModProofPoint {
                x,
                negate,
                multiply_w,
                z,
            })
        })
        .collect::<Result<Vec<_>, AuxError>>()?
        .try_into()
        .map_err(|_| AuxError::InvalidPiMod)?;
    Ok(PiModProof { w, points })
}

fn verify_pi_mod_inner(
    execution: ExecutionId,
    participant: ParticipantId,
    shared_randomness: &[u8; SHARED_RANDOMNESS_BYTES],
    modulus: &Integer,
    proof: &PiModProof,
    min_modulus_bits: u64,
) -> Result<(), AuxError> {
    // Validate every public input before entering the proof-body exponentiation.
    if modulus.significant_bits() < min_modulus_bits {
        return Err(AuxError::ModulusTooSmall);
    }
    if modulus.is_even() || modulus.cmp0().is_le() {
        return Err(AuxError::InvalidPiMod);
    }
    let mut primality_rng = OsRng;
    if modulus.is_probably_prime(25, &mut primality_rng) != IsPrime::No {
        return Err(AuxError::InvalidPiMod);
    }
    if !proof.w.in_mult_group_of(modulus) || proof.w.jacobi(modulus) != -1 {
        return Err(AuxError::InvalidPiMod);
    }
    for point in &proof.points {
        if !point.x.in_mult_group_of(modulus) || !point.z.in_mult_group_of(modulus) {
            return Err(AuxError::InvalidPiMod);
        }
    }

    let challenges =
        pi_mod_challenges(execution, participant, shared_randomness, modulus, &proof.w);
    for (point, challenge) in proof.points.iter().zip(&challenges) {
        let nth_power = point
            .z
            .pow_mod_ref(modulus, modulus)
            .ok_or(AuxError::InvalidPiMod)?;
        if nth_power != *challenge {
            return Err(AuxError::InvalidPiMod);
        }

        let mut residue = if point.negate {
            modulus - challenge
        } else {
            challenge.clone()
        };
        if point.multiply_w {
            residue = (residue * &proof.w).modulo(modulus);
        }
        let fourth_power = point
            .x
            .pow_mod_ref(&Integer::from(4u8), modulus)
            .ok_or(AuxError::InvalidPiMod)?;
        if fourth_power != residue {
            return Err(AuxError::InvalidPiMod);
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct PiFacSecurity {
    l: usize,
    epsilon: usize,
}

impl PiFacSecurity {
    const PRODUCTION: Self = Self {
        l: PI_FAC_L_BITS,
        epsilon: PI_FAC_EPSILON_BITS,
    };
}

#[allow(clippy::too_many_arguments)]
fn prove_pi_fac_inner(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    shared_randomness: &[u8; SHARED_RANDOMNESS_BYTES],
    modulus: &Integer,
    p: &Integer,
    q: &Integer,
    verifier_params: &RingPedersenParams,
    rng: &mut (impl RngCore + CryptoRng),
    security: PiFacSecurity,
    min_modulus_bits: u64,
) -> Result<PiFacProof, AuxError> {
    validate_ring_pedersen(verifier_params, min_modulus_bits)?;
    validate_pi_mod_witness(modulus, p, q, rng, min_modulus_bits)?;
    validate_pi_fac_statement(modulus, security, min_modulus_bits)?;

    let n_root = modulus.sqrt_ref().ok_or(AuxError::InvalidParameters)?;
    let l_plus_epsilon = security
        .l
        .checked_add(security.epsilon)
        .ok_or(AuxError::InvalidParameters)?;
    let two_to_l = Integer::from(1u8) << security.l;
    let two_to_l_plus_epsilon = Integer::from(1u8) << l_plus_epsilon;
    let factor_upper_bound = &two_to_l * &n_root;
    if p.cmp0().is_le() || q.cmp0().is_le() || p >= &factor_upper_bound || q >= &factor_upper_bound
    {
        return Err(AuxError::InvalidParameters);
    }

    let alpha_range = &two_to_l_plus_epsilon * &n_root;
    let mu_range = &two_to_l * &verifier_params.modulus;
    let wide_aux_range = &two_to_l_plus_epsilon * &verifier_params.modulus;
    let r_range = &wide_aux_range * modulus;

    let alpha = sample_half_pm(rng, &alpha_range)?;
    let beta = sample_half_pm(rng, &alpha_range)?;
    let mu = sample_half_pm(rng, &mu_range)?;
    let nu = sample_half_pm(rng, &mu_range)?;
    let r = sample_half_pm(rng, &r_range)?;
    let x = sample_half_pm(rng, &wide_aux_range)?;
    let y = sample_half_pm(rng, &wide_aux_range)?;

    let commitment_p = ring_pedersen_combine(verifier_params, p, &mu)?;
    let commitment_q = ring_pedersen_combine(verifier_params, q, &nu)?;
    let commitment_a = ring_pedersen_combine(verifier_params, &alpha, &x)?;
    let commitment_b = ring_pedersen_combine(verifier_params, &beta, &y)?;
    let commitment_t = verifier_params
        .modulus
        .combine(&commitment_q, &alpha, &verifier_params.t, &r)
        .ok_or(AuxError::ModularExponentiation)?;
    let commitment = PiFacCommitment {
        p: commitment_p,
        q: commitment_q,
        a: commitment_a,
        b: commitment_b,
        t: commitment_t,
    };

    let challenge = pi_fac_challenge(
        execution,
        prover,
        verifier,
        shared_randomness,
        verifier_params,
        modulus,
        &n_root,
        &commitment,
        security,
    )?;
    Ok(PiFacProof {
        z1: &alpha + &challenge * p,
        z2: &beta + &challenge * q,
        w1: &x + &challenge * &mu,
        w2: &y + &challenge * &nu,
        v: &r - &challenge * (&nu * p),
        commitment,
    })
}

#[allow(clippy::too_many_arguments)]
fn verify_pi_fac_inner(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    shared_randomness: &[u8; SHARED_RANDOMNESS_BYTES],
    modulus: &Integer,
    verifier_params: &RingPedersenParams,
    proof: &PiFacProof,
    security: PiFacSecurity,
    min_modulus_bits: u64,
) -> Result<(), AuxError> {
    // Check all cheap public domains and response bounds before proof-body
    // exponentiation. This also bounds the two secret-factor response
    // exponents an attacker can make us process.
    validate_ring_pedersen(verifier_params, min_modulus_bits)?;
    validate_pi_fac_statement(modulus, security, min_modulus_bits)?;
    for commitment in [
        &proof.commitment.p,
        &proof.commitment.q,
        &proof.commitment.a,
        &proof.commitment.b,
        &proof.commitment.t,
    ] {
        if !commitment.in_mult_group_of(&verifier_params.modulus) {
            return Err(AuxError::InvalidPiFac);
        }
    }

    let n_root = modulus.sqrt_ref().ok_or(AuxError::InvalidPiFac)?;
    let l_plus_epsilon = security
        .l
        .checked_add(security.epsilon)
        .ok_or(AuxError::InvalidPiFac)?;
    let response_range = (Integer::from(1u8) << l_plus_epsilon) * &n_root;
    if !is_in_half_pm(&proof.z1, &response_range) || !is_in_half_pm(&proof.z2, &response_range) {
        return Err(AuxError::InvalidPiFac);
    }

    let challenge = pi_fac_challenge(
        execution,
        prover,
        verifier,
        shared_randomness,
        verifier_params,
        modulus,
        &n_root,
        &proof.commitment,
        security,
    )?;

    let lhs = ring_pedersen_combine(verifier_params, &proof.z1, &proof.w1)
        .map_err(|_| AuxError::InvalidPiFac)?;
    let p_to_challenge = proof
        .commitment
        .p
        .pow_mod_ref(&challenge, &verifier_params.modulus)
        .ok_or(AuxError::InvalidPiFac)?;
    let rhs = (&proof.commitment.a * p_to_challenge).modulo(&verifier_params.modulus);
    if lhs != rhs || !lhs.in_mult_group_of(&verifier_params.modulus) {
        return Err(AuxError::InvalidPiFac);
    }

    let lhs = ring_pedersen_combine(verifier_params, &proof.z2, &proof.w2)
        .map_err(|_| AuxError::InvalidPiFac)?;
    let q_to_challenge = proof
        .commitment
        .q
        .pow_mod_ref(&challenge, &verifier_params.modulus)
        .ok_or(AuxError::InvalidPiFac)?;
    let rhs = (&proof.commitment.b * q_to_challenge).modulo(&verifier_params.modulus);
    if lhs != rhs || !lhs.in_mult_group_of(&verifier_params.modulus) {
        return Err(AuxError::InvalidPiFac);
    }

    let s_to_n = verifier_params
        .s
        .pow_mod_ref(modulus, &verifier_params.modulus)
        .ok_or(AuxError::InvalidPiFac)?;
    let lhs = verifier_params
        .modulus
        .combine(&proof.commitment.q, &proof.z1, &verifier_params.t, &proof.v)
        .ok_or(AuxError::InvalidPiFac)?;
    let r_to_challenge = s_to_n
        .pow_mod_ref(&challenge, &verifier_params.modulus)
        .ok_or(AuxError::InvalidPiFac)?;
    let rhs = (&proof.commitment.t * r_to_challenge).modulo(&verifier_params.modulus);
    if lhs != rhs || !lhs.in_mult_group_of(&verifier_params.modulus) {
        return Err(AuxError::InvalidPiFac);
    }
    Ok(())
}

fn validate_pi_fac_statement(
    modulus: &Integer,
    security: PiFacSecurity,
    min_modulus_bits: u64,
) -> Result<(), AuxError> {
    if modulus.significant_bits() < min_modulus_bits {
        return Err(AuxError::ModulusTooSmall);
    }
    if modulus.cmp0().is_le() || modulus.is_even() || security.l == 0 {
        return Err(AuxError::InvalidPiFac);
    }
    let required_bits = security
        .l
        .checked_mul(4)
        .and_then(|bits| u64::try_from(bits).ok())
        .ok_or(AuxError::InvalidPiFac)?;
    if modulus.significant_bits() < required_bits {
        return Err(AuxError::InvalidPiFac);
    }
    security
        .l
        .checked_add(security.epsilon)
        .ok_or(AuxError::InvalidPiFac)?;
    Ok(())
}

fn ring_pedersen_combine(
    params: &RingPedersenParams,
    s_exponent: &Integer,
    t_exponent: &Integer,
) -> Result<Integer, AuxError> {
    params
        .modulus
        .combine(&params.s, s_exponent, &params.t, t_exponent)
        .ok_or(AuxError::ModularExponentiation)
}

fn sample_half_pm(rng: &mut impl RngCore, range: &Integer) -> Result<Integer, AuxError> {
    if range.cmp0().is_le() {
        return Err(AuxError::InvalidParameters);
    }
    let half = range >> 1u8;
    if range.is_even() {
        Ok((range + 1u8).random_below(rng) - half)
    } else {
        Ok(range.random_below_ref(rng) - half)
    }
}

fn is_in_half_pm(value: &Integer, range: &Integer) -> bool {
    let bound = range >> 1u8;
    value.cmp_abs(&bound).is_le()
}

fn validate_pi_mod_witness(
    modulus: &Integer,
    p: &Integer,
    q: &Integer,
    rng: &mut impl RngCore,
    min_modulus_bits: u64,
) -> Result<(), AuxError> {
    let expected_modulus = p * q;
    if modulus.significant_bits() < min_modulus_bits || p == q || &expected_modulus != modulus {
        return Err(AuxError::InvalidParameters);
    }
    if p.mod_u(4) != 3 || q.mod_u(4) != 3 {
        return Err(AuxError::InvalidParameters);
    }
    if !matches!(
        p.is_probably_prime(25, rng),
        IsPrime::Yes | IsPrime::Probably
    ) || !matches!(
        q.is_probably_prime(25, rng),
        IsPrime::Yes | IsPrime::Probably
    ) {
        return Err(AuxError::InvalidParameters);
    }
    Ok(())
}

fn sample_negative_jacobi(modulus: &Integer, rng: &mut impl RngCore) -> Integer {
    loop {
        let candidate = Integer::sample_in_mult_group_of(rng, modulus);
        if candidate.jacobi(modulus) == -1 {
            return candidate;
        }
    }
}

fn find_quadratic_residue(
    challenge: &Integer,
    w: &Integer,
    p: &Integer,
    q: &Integer,
    modulus: &Integer,
) -> Option<(bool, bool, Integer)> {
    let p_symbol = challenge.modulo_ref(p).jacobi(p);
    let q_symbol = challenge.modulo_ref(q).jacobi(q);
    match (p_symbol, q_symbol) {
        (1, 1) => return Some((false, false, challenge.clone())),
        (-1, -1) => return Some((true, false, modulus - challenge)),
        _ => {}
    }

    let with_w = (challenge * w).modulo(modulus);
    let p_symbol = with_w.modulo_ref(p).jacobi(p);
    let q_symbol = with_w.modulo_ref(q).jacobi(q);
    match (p_symbol, q_symbol) {
        (1, 1) => Some((false, true, with_w)),
        (-1, -1) => Some((true, true, modulus - with_w)),
        _ => None,
    }
}

fn blum_square_root(
    value: &Integer,
    p: &Integer,
    q: &Integer,
    modulus: &Integer,
) -> Result<Integer, AuxError> {
    let exponent = ((p - 1u8) * (q - 1u8) + 4u8) / 8u8;
    value
        .pow_mod_ref(&exponent, modulus)
        .ok_or(AuxError::ModularExponentiation)
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

fn pi_mod_challenges(
    execution: ExecutionId,
    participant: ParticipantId,
    shared_randomness: &[u8; SHARED_RANDOMNESS_BYTES],
    modulus: &Integer,
    w: &Integer,
) -> [Integer; PI_MOD_REPETITIONS] {
    let mut hasher = Sha256::new();
    hasher.update(PI_MOD_TAG);
    hasher.update(execution.digest());
    hasher.update(participant.get().to_be_bytes());
    hasher.update((SHARED_RANDOMNESS_BYTES as u64).to_be_bytes());
    hasher.update(shared_randomness);
    transcript_integer(&mut hasher, modulus);
    transcript_integer(&mut hasher, w);
    hasher.update((PI_MOD_REPETITIONS as u64).to_be_bytes());
    let seed: [u8; 32] = hasher.finalize().into();
    let mut rng = HashStreamRng::new(seed);
    [(); PI_MOD_REPETITIONS].map(|()| Integer::sample_in_mult_group_of(&mut rng, modulus))
}

#[allow(clippy::too_many_arguments)]
fn pi_fac_challenge(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    shared_randomness: &[u8; SHARED_RANDOMNESS_BYTES],
    verifier_params: &RingPedersenParams,
    modulus: &Integer,
    n_root: &Integer,
    commitment: &PiFacCommitment,
    security: PiFacSecurity,
) -> Result<Integer, AuxError> {
    let mut hasher = Sha256::new();
    hasher.update(PI_FAC_TAG);
    hasher.update(execution.digest());
    hasher.update(prover.get().to_be_bytes());
    hasher.update(verifier.get().to_be_bytes());
    hasher.update((SHARED_RANDOMNESS_BYTES as u64).to_be_bytes());
    hasher.update(shared_randomness);
    hasher.update((security.l as u64).to_be_bytes());
    hasher.update((security.epsilon as u64).to_be_bytes());
    transcript_integer(&mut hasher, &verifier_params.modulus);
    transcript_integer(&mut hasher, &verifier_params.s);
    transcript_integer(&mut hasher, &verifier_params.t);
    transcript_integer(&mut hasher, modulus);
    transcript_integer(&mut hasher, n_root);
    transcript_integer(&mut hasher, &commitment.p);
    transcript_integer(&mut hasher, &commitment.q);
    transcript_integer(&mut hasher, &commitment.a);
    transcript_integer(&mut hasher, &commitment.b);
    transcript_integer(&mut hasher, &commitment.t);
    let seed: [u8; 32] = hasher.finalize().into();
    let mut rng = HashStreamRng::new(seed);
    let challenge_range = Integer::from(1u8) << security.l;
    sample_half_pm(&mut rng, &challenge_range).map_err(|_| AuxError::InvalidPiFac)
}

fn transcript_integer(hasher: &mut Sha256, value: &Integer) {
    let bytes = value.to_bytes_msf();
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

/// Deterministic SHA-256 stream used only to map a public Fiat-Shamir seed to
/// uniformly sampled public challenge integers. It is never used for secrets.
struct HashStreamRng {
    seed: [u8; 32],
    counter: u64,
    block: [u8; 32],
    offset: usize,
}

impl HashStreamRng {
    fn new(seed: [u8; 32]) -> Self {
        Self {
            seed,
            counter: 0,
            block: [0u8; 32],
            offset: 32,
        }
    }

    fn refill(&mut self) {
        let mut hasher = Sha256::new();
        hasher.update(HASH_STREAM_TAG);
        hasher.update(self.seed);
        hasher.update(self.counter.to_be_bytes());
        self.block = hasher.finalize().into();
        self.offset = 0;
        assert_ne!(
            self.counter,
            u64::MAX,
            "Fiat-Shamir stream cannot consume 2^64 SHA-256 blocks"
        );
        self.counter += 1;
    }
}

impl RngCore for HashStreamRng {
    fn next_u32(&mut self) -> u32 {
        let mut bytes = [0u8; 4];
        self.fill_bytes(&mut bytes);
        u32::from_le_bytes(bytes)
    }

    fn next_u64(&mut self) -> u64 {
        let mut bytes = [0u8; 8];
        self.fill_bytes(&mut bytes);
        u64::from_le_bytes(bytes)
    }

    fn fill_bytes(&mut self, dest: &mut [u8]) {
        let mut written = 0;
        while written < dest.len() {
            if self.offset == self.block.len() {
                self.refill();
            }
            let available = self.block.len() - self.offset;
            let take = available.min(dest.len() - written);
            dest[written..written + take]
                .copy_from_slice(&self.block[self.offset..self.offset + take]);
            self.offset += take;
            written += take;
        }
    }

    fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand_core::Error> {
        self.fill_bytes(dest);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PI_FAC_SECURITY: PiFacSecurity = PiFacSecurity { l: 2, epsilon: 32 };

    fn small_candidate(execution: ExecutionId) -> (AuxPrivate, CandidateAuxPublic) {
        let mut rng = OsRng;
        // Tiny safe primes are test-only. Production construction never calls
        // this helper and always enforces the 1536/3071-bit profile above.
        let paillier =
            DecryptionKey::from_primes(Integer::from(47u8), Integer::from(59u8)).unwrap();
        let (ring_pedersen, pedersen_phi, pedersen_lambda) =
            build_ring_pedersen(&mut rng, Integer::from(83u8), Integer::from(107u8)).unwrap();
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
    fn pi_mod_accepts_honest_modulus_and_binds_collective_randomness() {
        let execution = ExecutionId::new(b"aux-pi-mod").unwrap();
        let (private, public) = small_candidate(execution);
        let rho = [0x42u8; SHARED_RANDOMNESS_BYTES];
        let mut rng = OsRng;
        let proof = prove_pi_mod_inner(
            execution,
            public.participant,
            &rho,
            private.paillier.n(),
            private.paillier.p(),
            private.paillier.q(),
            &mut rng,
            1,
        )
        .unwrap();
        verify_pi_mod_inner(
            execution,
            public.participant,
            &rho,
            private.paillier.n(),
            &proof,
            1,
        )
        .unwrap();

        let wrong_rho = [0x24u8; SHARED_RANDOMNESS_BYTES];
        assert_eq!(
            verify_pi_mod_inner(
                execution,
                public.participant,
                &wrong_rho,
                private.paillier.n(),
                &proof,
                1,
            ),
            Err(AuxError::InvalidPiMod)
        );
    }

    #[test]
    fn pi_mod_rejects_tampered_nth_root() {
        let execution = ExecutionId::new(b"aux-pi-mod-tamper").unwrap();
        let (private, public) = small_candidate(execution);
        let rho = [0x19u8; SHARED_RANDOMNESS_BYTES];
        let mut rng = OsRng;
        let mut proof = prove_pi_mod_inner(
            execution,
            public.participant,
            &rho,
            private.paillier.n(),
            private.paillier.p(),
            private.paillier.q(),
            &mut rng,
            1,
        )
        .unwrap();
        proof.points[0].z += Integer::from(1u8);
        assert_eq!(
            verify_pi_mod_inner(
                execution,
                public.participant,
                &rho,
                private.paillier.n(),
                &proof,
                1,
            ),
            Err(AuxError::InvalidPiMod)
        );
    }

    #[test]
    fn pi_fac_accepts_honest_factors_and_binds_peer_context() {
        let execution = ExecutionId::new(b"aux-pi-fac").unwrap();
        let (private, public) = small_candidate(execution);
        let verifier = ParticipantId::new(2).unwrap();
        let rho = [0xa6u8; SHARED_RANDOMNESS_BYTES];
        let mut rng = OsRng;
        let proof = prove_pi_fac_inner(
            execution,
            public.participant,
            verifier,
            &rho,
            private.paillier.n(),
            private.paillier.p(),
            private.paillier.q(),
            &public.ring_pedersen,
            &mut rng,
            TEST_PI_FAC_SECURITY,
            1,
        )
        .unwrap();
        verify_pi_fac_inner(
            execution,
            public.participant,
            verifier,
            &rho,
            private.paillier.n(),
            &public.ring_pedersen,
            &proof,
            TEST_PI_FAC_SECURITY,
            1,
        )
        .unwrap();

        // Exercise peer/rho transcript binding with the production challenge
        // width so collision probability is cryptographically negligible even
        // though the algebraic test above intentionally uses tiny integers.
        let n_root = private.paillier.n().sqrt_ref().unwrap();
        let challenge = pi_fac_challenge(
            execution,
            public.participant,
            verifier,
            &rho,
            &public.ring_pedersen,
            private.paillier.n(),
            &n_root,
            &proof.commitment,
            PiFacSecurity::PRODUCTION,
        )
        .unwrap();
        let other_verifier = ParticipantId::new(3).unwrap();
        let peer_challenge = pi_fac_challenge(
            execution,
            public.participant,
            other_verifier,
            &rho,
            &public.ring_pedersen,
            private.paillier.n(),
            &n_root,
            &proof.commitment,
            PiFacSecurity::PRODUCTION,
        )
        .unwrap();
        assert_ne!(challenge, peer_challenge);

        let other_rho = [0x6au8; SHARED_RANDOMNESS_BYTES];
        let rho_challenge = pi_fac_challenge(
            execution,
            public.participant,
            verifier,
            &other_rho,
            &public.ring_pedersen,
            private.paillier.n(),
            &n_root,
            &proof.commitment,
            PiFacSecurity::PRODUCTION,
        )
        .unwrap();
        assert_ne!(challenge, rho_challenge);
    }

    #[test]
    fn pi_fac_rejects_tampered_factor_response() {
        let execution = ExecutionId::new(b"aux-pi-fac-tamper").unwrap();
        let (private, public) = small_candidate(execution);
        let verifier = ParticipantId::new(2).unwrap();
        let rho = [0x3cu8; SHARED_RANDOMNESS_BYTES];
        let mut rng = OsRng;
        let mut proof = prove_pi_fac_inner(
            execution,
            public.participant,
            verifier,
            &rho,
            private.paillier.n(),
            private.paillier.p(),
            private.paillier.q(),
            &public.ring_pedersen,
            &mut rng,
            TEST_PI_FAC_SECURITY,
            1,
        )
        .unwrap();
        proof.z1 += Integer::from(1u8);
        assert_eq!(
            verify_pi_fac_inner(
                execution,
                public.participant,
                verifier,
                &rho,
                private.paillier.n(),
                &public.ring_pedersen,
                &proof,
                TEST_PI_FAC_SECURITY,
                1,
            ),
            Err(AuxError::InvalidPiFac)
        );
    }

    #[test]
    fn paillier_signed_plaintexts_and_homomorphic_addition_round_trip() {
        let execution = ExecutionId::new(b"aux-paillier-algebra").unwrap();
        let (private, _) = small_candidate(execution);
        let ek = private.paillier.encryption_key();
        let mut rng = OsRng;
        let (left, _) = ek
            .encrypt_with_random(&mut rng, &Integer::from(-7i32))
            .unwrap();
        let (right, _) = ek
            .encrypt_with_random(&mut rng, &Integer::from(11i32))
            .unwrap();
        let sum = ek.oadd(&left, &right).unwrap();
        assert_eq!(private.paillier.decrypt(&sum).unwrap(), Integer::from(4u8));
    }

    #[test]
    fn production_verifier_rejects_tiny_test_moduli() {
        let execution = ExecutionId::new(b"aux-size-gate").unwrap();
        let (private, public) = small_candidate(execution);
        assert_eq!(
            public.verify_pi_prm(execution),
            Err(AuxError::ModulusTooSmall)
        );
        let rho = [0x55u8; SHARED_RANDOMNESS_BYTES];
        let mut rng = OsRng;
        let proof = prove_pi_mod_inner(
            execution,
            public.participant,
            &rho,
            private.paillier.n(),
            private.paillier.p(),
            private.paillier.q(),
            &mut rng,
            1,
        )
        .unwrap();
        assert_eq!(
            public.verify_pi_mod(execution, rho, &proof),
            Err(AuxError::ModulusTooSmall)
        );

        let verifier = ParticipantId::new(2).unwrap();
        let fac_proof = prove_pi_fac_inner(
            execution,
            public.participant,
            verifier,
            &rho,
            private.paillier.n(),
            private.paillier.p(),
            private.paillier.q(),
            &public.ring_pedersen,
            &mut rng,
            TEST_PI_FAC_SECURITY,
            1,
        )
        .unwrap();
        assert_eq!(
            public.verify_pi_fac(execution, verifier, &public.ring_pedersen, rho, &fac_proof,),
            Err(AuxError::ModulusTooSmall)
        );
    }

    #[test]
    fn security_constants_match_cggmp24_128_bit_profile() {
        assert_eq!(RSA_PRIME_BITS, 1536);
        assert_eq!(RSA_PUBLIC_MIN_BITS, 3071);
        assert_eq!(PI_PRM_REPETITIONS, 128);
        assert_eq!(PI_MOD_REPETITIONS, 128);
        assert_eq!(PI_FAC_L_BITS, 256);
        assert_eq!(PI_FAC_EPSILON_BITS, 512);
        assert_eq!(SHARED_RANDOMNESS_BYTES, 32);
    }
}

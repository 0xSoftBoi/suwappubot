//! Malicious-presigning proof foundations for secp256k1 CGGMP24.
//!
//! This module starts with the `Pi_enc-elg`, `Pi_elog`, and `Pi_aff` proof
//! cores used by CGGMP24 presigning. It deliberately does not expose a
//! presignature constructor: MtA message/state transitions, reliable
//! broadcast, and the remaining consistency checks must all land first.

use fast_paillier::{backend::Integer, Ciphertext, EncryptionKey};
use k256::{
    elliptic_curve::{bigint::U256, ops::Reduce, sec1::ToEncodedPoint},
    FieldBytes, ProjectivePoint, Scalar,
};
use rand_core::{CryptoRng, RngCore};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    cggmp_aux::RingPedersenParams,
    secp256k1_dkg::{ExecutionId, ParticipantId},
};

/// `ell` for `Pi_enc-elg` at CGGMP24's 128-bit security profile.
pub const PI_ENC_ELG_L_BITS: usize = 256;
/// Statistical slack for `Pi_enc-elg` at the 128-bit profile.
pub const PI_ENC_ELG_EPSILON_BITS: usize = 512;
/// Multiplicative witness size `ell` for `Pi_aff` at the 128-bit profile.
pub const PI_AFF_X_BITS: usize = 256;
/// Additive mask size `ell'` for `Pi_aff` at the 128-bit profile.
pub const PI_AFF_Y_BITS: usize = 1280;
/// Statistical slack for `Pi_aff` at the 128-bit profile.
pub const PI_AFF_EPSILON_BITS: usize = 512;

const PI_ENC_ELG_TAG: &[u8] = b"suwappu/cggmp24/pi-enc-elg/challenge/v1";
const PI_ENC_ELG_STREAM_TAG: &[u8] = b"suwappu/cggmp24/pi-enc-elg/hash-stream/v1";
const PI_ELOG_TAG: &[u8] = b"suwappu/cggmp24/pi-elog/challenge/v1";
const PI_ELOG_STREAM_TAG: &[u8] = b"suwappu/cggmp24/pi-elog/hash-stream/v1";
const PI_AFF_TAG: &[u8] = b"suwappu/cggmp24/pi-aff/challenge/v1";
const PI_AFF_STREAM_TAG: &[u8] = b"suwappu/cggmp24/pi-aff/hash-stream/v1";
const SECP256K1_ORDER: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PresignProofError {
    #[error("presigning RSA/Ring-Pedersen modulus is below the required security size")]
    ModulusTooSmall,
    #[error("PiEncElg public statement is outside the required domains")]
    InvalidStatement,
    #[error("PiEncElg witness does not match the public statement")]
    InvalidWitness,
    #[error("PiEncElg proof is invalid")]
    InvalidPiEncElg,
    #[error("PiElog public statement is outside the required curve domain")]
    InvalidPiElogStatement,
    #[error("PiElog witness does not match the public statement")]
    InvalidPiElogWitness,
    #[error("PiElog proof is invalid")]
    InvalidPiElog,
    #[error("PiAff public statement is outside the required domains")]
    InvalidPiAffStatement,
    #[error("PiAff witness does not match the public statement")]
    InvalidPiAffWitness,
    #[error("PiAff proof is invalid")]
    InvalidPiAff,
    #[error("Paillier operation failed while constructing a presigning proof")]
    Paillier,
}

/// Distinguishes the two first-round proofs so a proof for `k_i` cannot be
/// replayed as the proof for `gamma_i` under the same execution.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PiEncElgKind {
    EphemeralKey,
    Gamma,
}

impl PiEncElgKind {
    fn transcript_byte(self) -> u8 {
        match self {
            Self::EphemeralKey => 0,
            Self::Gamma => 1,
        }
    }
}

/// Public `Pi_enc-elg` statement `(C, A, B, X)`.
#[derive(Clone, Debug)]
pub struct PiEncElgStatement {
    ciphertext: Ciphertext,
    a: ProjectivePoint,
    b: ProjectivePoint,
    x: ProjectivePoint,
}

impl PiEncElgStatement {
    pub fn new(
        ciphertext: Ciphertext,
        a: ProjectivePoint,
        b: ProjectivePoint,
        x: ProjectivePoint,
    ) -> Self {
        Self {
            ciphertext,
            a,
            b,
            x,
        }
    }

    pub fn ciphertext_bytes(&self) -> Vec<u8> {
        self.ciphertext.to_bytes_msf()
    }

    pub fn curve_points_bytes(&self) -> Result<[[u8; 33]; 3], PresignProofError> {
        Ok([
            encode_point(&self.a)?,
            encode_point(&self.b)?,
            encode_point(&self.x)?,
        ])
    }
}

#[derive(Clone, Debug)]
struct PiEncElgCommitment {
    s: Integer,
    t: Integer,
    d: Integer,
    y: ProjectivePoint,
    z: ProjectivePoint,
}

/// Non-interactive CGGMP24 `Pi_enc-elg` proof.
#[derive(Clone, Debug)]
pub struct PiEncElgProof {
    commitment: PiEncElgCommitment,
    z1: Integer,
    z2: Integer,
    z3: Integer,
    w: Scalar,
}

impl PiEncElgProof {
    pub fn commitment_integer_bytes(&self) -> [Vec<u8>; 3] {
        [
            self.commitment.s.to_bytes_msf(),
            self.commitment.t.to_bytes_msf(),
            self.commitment.d.to_bytes_msf(),
        ]
    }

    pub fn commitment_curve_bytes(&self) -> Result<[[u8; 33]; 2], PresignProofError> {
        Ok([
            encode_point(&self.commitment.y)?,
            encode_point(&self.commitment.z)?,
        ])
    }
}

/// Separates the round-two gamma relation from the later presignature
/// consistency relation in the Fiat-Shamir transcript.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PiElogKind {
    GammaShare,
    PresignatureConsistency,
}

impl PiElogKind {
    fn transcript_byte(self) -> u8 {
        match self {
            Self::GammaShare => 0,
            Self::PresignatureConsistency => 1,
        }
    }
}

/// Public `Pi_elog` statement `(L, M, X, Y, H)`.
///
/// A valid witness `(y, lambda)` satisfies `L = lambda*G`,
/// `M = lambda*X + y*G`, and `Y = y*H`.
#[derive(Clone, Debug)]
pub struct PiElogStatement {
    l: ProjectivePoint,
    m: ProjectivePoint,
    x: ProjectivePoint,
    y: ProjectivePoint,
    h: ProjectivePoint,
}

impl PiElogStatement {
    pub fn new(
        l: ProjectivePoint,
        m: ProjectivePoint,
        x: ProjectivePoint,
        y: ProjectivePoint,
        h: ProjectivePoint,
    ) -> Self {
        Self { l, m, x, y, h }
    }

    pub fn curve_points_bytes(&self) -> Result<[[u8; 33]; 5], PresignProofError> {
        Ok([
            encode_point(&self.l).map_err(|_| PresignProofError::InvalidPiElogStatement)?,
            encode_point(&self.m).map_err(|_| PresignProofError::InvalidPiElogStatement)?,
            encode_point(&self.x).map_err(|_| PresignProofError::InvalidPiElogStatement)?,
            encode_point(&self.y).map_err(|_| PresignProofError::InvalidPiElogStatement)?,
            encode_point(&self.h).map_err(|_| PresignProofError::InvalidPiElogStatement)?,
        ])
    }
}

#[derive(Clone, Debug)]
struct PiElogCommitment {
    a: ProjectivePoint,
    n: ProjectivePoint,
    b: ProjectivePoint,
}

/// Non-interactive CGGMP24 `Pi_elog` proof.
#[derive(Clone, Debug)]
pub struct PiElogProof {
    commitment: PiElogCommitment,
    z: Scalar,
    u: Scalar,
}

impl PiElogProof {
    pub fn commitment_curve_bytes(&self) -> Result<[[u8; 33]; 3], PresignProofError> {
        Ok([
            encode_point(&self.commitment.a).map_err(|_| PresignProofError::InvalidPiElog)?,
            encode_point(&self.commitment.n).map_err(|_| PresignProofError::InvalidPiElog)?,
            encode_point(&self.commitment.b).map_err(|_| PresignProofError::InvalidPiElog)?,
        ])
    }
}

/// Separates the gamma MtA proof from the long-term signing-share MtA proof.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PiAffKind {
    GammaShare,
    SigningShare,
}

impl PiAffKind {
    fn transcript_byte(self) -> u8 {
        match self {
            Self::GammaShare => 0,
            Self::SigningShare => 1,
        }
    }
}

/// Public `Pi_aff` statement `(C, D, Y, X)`.
///
/// `C` and `D` use the verifier/peer Paillier key, `Y` uses the prover's
/// Paillier key, and `X = x*G` binds the multiplicative witness to secp256k1.
#[derive(Clone, Debug)]
pub struct PiAffStatement {
    c: Ciphertext,
    d: Ciphertext,
    y: Ciphertext,
    x: ProjectivePoint,
}

impl PiAffStatement {
    pub fn new(c: Ciphertext, d: Ciphertext, y: Ciphertext, x: ProjectivePoint) -> Self {
        Self { c, d, y, x }
    }

    pub fn ciphertext_bytes(&self) -> [Vec<u8>; 3] {
        [
            self.c.to_bytes_msf(),
            self.d.to_bytes_msf(),
            self.y.to_bytes_msf(),
        ]
    }

    pub fn curve_point_bytes(&self) -> Result<[u8; 33], PresignProofError> {
        encode_point(&self.x).map_err(|_| PresignProofError::InvalidPiAffStatement)
    }
}

#[derive(Clone, Debug)]
struct PiAffCommitment {
    a: Integer,
    b_x: ProjectivePoint,
    b_y: Integer,
    e: Integer,
    s: Integer,
    f: Integer,
    t: Integer,
}

/// Non-interactive CGGMP24 `Pi_aff` proof.
#[derive(Clone, Debug)]
pub struct PiAffProof {
    commitment: PiAffCommitment,
    z1: Integer,
    z2: Integer,
    z3: Integer,
    z4: Integer,
    w: Integer,
    w_y: Integer,
}

impl PiAffProof {
    pub fn commitment_integer_bytes(&self) -> [Vec<u8>; 6] {
        [
            self.commitment.a.to_bytes_msf(),
            self.commitment.b_y.to_bytes_msf(),
            self.commitment.e.to_bytes_msf(),
            self.commitment.s.to_bytes_msf(),
            self.commitment.f.to_bytes_msf(),
            self.commitment.t.to_bytes_msf(),
        ]
    }

    pub fn commitment_curve_bytes(&self) -> Result<[u8; 33], PresignProofError> {
        encode_point(&self.commitment.b_x).map_err(|_| PresignProofError::InvalidPiAff)
    }
}

#[derive(Clone, Copy)]
struct PiEncElgSecurity {
    l: usize,
    epsilon: usize,
}

#[derive(Clone, Copy)]
struct PiAffSecurity {
    l_x: usize,
    l_y: usize,
    epsilon: usize,
}

impl PiAffSecurity {
    const PRODUCTION: Self = Self {
        l_x: PI_AFF_X_BITS,
        l_y: PI_AFF_Y_BITS,
        epsilon: PI_AFF_EPSILON_BITS,
    };
}

impl PiEncElgSecurity {
    const PRODUCTION: Self = Self {
        l: PI_ENC_ELG_L_BITS,
        epsilon: PI_ENC_ELG_EPSILON_BITS,
    };
}

#[allow(clippy::too_many_arguments)]
pub fn prove_pi_enc_elg(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiEncElgKind,
    verifier_params: &RingPedersenParams,
    key: &EncryptionKey,
    statement: &PiEncElgStatement,
    plaintext: &Integer,
    nonce: &Integer,
    b: Scalar,
    rng: &mut (impl RngCore + CryptoRng),
) -> Result<PiEncElgProof, PresignProofError> {
    prove_pi_enc_elg_inner(
        execution,
        prover,
        verifier,
        kind,
        verifier_params,
        key,
        statement,
        plaintext,
        nonce,
        b,
        rng,
        PiEncElgSecurity::PRODUCTION,
        crate::cggmp_aux::RSA_PUBLIC_MIN_BITS,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn verify_pi_enc_elg(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiEncElgKind,
    verifier_params: &RingPedersenParams,
    key: &EncryptionKey,
    statement: &PiEncElgStatement,
    proof: &PiEncElgProof,
) -> Result<(), PresignProofError> {
    verify_pi_enc_elg_inner(
        execution,
        prover,
        verifier,
        kind,
        verifier_params,
        key,
        statement,
        proof,
        PiEncElgSecurity::PRODUCTION,
        crate::cggmp_aux::RSA_PUBLIC_MIN_BITS,
    )
}

/// Prove the CGGMP24 discrete-log/ElGamal relation used in presigning.
pub fn prove_pi_elog(
    execution: ExecutionId,
    prover: ParticipantId,
    kind: PiElogKind,
    statement: &PiElogStatement,
    y: Scalar,
    lambda: Scalar,
    rng: &mut (impl RngCore + CryptoRng),
) -> Result<PiElogProof, PresignProofError> {
    validate_pi_elog_statement(statement)?;
    if ProjectivePoint::GENERATOR * lambda != statement.l
        || ProjectivePoint::GENERATOR * y + statement.x * lambda != statement.m
        || statement.h * y != statement.y
    {
        return Err(PresignProofError::InvalidPiElogWitness);
    }

    let (alpha, mask, commitment) = loop {
        let alpha = Scalar::generate_vartime(rng);
        let mask = Scalar::generate_vartime(rng);
        let commitment = PiElogCommitment {
            a: ProjectivePoint::GENERATOR * alpha,
            n: ProjectivePoint::GENERATOR * mask + statement.x * alpha,
            b: statement.h * mask,
        };
        if pi_elog_commitment_is_valid(&commitment) {
            break (alpha, mask, commitment);
        }
    };

    let challenge = pi_elog_challenge(execution, prover, kind, statement, &commitment)?;
    Ok(PiElogProof {
        commitment,
        z: alpha + challenge * lambda,
        u: mask + challenge * y,
    })
}

/// Verify the CGGMP24 discrete-log/ElGamal relation used in presigning.
pub fn verify_pi_elog(
    execution: ExecutionId,
    prover: ParticipantId,
    kind: PiElogKind,
    statement: &PiElogStatement,
    proof: &PiElogProof,
) -> Result<(), PresignProofError> {
    validate_pi_elog_statement(statement)?;
    if !pi_elog_commitment_is_valid(&proof.commitment) {
        return Err(PresignProofError::InvalidPiElog);
    }
    let challenge = pi_elog_challenge(execution, prover, kind, statement, &proof.commitment)?;
    if ProjectivePoint::GENERATOR * proof.z != proof.commitment.a + statement.l * challenge
        || ProjectivePoint::GENERATOR * proof.u + statement.x * proof.z
            != proof.commitment.n + statement.m * challenge
        || statement.h * proof.u != proof.commitment.b + statement.y * challenge
    {
        return Err(PresignProofError::InvalidPiElog);
    }
    Ok(())
}

/// Prove the verifier-specific CGGMP24 Paillier affine relation used by MtA.
#[allow(clippy::too_many_arguments)]
pub fn prove_pi_aff(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiAffKind,
    verifier_params: &RingPedersenParams,
    key_j: &EncryptionKey,
    key_i: &EncryptionKey,
    statement: &PiAffStatement,
    x: &Integer,
    y: &Integer,
    nonce: &Integer,
    nonce_y: &Integer,
    rng: &mut (impl RngCore + CryptoRng),
) -> Result<PiAffProof, PresignProofError> {
    prove_pi_aff_inner(
        execution,
        prover,
        verifier,
        kind,
        verifier_params,
        key_j,
        key_i,
        statement,
        x,
        y,
        nonce,
        nonce_y,
        rng,
        PiAffSecurity::PRODUCTION,
        crate::cggmp_aux::RSA_PUBLIC_MIN_BITS,
    )
}

/// Verify the verifier-specific CGGMP24 Paillier affine relation used by MtA.
#[allow(clippy::too_many_arguments)]
pub fn verify_pi_aff(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiAffKind,
    verifier_params: &RingPedersenParams,
    key_j: &EncryptionKey,
    key_i: &EncryptionKey,
    statement: &PiAffStatement,
    proof: &PiAffProof,
) -> Result<(), PresignProofError> {
    verify_pi_aff_inner(
        execution,
        prover,
        verifier,
        kind,
        verifier_params,
        key_j,
        key_i,
        statement,
        proof,
        PiAffSecurity::PRODUCTION,
        crate::cggmp_aux::RSA_PUBLIC_MIN_BITS,
    )
}

#[allow(clippy::too_many_arguments)]
fn prove_pi_enc_elg_inner(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiEncElgKind,
    verifier_params: &RingPedersenParams,
    key: &EncryptionKey,
    statement: &PiEncElgStatement,
    plaintext: &Integer,
    nonce: &Integer,
    b: Scalar,
    rng: &mut (impl RngCore + CryptoRng),
    security: PiEncElgSecurity,
    min_modulus_bits: u64,
) -> Result<PiEncElgProof, PresignProofError> {
    validate_statement(verifier_params, key, statement, security, min_modulus_bits)?;
    let plaintext_range = Integer::from(1u8) << security.l;
    if !is_in_half_pm(plaintext, &plaintext_range)
        || !key.in_signed_group(plaintext)
        || !nonce.in_mult_group_of(key.n())
    {
        return Err(PresignProofError::InvalidWitness);
    }
    if key
        .encrypt_with(plaintext, nonce)
        .map_err(|_| PresignProofError::Paillier)?
        != statement.ciphertext
        || ProjectivePoint::GENERATOR * b != statement.b
        || statement.a * b + ProjectivePoint::GENERATOR * integer_to_scalar(plaintext)
            != statement.x
    {
        return Err(PresignProofError::InvalidWitness);
    }

    let l_plus_epsilon = security
        .l
        .checked_add(security.epsilon)
        .ok_or(PresignProofError::InvalidWitness)?;
    let two_to_l_plus_epsilon = Integer::from(1u8) << l_plus_epsilon;
    let aux_at_two_to_l = (Integer::from(1u8) << security.l) * &verifier_params.modulus;
    let aux_at_two_to_l_plus_epsilon = &two_to_l_plus_epsilon * &verifier_params.modulus;

    let alpha = sample_half_pm(rng, &two_to_l_plus_epsilon)?;
    let mu = sample_half_pm(rng, &aux_at_two_to_l)?;
    let r = Integer::sample_in_mult_group_of(rng, key.n());
    let beta = Scalar::generate_vartime(rng);
    let gamma = sample_half_pm(rng, &aux_at_two_to_l_plus_epsilon)?;

    let s = ring_combine(verifier_params, plaintext, &mu)?;
    let t = ring_combine(verifier_params, &alpha, &gamma)?;
    let d = key
        .encrypt_with(&alpha, &r)
        .map_err(|_| PresignProofError::Paillier)?;
    let y = statement.a * beta + ProjectivePoint::GENERATOR * integer_to_scalar(&alpha);
    let z = ProjectivePoint::GENERATOR * beta;
    let commitment = PiEncElgCommitment { s, t, d, y, z };
    let challenge = pi_enc_elg_challenge(
        execution,
        prover,
        verifier,
        kind,
        verifier_params,
        key,
        statement,
        &commitment,
        security,
    )?;

    let nonce_to_challenge = nonce
        .pow_mod_ref(&challenge, key.n())
        .ok_or(PresignProofError::Paillier)?;
    let z2 = (&r * nonce_to_challenge).modulo(key.n());
    Ok(PiEncElgProof {
        z1: &alpha + &challenge * plaintext,
        z2,
        z3: &gamma + &challenge * &mu,
        w: beta + integer_to_scalar(&challenge) * b,
        commitment,
    })
}

#[allow(clippy::too_many_arguments)]
fn verify_pi_enc_elg_inner(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiEncElgKind,
    verifier_params: &RingPedersenParams,
    key: &EncryptionKey,
    statement: &PiEncElgStatement,
    proof: &PiEncElgProof,
    security: PiEncElgSecurity,
    min_modulus_bits: u64,
) -> Result<(), PresignProofError> {
    // Domain and range checks are intentionally completed before the
    // proof-body exponentiations/homomorphic operations.
    validate_statement(verifier_params, key, statement, security, min_modulus_bits)?;
    if !proof
        .commitment
        .s
        .in_mult_group_of(&verifier_params.modulus)
        || !proof
            .commitment
            .t
            .in_mult_group_of(&verifier_params.modulus)
        || !proof.commitment.d.in_mult_group_of(key.nn())
        || !proof.z2.in_mult_group_of(key.n())
        || proof.commitment.y == ProjectivePoint::IDENTITY
        || proof.commitment.z == ProjectivePoint::IDENTITY
    {
        return Err(PresignProofError::InvalidPiEncElg);
    }
    let response_bits = security
        .l
        .checked_add(security.epsilon)
        .ok_or(PresignProofError::InvalidPiEncElg)?;
    let response_range = Integer::from(1u8) << response_bits;
    if !is_in_half_pm(&proof.z1, &response_range) || !key.in_signed_group(&proof.z1) {
        return Err(PresignProofError::InvalidPiEncElg);
    }

    let challenge = pi_enc_elg_challenge(
        execution,
        prover,
        verifier,
        kind,
        verifier_params,
        key,
        statement,
        &proof.commitment,
        security,
    )?;

    let encrypted_response = key
        .encrypt_with(&proof.z1, &proof.z2)
        .map_err(|_| PresignProofError::InvalidPiEncElg)?;
    let challenge_at_ciphertext = key
        .omul(&challenge, &statement.ciphertext)
        .map_err(|_| PresignProofError::InvalidPiEncElg)?;
    let expected_ciphertext = key
        .oadd(&proof.commitment.d, &challenge_at_ciphertext)
        .map_err(|_| PresignProofError::InvalidPiEncElg)?;
    if encrypted_response != expected_ciphertext {
        return Err(PresignProofError::InvalidPiEncElg);
    }

    let challenge_scalar = integer_to_scalar(&challenge);
    let z1_scalar = integer_to_scalar(&proof.z1);
    if statement.a * proof.w + ProjectivePoint::GENERATOR * z1_scalar
        != proof.commitment.y + statement.x * challenge_scalar
        || ProjectivePoint::GENERATOR * proof.w
            != proof.commitment.z + statement.b * challenge_scalar
    {
        return Err(PresignProofError::InvalidPiEncElg);
    }

    let lhs = ring_combine(verifier_params, &proof.z1, &proof.z3)
        .map_err(|_| PresignProofError::InvalidPiEncElg)?;
    let s_to_challenge = proof
        .commitment
        .s
        .pow_mod_ref(&challenge, &verifier_params.modulus)
        .ok_or(PresignProofError::InvalidPiEncElg)?;
    let rhs = (&proof.commitment.t * s_to_challenge).modulo(&verifier_params.modulus);
    if lhs != rhs {
        return Err(PresignProofError::InvalidPiEncElg);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn prove_pi_aff_inner(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiAffKind,
    verifier_params: &RingPedersenParams,
    key_j: &EncryptionKey,
    key_i: &EncryptionKey,
    statement: &PiAffStatement,
    x: &Integer,
    y: &Integer,
    nonce: &Integer,
    nonce_y: &Integer,
    rng: &mut (impl RngCore + CryptoRng),
    security: PiAffSecurity,
    min_modulus_bits: u64,
) -> Result<PiAffProof, PresignProofError> {
    validate_pi_aff_statement(
        verifier_params,
        key_j,
        key_i,
        statement,
        security,
        min_modulus_bits,
    )?;
    let x_range = Integer::from(1u8) << security.l_x;
    let y_range = Integer::from(1u8) << security.l_y;
    if !is_in_half_pm(x, &x_range)
        || !is_in_half_pm(y, &y_range)
        || !key_j.in_signed_group(y)
        || !key_i.in_signed_group(y)
        || !nonce.in_mult_group_of(key_j.n())
        || !nonce_y.in_mult_group_of(key_i.n())
    {
        return Err(PresignProofError::InvalidPiAffWitness);
    }
    let x_at_c = key_j
        .omul(x, &statement.c)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
    let y_under_j = key_j
        .encrypt_with(y, nonce)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
    let expected_d = key_j
        .oadd(&x_at_c, &y_under_j)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
    let expected_y = key_i
        .encrypt_with(y, nonce_y)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
    if ProjectivePoint::GENERATOR * integer_to_scalar(x) != statement.x
        || expected_d != statement.d
        || expected_y != statement.y
    {
        return Err(PresignProofError::InvalidPiAffWitness);
    }

    let l_x_epsilon = security
        .l_x
        .checked_add(security.epsilon)
        .ok_or(PresignProofError::InvalidPiAffWitness)?;
    let l_y_epsilon = security
        .l_y
        .checked_add(security.epsilon)
        .ok_or(PresignProofError::InvalidPiAffWitness)?;
    let two_to_l_x_epsilon = Integer::from(1u8) << l_x_epsilon;
    let two_to_l_y_epsilon = Integer::from(1u8) << l_y_epsilon;
    let aux_at_two_to_l_x_epsilon = &verifier_params.modulus * &two_to_l_x_epsilon;
    let aux_at_two_to_l_x = &verifier_params.modulus * &x_range;

    let alpha = loop {
        let candidate = sample_half_pm(rng, &two_to_l_x_epsilon)
            .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
        if integer_to_scalar(&candidate) != Scalar::ZERO {
            break candidate;
        }
    };
    let beta = sample_half_pm(rng, &two_to_l_y_epsilon)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
    let r = Integer::sample_in_mult_group_of(rng, key_j.n());
    let r_y = Integer::sample_in_mult_group_of(rng, key_i.n());
    let gamma = sample_half_pm(rng, &aux_at_two_to_l_x_epsilon)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
    let delta = sample_half_pm(rng, &aux_at_two_to_l_x_epsilon)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
    let m = sample_half_pm(rng, &aux_at_two_to_l_x)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;
    let mu = sample_half_pm(rng, &aux_at_two_to_l_x)
        .map_err(|_| PresignProofError::InvalidPiAffWitness)?;

    let alpha_at_c = key_j
        .omul(&alpha, &statement.c)
        .map_err(|_| PresignProofError::Paillier)?;
    let beta_encrypted_j = key_j
        .encrypt_with(&beta, &r)
        .map_err(|_| PresignProofError::Paillier)?;
    let a = key_j
        .oadd(&alpha_at_c, &beta_encrypted_j)
        .map_err(|_| PresignProofError::Paillier)?;
    let commitment = PiAffCommitment {
        a,
        b_x: ProjectivePoint::GENERATOR * integer_to_scalar(&alpha),
        b_y: key_i
            .encrypt_with(&beta, &r_y)
            .map_err(|_| PresignProofError::Paillier)?,
        e: ring_combine(verifier_params, &alpha, &gamma)?,
        s: ring_combine(verifier_params, x, &m)?,
        f: ring_combine(verifier_params, &beta, &delta)?,
        t: ring_combine(verifier_params, y, &mu)?,
    };
    let challenge = pi_aff_challenge(
        execution,
        prover,
        verifier,
        kind,
        verifier_params,
        key_j,
        key_i,
        statement,
        &commitment,
        security,
    )?;
    let nonce_to_challenge = nonce
        .pow_mod_ref(&challenge, key_j.n())
        .ok_or(PresignProofError::Paillier)?;
    let nonce_y_to_challenge = nonce_y
        .pow_mod_ref(&challenge, key_i.n())
        .ok_or(PresignProofError::Paillier)?;
    Ok(PiAffProof {
        z1: &alpha + &challenge * x,
        z2: &beta + &challenge * y,
        z3: &gamma + &challenge * &m,
        z4: &delta + &challenge * &mu,
        w: (&r * nonce_to_challenge).modulo(key_j.n()),
        w_y: (&r_y * nonce_y_to_challenge).modulo(key_i.n()),
        commitment,
    })
}

#[allow(clippy::too_many_arguments)]
fn verify_pi_aff_inner(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiAffKind,
    verifier_params: &RingPedersenParams,
    key_j: &EncryptionKey,
    key_i: &EncryptionKey,
    statement: &PiAffStatement,
    proof: &PiAffProof,
    security: PiAffSecurity,
    min_modulus_bits: u64,
) -> Result<(), PresignProofError> {
    validate_pi_aff_statement(
        verifier_params,
        key_j,
        key_i,
        statement,
        security,
        min_modulus_bits,
    )?;
    if !proof.commitment.a.in_mult_group_of(key_j.nn())
        || proof.commitment.b_x == ProjectivePoint::IDENTITY
        || !proof.commitment.b_y.in_mult_group_of(key_i.nn())
        || !proof
            .commitment
            .e
            .in_mult_group_of(&verifier_params.modulus)
        || !proof
            .commitment
            .s
            .in_mult_group_of(&verifier_params.modulus)
        || !proof
            .commitment
            .f
            .in_mult_group_of(&verifier_params.modulus)
        || !proof
            .commitment
            .t
            .in_mult_group_of(&verifier_params.modulus)
        || !proof.w.in_mult_group_of(key_j.n())
        || !proof.w_y.in_mult_group_of(key_i.n())
    {
        return Err(PresignProofError::InvalidPiAff);
    }
    let l_x_epsilon = security
        .l_x
        .checked_add(security.epsilon)
        .ok_or(PresignProofError::InvalidPiAff)?;
    let l_y_epsilon = security
        .l_y
        .checked_add(security.epsilon)
        .ok_or(PresignProofError::InvalidPiAff)?;
    let z1_range = Integer::from(1u8) << l_x_epsilon;
    let z2_range = Integer::from(1u8) << l_y_epsilon;
    if !is_in_half_pm(&proof.z1, &z1_range)
        || !is_in_half_pm(&proof.z2, &z2_range)
        || !key_j.in_signed_group(&proof.z2)
        || !key_i.in_signed_group(&proof.z2)
    {
        return Err(PresignProofError::InvalidPiAff);
    }

    let challenge = pi_aff_challenge(
        execution,
        prover,
        verifier,
        kind,
        verifier_params,
        key_j,
        key_i,
        statement,
        &proof.commitment,
        security,
    )?;

    let z1_at_c = key_j
        .omul(&proof.z1, &statement.c)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    let encrypted_z2 = key_j
        .encrypt_with(&proof.z2, &proof.w)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    let lhs_affine = key_j
        .oadd(&z1_at_c, &encrypted_z2)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    let challenge_at_d = key_j
        .omul(&challenge, &statement.d)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    let rhs_affine = key_j
        .oadd(&proof.commitment.a, &challenge_at_d)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    if lhs_affine != rhs_affine {
        return Err(PresignProofError::InvalidPiAff);
    }

    if ProjectivePoint::GENERATOR * integer_to_scalar(&proof.z1)
        != proof.commitment.b_x + statement.x * integer_to_scalar(&challenge)
    {
        return Err(PresignProofError::InvalidPiAff);
    }

    let encrypted_z2_i = key_i
        .encrypt_with(&proof.z2, &proof.w_y)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    let challenge_at_y = key_i
        .omul(&challenge, &statement.y)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    let rhs_y = key_i
        .oadd(&proof.commitment.b_y, &challenge_at_y)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    if encrypted_z2_i != rhs_y {
        return Err(PresignProofError::InvalidPiAff);
    }

    let lhs_x = ring_combine(verifier_params, &proof.z1, &proof.z3)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    let s_to_challenge = proof
        .commitment
        .s
        .pow_mod_ref(&challenge, &verifier_params.modulus)
        .ok_or(PresignProofError::InvalidPiAff)?;
    let rhs_x = (&proof.commitment.e * s_to_challenge).modulo(&verifier_params.modulus);
    if lhs_x != rhs_x {
        return Err(PresignProofError::InvalidPiAff);
    }

    let lhs_y = ring_combine(verifier_params, &proof.z2, &proof.z4)
        .map_err(|_| PresignProofError::InvalidPiAff)?;
    let t_to_challenge = proof
        .commitment
        .t
        .pow_mod_ref(&challenge, &verifier_params.modulus)
        .ok_or(PresignProofError::InvalidPiAff)?;
    let rhs_y = (&proof.commitment.f * t_to_challenge).modulo(&verifier_params.modulus);
    if lhs_y != rhs_y {
        return Err(PresignProofError::InvalidPiAff);
    }
    Ok(())
}

fn validate_pi_aff_statement(
    verifier_params: &RingPedersenParams,
    key_j: &EncryptionKey,
    key_i: &EncryptionKey,
    statement: &PiAffStatement,
    security: PiAffSecurity,
    min_modulus_bits: u64,
) -> Result<(), PresignProofError> {
    if key_j.n().significant_bits() < min_modulus_bits
        || key_i.n().significant_bits() < min_modulus_bits
        || verifier_params.modulus.significant_bits() < min_modulus_bits
    {
        return Err(PresignProofError::ModulusTooSmall);
    }
    if key_j.n().cmp0().is_le()
        || key_j.n().is_even()
        || key_i.n().cmp0().is_le()
        || key_i.n().is_even()
        || verifier_params.modulus.cmp0().is_le()
        || verifier_params.modulus.is_even()
        || !verifier_params.s.in_mult_group_of(&verifier_params.modulus)
        || !verifier_params.t.in_mult_group_of(&verifier_params.modulus)
        || !statement.c.in_mult_group_of(key_j.nn())
        || !statement.d.in_mult_group_of(key_j.nn())
        || !statement.y.in_mult_group_of(key_i.nn())
        || statement.x == ProjectivePoint::IDENTITY
        || security.l_x == 0
        || security.l_y == 0
        || security.l_x.checked_add(security.epsilon).is_none()
        || security.l_y.checked_add(security.epsilon).is_none()
    {
        return Err(PresignProofError::InvalidPiAffStatement);
    }
    Ok(())
}

fn validate_statement(
    verifier_params: &RingPedersenParams,
    key: &EncryptionKey,
    statement: &PiEncElgStatement,
    security: PiEncElgSecurity,
    min_modulus_bits: u64,
) -> Result<(), PresignProofError> {
    if key.n().significant_bits() < min_modulus_bits
        || verifier_params.modulus.significant_bits() < min_modulus_bits
    {
        return Err(PresignProofError::ModulusTooSmall);
    }
    if key.n().cmp0().is_le()
        || key.n().is_even()
        || verifier_params.modulus.cmp0().is_le()
        || verifier_params.modulus.is_even()
        || !verifier_params.s.in_mult_group_of(&verifier_params.modulus)
        || !verifier_params.t.in_mult_group_of(&verifier_params.modulus)
        || !statement.ciphertext.in_mult_group_of(key.nn())
        || statement.a == ProjectivePoint::IDENTITY
        || statement.b == ProjectivePoint::IDENTITY
        || statement.x == ProjectivePoint::IDENTITY
        || security.l == 0
        || security.l.checked_add(security.epsilon).is_none()
    {
        return Err(PresignProofError::InvalidStatement);
    }
    Ok(())
}

fn ring_combine(
    params: &RingPedersenParams,
    s_exponent: &Integer,
    t_exponent: &Integer,
) -> Result<Integer, PresignProofError> {
    params
        .modulus
        .combine(&params.s, s_exponent, &params.t, t_exponent)
        .ok_or(PresignProofError::Paillier)
}

#[allow(clippy::too_many_arguments)]
fn pi_enc_elg_challenge(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiEncElgKind,
    verifier_params: &RingPedersenParams,
    key: &EncryptionKey,
    statement: &PiEncElgStatement,
    commitment: &PiEncElgCommitment,
    security: PiEncElgSecurity,
) -> Result<Integer, PresignProofError> {
    let mut hasher = Sha256::new();
    hasher.update(PI_ENC_ELG_TAG);
    hasher.update(execution.digest());
    hasher.update(prover.get().to_be_bytes());
    hasher.update(verifier.get().to_be_bytes());
    hasher.update([kind.transcript_byte()]);
    hasher.update((security.l as u64).to_be_bytes());
    hasher.update((security.epsilon as u64).to_be_bytes());
    transcript_integer(&mut hasher, &verifier_params.modulus);
    transcript_integer(&mut hasher, &verifier_params.s);
    transcript_integer(&mut hasher, &verifier_params.t);
    transcript_integer(&mut hasher, key.n());
    transcript_integer(&mut hasher, &statement.ciphertext);
    transcript_point(&mut hasher, &statement.a)?;
    transcript_point(&mut hasher, &statement.b)?;
    transcript_point(&mut hasher, &statement.x)?;
    transcript_integer(&mut hasher, &commitment.s);
    transcript_integer(&mut hasher, &commitment.t);
    transcript_integer(&mut hasher, &commitment.d);
    transcript_point(&mut hasher, &commitment.y)?;
    transcript_point(&mut hasher, &commitment.z)?;
    let seed: [u8; 32] = hasher.finalize().into();
    let mut rng = HashStreamRng::new(seed, PI_ENC_ELG_STREAM_TAG);
    sample_half_pm(&mut rng, &secp256k1_order())
}

#[allow(clippy::too_many_arguments)]
fn pi_aff_challenge(
    execution: ExecutionId,
    prover: ParticipantId,
    verifier: ParticipantId,
    kind: PiAffKind,
    verifier_params: &RingPedersenParams,
    key_j: &EncryptionKey,
    key_i: &EncryptionKey,
    statement: &PiAffStatement,
    commitment: &PiAffCommitment,
    security: PiAffSecurity,
) -> Result<Integer, PresignProofError> {
    let mut hasher = Sha256::new();
    hasher.update(PI_AFF_TAG);
    hasher.update(execution.digest());
    hasher.update(prover.get().to_be_bytes());
    hasher.update(verifier.get().to_be_bytes());
    hasher.update([kind.transcript_byte()]);
    hasher.update((security.l_x as u64).to_be_bytes());
    hasher.update((security.l_y as u64).to_be_bytes());
    hasher.update((security.epsilon as u64).to_be_bytes());
    transcript_integer(&mut hasher, &verifier_params.modulus);
    transcript_integer(&mut hasher, &verifier_params.s);
    transcript_integer(&mut hasher, &verifier_params.t);
    transcript_integer(&mut hasher, key_j.n());
    transcript_integer(&mut hasher, key_i.n());
    transcript_integer(&mut hasher, &statement.c);
    transcript_integer(&mut hasher, &statement.d);
    transcript_integer(&mut hasher, &statement.y);
    transcript_point(&mut hasher, &statement.x)?;
    transcript_integer(&mut hasher, &commitment.a);
    transcript_point(&mut hasher, &commitment.b_x)?;
    transcript_integer(&mut hasher, &commitment.b_y);
    transcript_integer(&mut hasher, &commitment.e);
    transcript_integer(&mut hasher, &commitment.s);
    transcript_integer(&mut hasher, &commitment.f);
    transcript_integer(&mut hasher, &commitment.t);
    let seed: [u8; 32] = hasher.finalize().into();
    let mut rng = HashStreamRng::new(seed, PI_AFF_STREAM_TAG);
    sample_half_pm(&mut rng, &secp256k1_order())
}

fn validate_pi_elog_statement(statement: &PiElogStatement) -> Result<(), PresignProofError> {
    if statement.l == ProjectivePoint::IDENTITY
        || statement.m == ProjectivePoint::IDENTITY
        || statement.x == ProjectivePoint::IDENTITY
        || statement.y == ProjectivePoint::IDENTITY
        || statement.h == ProjectivePoint::IDENTITY
    {
        return Err(PresignProofError::InvalidPiElogStatement);
    }
    Ok(())
}

fn pi_elog_commitment_is_valid(commitment: &PiElogCommitment) -> bool {
    commitment.a != ProjectivePoint::IDENTITY
        && commitment.n != ProjectivePoint::IDENTITY
        && commitment.b != ProjectivePoint::IDENTITY
}

fn pi_elog_challenge(
    execution: ExecutionId,
    prover: ParticipantId,
    kind: PiElogKind,
    statement: &PiElogStatement,
    commitment: &PiElogCommitment,
) -> Result<Scalar, PresignProofError> {
    let mut hasher = Sha256::new();
    hasher.update(PI_ELOG_TAG);
    hasher.update(execution.digest());
    hasher.update(prover.get().to_be_bytes());
    hasher.update([kind.transcript_byte()]);
    transcript_point(&mut hasher, &statement.l)?;
    transcript_point(&mut hasher, &statement.m)?;
    transcript_point(&mut hasher, &statement.x)?;
    transcript_point(&mut hasher, &statement.y)?;
    transcript_point(&mut hasher, &statement.h)?;
    transcript_point(&mut hasher, &commitment.a)?;
    transcript_point(&mut hasher, &commitment.n)?;
    transcript_point(&mut hasher, &commitment.b)?;
    let seed: [u8; 32] = hasher.finalize().into();
    let mut rng = HashStreamRng::new(seed, PI_ELOG_STREAM_TAG);
    Ok(Scalar::generate_vartime(&mut rng))
}

#[cfg(test)]
fn scalar_to_centered_integer(scalar: Scalar) -> Integer {
    let order = secp256k1_order();
    let x = Integer::from_bytes_msf(&scalar.to_bytes());
    let half_order = (order.clone() - 1u8) / 2u8;
    if x <= half_order {
        x
    } else {
        x - order
    }
}

fn integer_to_scalar(value: &Integer) -> Scalar {
    let order = secp256k1_order();
    let magnitude = Integer::from_bytes_msf(&value.to_bytes_msf());
    let reduced = magnitude.modulo(&order);
    let encoded = reduced.to_bytes_msf();
    debug_assert!(encoded.len() <= 32);
    let mut padded = [0u8; 32];
    padded[32 - encoded.len()..].copy_from_slice(&encoded);
    let field_bytes: FieldBytes = padded.into();
    let scalar = <Scalar as Reduce<U256>>::reduce_bytes(&field_bytes);
    if value.cmp0().is_lt() {
        -scalar
    } else {
        scalar
    }
}

fn secp256k1_order() -> Integer {
    Integer::from_bytes_msf(&SECP256K1_ORDER)
}

fn sample_half_pm(rng: &mut impl RngCore, range: &Integer) -> Result<Integer, PresignProofError> {
    if range.cmp0().is_le() {
        return Err(PresignProofError::InvalidWitness);
    }
    let half = range >> 1u32;
    if range.is_even() {
        Ok((range + 1u8).random_below(rng) - half)
    } else {
        Ok(range.random_below_ref(rng) - half)
    }
}

fn is_in_half_pm(value: &Integer, range: &Integer) -> bool {
    value.cmp_abs(&(range >> 1u32)).is_le()
}

fn transcript_integer(hasher: &mut Sha256, value: &Integer) {
    let bytes = value.to_bytes_msf();
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn transcript_point(hasher: &mut Sha256, point: &ProjectivePoint) -> Result<(), PresignProofError> {
    hasher.update(encode_point(point)?);
    Ok(())
}

fn encode_point(point: &ProjectivePoint) -> Result<[u8; 33], PresignProofError> {
    if *point == ProjectivePoint::IDENTITY {
        return Err(PresignProofError::InvalidStatement);
    }
    point
        .to_affine()
        .to_encoded_point(true)
        .as_bytes()
        .try_into()
        .map_err(|_| PresignProofError::InvalidStatement)
}

/// Deterministic SHA-256 stream used only for public Fiat-Shamir challenges.
struct HashStreamRng {
    seed: [u8; 32],
    domain: &'static [u8],
    counter: u64,
    block: [u8; 32],
    offset: usize,
}

impl HashStreamRng {
    fn new(seed: [u8; 32], domain: &'static [u8]) -> Self {
        Self {
            seed,
            domain,
            counter: 0,
            block: [0u8; 32],
            offset: 32,
        }
    }

    fn refill(&mut self) {
        let mut hasher = Sha256::new();
        hasher.update(self.domain);
        hasher.update(self.seed);
        hasher.update(self.counter.to_be_bytes());
        self.block = hasher.finalize().into();
        self.offset = 0;
        assert_ne!(self.counter, u64::MAX, "Fiat-Shamir stream exhausted");
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
    use rand_core::OsRng;

    use super::*;

    const TEST_SECURITY: PiEncElgSecurity = PiEncElgSecurity { l: 8, epsilon: 512 };
    const TEST_AFF_SECURITY: PiAffSecurity = PiAffSecurity {
        l_x: 8,
        l_y: 8,
        epsilon: 512,
    };

    fn test_params() -> RingPedersenParams {
        RingPedersenParams {
            modulus: Integer::from(83u16) * Integer::from(107u16),
            s: Integer::from(4u8),
            t: Integer::from(9u8),
        }
    }

    fn test_key() -> EncryptionKey {
        // Large enough that a curve-order Fiat-Shamir challenge and the test
        // response fit the Paillier signed plaintext domain. No secret
        // factorization is needed by this proof-core test.
        EncryptionKey::from_n((Integer::from(1u8) << 607usize) - 1u8)
    }

    fn honest_fixture() -> (
        ExecutionId,
        ParticipantId,
        ParticipantId,
        RingPedersenParams,
        EncryptionKey,
        PiEncElgStatement,
        Integer,
        Integer,
        Scalar,
    ) {
        let execution = ExecutionId::new(b"pi-enc-elg-test").unwrap();
        let prover = ParticipantId::new(1).unwrap();
        let verifier = ParticipantId::new(2).unwrap();
        let params = test_params();
        let key = test_key();
        let plaintext = Integer::from(7u8);
        let nonce = Integer::sample_in_mult_group_of(&mut OsRng, key.n());
        let b = Scalar::from(5u64);
        let a_scalar = Scalar::from(13u64);
        let a = ProjectivePoint::GENERATOR * a_scalar;
        let statement = PiEncElgStatement {
            ciphertext: key.encrypt_with(&plaintext, &nonce).unwrap(),
            a,
            b: ProjectivePoint::GENERATOR * b,
            x: a * b + ProjectivePoint::GENERATOR * integer_to_scalar(&plaintext),
        };
        (
            execution, prover, verifier, params, key, statement, plaintext, nonce, b,
        )
    }

    fn honest_elog_fixture(
        h: ProjectivePoint,
    ) -> (ExecutionId, ParticipantId, PiElogStatement, Scalar, Scalar) {
        let execution = ExecutionId::new(b"pi-elog-test").unwrap();
        let prover = ParticipantId::new(1).unwrap();
        let y = Scalar::from(11u64);
        let lambda = Scalar::from(17u64);
        let x = ProjectivePoint::GENERATOR * Scalar::from(19u64);
        let statement = PiElogStatement {
            l: ProjectivePoint::GENERATOR * lambda,
            m: ProjectivePoint::GENERATOR * y + x * lambda,
            x,
            y: h * y,
            h,
        };
        (execution, prover, statement, y, lambda)
    }

    struct AffFixture {
        execution: ExecutionId,
        prover: ParticipantId,
        verifier: ParticipantId,
        params: RingPedersenParams,
        key_j: EncryptionKey,
        key_i: EncryptionKey,
        statement: PiAffStatement,
        x: Integer,
        y: Integer,
        nonce: Integer,
        nonce_y: Integer,
    }

    fn honest_aff_fixture() -> AffFixture {
        let execution = ExecutionId::new(b"pi-aff-test").unwrap();
        let prover = ParticipantId::new(1).unwrap();
        let verifier = ParticipantId::new(2).unwrap();
        let params = test_params();
        let key_j = test_key();
        let key_i = test_key();
        let x = Integer::from(7u8);
        let y = -Integer::from(9u8);
        let mut rng = OsRng;
        let c_nonce = Integer::sample_in_mult_group_of(&mut rng, key_j.n());
        let c = key_j.encrypt_with(&Integer::from(3u8), &c_nonce).unwrap();
        let nonce = Integer::sample_in_mult_group_of(&mut rng, key_j.n());
        let nonce_y = Integer::sample_in_mult_group_of(&mut rng, key_i.n());
        let x_at_c = key_j.omul(&x, &c).unwrap();
        let y_under_j = key_j.encrypt_with(&y, &nonce).unwrap();
        let d = key_j.oadd(&x_at_c, &y_under_j).unwrap();
        let y_ciphertext = key_i.encrypt_with(&y, &nonce_y).unwrap();
        let statement = PiAffStatement {
            c,
            d,
            y: y_ciphertext,
            x: ProjectivePoint::GENERATOR * integer_to_scalar(&x),
        };
        AffFixture {
            execution,
            prover,
            verifier,
            params,
            key_j,
            key_i,
            statement,
            x,
            y,
            nonce,
            nonce_y,
        }
    }

    #[test]
    fn pi_enc_elg_accepts_honest_relation_and_binds_verifier() {
        let (execution, prover, verifier, params, key, statement, plaintext, nonce, b) =
            honest_fixture();
        let mut rng = OsRng;
        let proof = prove_pi_enc_elg_inner(
            execution,
            prover,
            verifier,
            PiEncElgKind::EphemeralKey,
            &params,
            &key,
            &statement,
            &plaintext,
            &nonce,
            b,
            &mut rng,
            TEST_SECURITY,
            1,
        )
        .unwrap();
        verify_pi_enc_elg_inner(
            execution,
            prover,
            verifier,
            PiEncElgKind::EphemeralKey,
            &params,
            &key,
            &statement,
            &proof,
            TEST_SECURITY,
            1,
        )
        .unwrap();

        let other_verifier = ParticipantId::new(3).unwrap();
        assert_eq!(
            verify_pi_enc_elg_inner(
                execution,
                prover,
                other_verifier,
                PiEncElgKind::EphemeralKey,
                &params,
                &key,
                &statement,
                &proof,
                TEST_SECURITY,
                1,
            ),
            Err(PresignProofError::InvalidPiEncElg)
        );
    }

    #[test]
    fn pi_enc_elg_rejects_tampered_curve_relation() {
        let (execution, prover, verifier, params, key, mut statement, plaintext, nonce, b) =
            honest_fixture();
        let mut rng = OsRng;
        let proof = prove_pi_enc_elg_inner(
            execution,
            prover,
            verifier,
            PiEncElgKind::Gamma,
            &params,
            &key,
            &statement,
            &plaintext,
            &nonce,
            b,
            &mut rng,
            TEST_SECURITY,
            1,
        )
        .unwrap();
        statement.x += ProjectivePoint::GENERATOR;
        assert_eq!(
            verify_pi_enc_elg_inner(
                execution,
                prover,
                verifier,
                PiEncElgKind::Gamma,
                &params,
                &key,
                &statement,
                &proof,
                TEST_SECURITY,
                1,
            ),
            Err(PresignProofError::InvalidPiEncElg)
        );
    }

    #[test]
    fn pi_enc_elg_rejects_tampered_response_and_bad_ciphertext_domain() {
        let (execution, prover, verifier, params, key, statement, plaintext, nonce, b) =
            honest_fixture();
        let mut rng = OsRng;
        let mut proof = prove_pi_enc_elg_inner(
            execution,
            prover,
            verifier,
            PiEncElgKind::EphemeralKey,
            &params,
            &key,
            &statement,
            &plaintext,
            &nonce,
            b,
            &mut rng,
            TEST_SECURITY,
            1,
        )
        .unwrap();
        proof.z1 += Integer::from(1u8);
        assert_eq!(
            verify_pi_enc_elg_inner(
                execution,
                prover,
                verifier,
                PiEncElgKind::EphemeralKey,
                &params,
                &key,
                &statement,
                &proof,
                TEST_SECURITY,
                1,
            ),
            Err(PresignProofError::InvalidPiEncElg)
        );

        let mut invalid_statement = statement;
        invalid_statement.ciphertext = Integer::from(0u8);
        assert_eq!(
            verify_pi_enc_elg_inner(
                execution,
                prover,
                verifier,
                PiEncElgKind::EphemeralKey,
                &params,
                &key,
                &invalid_statement,
                &proof,
                TEST_SECURITY,
                1,
            ),
            Err(PresignProofError::InvalidStatement)
        );
    }

    #[test]
    fn pi_elog_accepts_honest_gamma_relation_and_binds_kind() {
        let (execution, prover, statement, y, lambda) =
            honest_elog_fixture(ProjectivePoint::GENERATOR);
        let mut rng = OsRng;
        let proof = prove_pi_elog(
            execution,
            prover,
            PiElogKind::GammaShare,
            &statement,
            y,
            lambda,
            &mut rng,
        )
        .unwrap();
        verify_pi_elog(
            execution,
            prover,
            PiElogKind::GammaShare,
            &statement,
            &proof,
        )
        .unwrap();
        assert_eq!(
            verify_pi_elog(
                execution,
                prover,
                PiElogKind::PresignatureConsistency,
                &statement,
                &proof,
            ),
            Err(PresignProofError::InvalidPiElog)
        );
        let other_prover = ParticipantId::new(2).unwrap();
        assert_eq!(
            verify_pi_elog(
                execution,
                other_prover,
                PiElogKind::GammaShare,
                &statement,
                &proof,
            ),
            Err(PresignProofError::InvalidPiElog)
        );
    }

    #[test]
    fn pi_elog_accepts_presignature_base_and_rejects_wrong_witness() {
        let h = ProjectivePoint::GENERATOR * Scalar::from(23u64);
        let (execution, prover, statement, y, lambda) = honest_elog_fixture(h);
        let mut rng = OsRng;
        let proof = prove_pi_elog(
            execution,
            prover,
            PiElogKind::PresignatureConsistency,
            &statement,
            y,
            lambda,
            &mut rng,
        )
        .unwrap();
        verify_pi_elog(
            execution,
            prover,
            PiElogKind::PresignatureConsistency,
            &statement,
            &proof,
        )
        .unwrap();
        assert_eq!(
            prove_pi_elog(
                execution,
                prover,
                PiElogKind::PresignatureConsistency,
                &statement,
                y + Scalar::ONE,
                lambda,
                &mut rng,
            )
            .unwrap_err(),
            PresignProofError::InvalidPiElogWitness
        );
    }

    #[test]
    fn pi_elog_rejects_tampered_response_and_invalid_curve_domain() {
        let (execution, prover, statement, y, lambda) =
            honest_elog_fixture(ProjectivePoint::GENERATOR);
        let mut rng = OsRng;
        let mut proof = prove_pi_elog(
            execution,
            prover,
            PiElogKind::GammaShare,
            &statement,
            y,
            lambda,
            &mut rng,
        )
        .unwrap();
        proof.z += Scalar::ONE;
        assert_eq!(
            verify_pi_elog(
                execution,
                prover,
                PiElogKind::GammaShare,
                &statement,
                &proof,
            ),
            Err(PresignProofError::InvalidPiElog)
        );

        let mut invalid_statement = statement;
        invalid_statement.h = ProjectivePoint::IDENTITY;
        assert_eq!(
            verify_pi_elog(
                execution,
                prover,
                PiElogKind::GammaShare,
                &invalid_statement,
                &proof,
            ),
            Err(PresignProofError::InvalidPiElogStatement)
        );
    }

    #[test]
    fn pi_aff_accepts_honest_mta_relation_and_binds_verifier() {
        let fixture = honest_aff_fixture();
        let mut rng = OsRng;
        let proof = prove_pi_aff_inner(
            fixture.execution,
            fixture.prover,
            fixture.verifier,
            PiAffKind::GammaShare,
            &fixture.params,
            &fixture.key_j,
            &fixture.key_i,
            &fixture.statement,
            &fixture.x,
            &fixture.y,
            &fixture.nonce,
            &fixture.nonce_y,
            &mut rng,
            TEST_AFF_SECURITY,
            1,
        )
        .unwrap();
        verify_pi_aff_inner(
            fixture.execution,
            fixture.prover,
            fixture.verifier,
            PiAffKind::GammaShare,
            &fixture.params,
            &fixture.key_j,
            &fixture.key_i,
            &fixture.statement,
            &proof,
            TEST_AFF_SECURITY,
            1,
        )
        .unwrap();

        let other_verifier = ParticipantId::new(3).unwrap();
        assert_eq!(
            verify_pi_aff_inner(
                fixture.execution,
                fixture.prover,
                other_verifier,
                PiAffKind::GammaShare,
                &fixture.params,
                &fixture.key_j,
                &fixture.key_i,
                &fixture.statement,
                &proof,
                TEST_AFF_SECURITY,
                1,
            ),
            Err(PresignProofError::InvalidPiAff)
        );
        assert_eq!(
            verify_pi_aff_inner(
                fixture.execution,
                fixture.prover,
                fixture.verifier,
                PiAffKind::SigningShare,
                &fixture.params,
                &fixture.key_j,
                &fixture.key_i,
                &fixture.statement,
                &proof,
                TEST_AFF_SECURITY,
                1,
            ),
            Err(PresignProofError::InvalidPiAff)
        );
    }

    #[test]
    fn pi_aff_rejects_tampered_response_and_ciphertext_domain() {
        let fixture = honest_aff_fixture();
        let mut rng = OsRng;
        let mut proof = prove_pi_aff_inner(
            fixture.execution,
            fixture.prover,
            fixture.verifier,
            PiAffKind::SigningShare,
            &fixture.params,
            &fixture.key_j,
            &fixture.key_i,
            &fixture.statement,
            &fixture.x,
            &fixture.y,
            &fixture.nonce,
            &fixture.nonce_y,
            &mut rng,
            TEST_AFF_SECURITY,
            1,
        )
        .unwrap();
        proof.z2 += Integer::from(1u8);
        assert_eq!(
            verify_pi_aff_inner(
                fixture.execution,
                fixture.prover,
                fixture.verifier,
                PiAffKind::SigningShare,
                &fixture.params,
                &fixture.key_j,
                &fixture.key_i,
                &fixture.statement,
                &proof,
                TEST_AFF_SECURITY,
                1,
            ),
            Err(PresignProofError::InvalidPiAff)
        );

        let mut invalid_statement = fixture.statement;
        invalid_statement.d = Integer::from(0u8);
        assert_eq!(
            verify_pi_aff_inner(
                fixture.execution,
                fixture.prover,
                fixture.verifier,
                PiAffKind::SigningShare,
                &fixture.params,
                &fixture.key_j,
                &fixture.key_i,
                &invalid_statement,
                &proof,
                TEST_AFF_SECURITY,
                1,
            ),
            Err(PresignProofError::InvalidPiAffStatement)
        );
    }

    #[test]
    fn pi_aff_rejects_wrong_witness_and_production_rejects_test_moduli() {
        let fixture = honest_aff_fixture();
        let mut rng = OsRng;
        let mut wrong_y = fixture.y.clone();
        wrong_y += Integer::from(1u8);
        assert_eq!(
            prove_pi_aff_inner(
                fixture.execution,
                fixture.prover,
                fixture.verifier,
                PiAffKind::GammaShare,
                &fixture.params,
                &fixture.key_j,
                &fixture.key_i,
                &fixture.statement,
                &fixture.x,
                &wrong_y,
                &fixture.nonce,
                &fixture.nonce_y,
                &mut rng,
                TEST_AFF_SECURITY,
                1,
            )
            .unwrap_err(),
            PresignProofError::InvalidPiAffWitness
        );

        let proof = prove_pi_aff_inner(
            fixture.execution,
            fixture.prover,
            fixture.verifier,
            PiAffKind::GammaShare,
            &fixture.params,
            &fixture.key_j,
            &fixture.key_i,
            &fixture.statement,
            &fixture.x,
            &fixture.y,
            &fixture.nonce,
            &fixture.nonce_y,
            &mut rng,
            TEST_AFF_SECURITY,
            1,
        )
        .unwrap();
        assert_eq!(
            verify_pi_aff(
                fixture.execution,
                fixture.prover,
                fixture.verifier,
                PiAffKind::GammaShare,
                &fixture.params,
                &fixture.key_j,
                &fixture.key_i,
                &fixture.statement,
                &proof,
            ),
            Err(PresignProofError::ModulusTooSmall)
        );
        assert_eq!(PI_AFF_X_BITS, 256);
        assert_eq!(PI_AFF_Y_BITS, 1280);
        assert_eq!(PI_AFF_EPSILON_BITS, 512);
    }

    #[test]
    fn production_pi_enc_elg_rejects_test_sized_moduli() {
        let (execution, prover, verifier, params, key, statement, plaintext, nonce, b) =
            honest_fixture();
        let mut rng = OsRng;
        let proof = prove_pi_enc_elg_inner(
            execution,
            prover,
            verifier,
            PiEncElgKind::EphemeralKey,
            &params,
            &key,
            &statement,
            &plaintext,
            &nonce,
            b,
            &mut rng,
            TEST_SECURITY,
            1,
        )
        .unwrap();
        assert_eq!(
            verify_pi_enc_elg_inner(
                execution,
                prover,
                verifier,
                PiEncElgKind::EphemeralKey,
                &params,
                &key,
                &statement,
                &proof,
                PiEncElgSecurity::PRODUCTION,
                crate::cggmp_aux::RSA_PUBLIC_MIN_BITS,
            ),
            Err(PresignProofError::ModulusTooSmall)
        );
        assert_eq!(PI_ENC_ELG_L_BITS, 256);
        assert_eq!(PI_ENC_ELG_EPSILON_BITS, 512);
        assert_eq!(scalar_to_centered_integer(Scalar::ZERO), Integer::from(0u8));
    }
}

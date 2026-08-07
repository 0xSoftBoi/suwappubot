//! Malicious-presigning proof foundations for secp256k1 CGGMP24.
//!
//! This module starts with the round-one `Pi_enc-elg` proof used for both the
//! ephemeral inverse-key share and `gamma` share. It deliberately does not
//! expose a presignature constructor: later `Pi_aff`, `Pi_elog`, MtA, reliable
//! broadcast, and final consistency checks must all land first.

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

const PI_ENC_ELG_TAG: &[u8] = b"suwappu/cggmp24/pi-enc-elg/challenge/v1";
const PI_ENC_ELG_STREAM_TAG: &[u8] = b"suwappu/cggmp24/pi-enc-elg/hash-stream/v1";
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
    #[error("Paillier operation failed while constructing PiEncElg")]
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

#[derive(Clone, Copy)]
struct PiEncElgSecurity {
    l: usize,
    epsilon: usize,
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
    let mut rng = HashStreamRng::new(seed);
    sample_half_pm(&mut rng, &secp256k1_order())
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
        hasher.update(PI_ENC_ELG_STREAM_TAG);
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

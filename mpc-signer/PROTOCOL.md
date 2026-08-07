# Native MPC protocol ledger

This file records exactly which external constructions each hand-written state
machine follows. A passing test is not a security proof, and none of the code
below is authorized for user funds while `PRODUCTION_READY` is `false`.

## Ed25519

Signing follows RFC 9591 `FROST(Ed25519, SHA-512)` and is checked against its
Appendix E.1 vector. RFC 9591 intentionally leaves distributed key generation
out of scope, so the older `dkg.rs` joint-Feldman milestone is not claimed to be
a complete malicious DKG.

The standalone DKG construction selected for that next hardening step is C2SP
COCKTAIL-DKG v0.2.1 / ChillDKG lineage. In particular, production Ed25519 DKG
must add authenticated+encrypted share transport and final transcript
certification; the existing custom DKG must not be relabeled production-safe.

- RFC 9591: https://www.rfc-editor.org/rfc/rfc9591.html
- COCKTAIL-DKG v0.2.1: https://c2sp.org/cocktail-dkg
- Olaf/SimplPedPop security analysis: https://eprint.iacr.org/2023/899

## secp256k1 / ECDSA

The ECDSA construction is pinned to the CGGMP family, using the current
self-contained CGGMP24 implementation specification as the executable protocol
description:

- CGGMP paper, latest revision 2024-10-21: https://eprint.iacr.org/2021/060
- Self-contained implementation spec: https://lfdt-lockness.github.io/cggmp21/cggmp24-spec.pdf
- Audited reference implementation (read-only reference, never a protocol
  dependency): https://github.com/LFDT-Lockness/cggmp21

`secp256k1_dkg.rs` implements the spec's section 4.2.2 threshold DKG state
boundaries for our fixed 2-of-3 profile. The implementation uses a fixed,
domain-separated Suwappu byte encoding, so it is not claiming wire
interoperability with the reference library. `ecdsa_cggmp.rs` implements the
section 4.3.2 Shamir-to-additive conversion and section 4.4 final signature
equations.

Important: sections 4.2.2 and 4.3.2 are an arbitrary-threshold extension made
by the reference implementation; the CGGMP24 paper itself describes n-of-n.
Our 2-of-3 use therefore requires dedicated cryptographic review even if the
reference implementation has been audited.

### Hard gate before presigning can exist

The following pieces are intentionally missing. `PresignatureShare` has no
public constructor until all of them are implemented and tested:

1. 3072-bit Paillier key generation for a 128-bit target and signed-message
   encryption/decryption/homomorphic operations.
2. Ring-Pedersen auxiliary parameters.
3. Provisioning proofs from section 4.1: `Pi_prm`, `Pi_mod`, and `Pi_fac`, with
   domain validation before arithmetic.
4. Presigning proofs/equations from section 4.3: Paillier encryption-in-range,
   Paillier affine-with-group-commitment, encryption/ElGamal relations, and the
   elliptic-curve discrete-log relations used by the protocol.
5. Authenticated broadcasts, encrypted point-to-point messages, durable unique
   execution IDs, timeout/abort behavior, and persisted one-shot presignatures.
6. Adversarial vectors, differential final-signature tests, side-channel
   review, and an independent cryptographic audit.

No shortcut around these gates is acceptable: a Paillier MtA exchange without
the specified range/relationship proofs is not malicious-secure threshold
ECDSA.

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
equations. `cggmp_aux.rs` now implements the first section 4.1 provisioning
slice: Paillier/Ring-Pedersen candidate generation and `Pi_prm`.

The 128-bit auxiliary profile is pinned to 1536-bit safe-prime factors,
public RSA moduli of at least 3071 bits, and `m = 128` `Pi_prm` repetitions,
matching the current reference implementation's `SecurityLevel128`. Paillier
arithmetic comes from pinned `fast-paillier` 0.3.2; it is a primitive
dependency, not an MPC/protocol dependency. Our Fiat-Shamir transcript uses a
fixed Suwappu domain and length-delimited integer encoding, so it does not
claim wire interoperability with the reference implementation.

Important: sections 4.2.2 and 4.3.2 are an arbitrary-threshold extension made
by the reference implementation; the CGGMP24 paper itself describes n-of-n.
Our 2-of-3 use therefore requires dedicated cryptographic review even if the
reference implementation has been audited.

### Remaining hard gate before presigning can exist

`PresignatureShare` still has no public constructor. The following pieces are
intentionally missing or incomplete, and all must be implemented and tested:

1. Finish section 4.1 provisioning with `Pi_mod` and `Pi_fac`, including the
   reliable commit/echo/reveal state machine. `Pi_prm` and its pre-arithmetic
   domain checks are present; they are not sufficient by themselves.
2. Presigning proofs/equations from section 4.3: Paillier encryption-in-range,
   Paillier affine-with-group-commitment, encryption/ElGamal relations, and the
   elliptic-curve discrete-log relations used by the protocol.
3. Authenticated broadcasts, encrypted point-to-point messages, durable unique
   execution IDs, timeout/abort behavior, and persisted one-shot presignatures.
4. Full-size auxiliary-generation performance/soak vectors plus bigint
   side-channel and memory-erasure hardening. The current bigint backend does
   not justify a zeroizing-deallocation claim for Paillier secret factors.
5. Adversarial vectors, differential final-signature tests, and an independent
   cryptographic audit.

No shortcut around these gates is acceptable: a Paillier MtA exchange without
the specified range/relationship proofs is not malicious-secure threshold
ECDSA.

# Suwappu native MPC signer (experimental)

This is the isolated protocol core for replacing Turnkey. It is intentionally
not wired into production wallet creation or transaction broadcast yet.

Current milestone:

- 2-of-3 joint Feldman DKG for Ed25519. Each of the three nodes contributes a
  fresh degree-one polynomial; no node constructs the aggregate signing key.
- Schnorr proof of knowledge for every DKG constant coefficient and Feldman
  verification for every participant-to-participant secret share.
- FROST(Ed25519, SHA-512) implemented directly from RFC 9591: round-one nonce
  commitments, binding factors, Lagrange interpolation, round-two shares,
  per-share verification, aggregation, and the mandated cofactored check.
- The RFC 9591 Appendix E.1 vector is checked byte-for-byte, and final output is
  independently verified as a normal Ed25519 signature.
- Crash-safe execution tombstones are fsynced before nonce generation. An
  execution ID is never reusable, even after success or a crash.
- A separate 2-of-3 secp256k1 DKG state machine now follows the threshold DKG
  construction in the CGGMP24 implementation specification: commit-before-
  reveal, reliable-echo agreement, private Feldman-verified Shamir shares, and
  a final Schnorr proof of knowledge of every resulting share.
- Any selected secp256k1 signing pair is converted from Shamir shares to the
  additive shares used by CGGMP using Lagrange coefficients. The final CGGMP
  partial-signature equations are implemented with per-partial verification,
  low-s normalization, ordinary ECDSA verification, and recovery-ID derivation.
- There is deliberately no public constructor for a CGGMP presignature yet.
  Threshold ECDSA cannot run until the malicious auxiliary/presigning proof
  layer produces that state after all required checks.
- The first auxiliary-provisioning slice now generates the CGGMP24 128-bit
  Paillier profile (1536-bit safe-prime factors, public modulus >=3071 bits),
  constructs separate Ring-Pedersen parameters, and implements the 128-fold
  Fiat-Shamir `Pi_prm` relation proof. The resulting type is explicitly a
  `CandidateAuxPublic`: it cannot be promoted into presigning state while
  `Pi_mod` and `Pi_fac` are absent.

`PRODUCTION_READY`, `MALICIOUS_DKG_READY`, and `MALICIOUS_ECDSA_READY` are all
hard-coded `false`. The DKG still needs a formally pinned malicious complaint /
disqualification protocol for the Ed25519 path. The secp256k1 ECDSA path still
needs the remaining CGGMP auxiliary proofs and malicious presigning proofs. Do
not activate this signer for user funds.

Primitive dependencies are deliberately narrow: `curve25519-dalek` for group
arithmetic, `sha2` for SHA-512, `rand_core` for OS entropy, `zeroize` for secret
state cleanup, `ed25519-dalek` only as an independent Ed25519 compatibility
verifier, `k256` for secp256k1 arithmetic plus independent final ECDSA
verification, and pinned `fast-paillier` as a low-level Paillier/big-integer
primitive. There is no FROST, MPC, or threshold-signature protocol dependency.

See `PROTOCOL.md` for the pinned constructions, trust assumptions, and the
proof gates that remain before this can ever become production-capable.

Run the protocol gates with:

```bash
cargo fmt --all -- --check
cargo test --all-targets
cargo clippy --all-targets -- -D warnings
```

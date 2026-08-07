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
  additive shares used by CGGMP using Lagrange coefficients. Auxiliary
  provisioning includes `Pi_prm`, `Pi_mod`, peer-specific `Pi_fac`, and the
  reliable commit/echo/reveal/proof promotion into `VerifiedAuxSet`.
- Malicious presigning implements `Pi_enc-elg`, `Pi_elog`, `Pi_aff`, reliable
  round-one agreement, verifier-specific MtA, proof-before-decrypt ordering,
  round-three consistency proofs, and the final `G*delta = Delta` /
  `PK*delta = S` checks. Only that final transition releases a consumed-on-use
  `PresignatureShare`.
- Presignatures cannot accept raw attacker-selected hashes. The public signing
  API hashes a supplied message/signing payload into `KnownMessageDigest` with
  SHA-256 or legacy Keccak-256, then performs per-partial verification, low-s
  normalization, ordinary ECDSA verification, and recovery-ID derivation.
- The auxiliary profile remains the CGGMP24 128-bit profile: 1536-bit
  safe-prime factors, public moduli >=3071 bits, 128-fold Fiat-Shamir proof
  repetitions, and a collective 32-byte `rho` seed.

`PRODUCTION_READY`, `MALICIOUS_DKG_READY`, and `MALICIOUS_ECDSA_READY` are all
hard-coded `false`. The Ed25519 path still needs its malicious DKG hardening.
The secp256k1 ECDSA protocol core is complete through presigning, but production
serialization/authenticated+encrypted transport, durable deployment wiring,
full-size soak/side-channel hardening, and independent cryptographic review
remain mandatory. Do not activate this signer for user funds.

Primitive dependencies are deliberately narrow: `curve25519-dalek` for group
arithmetic, `sha2`/`sha3` for hashing, `rand_core` for OS entropy, `zeroize` for secret
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

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

`PRODUCTION_READY`, `MALICIOUS_DKG_READY`, and `MALICIOUS_ECDSA_READY` are all
hard-coded `false`. The DKG still needs a formally pinned malicious complaint /
disqualification protocol, and threshold ECDSA has not landed. Do not activate
this signer for user funds.

Primitive dependencies are deliberately narrow: `curve25519-dalek` for group
arithmetic, `sha2` for SHA-512, `rand_core` for OS entropy, `zeroize` for secret
state cleanup, and `ed25519-dalek` only as an independent compatibility verifier.
There is no FROST or threshold-signature protocol dependency.

Run the protocol gates with:

```bash
cargo fmt --all -- --check
cargo test --all-targets
cargo clippy --all-targets -- -D warnings
```

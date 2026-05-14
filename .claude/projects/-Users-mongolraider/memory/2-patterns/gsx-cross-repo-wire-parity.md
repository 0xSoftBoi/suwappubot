---
name: gsx-cross-repo-wire-parity
description: "Where the wire-compatible mirror lives between gsx-lattice-protocol (Python LTP), gsx-dag (Rust DAG L1), and gsx-db (Rust state substrate), and what byte-level invariants tie them together."
metadata: 
  node_type: memory
  type: project
  originSessionId: a09ed7bf-9b31-46a8-b187-f0000133d1a4
---

The GSX stack splits across three repos that must agree byte-for-byte on
several surfaces. The Python mirror of those surfaces lives under
`gsx-lattice-protocol/src/ltp/corridor/`. Anything that publishes new bytes
on the wire between these repos must update both sides at once.

| Surface | Rust source | Python mirror |
|---|---|---|
| Corridor 7-of-9 attestation | `gsx-dag/crates/gsx-ltp/src/attestation.rs` | `src/ltp/corridor/attestation.py` |
| Commitment-Node DA SLA | `gsx-dag/crates/gsx-ltp/src/da.rs` | `src/ltp/corridor/da.py` |
| DID rotation STARK statement | `gsx-dag/crates/gsx-ltp/src/did_stark.rs` | `src/ltp/corridor/did_stark.py` |
| Length-prefixed SHA3-256 domain hash | `gsx-dag/crates/gsx-crypto/src/hash.rs::sha3_256_domain` | `src/ltp/corridor/digest.py` |
| Per-chain state anchor (Rust) | `gsx-db/crates/gsxdb-bridge/src/anchor/types.rs` | `src/ltp/corridor/state_anchor.py::*_blake3` |
| Per-chain state anchor (Solidity) | `gsx-db/contracts/src/LTPAnchorRegistry.sol` | `src/ltp/corridor/state_anchor.py::*_keccak256` |

**Why:** the LTP corridor witness, gsx-dag attestation pipeline, and gsx-db
anchor registry all sign/verify the same digests. A divergence in the byte
layout silently breaks 7-of-9 attestation; signatures still validate
locally but cross-repo verification returns false with no error.

**How to apply:**

1. Pinned invariants — *do not change without updating both sides plus the
   corridor parity tests*:
   - `ON_CHAIN_COMMITMENT_BYTES = 1_600` (paper §10.2).
   - `LTP_ATTESTATION_QUORUM_THRESHOLD = 7`, `LTP_ATTESTATION_QUORUM_SIZE = 9`.
   - Domain tags: `b"GSX-LTP-ATTEST-V1"`, `b"GSX-LTP-CID-V1"`, `b"GSX-DID-STARK-V1"`.
   - BLS corridor DST: `b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_"` — *not* `_POP_`.

2. Two `LTPAnchorRegistry` contracts exist with the same name but distinct
   schemas. Always disambiguate:
   - `gsx-lattice-protocol/contracts/src/LTPAnchorRegistry.sol` — per-entity
     commitment anchor (`anchorDigest`, `entityIdHash`, `merkleRoot`, ...).
   - `gsx-db/contracts/src/LTPAnchorRegistry.sol` — per-chain state-root
     anchor (`chainId`, `height`, `stateRoot`, `parent`, `mac`).

3. Gotchas burned in once:
   - LTP's general-purpose `BLS` class (`src/ltp/bls.py`) uses py_ecc's
     `G2ProofOfPossession` DST — incompatible with the corridor wire. The
     corridor shim in `src/ltp/corridor/bls.py` uses the `_NUL_` DST.
     See [[bls-dst-mismatch-cross-language-interop]].
   - LTP's `domain_hash_bytes(tag, data)` concatenates without a length
     prefix; gsx-crypto's `sha3_256_domain` does
     `H(len(tag) u32-BE || tag || data)`. The corridor `digest.py` mirrors
     the length-prefixed form; do not use `domain_hash_bytes` on the
     corridor surface.
   - gsx-db's MAC is BLAKE3-keyed in Rust but `keccak256` in Solidity as a
     phase-1 placeholder. Rust `hash()` folds in `auth_scheme`; Solidity
     `hashAnchor()` does not. Reconciliation is gsx-db sprint S11.

4. Golden vectors are pinned in
   `gsx-lattice-protocol/tests/corridor/test_digest_parity.py` and
   `test_state_anchor_parity.py`. Regenerate from Rust if the byte layout
   changes intentionally; never edit the hex without also editing the Rust
   source.

5. Cross-repo invariants live in:
   - `gsx-dag/CLAUDE.md` — "Constant-size LTP commitment (Paper §10.2)" and
     "PQ-conservative crypto surface".
   - `gsx-db/CLAUDE.md` — "Cross-parity" between Solidity `LTPAnchorRegistry`
     and Rust `gsxdb-anchor`.
   - `gsx-lattice-protocol/docs/design-decisions/GSX_DAG_DB_INTEGRATION.md`
     — the assessment boundary and source-path table.

6. Local-build rule: never run `cargo test --workspace`,
   `cargo build --workspace`, or `cargo clippy --workspace` against
   `~/gsx-build/gsx-dag` or `~/gsx-build/gsx-db` on this Mac — push and let
   CI validate. Per-crate `cargo test -p <crate> --lib` is fine when
   harvesting golden vectors.

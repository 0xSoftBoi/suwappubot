---
name: bls-dst-mismatch-cross-language-interop
description: |
  Fix silent BLS12-381 signature interop failure between Rust (`blst`) and
  Python (`py_ecc` / Python `blst` bindings) caused by mismatched hash-to-curve
  domain separation tags. Use when: (1) Python BLS signatures fail to verify
  under a Rust verifier (or vice versa) with no error — both sides produce
  valid 96-byte signatures that simply never cross-validate;
  (2) you're porting BLS sign/verify across languages and the spec says
  "BLS12-381 G2 signatures" without naming the ciphersuite;
  (3) `blst.P2.hash_to(msg)` is called without an explicit DST argument and
  the Rust side uses `blst::min_pk::SecretKey::sign(msg, BLS_DST, &[])` with
  an explicit `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_`;
  (4) `py_ecc.bls.G2ProofOfPossession` is used to interoperate with a Rust
  crate that uses the "basic" / NUL_ DST. Companion trap: SHA3-256 "domain
  hash" helpers that prepend a tag without length-prefixing it — silently
  diverge from length-prefixed `H(len(tag)||tag||data)` implementations.
author: Claude Code
version: 1.1.0
date: 2026-05-14
paths: ["**/*.rs", "**/*.py"]
---

# BLS12-381 DST Mismatch — Silent Cross-Language Interop Failure

## Problem

You port a BLS12-381 signature surface between Rust and Python. Both sides:

- generate keypairs of the same size (32-byte sk, 48-byte compressed-G1 pk),
- produce signatures of the same size (96-byte compressed-G2),
- compile and run without error,
- pass their own round-trip tests,

…but Python signatures **never** verify under the Rust verifier and Rust
signatures **never** verify under the Python verifier. There's no exception,
no malformed-bytes error, no obvious crash. Verification simply returns
`false` / `BLST_VERIFY_FAIL` for every cross-language signature.

Root cause: BLS12-381 hash-to-curve takes a domain separation tag (DST). The
DST is mixed into the hash that maps the message onto the curve. Two
signers using different DSTs produce signatures over *different curve
points* even when the input bytes are identical. Verification under either
DST against the other is unrecoverable — the hash-to-curve outputs simply
disagree.

The trap is that **both libraries default to *different* DSTs silently**,
and the BLS RFC (RFC 9380, ex–draft-irtf-cfrg-hash-to-curve) defines several
"ciphersuites" that all use the same key sizes and signature sizes but
distinct DSTs.

## Context / Trigger Conditions

Use this skill when:

- A Python `py_ecc.bls` signature does not verify under a Rust `blst`
  verifier (or vice versa), with no error message.
- Python `blst` bindings (`blst.P2().hash_to(msg).sign_with(sk)`) produce
  signatures that don't verify against a Rust verifier even though both use
  the same library family.
- A Rust crate signs via `blst::min_pk::SecretKey::sign(msg, BLS_DST, &[])`
  with an explicit DST constant (commonly
  `b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_"`) and you need to
  reproduce that in Python.
- Spec / paper says "BLS12-381 aggregate signatures, SHA-256 hash-to-curve"
  without naming the ciphersuite — pick `G2Basic` / `_NUL_` for raw
  signatures, `G2MessageAugmentation` / `_AUG_` for aug, or
  `G2ProofOfPossession` / `_POP_` for PoP. Mixing breaks everything.
- You're auditing why two BLS implementations "do the same thing" but
  don't interop.

## Solution

### 1. Find the Rust DST

Search the Rust crate's BLS module:

```sh
grep -rn 'BLS_SIG_BLS12381\|BLS_DST\|hash_to\|sign(.*, .*, .*\.as_bytes\|core_verify' --include='*.rs'
```

`blst::min_pk::SecretKey::sign(msg, DST, aug)` and `Signature::verify(...,
msg, DST, aug, ...)` both take DST as a positional argument. The three
canonical values are:

| Ciphersuite | DST | When used |
|---|---|---|
| basic | `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_` | raw signatures, no proof-of-possession |
| aug | `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_AUG_` | message augmentation (signer's pk prefixed to msg) |
| pop | `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_` | proof-of-possession scheme |

(Trailing underscore is part of the DST — don't strip it.)

### 2. Pick the matching Python ciphersuite

py_ecc:

```python
from py_ecc.bls import G2Basic                # _NUL_
from py_ecc.bls import G2MessageAugmentation  # _AUG_
from py_ecc.bls import G2ProofOfPossession    # _POP_
```

`py_ecc.bls.G2ProofOfPossession` is the default many tutorials reach for
because Ethereum 2.0 uses PoP. If your Rust counterpart uses `_NUL_`, this
will silently break interop.

Python `blst` bindings: `hash_to` and `core_verify` accept DST as a
positional argument. The default when omitted is *empty bytes*, **not** the
ciphersuite DST. Always pass it explicitly:

```python
sig = blst.P2()
sig.hash_to(msg, RUST_DST).sign_with(sk_obj)
sig.compress()

# verify
p2 = blst.P2_Affine(sig_bytes)
p1 = blst.P1_Affine(pk_bytes)
ok = p2.core_verify(p1, True, msg, RUST_DST) == blst.BLST_SUCCESS
```

### 3. Don't reuse a "general-purpose" Python BLS class with the wrong DST

If your Python codebase already has a `BLS` class signing under
`G2ProofOfPossession` for a different surface (e.g., consensus PoP), do
**not** reuse it for cross-language interop. Add a narrow corridor shim:

```python
# corridor_bls.py
import blst as _blst
from py_ecc.bls import G2Basic as _basic  # fallback when blst not installed

BLS_CORRIDOR_DST = b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_"

def corridor_sign(sk: bytes, digest: bytes) -> bytes:
    if _blst_available:
        sk_obj = _blst.SecretKey.from_bytes(sk)
        sig = _blst.P2()
        sig.hash_to(digest, BLS_CORRIDOR_DST).sign_with(sk_obj)
        return sig.compress()
    sk_int = int.from_bytes(sk, "big")
    return bytes(_basic.Sign(sk_int, digest))

def corridor_verify(pk: bytes, digest: bytes, sig: bytes) -> bool:
    if _blst_available:
        p1 = _blst.P1_Affine(pk)
        p2 = _blst.P2_Affine(sig)
        return p2.core_verify(p1, True, digest, BLS_CORRIDOR_DST) == _blst.BLST_SUCCESS
    return bool(_basic.Verify(pk, digest, sig))
```

Leave the existing PoP-based `BLS` class untouched so its tests keep passing.

### 4. Related trap — SHA3-256 "domain hash" length prefix

The same diagnosis applies to domain-separated SHA3-256 helpers. Rust crates
often implement:

```rust
H(len(tag) as u32 BE || tag || data)
```

…and Python codebases often implement the looser:

```python
sha3_256(domain + data)
```

These produce different digests for the same `(tag, data)` and create a
second silent-interop trap downstream of BLS signing — the *message* being
signed disagrees byte-by-byte, on top of the DST mismatch.

Mirror the Rust form exactly:

```python
import hashlib

def sha3_256_domain(tag: bytes, data: bytes) -> bytes:
    h = hashlib.sha3_256()
    h.update(len(tag).to_bytes(4, "big"))
    h.update(tag)
    h.update(data)
    return h.digest()
```

## Verification

1. **Golden vector test.** Generate a keypair on the Rust side. Sign a known
   message. Print the (pk, sig) hex. In Python, call `corridor_verify(pk,
   msg, sig)` — it must return `True`. Swap directions: sign in Python,
   verify in Rust.

2. **DST audit.** Grep both codebases for the literal DST string. If the
   Python codebase has zero matches, you are almost certainly using the
   library default — find which one and confirm it matches Rust.

3. **Length-prefix audit.** Compute `sha3_256_domain(b"ab", b"c")` and
   `sha3_256_domain(b"a", b"bc")` on both sides — under a length-prefixed
   implementation they differ; under a raw-concatenation implementation
   they collide.

## Example

Discovered in `gsx-lattice-protocol`'s `src/ltp/corridor/` module while
mirroring `gsx-dag/crates/gsx-ltp` (Rust). The existing
`src/ltp/bls.py::BLS` class signed under
`py_ecc.bls.G2ProofOfPossession` — DST `..._POP_` — but the corridor
attestation surface in `gsx-crypto/src/bls.rs` signs under
`b"BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_"`. A Python corridor witness
producing 7-of-9 attestations would have published valid-looking 96-byte
signatures that the Rust attestation pipeline rejected silently.

Fix lived in `src/ltp/corridor/bls.py` as a narrow shim explicitly keyed to
`BLS_CORRIDOR_DST`, paired with a length-prefixed `sha3_256_domain` mirror
of `gsx-crypto/src/hash.rs`. Cross-language parity verified via
hex-pinned golden digests in `tests/corridor/test_digest_parity.py`.

## Notes

- The same `_NUL_` / `_AUG_` / `_POP_` distinction applies to BLS12-377 and
  BLS24-315. The DST string changes but the trap is identical.
- ETH2.0 / consensus codebases default to `_POP_`. Cosmos / Drand and many
  newer protocol papers default to `_NUL_`. Filecoin uses `_NUL_` for some
  surfaces. There is no "correct" default — you must read the counterpart's
  source, not guess.
- `blst` Python bindings ship with `BLST_SUCCESS == 0`. `core_verify` returns
  an error code, not a bool — `== BLST_SUCCESS` is mandatory.
- The aggregate-verify path (`fast_aggregate_verify`) takes DST too. Don't
  copy the DST into the per-signature `core_verify` and forget the
  aggregate path.
- If you cannot easily change the Rust DST, you can also re-sign the entire
  surface from Python with the Rust DST — the keys are interoperable across
  ciphersuites; only the signing message-to-curve mapping changes.

## References

- [RFC 9380 — Hashing to Elliptic Curves (BLS hash-to-curve)](https://datatracker.ietf.org/doc/rfc9380/)
- [draft-irtf-cfrg-bls-signature — BLS ciphersuites _NUL_ / _AUG_ / _POP_](https://datatracker.ietf.org/doc/draft-irtf-cfrg-bls-signature/)
- [`blst` crate docs — sign/verify DST signature](https://docs.rs/blst/latest/blst/min_pk/struct.SecretKey.html#method.sign)
- [`py_ecc.bls` ciphersuite modules](https://github.com/ethereum/py_ecc/tree/master/py_ecc/bls)

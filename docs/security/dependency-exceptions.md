# Dependency security exceptions

Dependency audit exceptions are last-resort, reviewable controls. Each exception must identify one advisory, document the reachable dependency path, record compensating controls, and expire on a fixed date.

## PYSEC-2026-1325 — `ecdsa==0.19.2`

- Severity: High (CVSS 7.4).
- Dependency path: `starknet-py -> crypto-cpp-py==2.0.0 -> ecdsa==0.19.2`.
- Scope: Python dependency audit only, exact advisory ID `PYSEC-2026-1325`.
- Owner: Suwappu maintainers.
- Accepted: 2026-08-08.
- Review by: 2026-11-06.

### Evidence

The [OSV advisory](https://osv.dev/vulnerability/PYSEC-2026-1325) describes a Minerva timing attack against python-ecdsa's P-256 signing path and states that ECDSA signatures, key generation, and ECDH operations are affected; the project reports no planned fix.

The locked graph installs `crypto-cpp-py==2.0.0`. Inspection of that exact published wheel found one code import from python-ecdsa: `ecdsa.rfc6979.generate_k`. It contains no `SigningKey`, `sign_digest`, or ECDH use. The matching [upstream utility source](https://github.com/software-mansion-labs/crypto-cpp-py/blob/main/crypto_cpp_py/utils.py) uses `generate_k` with Starknet's curve order rather than the affected P-256 signing/key-generation/ECDH APIs.

### Compensating controls

- CI ignores only `PYSEC-2026-1325`; every other Python finding remains blocking.
- `ecdsa` remains transitive rather than a direct application dependency.
- Any new direct python-ecdsa use, any use of its signing/key-generation/ECDH APIs, or a change to the `crypto-cpp-py` call path requires immediate re-review.
- Remove this exception as soon as the dependency path drops python-ecdsa, a patched implementation becomes available, or before the review date unless the evidence is renewed.

# Dependency security exceptions

Dependency audit exceptions are last-resort, reviewable controls. Each exception must identify one advisory, document the reachable dependency path, record compensating controls, and expire on a fixed date.

## PYSEC-2026-1325 — `ecdsa==0.19.2`

- Severity: High (CVSS 7.4).
- Dependency path: `starknet-py -> crypto-cpp-py==2.0.0 -> ecdsa==0.19.2`.
- Scope: Python dependency audit only, exact advisory ID `PYSEC-2026-1325`.
- Owner: Suwappu maintainers.
- Accepted: 2026-08-08.
- Review by: 2027-02-20 (renewed 2026-11-20; previous date 2026-11-06 had lapsed).

### Evidence

The [OSV advisory](https://osv.dev/vulnerability/PYSEC-2026-1325) describes a Minerva timing attack against python-ecdsa's P-256 signing path and states that ECDSA signatures, key generation, and ECDH operations are affected; the project reports no planned fix.

The locked graph installs `crypto-cpp-py==2.0.0`. Inspection of that exact published wheel found one code import from python-ecdsa: `ecdsa.rfc6979.generate_k`. It contains no `SigningKey`, `sign_digest`, or ECDH use. The matching [upstream utility source](https://github.com/software-mansion-labs/crypto-cpp-py/blob/main/crypto_cpp_py/utils.py) uses `generate_k` with Starknet's curve order rather than the affected P-256 signing/key-generation/ECDH APIs.

Re-verified 2026-11-20: the lock still pins `crypto-cpp-py==2.0.0` and `ecdsa==0.19.2`; the published `crypto-cpp-py` 2.0.0 wheel still contains exactly one python-ecdsa import (`from ecdsa.rfc6979 import generate_k` in `crypto_cpp_py/utils.py`); 0.19.2 is still the newest python-ecdsa release and the OSV record lists no fixed version, so there is nothing to upgrade to.

### Compensating controls

- CI ignores only `PYSEC-2026-1325`; every other Python finding remains blocking.
- `ecdsa` remains transitive rather than a direct application dependency.
- Any new direct python-ecdsa use, any use of its signing/key-generation/ECDH APIs, or a change to the `crypto-cpp-py` call path requires immediate re-review.
- Remove this exception as soon as the dependency path drops python-ecdsa, a patched implementation becomes available, or before the review date unless the evidence is renewed.

## GHSA-qr28-fpjm-wq7f — `decode-uri-component@0.2.2` (terminal only)

- Severity: High (denial of service: quadratic time on long runs of percent-encoded input).
- Dependency path: `wagmi -> @wagmi/connectors -> @walletconnect/ethereum-provider -> @walletconnect/utils -> query-string@7.1.3 -> decode-uri-component@0.2.2`.
- Scope: `bun audit` in `terminal/` only, exact advisory ID `GHSA-qr28-fpjm-wq7f`. Every other workspace audits without this ignore.
- Owner: Suwappu maintainers.
- Accepted: 2026-11-20.
- Review by: 2027-02-20.

### Evidence

The advisory covers every release up to 0.5.0; the fixed line is ESM-only. `query-string@7.1.3` loads it with `require('decode-uri-component')`, so an override to the fixed release breaks the import at runtime, and `@walletconnect/utils` pins `query-string` 7.x. The only way to drop the path is a wagmi major upgrade (v3), which is a wallet-connection change that needs its own testing and is out of scope for a dependency bump.

The package runs in the visitor's browser only: `terminal/` is a static Vite bundle with no server-side rendering, so there is no shared process to exhaust. The input it parses is WalletConnect pairing/deep-link URIs, so the worst case is a visitor's own tab stalling after they open a crafted link. No keys, funds, or other users are reachable through it.

### Compensating controls

- CI ignores only `GHSA-qr28-fpjm-wq7f`, and only for `terminal/`; all other findings in every workspace stay blocking.
- The package stays transitive; application code must not import `query-string` or `decode-uri-component` directly.
- Remove this exception when wagmi is upgraded past the `query-string@7` path, or when WalletConnect ships a release that drops it — whichever comes first, and no later than the review date unless the evidence is renewed.

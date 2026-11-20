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

## GHSA-mrhx-c7xc-m3w5 — `zod@3.25.76` under `@coinbase/x402` (api-ts only)

- Severity: High (CVSS 4.0 8.2, CWE-770). CVE-2023-54404.
- Dependency path: `api-ts: @coinbase/x402@2.1.0 -> zod ^3.24.2` and `@coinbase/x402 -> @coinbase/cdp-sdk@1.57.0 -> zod ^3.25.76`. Both dependents declare zod 3; the advisory lists no patched 3.x release (patched: 4.6.6+).
- Scope: Bun dependency audit of `api-ts` only, exact advisory ID `GHSA-mrhx-c7xc-m3w5`, applied via the per-workspace ignore in `.github/workflows/test.yml`. Every other workspace is on zod 4.6.6+ (api-ts's own direct `zod`, `@anthropic-ai/sdk`, `@x402/core`, `@x402/evm`, `abitype` were all moved to 4.6.7 on 2026-11-20).
- Owner: Suwappu maintainers.
- Accepted: 2026-11-20.
- Review by: 2027-02-20.

### Evidence

The advisory describes memory exhaustion when a zod **array schema** validates a **large attacker-supplied array**: every failing element allocates an issue object with no cap.

The vulnerable zod 3 copy is reachable only through two modules, neither of which validates inbound request bodies:

- `@coinbase/x402` itself ships no zod import in its `dist/` (grep of the installed 2.1.0).
- `@coinbase/cdp-sdk` imports zod only in `policies/evmSchema.js`, `policies/solanaSchema.js` and `policies/types.js`: schemas for CDP wallet-policy objects that the SDK consumer constructs in code. Its `./auth` entrypoint, the only subpath our code reaches (`FacilitatorService.ts` calls `createFacilitatorConfig` to mint a per-request CDP JWT), imports no zod.

Inbound x402 payment payloads are validated by `@x402/core` / `@x402/evm` 2.32, which depend on zod `^4.6.6` and resolve to 4.6.7. No attacker-controlled array reaches the zod 3 instance.

### Compensating controls

- CI ignores the advisory for `api-ts` only; the same advisory stays blocking in every other workspace.
- api-ts never calls the cdp-sdk policy APIs; adding a call to `@coinbase/cdp-sdk` policy or wallet-management APIs, or routing any request body through `@coinbase/x402`, requires immediate re-review.
- Remove this exception as soon as `@coinbase/x402` and `@coinbase/cdp-sdk` publish releases on zod 4, or a patched zod 3.x appears, or before the review date unless the evidence is renewed.

## GHSA-mrhx-c7xc-m3w5 and GHSA-qr28-fpjm-wq7f — wallet-connector transitives (terminal only)

- Severity: High (zod, CVSS 4.0 8.2, CWE-770) and High (decode-uri-component, quadratic-time DoS).
- Dependency paths (terminal, a browser-only Vite bundle):
  - zod 3.25.76 / 3.22.4: `wagmi -> @wagmi/connectors -> @base-org/account -> @coinbase/cdp-sdk@1.54.0 -> zod ^3.25.76` (its nested `abitype 1.0.6` declares `^3 >=3.22.0`), and `@reown/appkit-wallet@1.7.8 -> zod 3.22.4` (exact pin; 2.0.0 is identical). No patched zod 3.x exists.
  - decode-uri-component 0.2.2: `@wagmi/connectors@6.2.0 -> @walletconnect/ethereum-provider =2.21.1 -> @walletconnect/utils 2.21.1 -> query-string =7.1.3 -> decode-uri-component ^0.2.2`. The only patched release is 0.5.1, which is outside the range and ESM-only, while query-string 7.1.3 `require()`s it; an override would break WalletConnect at runtime. `@walletconnect/utils` drops query-string from 2.22, reachable only through wagmi 3.x.
- Scope: Bun dependency audit of `terminal` only, exact advisory IDs above, via the per-workspace ignore in `.github/workflows/test.yml`. Every other finding in terminal was fixed on 2026-11-20 (storybook 8.6.19, vite 6.4.6, sharp 0.35.5, top-level zod 4.6.7, follow-redirects, source-map-js, brace-expansion).
- Owner: Suwappu maintainers.
- Accepted: 2026-11-20.
- Review by: 2027-02-20.

### Evidence

Both advisories are denial-of-service: zod allocates an issue per failing element of a large array; decode-uri-component spends quadratic time on long runs of percent-encoding. In terminal these copies run inside the user's own browser tab, inside wallet-connection code (Base Account connector, WalletConnect URI parsing, Reown wallet kit). The attacker's reach is a malformed wallet payload or URI that the user themselves connects to, and the blast radius is that one tab. No server, no other user, and no signed transaction is affected; signing stays in the wallet.

### Compensating controls

- CI ignores exactly these two advisory IDs for `terminal` only.
- Remove the zod ignore when `@coinbase/cdp-sdk` and `@reown/appkit-wallet` publish on zod 4 (or a patched 3.x appears); remove the decode-uri-component ignore when terminal moves to wagmi 3.x, which drops query-string.
- Before the review date, re-check both upstreams; renew only with fresh evidence.

## Override on record (not an exception): `zod` in `webapp`

- `webapp/package.json` `overrides` pins `zod` to `^4.6.6` because `@p2pdotme/sdk` (1.2.8 through 1.3.13) pins zod at exactly `4.3.6`, which carries the same advisory and which npm reports as "no fix available". The override moves it to 4.6.7, a minor step inside zod 4 with no removed APIs; the webapp build and unit suite pass. It is listed here because `@p2pdotme/sdk` sits on a payments path. Drop the override once the SDK publishes a release on zod 4.6.6+.

# Scope: Single-File / On-Chain Frontend for the Primitives

**Status:** proposal, not started · **Author:** engineering · **Date:** 2026-08-11

## 1. The problem this solves

The three primitives (`SuwappuTimeCurve`, `SuwappuAmortizingVault`,
`SuwappuMutualCredit`) are immutable, oracle-free, no-owner, no-upgrade contracts.
The UI in front of them is a Next.js app on a Railway container behind Cloudflare.

That is a **lifetime mismatch**. The contracts run forever; the interface to them
depends on a company, a container, a DNS record, and whoever can push to `dev`.
If any of those change, the "immutable" system becomes unusable or — worse —
silently serves different code against the same contracts.

zswap ([zswap.wei.limo](https://zswap.wei.limo/)) is the reference implementation
of the fix: a DEX whose entire frontend is bytes on Ethereum, with **no server,
no CDN, no npm dependencies, and no RPC provider** — it reads through the user's
own wallet. Its own framing: *"a new version is a new address, not an edit."*

**Goal:** the primitives' UI should have the same failure modes as the primitives
themselves — i.e. none that we control.

## 2. What "done" means (acceptance criteria)

1. One self-contained `.html` file. Zero external requests except the user's
   wallet. No CDN, no Google Fonts, no analytics, no image hosts.
2. Opens from `file://` and works. That is the honest test of "no server".
3. Reads go through the connected wallet (already shipped — see §7).
4. Feature parity with the current dapp: curve buy/sell, vault
   lend/borrow/repay/amortize/liquidate + positions, full credit-line lifecycle
   + netCycle, settings, faucet.
5. Byte-for-byte reproducible build, so anyone can verify the deployed bytes
   match this repo.
6. Published to at least one address-permanent location; ENS name resolving to it.

## 3. Delivery options (pick one, they are not equivalent)

| | Where bytes live | Survives us vanishing? | Cost | Notes |
|---|---|---|---|---|
| **A. IPFS + ENS** | IPFS, pinned | ⚠️ only while pinned | ~$0 + pinning | zswap explicitly rejects this: *"no IPFS, no pinning service, nothing to go dark."* |
| **B. Arweave + ENS** | Arweave | ✅ pay-once permanence | ~$5–15 | Simple, genuinely permanent, no gas math |
| **C. On-chain (SSTORE2) + ENS** | Ethereum/Base contract code | ✅ as long as the chain | see §4 | Strongest claim; matches the contracts exactly |
| **D. All of the above** | — | ✅ | sum | Same bytes, three locations. Recommended. |

**Chain choice under C is a real decision.** Our contracts are on **Base**;
ENS lives on **Ethereum mainnet**. Storing on Base is ~17× cheaper but relies on
a Base-aware gateway. Storing on L1 is the canonical, maximally-durable option.

> Verify before committing to C: the exact mechanism `wei.limo` uses to serve
> on-chain bytes (zswap also references an `0x{address}.w4eth.io` address-as-
> subdomain gateway). We should not design around a gateway we have not
> confirmed. eth.limo itself resolves ENS `contenthash` →
> IPFS/IPNS/Arweave/Swarm — **not** raw contract storage — so on-chain serving
> needs either a gateway that supports it or an ENS resolver returning the bytes.

## 4. On-chain cost model (measured, live prices)

SSTORE2: bytes are stored as contract *code* and read with `EXTCODECOPY`.
Cost ≈ **200 gas/byte** (code deposit) + **16 gas/byte** (calldata) + 21k per
chunk. EVM caps a contract at **24,576 bytes**, so the file is split into chunks.

At **ETH $1,881.57**, **Base 0.006 gwei**, **L1 0.104 gwei** (measured 2026-08-11;
L1 was unusually cheap, so a 10 gwei column is included as normal conditions):

| Payload | Chunks | Gas | Base | L1 @0.104 gwei | L1 @10 gwei |
|---|---|---|---|---|---|
| 60 KB (gzip-stored) | 3 | 13.3M | **$0.15** | $2.61 | $250.89 |
| 100 KB raw | 5 | 22.2M | **$0.25** | $4.36 | $418.15 |
| 150 KB raw | 7 | 33.3M | **$0.38** | $6.53 | $627.03 |
| 240 KB (zswap's size) | 10 | 53.3M | **$0.60** | $10.45 | $1,002.77 |

**Conclusion: cost is not the blocker.** Even on L1 under normal gas this is a
few hundred dollars, once. Storing gzipped (and serving with
`Content-Encoding: gzip`) cuts it ~4×. On Base it is pocket change.

## 5. The actual cost: rewriting the UI

This is the real price, and it is engineering time, not gas.

**What must go:** React, React-DOM, Next.js, TanStack Query, viem.
**What must be hand-written to replace them:**

| Concern | Today | Replacement | Est. |
|---|---|---|---|
| ABI encode/decode | viem | hand-rolled encoder for our ~40 functions; `keccak256` for selectors; `BigInt` + `padStart(64,'0')` (zswap's approach) | 2–3 d |
| Custom error decoding | viem `ContractFunctionRevertedError` | selector→name table (we have 20+ custom errors) | 0.5 d |
| Multicall batching | viem `multicall` | hand-encoded Multicall3 `aggregate3` | 1 d |
| Reactivity / rendering | React | direct DOM + a tiny render loop | 3–4 d |
| Data fetching/caching | TanStack Query | small poll+cache keyed by block number | 1–2 d |
| Styling | Tailwind build | inline `<style>`, hand-written | 1 d |
| Wallet + EIP-6963 + EIP-5792 | ours | **ports directly, already dependency-free** | 0.5 d |
| Number formatting | viem `formatUnits`/`parseUnits` | hand-rolled fixed-point | 0.5 d |
| Build → single file | Next | inline + minify + gzip + hash | 1 d |
| Test harness (reuse existing Playwright + EIP-1193 bridge) | — | port | 1 d |
| Deploy tooling (SSTORE2 chunker + verifier) | — | Foundry script | 1–2 d |

**Estimated: 12–17 working days** for parity, plus review. Current dapp source is
**3,235 lines** across `lib/dapp`, `components/dapp`, `hooks` — most of the
*logic* survives; the *framework usage* is what gets rewritten.

**Size target:** current build ships 1,229 KB raw JS / 375 KB gzipped. A
hand-rolled single file should land **60–120 KB unminified** (zswap does far more
in 240 KB), i.e. 3 chunks stored gzipped.

## 6. What we lose (state plainly)

- **Maintainability.** Every future change is hand-written DOM and hand-encoded
  ABI. Contributors need to be comfortable with that.
- **The React ecosystem.** No component libraries, no hooks, no devtools.
- **Iteration speed.** This is the opposite of the last two weeks of work.
- **A dead end if the app keeps growing.** Fine for three fixed primitives whose
  ABIs can never change (they're immutable). Wrong for a product surface that
  ships features weekly.
- **Duplication.** The Next.js dapp would either be retired or maintained in
  parallel. Maintaining both is the worst outcome — pick one.

## 7. Already done (no longer in scope)

Shipped in `be06ac2`, so the gap is smaller than it looks:

- **Wallet-as-RPC** — reads go through the wallet's provider, public RPC only as
  fallback. The single-file build inherits this.
- **EIP-5792 atomic batching** — approve+action in one signature.
- **EIP-6963 multi-wallet**, no WalletConnect tree, no external wallet SDK.
- **No CDN scripts** already; the only external fetches today are Google Fonts
  (must be inlined or dropped) and BaseScan links (informational, fine).

## 8. Phasing (each phase independently valuable)

- **Phase 0 — Decide (0.5 d).** Confirm the gateway mechanism (§3 note), pick
  chain (Base vs L1), pick delivery (recommend **D**). Decide the fate of the
  Next.js dapp.
- **Phase 1 — Static, self-contained (2–3 d).** Inline the fonts, drop remaining
  external requests, ship a static export that works from `file://`. *Delivers
  most of the censorship-resistance for ~15% of the effort.* Still React.
- **Phase 2 — Dependency-free rewrite (10–14 d).** §5. Ends with one HTML file,
  parity, and the existing Playwright/EIP-1193 harness passing against it.
- **Phase 3 — Publish (1–2 d).** SSTORE2 chunker + on-chain assembler, Arweave
  upload, ENS `contenthash`, reproducible-build verifier script.
- **Phase 4 — Versioning discipline (0.5 d).** Document "a new version is a new
  address", link previous versions from the page (zswap does this).

## 9. Recommendation

**Do Phase 0 + Phase 1 now. Do not commit to Phase 2 yet.**

Phase 1 removes the CDN/font dependencies and proves the app runs from a bare
file — that is the bulk of the real fragility, in ~2–3 days, with no rewrite and
no loss of maintainability.

Phase 2 is only worth it if the answer to *"are these primitives permanent public
infrastructure, or a demo surface for Suwappu?"* is the former. If they're a
product surface that will keep changing, hand-rolled DOM is a liability, and
**Phase 1 + Arweave/IPFS publishing (option B) gets ~80% of the benefit for ~15%
of the cost.**

Note the honest caveat on the whole idea: an immutable frontend also means
**immutable bugs**. Our contracts got 4 CRITICAL + 4 HIGH fixes between the first
and second review. A frontend that can't be patched needs the same review bar as
the contracts — that review cost is not in the estimates above.

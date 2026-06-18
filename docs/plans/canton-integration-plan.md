# Canton Network Integration — Scope & Build Plan

**Status:** Scoped, pre-implementation
**Branch:** `claude/canton-first-class-2z7p6n`
**Decisions (locked):** First-class (single codebase, not a fork) · run our **own validator node** · full scope **including swaps**.

---

## 1. TL;DR

Canton is added as a first-class chain following the `ChainType` enum pattern (like Solana/TRON/Starknet), but it is **not** a clone of those integrations. Three things make it different and drive the cost:

1. **No public RPC.** A party must be onboarded onto a **participant/validator node** we run; every read/write goes through that node's JSON Ledger API. → **Phase 0 is infra, not code.**
2. **No Python SDK.** We hand-roll an HTTP client against the JSON Ledger API (`/v2/interactive-submission/prepare` → sign hash → `/execute`).
3. **UTXO token model (CIP-56).** Balance = sum of active `Holding` contracts; no `balanceOf`.

The **good news on swaps**: CantonSwap exposes a Jupiter-style REST API, and settlement is just "transfer the token to a returned address with a memo." So **swap execution == the CIP-56 transfer primitive**. Transfers and swaps collapse into one signing path.

---

## 2. What Canton actually is (decision-relevant facts)

| Property | Canton | Contrast with bot's chains |
|---|---|---|
| "Wallet" | A **PartyID** = `(random X, fingerprint of pubkey N)`, hosted on a participant node | Other chains derive an address from a local keypair, no node round-trip |
| Network access | **Participant node → Global Synchronizer** (Super Validators). No Infura-style public RPC | Stateless public RPC |
| Signing | External party signs a `preparedTransactionHash`; ECDSA-P256 (`SIGNING_ALGORITHM_SPEC_EC_DSA_SHA_256`) or EdDSA/Ed25519; `HASHING_SCHEME_VERSION_V2` | secp256k1 (EVM/TRON), Ed25519 (Solana), STARK (Starknet) |
| Submit | `prepare` → sign → `execute` (no broadcast/mempool) | `sendRawTransaction` broadcast |
| Tokens | **CIP-56** UTXO `Holding` contracts; keep <~10 UTXOs/user, `MergeDelegation` | ERC-20-style `balanceOf` |
| Swaps | Atomic DvP; **CantonSwap AMM** live (REST API); LOB "coming" | Aggregator quote race |
| Cross-chain | None for our purposes (permissioned, no bridge liquidity) | LiFi/Socket/etc. |

Sources: Digital Asset platform docs (external party signing, JSON Ledger API), Splice docs (validator deployment, token standard), CIP-56, CantonSwap API docs (`cantonswap.nightly.app/docs`).

---

## 3. Phase 0 — Infrastructure (BLOCKING, ops not code)

Nothing below can be **live-tested** until this exists. Code can be written & unit-tested against the spec in parallel, but "live" requires:

1. **Stand up a participant/validator node.** Fastest path = **Docker Compose** bundle (participant node + validator backend + wallet UI + CNS UI). Start on **DevNet**.
2. **Onboarding:** obtain a one-time `onboardingSecret` from an SV sponsor (DevNet secret valid 1h; TestNet/MainNet 48h). DevNet also requires our **egress IP added to the SV allowlist**.
3. **Isolation rule:** never reuse Postgres/Docker volumes across DevNet/TestNet/MainNet — fully isolated deployments.
4. **Expose** the node's JSON Ledger API to the bot (internal network / auth) and capture its base URL → `CANTON_LEDGER_API_URL`.

**Ops deliverables:** node running on DevNet, JSON Ledger API reachable, our party onboarded, OpenAPI spec pulled from `…/docs/openapi` for client reference. Estimated: days of ops work + sponsor coordination, independent of the code below.

> Production note: running this node is a standing operational commitment (uptime, upgrades, DB, monitoring) — heavier than adding an RPC URL. Factor into the deploy/runbook before MainNet.

---

## 4. Identity & wallet model

Canton wallet creation is a **two-step, node-dependent** flow (unlike the local-only keygen of other chains):

1. Generate an Ed25519 (preferred — aligns with existing Solana handling + Turnkey `CURVE_ED25519`) or P-256 keypair locally.
2. **Onboard the public key** to our participant node via `POST /v2/parties/external/allocate` (+ topology txns) → receive the **PartyID**. Store PartyID as `address`, private key encrypted as today.

Implications:
- `create_canton_wallet()` is **async** and needs node access (most other `create_*` are sync, local). The `create_wallet()` dispatcher must `await` it.
- Turnkey: Ed25519 is supported, but the onboarding round-trip is custom — treat Canton like TRON/Starknet today (fall back to local signing, not Turnkey) for v1.
- DB: reuse the `Wallet` table + `chain_type` enum. **No schema change.**

---

## 5. JSON Ledger API client (the core new component)

New file `bot/services/canton_ledger_api.py` — a thin async HTTP client (httpx) wrapping:

- `prepare(commands) -> {preparedTransaction, preparedTransactionHash}` via `POST /v2/interactive-submission/prepare`
- `execute(preparedTransaction, signature, hashingSchemeVersion=V2, partySignatures) -> txId` via `POST /v2/interactive-submission/execute`
- `active_contracts(party, interfaceFilter)` for reading `Holding` UTXOs
- `allocate_external_party(pubkey, …)` for onboarding
- Independent **hash recomputation** of the transaction tree to verify the node's `preparedTransactionHash` before signing (security: don't blind-sign what the node returns)

Signing helper in `wallet.py`: `sign_canton_hash(wallet, hash_bytes) -> signature` using the decrypted key (Ed25519/P-256 via `cryptography`).

---

## 6. Balance / portfolio

`get_canton_balance(party, instrumentId)` = query active `Holding` contracts via `active_contracts` with the `Holding` interface filter, sum amounts grouped by `instrumentId`, normalize by token decimals. Wire into the existing balance/portfolio handlers behind the `ChainType.CANTON` branch. UTXO hygiene (merge via `MergeDelegation`) can be a later optimization.

---

## 7. Transfer primitive (shared by send AND swap)

`transfer_canton(wallet, recipient_party, instrumentId, amount, memo?)`:
1. Fetch `TransferFactory` from the registry endpoint → `factoryId`, `disclosedContracts`, `choiceContextData`.
2. Build the exercise command → `prepare` → verify hash → `sign_canton_hash` → `execute`.
3. Optional `memo` field (required for the swap path below).

This single function powers both `/s`-style sends and swap settlement.

---

## 8. Swaps via CantonSwap (the clean part)

CantonSwap API (base `https://mainnet.rpc.canton.nightly.app`, find DevNet/TestNet equivalent for testing):

- `GET /nswap/tokens` → catalog: `instrumentId, symbol, decimals, price, minSwapAmount, maxSwapUsd, …`
- `POST /nswap/quote` (req: `fromToken, toToken, amount, recipient=partyId, slippageTolerance?`) → `fromAmount, toAmount, minOutAmount, rate, priceImpact, memo, swapAddress, magicAddress?`

**Settlement = a CIP-56 transfer (Section 7):**
- Standard route: `transfer_canton(swapAddress, fromToken, fromAmount, memo=quote.memo)` — memo **required**.
- Direct route: if `magicAddress` present, `transfer_canton(magicAddress, …)` with **no memo**.
- Status: no dedicated polling endpoint documented → track by watching wallet activity / the resulting `Holding` contract appearing for `toToken`.

New file `bot/services/canton_swap_api.py` mirrors `jupiter_api.py`/`sunswap_api.py`: a single-provider quote source. Same-chain only. Wire into `swap_engine.py` behind an `_is_canton_swap()` guard; **hard-guard cross-chain off** (raise `SwapError`, like Starknet/TRON).

> ⚠️ Open item: CantonSwap's documented base URL is mainnet-only; no auth/devnet URL documented and **no status endpoint**. Confirm a test endpoint + completion-tracking approach during Phase 0. This is the one external dependency that could slip the swap phase.

---

## 9. File-by-file plan & effort

| # | File | Change | ~LOC |
|---|------|--------|------|
| 1 | `bot/config/chains.py` | `ChainType.CANTON`; `CHAINS["canton"]` config (str chain_id, native `CC`, `CANTON_LEDGER_API_URL` env, explorer, emoji) | 15 |
| 2 | `bot/utils/validators.py` | `validate_canton_address()` (PartyID format) + dispatch branch | 25 |
| 3 | `bot/services/canton_ledger_api.py` | **NEW** — prepare/execute/active_contracts/allocate + hash verify | 200 |
| 4 | `bot/services/wallet.py` | `create_canton_wallet()` (async, onboard), `sign_canton_hash()`, dispatcher branches | 90 |
| 5 | `bot/services/canton_swap_api.py` | **NEW** — `/nswap/tokens`, `/nswap/quote` client | 120 |
| 6 | `bot/services/swap_engine.py` | `_is_canton_swap()`, quote branch, execute = transfer-with-memo, cross-chain guard | 120 |
| 7 | balance/portfolio handlers | `ChainType.CANTON` branch → `get_canton_balance()` | 60 |
| 8 | `bot/config/tokens.py` | Canton token list (seed from `/nswap/tokens`) | 30 |
| 9 | `api-ts/src/config/chains.ts` | Add canton to metadata maps (read-only; signing stays Python) | 30 |
| 10 | `requirements.txt` | `httpx` (likely present), `cryptography` (present) for Ed25519/P-256 | 2 |
| 11 | `tests/test_canton_*.py` | wallet create (mocked node), quote parse, transfer/swap command build, hash-verify | 250 |
| | **Total (ex-node)** | | **~900** |

No DB migration. No `packages/shared` change required for v1.

---

## 10. Config / env

```
CANTON_LEDGER_API_URL=http://<participant-node>:7575   # JSON Ledger API
CANTON_PARTY_HINT / CANTON_SYNCHRONIZER_ID=...          # onboarding params
CANTONSWAP_API_URL=https://<devnet-or-mainnet>.rpc.canton.nightly.app
```
All must be added to Railway/deploy config (CLAUDE.md pre-deploy checklist item 3).

---

## 11. Risks & open questions

1. **Node uptime is now a hard dependency for a user-facing chain.** If the node is down, Canton wallet/balance/swap all fail. Needs health-monitor coverage + a graceful "Canton temporarily unavailable" path.
2. **CantonSwap: no documented testnet URL / auth / status endpoint.** Confirm in Phase 0; design completion-tracking via ledger polling.
3. **Curve choice (Ed25519 vs P-256).** Confirm what our node + external-party onboarding accepts; prefer Ed25519.
4. **UTXO fragmentation** can degrade UX (many small Holdings). Merge strategy may be needed sooner than expected for active users.
5. **Hashing scheme drift** (`V2` today) — pin the version; Canton is evolving (3.x).
6. **Async wallet creation** changes an assumption (`create_*_wallet` sync) — audit all call sites.

---

## 12. Verification plan (per CLAUDE.md standing rules)

- Parse: `python3 -c "import ast; ..."` on every changed file.
- Boot-import gate: ensure `bot/main.py` import chain still loads (new imports are lazy where possible).
- `bash scripts/verify.sh` green.
- **Live (post-node):** create a Canton wallet → receive test token on DevNet → read balance → execute a CIP-56 transfer → execute a CantonSwap swap → confirm `toToken` Holding appears. Per rule #2, do not call it "live" until this end-to-end runs.

---

## 13. Sequencing

```
Phase 0  Node on DevNet + CantonSwap test endpoint confirmed     [ops, blocking]
Phase 1  chains.py + validators + ledger client + wallet + balance   (files 1–4,7,8)
Phase 2  transfer primitive                                          (part of file 4/6)
Phase 3  CantonSwap quote + swap execute                             (files 5–6)
Phase 4  tests + verify.sh + boot gate                              (file 11)
```
Phases 1–4 are code and can start now against the spec; only live verification waits on Phase 0.

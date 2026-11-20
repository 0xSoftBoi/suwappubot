# Suwappu Agent Swap Passport — ETHGlobal Tokyo 2026 submission

## Pitch

AI trading agents today have no identity a human, an exchange, or another agent can trust — they're
just a wallet address. Agent Swap Passport gives an agent a real, checkable identity, per wallet,
enforced live: a live Uniswap v4 pool refuses to swap for an unverified wallet (real revert, zero
gas), the wallet's human proves they're a real person with World ID, the server mints the wallet a
human-readable name (`<wallet>.suwappu-agents.eth`) that resolves on-chain and flips the same wallet
to verified on the pool's hook, and only then does the swap actually execute — through the same hook,
on the same pool. One verification, reused across three separate pieces of infrastructure — proof of
personhood, a name, and a gated trade — instead of three disconnected demos. Every step below is a
real Sepolia transaction from a live, per-wallet run, not a mock or a canned receipt.

## 90-second demo script (matches the live page)

1. Open **[suwappu.bot/passport](https://suwappu.bot/passport)** with a fresh wallet address (the
   page lets you edit it).
2. **Beat 1 — blocked swap.** Trigger a swap for that wallet. It reverts `SwapperNotVerified` at
   zero gas — the hook itself is refusing the trade
   (`contracts-hackathon/uniswap-hook/src/WorldIdGateHook.sol:69`).
3. **Beat 2 — World ID.** Scan the QR (action `suwappu-passport`, signal `passport:<wallet>`).
   Behind the scenes the server mints `<wallet[2:10]>.suwappu-agents.eth` and calls
   `setWorldIdVerified(wallet, true)` on the hook — two real Sepolia transactions, both awaited
   before the page shows `ready`.
4. **Beat 3 — executed swap.** Trigger the swap again for the same wallet. It now executes through
   the same hook, same pool — tx link shown on the page.
5. Confirm independently on Sepolia Etherscan, from the proven run (wallet
   `0x62cd260f30c9040cfcb5b9be64d0817777159e02`, 2026-09-26 23:2x UTC, all three receipts
   `status: success`):
   - ENS subname mint: [`0x7d0b2826…30fcb43627`](https://sepolia.etherscan.io/tx/0x7d0b28260e353728561d8716454fc5f378f74f485179506c607fe630fcb43627)
   - Hook allowlist (`setWorldIdVerified`): [`0x57947f5b…10538cf6ab`](https://sepolia.etherscan.io/tx/0x57947f5bb5d77e3de3ba7b68cee307bf2d086113fcde453577cf1fa0538cf6ab)
   - Executed swap through the hook: [`0xce3a015c…2cbc4e1ff0`](https://sepolia.etherscan.io/tx/0xce3a015c5446a7cb808258053837845445cdd17be7c6aea47bbfb72cbc4e1ff0)
     (block 11789404)
   - Hook address: [`0xc72ab4dF…6c080`](https://sepolia.etherscan.io/address/0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080)
   - ENS subregistry: [`0xd617a791…4bd062`](https://sepolia.etherscan.io/address/0xd617a7918b89c7bac8f85c53e327d034914bd062)
   - Scanning again with the *same* human returns `status: existing` (one human, one passport) — the
     replay-safety path, not a bug.

**Scope note:** Intercepta was explored in earlier build phases (`api-ts/src/hackathon/tokyo2026/intercepta/`)
but was **not demoed and is out of scope for this submission** — no live API key was provisioned, so we
are not claiming that track.

---

## World ID / IDKit

> Bounty requirements (ethglobal.com/events/tokyo2026/prizes): "Integrate IDKit in a functioning
> application... verify the result on the server" (IDKit, $5k); "Demonstrate the complete journey:
> identity request, user completion, validated result" + a denied path (World ID for Agents, $5k).

**What we built:** a per-wallet World ID gate that drives real on-chain state, not just a UI badge.
Each wallet gets its own action/signal pair; the proof is verified against World's real staging
API, never trusted from the client, and a successful verify triggers the ENS mint + hook allowlist
below.

- Route surface: `POST /hackathon/passport/start`, `POST /hackathon/passport/verify`
  (`api-ts/src/routes/hackathon.ts:146`, `:170`) — plus the original single-shot gate at
  `POST /hackathon/world-id/start` / `/verify` (`api-ts/src/routes/hackathon.ts:55`, `:104`) still
  live behind the same server-side verifier.
- Orchestration: `startPassportGate()` / `pollPassportGate()`
  (`api-ts/src/hackathon/passport.ts:114`, `:159`), action `PASSPORT_ACTION = 'suwappu-passport'`
  (`api-ts/src/hackathon/passport.ts:36`), signal `passport:<wallet>`.
- Server-side proof verification: `api-ts/src/hackathon/tokyo2026/world-id/guardianGate.ts`.
- Replay defense: a second scan by the same human for a different wallet resolves to their
  **existing** passport (`status: 'existing'`) instead of minting a duplicate
  (`api-ts/src/hackathon/passport.ts:250`, `findWalletByNullifier`) — this is the "protected action
  doesn't occur again" denied-path requirement, proven live: re-scanning after the 2026-09-26 run
  returned `existing`, not a second mint.
- Denied path on the production agent-link flow (non-hackathon route) also proven: a second proof
  for an already-used identity was rejected 409 "proof already used (replay rejected)"
  (`docs/demo-readiness.md`, "Passport CLAIM proven on prod" entry, 2026-09-26 19:13 UTC).

**How to verify it yourself in 2 minutes:**
1. `curl https://api.suwappu.bot/hackathon/status` → confirms the trust layer and World ID provider
   are live (`{"trustLayer":true,"providers":{"worldId":true,...}}`).
2. Open the page with a fresh wallet, run beats 1–3, and read the result card — no source access
   needed.
3. Read `api-ts/src/hackathon/passport.ts:114-193` and
   `api-ts/src/hackathon/tokyo2026/world-id/guardianGate.ts` for the server-side verify + replay
   logic directly.

**Limitation:** the staging verification token issued by World's developer portal expires
**2026-09-27 17:14 UTC** — after that, re-running the flow needs a fresh token
(`WORLD_STAGING_VERIFICATION_TOKEN` on the api-ts production service). Prod also runs
`WORLD_ENV=staging`; a judge scanning with their own phone produces a production proof, so the
operator needs to register `suwappu-passport` in production and flip `WORLD_ENV` before that works
(`docs/demo-readiness.md`, "Passport v2" entry).

---

## ENSv2

> Bounty requirements (ethglobal.com/events/tokyo2026/prizes): built on ENSv2 (Sepolia); "ENSv2
> features should be central to the product, not a cosmetic add-on"; live link + open-source code.

**What we built:** every verified wallet gets a real ENSv2 subname minted under a dedicated
`suwappu-agents.eth` subregistry — an on-chain `PermissionedRegistry.register()` call, idempotent
per wallet (skipped if the name already resolves) — and the name actually resolves to the wallet, not
just registers.

- Provisioning: `provisionPassport()` in `api-ts/src/hackathon/tokyo2026/passportChain.ts:279`
  (mint + allowlist, both awaited before returning `ready`).
- Minting client: `api-ts/src/lib/ensSubname.ts:70` (`register()` ABI/call), subregistry
  addressing at `api-ts/src/hackathon/tokyo2026/ensv2/addresses.ts`.
- Subregistry (dedicated to `suwappu-agents.eth`, not the shared root registry) deployed on Sepolia:
  [`0xd617a7918b89c7bac8f85c53e327d034914bd062`](https://sepolia.etherscan.io/address/0xd617a7918b89c7bac8f85c53e327d034914bd062).
- **Resolution fix (commit `1d4898cc`):** the original mint used `PublicResolverV2`, which
  authorizes `setAddr()` through the ENSv1 `NameWrapper` — a registry ENSv2 names never touch — so
  no name could ever resolve. We deployed a minimal owner-controlled `PassportResolver.sol`
  (Sepolia [`0x553E898DBee7e9490947c3CD58d086ffE7490F80`](https://sepolia.etherscan.io/address/0x553E898DBee7e9490947c3CD58d086ffE7490F80),
  deploy tx [`0x578ef251…4d16986982`](https://sepolia.etherscan.io/tx/0x578ef25199f7638f5f350e68fd05f1dd56ed4a665fe353de7cdb9e4d16986982))
  and have the minter call `setAddr(namehash(name), wallet)` after mint, skipped if the address
  already matches.
- Live-minted subname for the proven per-wallet run: `<0x62cd26f…>.suwappu-agents.eth`, mint tx
  [`0x7d0b2826…30fcb43627`](https://sepolia.etherscan.io/tx/0x7d0b28260e353728561d8716454fc5f378f74f485179506c607fe630fcb43627),
  block 11789404, `status: success`.
- Earlier proven mint (single-shot flow, before the resolver fix): `f4c68576.suwappu-agents.eth`,
  registration tx [`0x0787f570c9e8f2f730523be1cdad32e7d58cc467c988cf60426c69a315dee233`](https://sepolia.etherscan.io/tx/0x0787f570c9e8f2f730523be1cdad32e7d58cc467c988cf60426c69a315dee233).

**How to verify it yourself in 2 minutes:**
1. Open either mint tx link above on Sepolia Etherscan — confirmed, `status: success`,
   `method: register` against the subregistry address.
2. Read `passportChain.ts:279-350` for the mint + `setAddr` call shape, and
   `contracts-hackathon/PassportResolver.sol` for why the resolver swap was necessary.
3. Run the demo page with a new wallet — the resulting name resolves in the UI, live, not fabricated
   copy.

**Limitation:** state is chain-derived on read (`GET /hackathon/passport/:wallet` re-resolves ENS +
hook mapping), but pending polls and tx hashes for in-flight jobs are process-local (single
replica) — see `api-ts/src/hackathon/passport.ts:1-20` header comment.

---

## Uniswap v4 hook

> Bounty requirements (ethglobal.com/events/tokyo2026/prizes): public GitHub repo with open-source
> code and a `FEEDBACK.md`; completed Uniswap Developer Feedback Form linking it; README points to
> exact contracts/lines.

**What we built:** a `beforeSwap` v4 hook that only lets a swap through if the swapper's address has
a recorded World ID verification — enforced on-chain at the pool level, driven per-wallet by the
same World ID gate as the passport flow above, and provably both blocking and unblocking the same
wallet in one run.

- Hook contract: `contracts-hackathon/uniswap-hook/src/WorldIdGateHook.sol:22` (`contract
  WorldIdGateHook is IHooks`), the gate itself at `:62` (`function beforeSwap(...)`), the revert at
  `:69` (`revert SwapperNotVerified(swapper)`), the allowlist storage at `:29`
  (`mapping(address => bool) public isWorldIdVerified`), the owner-gated setter at `:52`
  (`function setWorldIdVerified(address account, bool verified) external onlyOwner`).
- Server side: `simulateSwapThroughHook()` / `sendSwapThroughHook()`
  (`api-ts/src/hackathon/tokyo2026/passportChain.ts:420`, `:429`) call `PoolSwapTest` with
  `hookData = abi.encode(wallet)`; a blocked simulation decodes the hook's custom error through
  v4-core's `WrappedError` wrapper (`passportChain.ts:389-396`) so the UI shows
  `SwapperNotVerified` at zero gas, not a generic revert string.
- Deployed to Sepolia via CREATE2:
  [`0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080`](https://sepolia.etherscan.io/address/0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080),
  deploy tx [`0x32c9bc9f20f44b858640c01f1eb8211410c38b554ae68161bfb5541234bb3b89`](https://sepolia.etherscan.io/tx/0x32c9bc9f20f44b858640c01f1eb8211410c38b554ae68161bfb5541234bb3b89).
- Proven per-wallet run (2026-09-26 23:2x UTC, wallet `0x62cd260f30c9040cfcb5b9be64d0817777159e02`):
  - blocked simulation → `SwapperNotVerified`, zero gas (no tx — simulation only, by design).
  - allowlist tx: [`0x57947f5bb5d77e3de3ba7b68cee307bf2d086113fcde453577cf1fa0538cf6ab`](https://sepolia.etherscan.io/tx/0x57947f5bb5d77e3de3ba7b68cee307bf2d086113fcde453577cf1fa0538cf6ab).
  - executed swap through the same hook after allowlisting:
    [`0xce3a015c5446a7cb808258053837845445cdd17be7c6aea47bbfb72cbc4e1ff0`](https://sepolia.etherscan.io/tx/0xce3a015c5446a7cb808258053837845445cdd17be7c6aea47bbfb72cbc4e1ff0),
    block 11789404, `status: success`.
- Earlier single-shot proof (before the per-wallet flow): swap tx
  [`0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32`](https://sepolia.etherscan.io/tx/0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32).
- `docs/submissions/uniswap-feedback.md` — Developer Feedback Form content per the bounty requirement.

**How to verify it yourself in 2 minutes:**
1. Open the allowlist tx and the executed-swap tx above on Sepolia Etherscan — the allowlist tx
   calls `setWorldIdVerified`; the swap tx's internal calls show `beforeSwap` executing on the hook
   address before the pool moves funds.
2. Read `WorldIdGateHook.sol:52-70` — `setWorldIdVerified` (the allow) and `beforeSwap`'s revert
   path (the gate) are both there, no client-side enforcement.
3. `docs/submissions/uniswap-feedback.md` has the completed feedback content; the actual Developer
   Feedback Form submission is a manual step outside this repo — see limitation below.

**Limitation:** we have not independently re-confirmed, inside this doc pass, that the Uniswap
Developer Feedback Form was actually submitted through Uniswap's own form UI (only that the content
exists in-repo at `docs/submissions/uniswap-feedback.md`). Confirm the form submission itself before
the judging deadline.

---

## Known limitations (submission-wide)

- **Staging World ID token expires 2026-09-27 17:14 UTC.** Anyone re-running the flow after that
  needs a fresh `WORLD_STAGING_VERIFICATION_TOKEN` set on the api-ts production service.
- **Prod runs `WORLD_ENV=staging`.** A judge scanning with their own World App phone produces a
  production-environment proof; the operator needs to register `suwappu-passport` in World's
  production environment and flip `WORLD_ENV=production` for a live phone scan to verify
  (`docs/demo-readiness.md`, "Passport v2" entry).
- **Nullifiers are single-use per human, per action.** A given real-world identity can only mint one
  passport under `suwappu-passport`; re-scanning correctly returns `status: 'existing'` for their
  already-minted wallet — this is the intended replay defense, not a bug.
- **State is single-replica for in-flight jobs.** Passport state on disk is chain-derived on read
  (survives restarts), but pending-poll and swap-job tracking is an in-memory `Map`
  (`api-ts/src/hackathon/passport.ts`, header comment) — a multi-replica deploy would need this in
  Redis/DB.
- **Relayer gas is finite.** 0.0237 Sepolia ETH observed at 22:50 UTC ≈ 20 more passports
  (`docs/demo-readiness.md`); top up before a live re-run.
- **Intercepta is out of scope.** Code exists in the repo (`api-ts/src/hackathon/tokyo2026/intercepta/`)
  but was never live-tested with a real API key, and is not part of this submission's claimed tracks.
- **Public RPC quota pressure** has been observed on prod for unrelated chains (see
  `docs/demo-readiness.md`, blocker B3) — does not affect the Sepolia txs cited above, which are
  already confirmed on-chain, but a live re-run during judging could hit rate limits on shared
  public RPCs.
- **1inch/Aqua work exists in the repo** (`contracts-hackathon/aqua-app/`, `aqua-swapvm/`) but is not
  part of this submission's claimed tracks per this document's scope (World ID, ENSv2, Uniswap only).

## Source of every number in this document

- Per-wallet proven run (wallet `0x62cd260f30c9040cfcb5b9be64d0817777159e02`, ENS mint tx, allowlist
  tx, executed-swap tx, block 11789404): `docs/demo-readiness.md`, "Passport v2 (per-wallet, real
  on-chain effects)" entry, 2026-09-26 23:2x UTC.
- PassportResolver deploy address/tx and the resolution-bug root cause: commit `1d4898cc` commit
  message and `contracts-hackathon/PassportResolver.sol`.
- Earlier single-shot mint/hook-deploy/swap tx hashes and subregistry/hook addresses: prior
  live E2E run (2026-09-26 19:24 UTC) and `docs/plans/ethglobal-tokyo2026-agent-passport.md` Phase 3/5.
- File:line pointers: verified with `git grep -n` against `origin/main` at the time of writing
  (see individual line numbers above); route/orchestration lines re-verified against commit
  `697920e2` and `api-ts/src/routes/hackathon.ts`, `api-ts/src/hackathon/passport.ts`,
  `api-ts/src/hackathon/tokyo2026/passportChain.ts` on `origin/main`.
- Bounty requirement quotes: fetched from ethglobal.com/events/tokyo2026/prizes on 2026-09-26.
- Token expiry, `WORLD_ENV` caveat, relayer gas, replay behavior: `docs/demo-readiness.md`.

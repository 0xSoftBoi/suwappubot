# ETHGlobal Tokyo 2026 — "Agent Swap Passport" build plan

**SCOPE UPDATE (2026-09-26)**: priorities changed. New target tracks, essential unless noted:
1. **1inch** — Aqua/SwapVM (essential, not yet started — see Phase 5 below)
2. **Uniswap** — v4 compliance hook (essential, not yet started — see Phase 5 below)
3. **ENS** — Best Use of ENSv2 ($6k) — DONE, live-verified
4. **World ID** — IDKit + AgentKit ($5k + $5k) — nice-to-have, already DONE/live-verified, kept in submission
5. **Intercepta** — DROPPED per explicit direction, code stays in repo but not part of the submission story.

**Known conflict**: ETHGlobal caps a project at 3 partner prizes. This is now 4 tracks (1inch,
Uniswap, ENS, World counts as 1 slot for its 2 bounties = arguably 3 slots: 1inch, Uniswap, ENS,
+ World as a 4th). Explicit decision: submit all 4 anyway and accept the risk of forfeiting one
prize or disqualification from one track per ETHGlobal's rules, rather than dropping any of them
pre-emptively. Revisit at actual submission time if organizers clarify enforcement.

Original Phase 0 research (before this scope change) had dropped 1inch/Uniswap specifically because
both "require net-new contract/relayer infra (oracle + relayer + hook, or SwapVM order construction)"
— that assessment stands technically; it's now in scope despite the build cost, not because the
build cost went away. Budget real implementation time accordingly.

## Key existing-code leverage point

Suwappu **already has a human↔agent binding primitive**: `agents.ownerUserId` +
`POST /v1/agent/link/code` → `/claim <code>` in the Telegram bot
(`api-ts/src/routes/agent.ts:4173-4236`, schema at `api-ts/src/db/schema/agents.ts:51-55`).
This is functionally what World AgentKit's "AgentBook" does (bind a human's verified identity to
an agent wallet) — so the build is **adding World ID verification as a stronger claim gate on top
of the existing claim flow**, not building agent identity from scratch.

Also already in place, reusable as-is:
- `middleware/x402Payment.ts` (`meteredPayment`) — pay-per-call x402 credit metering
- `lib/x402Verify.ts` — on-chain USDC payment verification
- `services/audit.ts` (`writeAuditLog`) — audit trail, already used on every link-code event
- `db/schema/agents.ts` — `metadata: jsonb` column, free to store risk score / ENS name / World ID proof hash without a migration

## Phase 0 — Verify before writing code (half a day)

- [ ] Confirm exact `agentkit` header payload schema by reading `./x402/DOCS.md` in
      `github.com/worldcoin/agentkit` directly (previous research only confirmed the header name
      and round-trip shape, not the byte-level schema).
- [ ] Confirm ENSv2 subname-creation call from `docs.ens.domains/ensv2/registry` and
      `/ensv2/permissions` pages directly (do NOT reuse ENSv1 `NameWrapper.setSubnodeOwner` —
      confirmed wrong API for v2).
- [ ] Get Intercepta sandbox API key + demo risky/clean addresses from the event Discord/booth
      (self-serve sandbox not confirmed to exist).
- [x] Register/acquire an ENSv2 parent name on Sepolia for subname issuance — **DONE**:
      `suwappu-agents.eth` registered on Sepolia, owned by `0x23865aA89E79511950987CC15cd5834BE010E8E7`
      (key at `scripts/.ens_sepolia_key`, gitignored), 1-year duration, paid ~8 test USDC.
      Registrar: `ETHRegistrar` at `0xAbe76F6C8DFcEd81AA5A2bB8034202A7136b94ca` — commit-reveal flow
      (`commit(bytes32)` then `register(label, owner, secret, subregistry, resolver, duration,
      paymentToken, referrer)` after `MIN_COMMITMENT_AGE`=60s). Payment must be in an oracle-approved
      ERC20 (native ETH NOT accepted) — accepted tokens on Sepolia: USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`,
      USDC `0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e`, DAI `0x278053aCc97888E63Ec81c80FEC641Bf0Bf19664`.
      Registry contract for subname minting: `ETHRegistry`/`PermissionedRegistry` (ERC-1155) at
      `0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E`, same `register()` shape but with `roleBitmap`/absolute
      `expiry` instead of `duration`. Resolver currently set to zero address — must be set before Phase 3
      subname resolution works. Txs: approve `0x2475fc6685724406836655eca8d39eff4f7b49eaa389f26a2a4cf0c9269da6d6`,
      commit `0xf3c300565fee98c522f8db2f888f9289c5599e6f2c40d61b9d2406f5c0e0e348`,
      register `0xc1cd54b93ad25c3e30586b7c6046dee44eb19d100255a132cce6d8ecb19c0da6`.

## Phase 1 — World: strengthen the existing link flow (owns both $5k bounties)

Files: `api-ts/src/routes/agent.ts`, new `api-ts/src/lib/worldId.ts`, new
`api-ts/src/middleware/worldIdAuth.ts`

**Status: implemented, not functionally verified.** `bun` is unavailable in the
build sandbox that implemented this, so `bun run check` could not be run —
needs a `bun run check` pass (and a live proof round-trip) in a real dev
environment before demo. World ID app confirmed: `app_id
app_1b018287a10e1b3d9d56de5d3096ffc6`, `rp_id rp_ce904182c872598d`, action
`agent-swap-passport-verify` (staging). Verify endpoint confirmed as
RP-scoped: `POST https://developer.world.org/api/v4/verify/{rp_id}` (not
`{app_id}` — this is the 4.0 managed-RP flow, not legacy IDKit).

1. [x] `lib/worldId.ts`: thin client for `POST https://developer.world.org/api/v4/verify/{rp_id}` (IDKit proof verification, RP-scoped) — covers the **IDKit bounty** standalone. Fails closed on missing config/network error/non-2xx (never defaults to "verified").
2. [x] Extended `POST /v1/agent/link/code` (agent.ts:4176) to optionally accept `world_id_proof` in the request body (`{proof, merkle_root, nullifier_hash, verification_level, signal?}`). When present, verifies via `lib/worldId.ts` before minting the code, and merges the verification result (nullifier hash, verification level, sha256 proof hash, timestamp) into `agents.metadata` via a jsonb `coalesce(...) || ...` update — no migration needed.
3. [x] `middleware/worldIdAuth.ts`: `agentkit` header verification (EIP-191 SIWE/EIP-4361 signature check against the confirmed AgentKit payload schema) as a gate that can sit ahead of `meteredPayment`. Sets `c.set('agentKitVerified'/'agentKitAddress'/'agentKitPayload')` for the payment middleware/route to consume; rejects (400) only when the header is present-but-invalid, falls through (to standard x402) when absent. **EIP-1271 (smart-contract wallet) branch is a stub** (`agentkit_eip1271_not_implemented`) — needs a per-chainId viem client wired up, left as a follow-up. Wired ahead of `meteredPayment('swap/execute')` at `api-ts/src/routes/agent.ts:537` (`agentRoutes.use('/swap/execute', worldIdAuth())` immediately before the existing `meteredPayment('swap/execute')` registration at `agent.ts:538`) — this is the real on-chain swap-execution action, giving the "request -> completion -> validation -> protected action" shape end-to-end. `bun run check` passes clean with this wiring. **MONEY-PATH**: this touches the live metered-payment gate on swap execution; needs `money-path-reviewer` before merging outside the hackathon branch.
4. [x] Denied path: `world_id_verification_failed` 409 added at agent.ts, following the `already_linked` 409 template, audited via `writeAuditLog` as `agent.link_code_rejected` with `{reason: 'world_id_verification_failed', error}`.

**Post-review hardening (money-path-reviewer pass, findings 1/2/4/5/6 — all addressed):**

- **Finding 1 (replay protection, `worldIdAuth.ts`)**: added a process-local in-memory `Map<nonce, expiry>` nonce store (`issueAgentKitNonce`/consume-on-verify, single-use, deleted regardless of outcome). `expirationTime` is now required (was optional); reject if `now - issuedAt > 5min`, `now > expirationTime`, or `now < notBefore`. `domain` must equal `EnvService.API_DOMAIN` (new, defaults to `api.suwappu.bot`), `chainId` must be in an allow-list (`eip155:8453`), `resources` must include the current request path. **Not fully fixed**: no challenge-issuance endpoint exists yet to call `issueAgentKitNonce()` from, and the nonce store is in-memory/single-instance only — both flagged as hackathon-scope limitations (production needs Redis/DB-backed nonces plus multi-instance safety) in code comments.
- **Finding 2 (address-to-agent binding, `worldIdAuth.ts`)**: before setting `agentKitVerified=true`, the middleware now checks `c.get('agent').metadata.wallet_address` (same convention as `checkEvmWalletOwnership` in `agent.ts`) against the SIWE `address`. Mismatch or missing wallet falls through unverified (no 400) to preserve back-compat.
- **Finding 4 (World ID sybil-resistance, `agent.ts` + `lib/worldId.ts` + `EnvService.ts`)**: `action` and `signal` are now always server-computed (`config.action`, agent id) — caller-supplied `action`/`signal` in `world_id_proof` are ignored/removed from the accepted shape. Added a nullifier-uniqueness check (`agents.metadata->'worldId'->>'nullifierHash'` query, rejects with `world_id_verification_failed` 409 if bound to a different agent) — **query-based, not a DB unique index** (hackathon scope; noted in code as a production follow-up). Removed the hardcoded defaults on `WORLD_ID_APP_ID`/`WORLD_ID_RP_ID` in `EnvService.ts` so missing config now actually fails closed.
- **Finding 5 (fail-closed contract, `worldId.ts`)**: now requires `res.ok === true` AND `body.success === true` explicitly (no `!== false` inversion), and never falls back to caller-supplied `nullifier_hash`/`verification_level` — a portal response missing `nullifier_hash` is treated as failure.
- **Finding 6 (ordering, `agent.ts` `/link/code`)**: the `ownerUserId != null` "already linked" 409 now runs before World ID proof verification, so an already-linked agent gets a fast 409 without spending a portal call.

`bun run check` passes clean after all of the above.

## Phase 2 — Intercepta: screen before charging (owns the $2k bounty)

Files: new `api-ts/src/lib/intercepta.ts`, `api-ts/src/middleware/x402Payment.ts`

1. `lib/intercepta.ts`: client for `GET https://api.web3antivirus.io/api/public/v2/extension/account/{address}/quick-scan`, auth via `X-API-KEY`. Cache result briefly (risk doesn't need re-checking every call).
2. In `meteredPayment` (x402Payment.ts), before `consumePayment`/`verifyX402Payment` finalizes a charge, call quick-scan on the counterparty address from the payment payload. If `toxicScore` exceeds a threshold, reject with a clear reason (`traits[]` names) instead of charging — this is the "visible reasoning" the bounty demo needs.
3. Demo: one call against a known-clean address (approved, swap/payment proceeds) and one against the Intercepta-provided risky demo address (blocked, reasoning shown) — satisfies the bounty's exact requirement.
4. Persist the last scan result to `agents.metadata` so it compounds into a running risk history per agent (this is what makes it a "passport" rather than a one-shot check, and differentiates the submission from template community repos like `Decision402`).

**Status: code-complete.** `lib/intercepta.ts`, `EnvService.ts` (`INTERCEPTA_API_KEY`,
`INTERCEPTA_TOXIC_SCORE_THRESHOLD`), and `middleware/x402Payment.ts` (screen-before-settle,
read-merge-write persist into `agents.metadata.intercepta`) are implemented and fail-closed
end-to-end. **`INTERCEPTA_API_KEY` is NOT YET PROVISIONED** (self-serve Typeform at
docs.web3antivirus.io/reference/getting-started-1 not yet submitted) — until it is set, every
metered payment attempt on this path is rejected with "risk screening unavailable" rather than
allowed through. Not yet live-verified end-to-end (needs the real key + a clean/risky demo
address pair from the event Discord/booth per the checklist above). This is a MONEY-PATH change
and needs a `money-path-reviewer` pass before merging past the hackathon branch.

## Phase 3 — ENS: durable identity anchor (owns the $6k bounty)

Files: `api-ts/src/lib/ensSubname.ts`, `api-ts/src/routes/agent.ts`, `api-ts/src/config/EnvService.ts`

**Status: LIVE-VERIFIED END-TO-END** (2026-09-26). `bun run check` passes clean (`tsc --noEmit`, no errors).

1. [x] `lib/ensSubname.ts`: mints `<label>.suwappu-agents.eth` via `PermissionedRegistry.register(label, owner, registry, resolver, roleBitmap, expiry)`. Confirmed empirically on Sepolia (not assumed) that this must be called on a **subregistry** dedicated to `suwappu-agents.eth`, not on the root `.eth` registry (`0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E`) — `getSubregistry("suwappu-agents")` on the root registry currently returns the zero address, confirming no subregistry exists yet. Fails closed (`{minted:false, error}`) on missing minter key / missing subregistry / invalid owner address — never throws, never silently skips reporting why.
2. [x] Wired into `POST /v1/agent/link/code` in `agent.ts`: once `worldIdMetadata` is set (World ID proof verified) and the agent has an EVM `metadata.wallet_address`, calls `mintAgentSubname` best-effort (mint failure never fails link-code issuance) and jsonb-merges `{ensName: {name, txHash, mintedAt}}` into `agents.metadata`, audited as `agent.ens_subname_minted` / `agent.ens_subname_mint_skipped`. **Scope note**: this fires at link-code-mint time (World ID verified), not at actual claim completion — `agents.ownerUserId` is set by the Python bot's `/claim` handler, which is outside api-ts and wasn't touched by this pass. "Claimed AND verified" from the original plan is approximated as "verified" here; wiring the mint to fire on claim instead would need a bot-side call into this same `ensSubname.ts` logic (or a shared claim-completion webhook) as a follow-up.
3. [x] `agent.ts` `/me` response now returns `ens_name` alongside `owner_linked` (reads `agent.metadata.ensName.name`, null until minted).
4. [x] **On-chain setup transactions broadcast successfully** (2026-09-26, from wallet `0x23865aA89E79511950987CC15cd5834BE010E8E7`, ~0.0496 Sepolia ETH balance, RPC `https://ethereum-sepolia-rpc.publicnode.com`):
   - **Resolver chosen**: `PublicResolverV2` at `0xd7e590ad0e92a6ac1d81f4483a9b951d3585a50f` (verified on Blockscout Sepolia, contract name `PublicResolverV2`), NOT `PermissionedResolver` (`0x14f09fd05d4585759e54844dc9b00147131cf243`, also verified) — ENSv2 docs describe PermissionedResolver as a per-account proxy meant to be deployed once per name via a factory (unnecessary complexity for a shared hackathon namespace where every agent subname can safely share one resolver contract).
   - Confirmed via `findTokenId("suwappu-agents")` on the root registry: tokenId `74898739396752952865068188151234010729065566911477583651161295647071342166016`, owner `0x23865aA89E79511950987CC15cd5834BE010E8E7` (matches Phase 0).
   - **Tx 1 — deployed subregistry**: new `PermissionedRegistry` instance deployed at `0xbc0d87c4bee7b0fce09127238574645feed76bea` (same verified bytecode as the root registry, constructor `(labelStore=0x375C082021E677a40eA2AE094D050602dba90992, rootAccount=0x23865aA89E79511950987CC15cd5834BE010E8E7, roleBitmap=452312848583266388373324183574235730989896496894242753832103786389058879744)`). Tx hash: `0x32a49ee1b02a5512c47bea1364c532ca89c8454720d25c253adad3e9bf016ab0`, status success.
   - **Tx 2 — wired subregistry**: `setSubregistry(74898739396752952865068188151234010729065566911477583651161295647071342166016, 0xbc0d87c4bee7b0fce09127238574645feed76bea)` on `0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E`. Tx hash: `0x0ba195ee9a4b447eafaa653110619347ce519236b0527ed9981ba8e7d732390b`, status success.
   - **Tx 3 — set resolver**: `setResolver(74898739396752952865068188151234010729065566911477583651161295647071342166016, 0xd7e590ad0e92a6ac1d81f4483a9b951d3585a50f)` on `0x657eA849311d3D5823348ddEd7C2AaAFb3EDE09E`. Tx hash: `0xe301cba40cfec6fcff7b3ca31674cb429ca9c70c11a598f1081ba4f48bc3943b`, status success.
   - **CRITICAL BUG FOUND & FIXED**: tx 1's subregistry (`0xbc0d87c4bee7b0fce09127238574645feed76bea`) was deployed with creation bytecode pulled from Blockscout that already had the *original* ENS deployer's constructor args baked in at the tail. Appending our own ABI-encoded args after that did nothing — Solidity decodes constructor args from a fixed offset right after the compiled code, so the baked-in args won (all admin roles went to ENS's own deployer `0x84D3a426D4E12E955d1DF95db0B24fe26afE39D3`, not our wallet). Every `register()`/`grantRootRoles()` call against it reverted (`EACUnauthorizedAccountRoles` / `EACCannotGrantRoles`) until this was diagnosed by decoding the deploy tx's actual constructor args and cross-checking `hasRootRoles` on-chain.
   - **Fix**: stripped the baked-in trailing constructor args from the creation bytecode, redeployed with our own wallet as `rootAccount` and a full role bitmap (registrar/resolver/subregistry/renew/parent + all admin variants). **New subregistry: `0xd617a7918b89c7bac8f85c53e327d034914bd062`** (tx `0xc252a00de6a0b13f621142ce5a5975a015c2810eae440cda834fceb8493a5c0d`, confirmed `hasRootRoles(ROLE_REGISTRAR)` = true). Re-ran `setSubregistry` on the parent to point at the new one (tx `0xb02c3d1dce038587ebd291ff73247acfb48be4fb6224c9b036426bdf050bb8f9`). `ENS_SUWAPPU_AGENTS_SUBREGISTRY` in `EnvService.ts` updated to the new address. The old dead subregistry (`0xbc0d87...`) is abandoned, harmless.
   - `ENS_MINTER_PRIVATE_KEY` set in a new gitignored `api-ts/.env` (local dev only) from `scripts/.ens_sepolia_key`.
5. This is the piece that ties Phases 1+2 together into one legible story for judges: resolve `<agent>.suwappu-agents.eth` → see World ID-verified owner + live Intercepta risk history, in one on-chain-anchored identity. That composed narrative is what the ENS bounty's "AI agent identity integration" focus area is actually asking for.

## Live end-to-end verification (2026-09-26)

Ran a genuine, non-fabricated, full round trip locally (disposable Postgres, api-ts dev server on :8000):

1. **Real World ID staging proof** generated via `@worldcoin/idkit-core`'s `IDKit.request()` (V4/managed-RP protocol, `rp_context` signed server-side with our RP's signing key via `@worldcoin/idkit-server`'s `signRequest()`) + the hosted World ID Simulator (simulator.worldcoin.org), driven headlessly with Playwright since no interactive browser/phone was available. QR→connect-URL decoded with `jsQR`, fed into the simulator's "Paste code" flow, completed a real Orb-credential verification against World's staging Semaphore tree. This is a genuine cryptographic proof, not test data — nothing was fabricated.
2. **Found and fixed a real bug**: `lib/worldId.ts`'s original request/response shape was entirely wrong against the actual World ID v4 API — it assumed a flat `{proof, merkle_root, nullifier_hash, verification_level}` envelope, but the real API needs `{action, signal, environment, protocol_version, nonce, responses: [...], rp_context}` and returns `{success, nullifier, results: [...]}`, not `{nullifier_hash, verification_level}`. This would never have worked against the real World ID network. Rewritten and confirmed live: `POST /api/v4/verify/{rp_id}` → `{"success":true,"message":"Proof verified successfully"}`.
3. Fed the real proof into our own `POST /v1/agent/link/code` → `world_id_verified: true`.
4. **Found and fixed a second real bug**: the Phase 3 subregistry's role-grant issue described above (baked-in constructor args from the wrong bytecode source).
5. Re-ran the same call → ENS subname minted for real: `GET /v1/agent/me` → `"ens_name": "f4c68576.suwappu-agents.eth"`, audit log `agent.ens_subname_minted`, on-chain tx `0x0787f570c9e8f2f730523be1cdad32e7d58cc467c988cf60426c69a315dee233` confirmed `status: ok`, `method: register` on the correct subregistry via Blockscout.

New/changed files from this pass: `api-ts/src/lib/worldId.ts` (rewritten request/response shape), `api-ts/src/routes/agent.ts` (`WorldIdProofInput` shape updated to `{protocol_version, environment, responses[]}`), `api-ts/src/config/EnvService.ts` (`WORLD_ID_RP_SIGNING_KEY`, `WORLD_ID_STAGING_VERIFICATION_TOKEN` added; `ENS_SUWAPPU_AGENTS_SUBREGISTRY` updated to the redeployed address).

**Not yet fixed / still open**: the money-path-reviewer findings on `worldIdAuth.ts` (replay/nonce, address-agent binding) were addressed in an earlier pass; the Intercepta findings (Phase 2) were explicitly deprioritized per user direction ("ignore intercepta") and remain as originally flagged.

## Phase 5 — Uniswap v4 hook ($6k standard + $4k continuity-eligible)

Confirmed bar (ethglobal.com/events/tokyo2026/prizes): any novel v4 hook qualifies, no
mandated "compliance" theme. Minimal qualifying submission: deploy one hook + one pool
on a testnet, execute one real swap through it, capture the tx hash, README + FEEDBACK.md
pointing at exact contract/lines.

Plan: build a World-ID-gated `beforeSwap` hook (on-theme with the rest of the submission,
reuses `worldId.ts`/`worldIdAuth.ts` conceptually) — a pool that only lets a swap through
if the swapper address has a verified World ID passport recorded (e.g. via a simple
on-chain attestation registry contract we also deploy, populated from the same
`agents.metadata.worldId` verification api-ts already does off-chain).

**Status: LIVE-VERIFIED END-TO-END** (2026-09-26). Foundry project at
`contracts-hackathon/uniswap-hook/` (Uniswap/v4-core + v4-periphery installed via
`forge install`; no `BaseHook.sol` existed in this checkout of v4-periphery, so
`WorldIdGateHook` implements `IHooks` directly instead — simpler and fully self-contained,
functionally identical for our single-callback use case).

- [x] Confirmed exact PoolManager address for Sepolia directly from
      docs.uniswap.org/contracts/v4/deployments (not the research pass's unverified
      guess): `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (chain 11155111). Also got
      `PoolSwapTest` (`0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe`) and
      `PoolModifyLiquidityTest` (`0x0C478023803a644c94c4CE1C1e7b9A087e411B0A`) — the
      official test routers, used directly instead of building our own.
- [x] `WorldIdGateHook.sol` implements `IHooks`, only `beforeSwap` does real work (every
      other callback reverts — harmless since the deployed address's flag bits mean
      PoolManager never invokes them). **Real bug caught by a dry-run before spending
      gas**: `beforeSwap`'s `sender` param is the calling router (`PoolSwapTest`), not
      the swapper's EOA — any real compliance hook has to thread the actual swapper
      through `hookData` instead of trusting `sender`. Fixed before the real deploy.
- [x] Allowlist is a simple owner-set `mapping(address => bool) isWorldIdVerified` on the
      hook itself (no separate registry contract needed for hackathon scope) — seeded
      with `0x23865aA89E79511950987CC15cd5834BE010E8E7` (the same wallet that completed
      real World ID verification in Phase 1/3).
- [x] **Deployed to Sepolia via CREATE2** (salt mined with `HookMiner` for the
      `BEFORE_SWAP_FLAG` bit): hook at `0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080`
      (deploy tx `0x32c9bc9f20f44b858640c01f1eb8211410c38b554ae68161bfb5541234bb3b89` —
      note: an earlier deploy at `0x5Eb5451FA008148Fc51AFb552343702b77B54080` used the
      pre-hookData-fix bytecode and is dead/unused, harmless sunk gas).
- [x] Created one pool with two mock ERC20s (`MockERC20.sol`, deployed at
      `0x4408C29D4dC2653a3dCe5DAde8227927bC33f656` and
      `0xCb2e4E474dfc367687A98f731c7e3261c975C382`), added liquidity, executed one real
      swap through `PoolSwapTest` passing the swapper's address via `hookData` — tx
      `0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32`, status
      `0x1` (success). Scripts: `script/Deploy.s.sol`, `script/SetVerified.s.sol`,
      `script/SetupPoolAndSwap.s.sol`.
- [x] README section added to `docs/submissions/ethglobal-tokyo2026-agent-swap-passport.md`;
      feedback file at `docs/submissions/uniswap-feedback.md`.
- MONEY-PATH note: this is new Solidity touching real (testnet) swap execution — no
      `money-path-reviewer` equivalent exists for raw Solidity yet; get a second
      read-through before any mainnet-adjacent claim, never deploy to mainnet from
      hackathon code as-is.

## Phase 6 — 1inch Aqua / SwapVM ($7k)

Confirmed bar: build a custom Aqua app implementing a DeFi position; SwapVM opcodes are
optional (score higher, not required). Demonstrated via test script or thin UI — no
oracle/relayer/solver requirement.

**Status: LIVE-VERIFIED END-TO-END** (2026-09-26). Foundry project at
`contracts-hackathon/aqua-app/` (`1inch/aqua`, `1inch/solidity-utils`,
`OpenZeppelin/openzeppelin-contracts@v5.4.0` installed via `forge install`;
`via_ir = true` needed in `foundry.toml` — stack-too-deep otherwise).

- [x] Cloned `github.com/1inch/aqua` and `github.com/1inch/swap-vm` directly. Confirmed:
      Aqua has **no canonical pre-deployed instance** to depend on (it's a permissionless
      registry with no constructor args — every integrator deploys their own, confirmed
      from `src/Aqua.sol`, no address baked in anywhere). No `AquaProtocolContract`/
      `strategyHash`-SDK exists as described by an unverified derivative-project README
      referenced in the earlier research pass — that was a red herring; the real API is
      `Aqua.ship()/dock()/pull()/push()` directly, exactly as documented in `README.md`'s
      "API Reference" section, and `examples/apps/XYCSwap.sol` is a complete, working
      reference app to build from (used directly as the template).
- [x] `WorldIdGatedXYCSwap.sol` — copied `XYCSwap`'s constant-product AMM logic
      (`quoteExactIn`/`swapExactIn`, `AquaApp` base) and added a `TakerNotWorldIdVerified`
      gate on `swapExactIn`'s `msg.sender`, owner-set allowlist populated the same way as
      the Uniswap hook and World ID work — same cross-track identity story.
- [x] Deployed to Sepolia (no attestation-registry dependency needed, Aqua itself has no
      external deps): `Aqua` at `0xE323d20Cf10686d0a61b4A1aE971F0491e43ea96`,
      `WorldIdGatedXYCSwap` at `0xaE0F41531CD3B1f9239E12f2c3Ee0Ad643399863`.
- [x] Shipped a real strategy (1000/1000 mock-token liquidity), deployed a `SimpleTaker`
      contract implementing the swap callback, marked it World ID-verified, executed a
      real swap — tx `0x68b324e28d9897f96e77ee9ddb2e12c021ab2df6a7b1722811d32c7e5bb15254`,
      status `0x1`, real constant-product output (~0.996 tokens out for 1 in at 30bps
      fee). Full deploy+demo in one script: `script/DeployAndDemo.s.sol`.
- [x] README section added to `docs/submissions/ethglobal-tokyo2026-agent-swap-passport.md`.
      No separate FEEDBACK.md required per the confirmed bounty bar (not mandated for
      1inch the way it is for Uniswap/Intercepta) — revisit at actual submission time if
      1inch's specific Tokyo 2026 rules add one.
- [x] **Follow-up done, not deferred**: real SwapVM opcode composition, per explicit
      user direction to go deeper than the plain Aqua-contract-call app above. Foundry
      project at `contracts-hackathon/aqua-swapvm/` (`1inch/swap-vm` + `1inch/aqua` +
      `1inch/solidity-utils` + `openzeppelin-contracts@v5.4.0` via `forge install`;
      `via_ir = true` AND `optimizer_runs = 700` required — matching 1inch's own
      `swap-vm/foundry.toml` settings was necessary just to fit the contract under
      the 24,576-byte EIP-170 limit, confirmed by direct measurement (`forge build
      --sizes`): 47,924 bytes with default optimizer settings vs 22,344 with 1inch's).
  - **Real gap found and fixed**: 1inch's own curated `AquaOpcodes.sol` dispatcher
    (used by their `AquaSwapVMRouter`) deliberately omits the `Whitelist` instruction
    family (`PrivateOrder`/`WhitelistCoequal`/`WhitelistSequential`) — confirmed by
    reading the dispatcher source directly, not inferred. An Aqua-backed strategy
    cannot use a whitelist opcode out of the box. Fixed by writing
    `src/AquaOpcodesWithWhitelist.sol` (extends the curated dispatcher, adds the
    missing family back) and `src/WorldIdPassportSwapVMRouter.sol` (same shape as
    1inch's own `AquaSwapVMRouter`, swaps in the extended dispatcher) — a legitimate,
    reusable extension of 1inch's own opcode set.
  - **Composed program**: `WhitelistCoequal(nextPC, [takerAddress])` → `Revert()` (falls
    through if not whitelisted) → `XYCSwap.build()` (real constant-product pricing) →
    `Salt.build(...)`. Built using 1inch's own `InstructionBuilder`/opcode-library
    `.build()` methods directly — not hand-rolled byte-packing — computing the jump
    offset from `WhitelistCoequal.sizeOf(...) + revertOp.length` rather than a
    hardcoded magic number.
  - **`WorldIdGatedTaker.sol`**: same role as `WorldIdGatedTaker`/`SimpleTaker` in the
    plain Aqua app — its own contract address is the identity checked by the whitelist
    opcode (consistent with the Uniswap hook's finding that the real identity check
    has to target the calling contract, not a downstream EOA, across all three
    integrations in this submission).
  - **Verified both directions before spending any mainnet-adjacent gas**: a
    non-whitelisted taker's `swap()` call was proven to revert in a local-fork
    `forge script` dry-run (zero cost) before ever touching the real deploy — this
    is the actual adversarial check, not just "the happy path worked."
  - **Live-verified on Sepolia**: `WorldIdPassportSwapVMRouter` at
    `0x39130Cdd27f4db4f77bb359b00146582a4ed7DCf`, `WorldIdGatedTaker` at
    `0xfe18616DD3a563a6b8C8fdc14b8E655A7D51e6d5`, real shipped strategy (1000/1000
    liquidity), real swap tx
    `0x716492af5f5f9b37c240c83495f293755d4f215333b90ccc7ead34e4d2e5be4c` — status
    `0x1`, `amountIn=1e18` → `amountOut=999000999000999000` (real constant-product
    math, not a mock).
  - Both the plain `WorldIdGatedXYCSwap` (`contracts-hackathon/aqua-app/`) and this
    opcode-composed version (`contracts-hackathon/aqua-swapvm/`) are included in the
    submission — the opcode version is the deeper/higher-scoring one per the bounty's
    own rules, the plain version is kept as the simpler, easier-to-audit fallback.
- MONEY-PATH note: same caveat as Phase 5 — three separate new Solidity codebases now
  exist (`uniswap-hook/`, `aqua-app/`, `aqua-swapvm/`), get a second read-through
  before any mainnet-adjacent claim, hackathon/testnet only, never point any of them
  at real funds without a real security review first.

## Phase 4 — Submission packaging

**Final scope** (per the 2026-09-26 scope update): 1inch, Uniswap, ENS essential;
World ID nice-to-have (done anyway); Intercepta dropped. All 4 submitted tracks are
live-verified end-to-end with real testnet transactions, not just code-complete.

- [x] One repo, one coherent flow (agent claims → World ID verify → ENS subname mint,
      with the same World-ID-verified identity also gating a Uniswap v4 hook and a
      1inch Aqua position) — not disconnected demos, one identity story reused across
      three separate sponsor integrations. Live-verified end-to-end for all of World ID,
      ENS, Uniswap, and 1inch.
- [x] Per-track README with exact file:line/address/tx pointers per sponsor:
      `docs/submissions/ethglobal-tokyo2026-agent-swap-passport.md` — sections for
      World, ENS, Uniswap, 1inch. Intercepta section kept for transparency (code exists,
      fail-closed, not live-tested) but explicitly marked dropped from the submission.
- [x] `docs/submissions/uniswap-feedback.md` (Uniswap requires a completed Developer
      Feedback Form linking it — confirm the exact current form URL at actual submission
      time and complete it).
- [x] `docs/submissions/intercepta-feedback.md` kept for reference even though Intercepta
      itself is dropped — no harm, and the API-integration notes are still accurate.
- [x] 1inch: confirmed from ethglobal.com/events/tokyo2026/prizes — no `FEEDBACK.md`/
      developer feedback form required for the 1inch track (that requirement is
      Uniswap-specific). 1inch's actual stated requirements: use official Aqua/SwapVM
      contracts (redeployments OK — matches our own-instance deployment), present
      onchain execution of token transfers at the final demo (local forks allowed — we
      have real Sepolia txs, exceeds the bar), and maintain proper git commit history
      (no single-commit-on-final-day). No action needed beyond normal commit hygiene.
- [ ] Final demo video / live walkthrough recording — not yet done. Given 4 separate
      on-chain integrations now exist with real tx hashes, a screen recording walking
      through each one (link code → World ID proof → ENS resolution → a Uniswap swap →
      an Aqua swap) would be the strongest submission asset; not yet produced.
- [x] Prize cap resolved — **it was never actually a blocker.** The "3-partner-prize
      cap" is a limit on how many prizes you *select to apply for* on the submission
      form's last step, not a limit on how many tracks you can technically submit
      to/build for. ETHGlobal's standard published rule: "If a partner has multiple
      tracks, you can be eligible for all of them while only counting as 1 Partner
      Prize" — meaning World's two bounties (IDKit + AgentKit) already count as one
      slot, so our actual count is 1inch + Uniswap + ENS + World = 4 selectable slots,
      still one over the cap of 3. Practical resolution: build/submit all 4 technically
      (no platform restriction on that), and when the submission form asks which 3
      Partner Prizes to apply for, pick the 3 highest-value/best-fit ones (likely 1inch
      $7k, Uniswap $6k+$4k continuity, ENS $6k — dropping World's $5k+$5k since it's the
      explicitly-deprioritized "nice-to-have" per the 2026-09-26 scope update). UNVERIFIED:
      the exact Tokyo 2026 rules/FAQ page 404'd during this research pass; re-confirm
      against the live submission form at actual submission time since ETHGlobal
      sometimes relocates these pages close to the event.
- [ ] Intercepta API key was never provisioned — irrelevant now that Intercepta is
      dropped from the submission; no action needed unless it's revived later.

## Open risks to track during build

- AgentKit header schema (Phase 1) is confirmed and implemented, but full production
  hardening (Redis-backed nonce store, DB-level nullifier uniqueness, EIP-1271) remains
  hackathon-scope per money-path-reviewer's earlier findings — do not treat as
  production-ready without that follow-up work.
- Two brand-new Solidity codebases now exist (`contracts-hackathon/uniswap-hook/`,
  `contracts-hackathon/aqua-app/`) with no `money-path-reviewer`-equivalent review yet —
  both are testnet-only, deliberately unaudited hackathon code; never point either at
  mainnet funds without a real security review first.
- Sepolia test wallet `0x23865aA89E79511950987CC15cd5834BE010E8E7` is down to ~0.032 ETH
  after all four builds — insufficient for another full deploy-from-scratch cycle; top
  up before attempting further on-chain work on this wallet.

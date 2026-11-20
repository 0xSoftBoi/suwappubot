# Agent Swap Passport — ETHGlobal Tokyo 2026 submission

One flow: **agent claims a link code → World ID verifies the human behind it → an ENS
subname anchors that identity on-chain → that same World-ID-verified identity gates a
real swap on both a Uniswap v4 hook and a 1inch Aqua position.** Not four disconnected
demos — one composed identity/passport for an AI trading agent, reused across three
separate sponsor integrations, built on Suwappu's existing cross-chain swap
infrastructure.

**Submitted tracks**: World (IDKit + AgentKit), ENS, Uniswap, 1inch — all four
live-verified end-to-end with real testnet transactions. Intercepta was explored and
partially built (see below) but dropped from the final submission.

Full build log, exact byte-level API schemas discovered, and every tx hash: see
[`docs/plans/ethglobal-tokyo2026-agent-passport.md`](../plans/ethglobal-tokyo2026-agent-passport.md).
This file is the judge-facing index into that log.

## World — IDKit + AgentKit ($5k + $5k)

- **IDKit / server-side proof verification**: `api-ts/src/lib/worldId.ts:96` —
  `verifyWorldIdProof()`. Calls the real World ID 4.0 managed-RP endpoint
  (`POST https://developer.world.org/api/v4/verify/{rp_id}`), signs the required
  `rp_context` server-side (`@worldcoin/idkit-server`'s `signRequest`), fails closed on
  any error. **Live-verified**: a genuine staging proof (generated via the World ID
  Simulator, not fabricated) returned `{"success":true,"message":"Proof verified
  successfully"}` from World's own API.
- **Wired into the claim flow**: `api-ts/src/routes/agent.ts:4191` —
  `POST /v1/agent/link/code` optionally accepts a World ID proof, verifies it before
  minting the code, and stamps the nullifier + verification level into
  `agents.metadata`. Nullifier-uniqueness is enforced so one human can't mint unlimited
  linked agents.
- **AgentKit / protected-action gate**: `api-ts/src/middleware/worldIdAuth.ts:256` —
  `worldIdAuth()`, wired at `api-ts/src/routes/agent.ts:542` directly ahead of the real
  swap-execution route's metered-payment gate (`:543`). Verifies the `agentkit` header's
  EIP-4361/SIWE-style signature (EIP-191 done; EIP-1271 stubbed as a follow-up), giving
  the "request → completion → validation → protected action" shape against a real
  on-chain swap, not a toy endpoint.

## ENS — Best Use of ENSv2 ($6k)

- **Subname minting**: `api-ts/src/lib/ensSubname.ts:91` — `mintAgentSubname()` calls
  `PermissionedRegistry.register()` on a dedicated Sepolia subregistry deployed for
  `suwappu-agents.eth`.
- **Wired into the claim flow**: once World ID verification succeeds and the agent has
  a linked wallet, a subname mints automatically (`api-ts/src/routes/agent.ts` inside
  the `/link/code` handler). Surfaced in `GET /v1/agent/me` as `ens_name`.
- **Live-verified**: `f4c68576.suwappu-agents.eth` minted for a real test agent,
  confirmed on Sepolia via Blockscout (`register`, status `ok`).
- This is the piece that composes the other two tracks into one legible on-chain
  identity: resolve `<agent>.suwappu-agents.eth` → see a World ID-verified owner with a
  live Intercepta risk history, all anchored on one ENS name.

## Uniswap — v4 hook ($6k standard + $4k continuity-eligible)

- **Contract**: `contracts-hackathon/uniswap-hook/src/WorldIdGateHook.sol` — a `beforeSwap`
  hook that only lets a swap through if the swapper address (passed via `hookData`,
  since the immediate `sender` PoolManager reports is the router, not the EOA — a
  realistic constraint any real compliance hook has to handle) is recorded as World
  ID-verified in an owner-set mapping. Populated from the same off-chain World ID
  verification api-ts already performs (`api-ts/src/lib/worldId.ts`,
  `api-ts/src/routes/agent.ts` `/v1/agent/link/code`) — this is the on-chain enforcement
  point for the same passport, tying the Uniswap and World tracks together.
- **Deployed on Sepolia**: hook at `0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080` (CREATE2,
  flag bits mined to enable only `beforeSwap`), against the real Sepolia `PoolManager`
  at `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (confirmed from
  docs.uniswap.org/contracts/v4/deployments, not assumed).
- **Live-verified**: created a real pool with two mock ERC20s (`0x4408C29D...`,
  `0xCb2e4E47...`) using this hook, added liquidity, and executed a real swap through it
  via `PoolSwapTest` — tx `0x4491020f77ab779e233f132b0e3d5c7a6821e827df2d4dae34efe306774f4d32`,
  status `0x1` (success). Deploy script: `contracts-hackathon/uniswap-hook/script/Deploy.s.sol`
  (CREATE2 salt mining via `HookMiner`); pool setup: `script/SetupPoolAndSwap.s.sol`.
- See [`uniswap-feedback.md`](./uniswap-feedback.md) for the Developer Feedback Form
  writeup.

## 1inch — Aqua / SwapVM ($7k)

- **Contract**: `contracts-hackathon/aqua-app/src/WorldIdGatedXYCSwap.sol` — a custom Aqua
  app implementing a constant-product AMM position (built directly on Aqua's own
  `XYCSwap` reference example), where `swapExactIn` only executes for a taker
  (`msg.sender`) recorded as World ID-verified. Same allowlist pattern as the Uniswap
  hook and the same off-chain source of truth (`api-ts/src/lib/worldId.ts`,
  `/v1/agent/link/code`) — composing the World and 1inch tracks into one identity-gated
  DeFi position.
- **Deployed on Sepolia** (own instances, Aqua is permissionless with no canonical
  deployment to depend on): `Aqua` registry at
  `0xE323d20Cf10686d0a61b4A1aE971F0491e43ea96`, `WorldIdGatedXYCSwap` app at
  `0xaE0F41531CD3B1f9239E12f2c3Ee0Ad643399863`.
- **Live-verified**: shipped a real strategy (1000/1000 mock-token liquidity from a
  maker wallet), deployed a `SimpleTaker` contract, marked it World ID-verified, and
  executed a real swap through `swapExactIn` — tx
  `0x68b324e28d9897f96e77ee9ddb2e12c021ab2df6a7b1722811d32c7e5bb15254`, status `0x1`
  (success), real constant-product output amount (~0.996 tokens for 1 token in at 30bps
  fee). Deploy/demo script: `contracts-hackathon/aqua-app/script/DeployAndDemo.s.sol`.
- **Also built, and genuinely deeper**: `contracts-hackathon/aqua-swapvm/` composes real
  SwapVM opcodes (`WhitelistCoequal` for the identity gate + `XYCSwap` for pricing,
  `Revert`/`Salt` for control flow) into one program, executed through Aqua-backed
  liquidity — the "define custom instructions" path the bounty says scores higher.
  Building this surfaced a real gap: 1inch's own curated `AquaOpcodes` dispatcher
  (`lib/swap-vm/contracts/opcodes/AquaOpcodes.sol`) deliberately excludes the whitelist
  instruction family, so an Aqua-backed strategy can't use it out of the box.
  `src/AquaOpcodesWithWhitelist.sol` extends that dispatcher to add it back, and
  `src/WorldIdPassportSwapVMRouter.sol` wires it into a real router — a legitimate,
  reusable extension of 1inch's own opcode set, not a hand-rolled toy.
  - Deployed on Sepolia: `WorldIdPassportSwapVMRouter` at
    `0x39130Cdd27f4db4f77bb359b00146582a4ed7DCf`, `WorldIdGatedTaker` at
    `0xfe18616DD3a563a6b8C8fdc14b8E655A7D51e6d5`.
  - **Live-verified, both directions**: an unwhitelisted taker's swap reverts (confirmed
    in a local fork test before ever touching mainnet gas); the real whitelisted taker's
    swap succeeded on Sepolia — tx
    `0x716492af5f5f9b37c240c83495f293755d4f215333b90ccc7ead34e4d2e5be4c`, status `0x1`,
    real constant-product output (`999000999000999000` wei out for `1e18` wei in).
  - This and the plain `WorldIdGatedXYCSwap` app above are both included in the
    submission — the opcode-composed version is the more sophisticated one, the plain
    contract-call version is the simpler fallback if judges want the easier-to-audit path.

## Intercepta — Safe Agent-to-Agent Payments ($2k) — DROPPED FROM SUBMISSION

Explored and partially built, then explicitly dropped from the final submission
(not one of the four tracks above). Kept here for transparency — the code exists in
the repo and is fail-closed, but was never live-tested (API key not provisioned) and
is not part of what's being judged.

- **Risk screening client**: `api-ts/src/lib/intercepta.ts:100` — `quickScan()`, calls
  Intercepta's quick-scan API, fails closed (never allows a payment through on a scan
  failure).
- **Wired into the payment path**: `api-ts/src/middleware/x402Payment.ts` —
  `chargeAgentForCall` screens the counterparty address before settling; a scan result
  above the configurable toxic-score threshold blocks the charge with the flagged
  traits surfaced in the error. Scan history compounds into `agents.metadata` per agent,
  making it a running risk passport rather than a one-shot check.
- **Status**: code-complete, fail-closed end-to-end, **not yet live-tested** — the
  Intercepta API key requires a self-serve Typeform submission
  (docs.web3antivirus.io/reference/getting-started-1) that wasn't completed for this
  submission. See [`FEEDBACK.md`](./intercepta-feedback.md) for API feedback.

## Money-path review status

Two of the three tracks touch the real metered-payment/swap-execution path
(`worldIdAuth` gating `swap/execute`; Intercepta gating `chargeAgentForCall`). Both were
reviewed by an adversarial money-path reviewer; the World ID/AgentKit findings (replay
protection, address-to-agent binding, sybil resistance) were fixed and re-verified. The
Intercepta findings (metadata race condition, other payment routes not yet screened)
remain open — flagged explicitly rather than silently shipped; see the plan doc's
Phase 2 section for the full finding list.

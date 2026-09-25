# Suwappu Trust Layer — ETHGlobal Tokyo 2026

One build, five prize tracks. The thesis: **before an AI agent moves money,
World proves who backs it, Intercepta checks whether the counterparty is safe,
ENSv2 proves what the named agent is allowed to do, and Uniswap provides the
executable route.**

| Prize | Track | Module |
|---|---|---|
| $5,000 | World — Best Use of World ID for Agents | `src/world-id/` |
| $6,000 | ENS — Best Use of ENSv2 | `src/ensv2/` |
| $6,000 | Uniswap — Best Uniswap Stack Contribution | `src/uniswap/` |
| $2,000 | Intercepta — agent/x402 payment safety | `src/intercepta/` |
| $1,000 | Curvegrid — Best AI Agent Project | `curvegrid/` |

## The demo (3 minutes)

1. Agent proposes a trade in the Telegram bot: "Swap 1.5 ETH → USDC on Base".
2. Human scans the World ID QR (`connectorURI` from `startTradeVerification`).
   Backend verifies the proof server-side — **signal bound to the exact trade
   intent**, nullifier stored with a UNIQUE constraint.
3. Intercepta screens the x402 `payTo` **before signing** — clean counterparty passes.
4. Uniswap Trading API returns the best route (Classic vs UniswapX dispatch);
   approval check runs Permit2-aware before the swap payload is built.
5. ENSv2 resolves `agent.demo.suwappu.eth` live; onchain caps enforced.
6. Second scenario: a flagged counterparty is **blocked with a visible reason**;
   an over-cap trade is blocked by the ENS policy; a denied World verification
   means no execution. The held payment escalates to World ID step-up.

Full runbook: [`src/demo/runbook.md`](src/demo/runbook.md).

## Layout

```
src/
  world-id/     rpSignature.ts   RP request signing (backend-only)
                guardianGate.ts  QR → poll → server-side verify, intent-bound signal
                stepUp.ts        WorldIdApproval → ApprovalService step-up adapter
                agentkit.ts      x402: agent-side client + seller-side header verify
  intercepta/   client.ts        address / token / transaction scans
                policy.ts        findings → PolicyVerdict + trust penalty
                screen.ts        pre-sign + pre-execute orchestration
  ensv2/        addresses.ts     Sepolia deployment set (re-confirm at workshop)
                roles.ts         role-bitmap delegation (agent can never self-raise caps)
                register.ts      agent.<name>.suwappu.eth issuance
                resolver.ts      live policy resolution — the L4 gate
  uniswap/      tradingApi.ts    /quote /swap /order /check_approval client
                routeAdapter.ts  first-class quote/execution source
                mcpTools.ts      uniswap_quote / uniswap_check_approval / uniswap_build_execution
  demo/         runbook.md
curvegrid/      README.md        prize positioning (no MultiBaas dependency)
```

## Quick start

```bash
cd hackathon/tokyo2026
cp .env.example .env   # fill in at the venue — never commit .env
bun install
bun test               # 27 unit tests, pure logic
bun run check          # type gate
bun run demo           # executable end-to-end demo: 5 scenarios, self-asserting
```

`bun run demo` runs the full trust-layer pipeline
(`src/demo/pipeline.ts`) against mock providers — no keys needed. Mocks swap
only the network transports; the verdict logic (`scanResultToPolicySignal`,
`validateWorldIdStepUp`, `hashIntent`) is the real code. With keys in `.env`,
the same pipeline runs against the live providers.

## api-ts integration seams (post-hackathon wiring)

The modules are standalone by design; production wiring is four thin,
env-flagged insertion points — no behavior change when flags are off:

1. **PolicyService** (`api-ts/src/services/PolicyService.ts`, `evalStateless`):
   after the allowlist checks, run `screenPreparedTx` and fold the returned
   `{ block?, approval? }` from `scanResultToPolicySignal` into the verdict.
2. **ApprovalService** (`api-ts/src/services/ApprovalService.ts`,
   `decideApproveWithStepUp`): add `decideApproveWithWorldId` using
   `validateWorldIdStepUp` from `src/world-id/stepUp.ts` — same TTL semantics,
   same single-transaction decision update.
3. **X402Service.verify_payment** (bot): pre-sign `screenPreSign` on `payTo`;
   seller-side `verifyAgentKitHeader` on the `agentkit` extension.
4. **Swap routing** (api-ts route providers): register `UniswapTradingProvider`
   from `src/uniswap/routeAdapter.ts`; MCP tools from `src/uniswap/mcpTools.ts`
   into the MCP server.

## Keys needed (user provides at the end)

- `WORLD_APP_ID`, `WORLD_RP_ID`, `RP_SIGNING_KEY` — developer.world.org
- `AGENTKIT_AGENT_ADDRESS` — `npx @worldcoin/agentkit-cli@0.2.0 register` (needs Orb)
- `INTERCEPTA_API_KEY` — intercepta.io/ethglobal (sandbox, 1,000 req)
- `UNISWAP_API_KEY` — developers.uniswap.org/dashboard
- `SEPOLIA_RPC_URL`, `ENSV2_OWNER_PRIVATE_KEY` — testnet only

## Submission docs

- [`WORLD_ID_DEBRIEF.md`](WORLD_ID_DEBRIEF.md) — required World debrief
- [`FEEDBACK.md`](FEEDBACK.md) — required Uniswap feedback (also submit the form)
- [`INTERCEPTA_FEEDBACK.md`](INTERCEPTA_FEEDBACK.md) — API feedback

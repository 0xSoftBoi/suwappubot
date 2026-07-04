# Agent Leading-Edge Roadmap (researched 2026-07-02)

Synthesis of four deep research sweeps (agentic payments, agent identity/trust,
execution-API competitors, agent DX) to take Suwappu from Dune-parity to the
leading edge of agent-native crypto execution. Ground truth: the mid-2026
frontier has consolidated on a four-layer stack — **MCP** (tools), **A2A**
(agent↔agent), **x402** (payments), **ERC-8004** (identity/reputation) — and
the leaders compose all four. We have three of the four legs.

## Where we already lead

- **Breadth**: swaps + perps (Hyperliquid) + predictions (Polymarket) + lending
  (Morpho) in one API. No competitor has all four (Bankr is closest; Jupiter is
  Solana-only; 1inch/Li.Fi/OKX are swap-centric).
- **A2A protocol** support + agent card at both well-known paths. Dune,
  Coinbase, Zerion, Codex have none.
- **x402 metering** with facilitator settlement, layered fallbacks (tier →
  credits → on-chain settle → 402 challenge), idempotent USDC top-ups.
- **Base Spend Permissions** recurring billing (true crypto-native auto-renew —
  x402 itself doesn't have this).
- Self-serve agent registration with instant API keys.

## Shipped in this push

- Dune-parity landing page (`/agents`), agent pricing surface, gitbook docs
  (MCP tool reference, per-client setup, billing/x402 docs), `llms.txt` +
  `llms-full.txt` on both API and showcase.
- MPP/AP2 mislabeling fix (stop claiming AP2 compliance we don't have).
- MCP protocol version negotiation (was pinned to 2024-11-05).
- MCP Registry manifest (`server.json`) + publish runbook (needs DNS TXT).
- `/.well-known/ai-catalog.json` (ARD v0.9 draft — Google/Microsoft/HF-backed
  federated agent discovery).
- x402 extension declared in the A2A agent card
  (google-agentic-commerce/a2a-x402 convention).
- Agent-native CLI (`-o json` on every command, `suwappu auth`, register/
  quote/swap/chains/tokens/billing commands) — Dune CLI pattern.
- Installable Agent Skills package (`skills/suwappu/SKILL.md`, agentskills.io
  spec, `npx skills add` path across 17+ agent runtimes).

## Phase 1 — safety rails (next; MONEY-PATH review required)

1. **`POST /v1/agent/swap/simulate`** — Tenderly-style dry-run: expected
   output, slippage, would-it-revert, state diff where the chain supports it.
   Biggest gap vs Coinbase Agentic Wallets / ChainGPT-class rivals. Every
   competitor safety story starts here.
2. **Per-tx + daily spend limits on managed wallets** exposed as first-class
   API objects (we have Turnkey policies; surface velocity caps and make them
   inspectable). Note: Turnkey/Privy enforce policy off-chain (signing
   service); Crossmint/Coinbase enforce on-chain in smart accounts. Evaluate
   an on-chain backstop via our existing `smartAccount.ts` / spend-permission
   contracts.
3. **Honeypot/rug-check + stop-loss/take-profit as execution-API primitives**
   (ElizaOS has these only as framework plugins; nobody offers them as a
   hosted API guard). White space.

## Phase 2 — payments frontier

1. **Session-based payments**: agent pre-authorizes a spend limit (reuse our
   EIP-712 Spend Permission pattern), calls stream against it off-ledger,
   settle in batches. This is where both x402 V2 (SIWx sessions) and
   Stripe/Tempo MPP (session intents + vouchers) are converging; doing it
   crypto-native with no Stripe dependency puts us ahead of both.
2. **Refunds/escrow for failed paid calls** (x402r-compatible). A publicly
   logged x402 weakness (MCP discussion #2436): paid tool call fails → no
   refund path. Define one for `execute_swap`.
3. **Signed spend-cap mandates** (AP2-style Payment Mandate, crypto-native):
   allowlisted tools, velocity limit, expiry — an inspectable artifact, not
   just a balance.
4. **List in x402 Bazaar / publish V2 Discovery metadata** (we consume
   directories via `browse_mpp_directory` but don't advertise ourselves).
5. **Exercise the facilitator settle path live** (FacilitatorService is
   code-complete but never run against a live facilitator — not a claimable
   feature until end-to-end tested).

## Phase 3 — identity & verifiable trust (highest differentiation)

1. **ERC-8004 identity for the API itself** — mint IdentityRegistry NFT,
   `agentURI` → registration file listing MCP/A2A/REST endpoints. Live on
   mainnet since Jan 2026; ~no DeFi execution API has registered yet.
   Chain choice needs a scoped follow-up (mainnet vs Base vs BNB — BNB has
   the largest registered-agent base via BRC8004).
2. **Portable reputation for OUR registered agents**: we already track
   `total_requests`/`total_swaps` per agent — write periodic aggregate
   signals to the ERC-8004 Reputation Registry or an EAS schema. "This agent
   ran N real swaps with zero failed settlements" becomes a credential the
   agent carries to other services. Nobody does this from the infra side.
3. **EAS-attested swap receipts** on Base (sub-cent each): hash of
   {quote_id, tokens, amounts, tx hash, agent_id, ts} per executed swap →
   verifiable execution history (Recall/EigenCloud validated market demand;
   wallet-API tier has nothing).
4. **Publish to the official MCP Registry** (manifest ready; needs DNS TXT on
   suwappu.bot).
5. Longer term: **TEE-attested execution path** (Phala-style) — hardest to
   copy; closes "trust the operator" gap.

## Phase 4 — data & reach

1. **WebSocket price/tx streams** — Codex and Mobula both ship WS; we're
   REST+webhooks only. Time this with the **Dune Sim sunset (Aug 1, 2026)**:
   their real-time wallet/balance/price API users are migrating (Zerion/
   Codex/Mobula are the anointed targets) — a live acquisition window for
   exactly the execution+data agents we serve.
2. **MCP progress notifications** for long ops (bridge polling, multi-hop
   routing); plan elicitation around the stateless multi-round-trip pattern
   (SEP-2322) in the 2026-07-28 MCP spec.
3. **Fiat rails** (onramp/virtual cards a la Crossmint lobster.cash) — the one
   table-stakes competitor bundle we lack entirely. Larger bet; needs product
   decision.
4. **Delegated user-owned wallets** (Privy "Model 2": end user keeps custody,
   grants scoped agent signer). Confirm whether our Turnkey wiring can do
   this; increasingly a named pattern.
5. **Arazzo workflow doc** for quote→swap→status (spec still maturing; low
   priority).

## Key competitive facts worth remembering

- Dune Agents = SQL analytics only; killed their real-time API (Sim) —
  deliberately vacating the execution space.
- x402: ~165M cumulative txns but ~half test traffic; spec freeze Q3 2026;
  Foundation (Linux Foundation) members include Google, Visa, AWS, Anthropic.
- Stripe/Tempo MPP (Mar 2026) wins the onboarding argument on MCP; Mastercard
  Agent Pay for Machines (Jun 2026) shows card networks converging on the
  same primitives. Everyone is building: credentialed agent + spend caps +
  machine-speed micropayments.
- Li.Fi now ships its own hosted MCP server — a disintermediation risk since
  we route through them; our moat is breadth + wallets + billing + A2A, not
  the swap route itself.

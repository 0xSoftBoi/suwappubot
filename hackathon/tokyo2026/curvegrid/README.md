# Curvegrid — Best AI Agent Project ($1,000)

## Positioning

Suwappu's trust-layer agent is a **policy-aware transaction agent for
cross-chain stablecoin payments**: every trade an AI agent proposes is

1. checked against onchain policy (ENSv2 spending caps and permissions —
   `src/ensv2/`),
2. screened for counterparty risk (Intercepta — `src/intercepta/`), and
3. released only after a verified human approves it (World ID —
   `src/world-id/`),

so agents can move real money autonomously without moving it recklessly.

This hits four of Curvegrid's listed categories directly: policy-aware
transaction agents, agent-to-agent payments (x402 + AgentKit), stablecoin
payment agents, and onchain monitoring agents (the screening layer).

## Why no MultiBaas dependency

The Tokyo 2026 AI Agent prize does not require MultiBaas — the agent itself
is the submission. MultiBaas work is stretch-only:

- **If the core build finishes early:** add an event-query activity feed
  (agent trades indexed and displayed), or a tiny `AgentAuditLog` contract
  called through MultiBaas so every guardian-gate decision leaves an
  onchain audit trail.
- **Do not** build a dashboard from scratch for the Digital Asset Dashboard
  prize — only enter it if the existing portfolio view already renders
  against demo wallets.

## What to show the Curvegrid judges

- The 3-minute runbook (`src/demo/runbook.md`) — the whole trust layer in
  one flow.
- The policy code: `src/intercepta/policy.ts` (verdicts),
  `src/ensv2/resolver.ts` (onchain caps), `src/world-id/guardianGate.ts`
  (human approval).
- The pitch paragraph above, verbatim.

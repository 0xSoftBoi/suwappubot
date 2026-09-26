# Agent Desk — product parity vs. the agent-platform field

Research date: 2026-08-31. Surveyed: ChatGPT Atlas agent mode, Claude
Code/Cowork permission modes, OpenAI Agents SDK sessions, Devin/Cursor
background agents, Payman, Skyfire, Coinbase x402/Agentic Wallets, Stripe
agent toolkits, Visa/Mastercard agentic commerce, Safe guards, Fireblocks
policy engine, Tenderly previews.

## Where the desk is AHEAD of the field

- **The mandate is agent-queryable.** `check_mandate` exposes the rule set as
  a typed dry-run; Payman/Fireblocks policies are opaque to the agent.
- **Amendments are directional diffs.** Loosening vs. tightening is computed
  and flagged; Safe/Fireblocks show that something changed, not whether it
  got riskier.
- **The policy compiler reports its own loss.** `compile_mandate_to_policy`
  names what did not survive translation; competitors don't self-report.
- **The governance graph narrates itself live** (DeskFlow). Nobody else
  visualizes their own permission topology in real time.

## Shipped from this survey

- **Take-control switch** (Atlas's headline control, made harder): Pause
  agent withdraws every tool from `document.modelContext` in one abort — a
  paused agent cannot even read — Resume re-registers. Smoke-asserted.
- **Session persistence** (Devin/Cursor checkpoint pattern): proposals +
  activity rehydrate from browser storage; a reload never eats the receipt.
  Smoke-asserted.
- **Impact strip on proposal cards** (Tenderly's preview pattern): worst-case
  floor, price impact, gas, settlement time as labeled deltas beside every
  swap proposal, from data the desk already holds.
- Earlier in the same push: sequenced multi-leg plan handoff (Safe-style
  order enforcement in the DOM).

## Backlog (ranked, none needs a backend)

1. **Timed override cooldown** (Safe's override-after-delay): a visible
   countdown before an allowed-once Approve unlocks. Touches the smoke flow;
   do it with test updates in one change.
2. **Per-tool allowlist** (Claude Code pattern): human toggles individual
   tools off without pausing everything.
3. **Category forced-pause flags** (Atlas's pause-on-financial-sites): e.g.
   always block first-trade-of-a-new-token regardless of size — a synthetic
   mandate rule through the existing violation plumbing.
4. **Second-approver quorum stub** (Fireblocks): `requireSecondApprover` on
   the mandate; Approve becomes 1/2.
5. **First-seen counterparty note** (KYT-shaped, honestly labeled heuristic):
   flag never-before-seen tokens/addresses on proposal cards as advisory.
6. **Amendment history chain in the receipt**: accumulate every approved
   diff keyed by mandate version, not just the latest.

Rejected for now: chasing Atlas's conversational confirms (weaker than our
structured verdicts), Stripe-style restricted keys (their own docs admit
keys scope operations, not amounts — our mandate already does amounts).

---
title: "Stablecon DC 2026 — event brief"
audience: internal — whoever is staffing the Suwappu table/talk at Stablecon DC
status: draft
event_date: ~2026-09-09 (two weeks from today, 2026-08-26 — confirm exact date/time against the event page before printing anything)
---

## 0. What this brief assumes

Stablecon DC's audience is stablecoin issuers, payment/settlement infra teams, exchanges,
and regulatory-adjacent builders — not a general crypto-trading crowd. Positioning below
leans on the two most defensible, audience-relevant, *shipped* pieces of Suwappu: the
cross-chain execution layer (routing/custody discipline) and the compliance screening gate
(directly relevant to anyone thinking about permissioned or monitored settlement). It does
**not** lean on Positions/Membership (not deployed — see `docs/marketing/positions-launch.md`
line 1) or the Seasons token (pre-TGE, no token exists — see
`docs/marketing/crosspost/fee-denominated-points.md`). Those are fine as "ask me about it"
follow-ups, never as the headline.

## 1. Positioning statement (stablecoin audience)

> Suwappu is the execution layer between intent and markets: it routes a swap intent across
> 21 routing integrations and 45 chains, and separates "we prepared a transaction" from "we
> moved your funds" with a formal 5-level authority ladder — so custody is never ambiguous,
> whether the caller is a human in Telegram or an autonomous agent paying per call in USDC.

Why this framing for *this* audience specifically: stablecoin people care about two things
above almost everything else — where their token can actually move, and who can move it
without asking. The execution-authority ladder and the compliance gate both answer exactly
that, with code behind them, not a deck.

## 2. 30-second pitch

> "Suwappu routes swaps across 45 chains and 21 routers — think of it as the layer that
> decides which existing DEX or bridge should fill an intent, not another DEX itself. We
> separate 'prepared a transaction' from 'moved your funds' formally, so an agent or a human
> always knows which one just happened. And because a lot of you are thinking about
> permissioned settlement, we also shipped an application-layer compliance gate modeled on
> the UBS/Nethermind public-Ethereum PoC — allowlist/blocklist screening before every swap is
> signed, off by default, on when you turn it on."

## 3. 2-minute pitch

> "Nobody wakes up wanting to use a DEX aggregator — they want to get from token A to token B
> and be done. The hard part is that 'swap ETH for USDC' isn't one operation, it's a search:
> which of our 21 routing integrations can even serve this pair, on this chain, right now, at
> what price? We run that search — quote comparison, simulation, safety checks — every time,
> across a platform surface spanning 45 chains, 18 of those exposed to AI agents specifically.
>
> Two things about how we built it that matter to a room full of stablecoin people. First,
> custody clarity: we have a five-level authority ladder — discover, quote, simulate, prepare
> an unsigned transaction, or actually execute with managed funds — and we never let a method
> name imply a level of authority it doesn't have. Our own MCP tool called `execute_swap`, for
> instance, only prepares a transaction; it doesn't move funds. That's documented, not a
> surprise someone finds in an audit.
>
> Second, compliance. In June this year UBS and Nethermind showed a regulated institution
> could trade on public Ethereum with node-level address restrictions and private relay
> routing. We don't run nodes for other people's traffic, but we adapted the same idea to the
> layer we do control: every swap we originate gets screened against an allow/block list
> before it's ever signed, at one single choke point in the code. Off by default, three modes
> — disabled, monitor, enforce — so an operator can stage a rollout and watch logs before
> flipping it on.
>
> And because a lot of execution today isn't a human tapping a button, we also built the
> agent side properly: pay-per-call pricing in USDC via x402 — a quote is a tenth of a cent,
> an executed swap is half a cent — so an autonomous agent with a wallet and no credit card
> can use this without a subscription.
>
> We're not going to tell you this is a compliance certification, because it isn't — it's a
> configurable, tested, auditable gate. That's on purpose: we'd rather you trust the parts we
> can prove than the parts we can't."

## 4. Demo flow (real bot commands, verified against `bot/handlers/quickswap.py`)

Run this live in Telegram (`t.me/SuwappuBot`) or the terminal (`terminal.suwappu.bot`):

1. `/start` — show onboarding, wallet creation happens here (custody model: user-controlled
   wallet, not a shared pool).
2. `/w` — show the wallet view; point out address + balances across chains.
3. `/b` — balance check, cross-chain view.
4. `/s 0.004 ETH base USDC base` — same-chain quote (usage string is literally in the handler
   docstring, `bot/handlers/quickswap.py:48`). Narrate: this triggers the parallel
   quote-discovery step across eligible routing integrations for this pair/chain.
5. `/s 100 USDC ETH` — cross-chain-capable form (`bot/handlers/quickswap.py:32`) to show the
   router picking a path without the user specifying chains explicitly.
6. `/p` — portfolio view, shows the result of the swap plus cross-chain aggregation.
7. **If time allows and audience is technical:** show the agent side — `curl -X POST
   https://api.suwappu.bot/v1/agent/register` live, then a `get_quote` call, to make the
   "agents pay per call" claim concrete instead of a slide bullet.

Do not demo `/snipe`, `/fee`, `/hw`, `/st`, `/m` — sniping and admin commands read as
speculative/insider tooling to a compliance-minded audience and are off-message for this room.

## 5. Anticipated hard questions and honest answers

**Q: "Is this custodial? Who holds the keys?"**
A: Users have self-custody wallets by default; execution can prepare an unsigned transaction
for the user to sign, or, under an explicit separate grant, use managed execution where
Suwappu's infrastructure signs. These are two different, clearly labeled authority levels
(Level 3 vs Level 4 in our docs) — we never let a tool name blur which one happened. Point to
`docs/product-status.md`'s authority ladder if pressed for detail.

**Q: "Is your compliance screening actually enforced in production, or is this a slide?"**
A: Honest answer: it's shipped and tested, but `COMPLIANCE_MODE` defaults to `disabled`. It's
infrastructure available to any deployment that wants a permissioned or monitored posture —
we are not currently claiming it's actively enforcing on our own production traffic. Don't
overstate this; say exactly that.

**Q: "What sanctions list are you using — is it maintained?"**
A: The bundled list is a curated seed set (OFAC-style, e.g., Tornado Cash), not an exhaustive
maintained feed. It's designed to be swapped for a commercial screening vendor (Chainalysis/
TRM-class) or a maintained feed via config — we ship the interface, not a claim that our seed
list alone is sufficient for production compliance.

**Q: "Do you support [stablecoin issuer's chain/token]?"**
A: Don't guess. Say: "check live — `GET /v1/agent/chains` or `list_chains` in our MCP gives
you the current answer, because that list changes and we don't want to give you a stale
number from a slide." Offer to check it live at the table if asked.

**Q: "Is there a token?"**
A: No token exists today. There's a published, pre-launch design for a fee-denominated points
program with a committed disinflationary emission schedule (season 1 scheduled Jul 1 – Oct 1,
2026) — happy to talk mechanism design, but don't imply it's live or investable.

**Q: "What happens if a router/bridge you route through gets exploited?"**
A: Not directly documented in what we reviewed for this brief — do not improvise a specific
answer. Say "let me get you the specific incident-response contact" and follow up, rather than
inventing a guarantee.

## 6. Two-week pre-event distribution checklist

Dates below are relative to today, **2026-08-26**, assuming the event is roughly two weeks
out (~2026-09-09) — confirm the exact date against the event page and shift these if it
differs.

| When | Action | Uses |
|---|---|---|
| **Day 0 (today, 8/26)** | Publish `execution-layer.md` long-form on Mirror/blog; post X thread version | `docs/marketing/crosspost/execution-layer.md` |
| **Day 0–1** | LinkedIn post: execution-layer version, tag it as "ahead of Stablecon DC" | `execution-layer.md` §C |
| **Day 3 (8/29)** | Publish `compliance-screening.md` long-form; this is the highest-relevance piece for a stablecoin audience — lead with it in any direct outreach to Stablecon attendees/sponsors | `compliance-screening.md` |
| **Day 4** | X thread + LinkedIn for compliance-screening | `compliance-screening.md` §B/§C |
| **Day 6 (9/1)** | Publish `agent-payments-x402.md` — timely if Stablecon has an agentic-commerce/x402 track | `agent-payments-x402.md` |
| **Day 7** | X thread + LinkedIn for agent-payments-x402 | `agent-payments-x402.md` §B/§C |
| **Day 9 (9/4)** | Publish `fee-denominated-points.md` — clearly labeled pre-TGE design piece; good for mechanism-design-curious attendees, do not push as primary | `fee-denominated-points.md` |
| **Day 10–12** | Reshare the strongest-performing piece (likely execution-layer or compliance-screening) with a direct "see us at Stablecon DC, [booth/table/talk info]" CTA | whichever crosspost got the most engagement |
| **Day 13 (day before)** | Post the 30-second pitch as a short-form video/text teaser; confirm live demo environment (test `/s` command end-to-end on testnet or small real amount before the event, per CLAUDE.md live-verification rule) | §2 of this doc |
| **Day of event** | Run the demo flow (§4) live at the table; do not rely on screenshots | §4 of this doc |
| **Day +1–3** | Follow-up post: what was demoed, any questions from the floor worth answering publicly (use §5 as a base, add real Q&A) | this doc, §5 |

## 7. What this brief could not verify

- **Exact Stablecon DC 2026 date/time/venue/booth assignment** — not present in the repo;
  confirm against the event's own page before finalizing travel/staffing/signage.
- **Whether compliance screening or Flashbots routing is enabled on Suwappu's own current
  production traffic** — `docs/product-status.md` doesn't state a current runtime value for
  `COMPLIANCE_MODE`; treat as "available, off by default" until confirmed live via
  `python3 scripts/status.py` or Railway env inspection, per repo convention.
- **Router/bridge incident-response process for a third-party exploit** — not found in the
  docs reviewed; flagged in §5 rather than guessed.

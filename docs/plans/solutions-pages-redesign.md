# Solutions pages — teardown + redesign brainstorm

**Status:** brainstorm, not yet approved
**Scope:** `showcase/src/app/solutions/` (currently one page, 200 lines)
**Date:** 2026-08-11

---

## 1. What we have today

One route, `/solutions`, rendering four stacked rows with `#anchors`:

| Row | Anchor | CTA |
|-----|--------|-----|
| Trading agents | `#trading` | Read the API docs |
| Portfolio agents | `#portfolio` | Portfolio rebalancer guide |
| Payment & commerce agents | `#payments` | Agentic Payments (x402) docs |
| Embedded wallets | `#wallets` | Managed wallets guide |

Layout: lead row full-width terminal, rows 2–4 alternating copy/code split.
Ends with one shared `mkt-cta` block.

---

## 2. Why it's not working

### 2.1 It's one page pretending to be four
The **footer already links to all four as if they were separate destinations**
(`/solutions#trading`, `#portfolio`, `#payments`, `#wallets`). The information
architecture wants pages; we gave it anchors. Consequences:

- Nothing to point a paid-search campaign at.
- One `<title>`/`<meta description>`/OG image for four different searches.
- Docs can't deep-link "here's the marketing context for x402."
- Can't put a distinct case study, FAQ, or price point on each.
- An anchor jump drops you mid-page with no header, no context, no nav.

### 2.2 It's buried, and it collides with `/agents`
`/solutions` is reachable only from a nested drawer group ("The case" →
`grpWhy`, alongside enterprise/compare/security in `NavMenuData.ts`), the
footer anchors, and `sitemap.ts`. Not a top-level nav item.

Worse: **`/agents` (343 lines) already does most of this page's job** —
"Onchain execution for AI agents: REST API, MCP & A2A for quotes, swaps,
managed wallets across 18 chains," and it goes further (perps, lending,
webhooks). `/enterprise` (220 lines) covers the same capabilities again for
procurement. `/solutions` (200 lines) is the thinnest of the three and the
least differentiated.

**This is the real question, ahead of layout:** what is `/solutions` *for*
when `/agents` exists? See §5.0.

### 2.3 It's a docs table of contents in marketing clothes
Every one of the four CTAs is "go read the docs." The page describes
**endpoints**, not outcomes. Missing entirely: why us vs. rolling your own,
what it costs, what breaks if you build it yourself, who else is using it,
how to talk to a human.

### 2.4 Segmented by endpoint, not by buyer
Three of the four rows ("trading agents," "portfolio agents," "payment
agents") are the *same reader* — an agent developer. The fourth (embedded
wallets) is a feature, not a solution. Meanwhile nothing on the page speaks
to a fund, a trading desk, a wallet app, or a Telegram community.

### 2.5 Zero proof
`stats.generated.json` carries real ammunition — **45 platform chains, 18 on
the agent API, 20 routers raced** — and the page uses exactly one of those
numbers, once. No latency, no uptime, no volume, no logos, no quotes.

### 2.6 Code as wallpaper
Four code blocks, none copyable, none runnable, responses hand-written as
comments. Code is the single strongest asset a dev-infra page owns and here
it is decoration.

### 2.7 The layout is the template it was trying to escape
Alternating left/right rows of equal visual weight is the most templated
pattern in B2B. The CSS file's own header comment admits the previous
version "read as a template rather than four distinct jobs" — and the fix
was rearranging the same template.

### 2.8 The no-em-dash style is being executed badly
The site is deliberately em-dash-free (`agents/page.tsx` has one em-dash in
343 lines, `enterprise/page.tsx` and `solutions/page.tsx` have zero). That's
a policy, not a bug. But on this page the substitution is mechanical, and
colons are carrying loads they can't:

> "Give a strategy: human-written or fully autonomous: the ability to quote
> and execute swaps…"

Two colons in one sentence, and the reader has to backtrack to find the
verb. Same pattern in three of the four bodies and in the hero lead.

**The fix is to recast the sentences, not to swap the punctuation back.**
Short sentences don't need em-dashes or colons. This is worth doing on its
own merits regardless of what we decide about structure.

---

## 3. What the market does (competitor scan)

The mature pattern is **thin hub → N dedicated use-case pages**, each on a
repeatable template. Segmentation is by **job-to-be-done**, not persona or
product SKU.

- **Stripe** — no hub, ~10 dedicated `/use-cases/*` pages (platforms,
  ecommerce, global businesses). Interactive product mockups per feature.
- **Circle** — dedicated `/use-case/payments`, `/use-case/trading-services`.
  Named exec testimonial quotes.
- **Crossmint** — `/solutions/*` (agentic-payments, fintech-and-stablecoins)
  kept deliberately separate from `/products/*`. Solution = job to be done,
  product = the tool. On-page FAQ doing objection handling.
- **Turnkey** — `/solutions/embedded-wallets`, `/company-wallets`,
  `/consumer-applications`. Resource carousel at page bottom to stay in-funnel.
- **Alchemy** — ~10 `/blockchain-for/{industry}` pages. Industry-vertical
  framing, visibly SEO-farmed and thin. **The failure mode to avoid.**
- **LI.FI, 0x** — effectively no marketing use-case pages; use cases live in
  docs. Weakest of the set, and closest to where we are now.

**Composite page anatomy across the good ones:** hero → logo/proof bar (high,
before any explanation) → problem framing → 3–5 feature blocks each with its
own visual → one flagship case study (challenge/solution/result) → security
section → CTA → FAQ.

**One place we should deviate:** the scan found code samples absent from
those marketing pages. Stripe and Circle sell to finance orgs; we sell to
people who will paste a curl into a terminal in the next sixty seconds.
Keep code — but make it *real* (copyable, runnable, with the actual
response), which is a stronger proof asset than a logo bar we don't have yet.

---

## 4. The proof problem (be honest)

The competitor template leans on logo bars, named case studies, and customer
quotes. **We have none of those.** Any redesign that budgets space for them
ships with grey placeholder boxes, which is worse than the current page.

Proof we *can* actually put on the page today:

1. **Live quote widget** — call `/v1/agent/quote` from the browser and render
   the real route, the real price, the routers raced, the response time.
   This is demo + proof + code sample in one artifact, and nobody in the
   competitive set has it.
2. **Real numbers from `stats.generated.json`** — 18 agent-API chains, 20
   routers raced, generated at build time so they can't go stale.
3. **Real API responses** in every code block, fetched or fixture-checked,
   not hand-typed comments.
4. **Build-vs-buy table** — what you'd have to write yourself to match one
   `client.swap()` call (router integrations, quote racing, nonce handling,
   key custody, per-chain gas, failure retries).
5. **Uptime / latency**, if `/status` has real history to cite.

---

## 5. Proposed structure

### 5.0 First: decide what `/solutions` is, vs `/agents` and `/enterprise`

Right now three pages describe the same API to three barely-different
audiences. Crossmint's split is the cleanest available answer and it maps
onto what we already have:

| Page | Answers | Reader arrives asking |
|------|---------|-----------------------|
| `/agents` | **the tool** — every capability, surface by surface (REST, MCP, A2A, x402, wallets, perps, lending, webhooks) | "what can this thing do?" |
| `/solutions/*` | **the job** — one outcome per page, end to end, with the code that gets there | "can it do *my* thing?" |
| `/enterprise` | **the risk** — custody boundaries, policy controls, procurement proof | "can I sign off on this?" |
| `/compare` | **the alternative** — vs bots, terminals, infra | "why not X?" |

If we accept that, `/solutions` stops trying to be a smaller `/agents` and
starts being the page a specific buyer lands on from a specific search or
ad. Everything in Option A follows from that. If we *don't* accept it, the
honest move is to **delete `/solutions` and fold its four rows into
`/agents`** — one strong page beats two weak ones.

### Option A — Hub + 4 spokes (recommended)

```
/solutions                         thin hub, self-select by job
/solutions/trading-agents
/solutions/portfolio-agents
/solutions/agent-payments          (x402 / micropayments)
/solutions/embedded-wallets
```

Footer links stop being anchors and become real hrefs — zero footer churn,
the labels already match. `/solutions` enters the primary nav.

**Spoke template:**

1. Hero — the job in one line + the single number that makes it credible
2. The four lines that do it — copyable code + **real** response
3. What you'd build instead — build-vs-buy table
4. How it works — flow diagram (reuse `summer-flow`)
5. Limits & safety — spend policy, slippage caps, allowed pairs, custody model
6. Proof — chains, routers, latency; live widget on the trading page
7. Where to go next — the specific guide + API reference, not "read the docs"
8. Dual CTA — get an API key / talk to us
9. FAQ — objection handling, 4–6 questions, unique per page

**Hub:** four cards, one line each, plus a "not a developer?" lane pointing at
the Telegram bot. No duplicated body copy.

### Option B — Two axes (Stripe-style, later)

Keep A's use-case spokes, add a persona axis once we have proof to fill it:
`/solutions/funds`, `/solutions/wallet-apps`, `/solutions/communities`.
**Not now** — persona pages with no case studies are the Alchemy failure mode.

### Option C — Fix in place
Rewrite copy, add proof, kill the colons, leave one page. Cheapest, keeps
every structural problem in §2.1–2.2. Only worth it as a stopgap.

### Option D — Delete it
Fold the four rows into `/agents`, redirect `/solutions` → `/agents`, retire
the footer anchors. Legitimate if we don't want to maintain five marketing
pages. Costs us the per-use-case ad/SEO landing surface permanently.

---

## 6. Open questions for the user

0. **Does `/solutions` survive at all** (§5.0)? If yes, it owns "the job" and
   `/agents` owns "the tool" — and `/agents` should lose its use-case framing.
   If no, Option D and we stop here.
1. **Who is this page actually for** — agent developers, funds/desks, or
   wallet apps? The current page assumes developer; the roadmap may not.
2. **Do we have any named user we can cite**, even anonymized ("a market-
   making desk running X/day")? That unlocks the case-study slot.
3. **Is the live quote widget acceptable** — it means the marketing site
   calls the production agent API on page load. Rate limits, key handling,
   and abuse need a decision.
4. **Should `/solutions` go in the primary nav**, and if so what gets
   demoted?
5. **i18n:** solutions copy is hardcoded English while the site ships
   en/es/fr/zh. Do spokes need translating, or is English-only acceptable
   for this section?

---

## 7. Suggested sequencing

- **Now (no approval needed):** recast the colon-stacked sentences (§2.8),
  wire real numbers from `stats.generated.json` into all four bodies.
- **Next:** split into hub + 4 spokes with the §5 template, footer hrefs
  de-anchored, unique metadata + OG image per spoke.
- **Then:** live quote widget on `/solutions/trading-agents`, build-vs-buy
  tables, FAQs.
- **Later:** persona pages, once there's a case study to put on them.

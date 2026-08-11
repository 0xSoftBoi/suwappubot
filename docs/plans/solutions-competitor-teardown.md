# How competitors and enterprise sites build solutions pages

Companion to `solutions-pages-redesign.md`. Verbatim section anatomy, not
paraphrase. Sources cited inline.

**Date:** 2026-08-11

---

## 1. 0x — the closest model to what we need

0x is our nearest structural competitor (swap API, cross-chain API, gasless
API) and has the most rigorous solutions architecture in the set.

**The split is the lesson.** Two parallel nav sections, different jobs:

| Nav section | Segmented by | Example |
|-------------|--------------|---------|
| **Products** | capability | Swap API (EVM), Swap API (Solana), Cross-Chain API, Gasless API, Trade Analytics API |
| **Solutions** | customer type | `/solution/cex`, `/solution/wallets`, `/solution/payments`, `/solution/stablecoins`, `/solution/rwas` |
| **Case Studies** | — | separate third nav item |

### `0x.org/solution/wallets` — section order, verbatim

> **H1: "Keep users swapping on your app and retain revenue."**

1. "Trusted by 60+ leading wallets and consumer apps" — logo bar, placed
   above any explanation (Phantom, Trust, Rainbow, MetaMask, Coinbase, Definitive)
2. "Competition is growing. Swaps are where you win or lose." — problem framing
3. "Powering swaps at scale" — metrics
4. "Features you can build"
5. "What makes it work"
6. "Built for apps that can't afford execution failures"
7. "Full execution control without the maintenance."
8. "Go deeper" — resources
9. "Ready to make your swap experience a competitive advantage?" — closing CTA

**CTAs:** "Talk to our team" / "Read the [X] case study" / "Explore the
documentation" — three lanes: sales, proof, self-serve.

**Note the headline.** It's not "Swap API for wallets." It's a *business
outcome for the reader* — retain revenue, beat your competitor. Our current
row headings ("Trading agents", "Portfolio agents") name a category, not an
outcome.

### The proof lesson: they lead with performance, not just logos

- `/solution/wallets`: **10M wallets, 1M+ pairs, <181ms, 2.5% revert rate,
  370+ liquidity sources**
- `/products/swap`: **99.92% uptime, 4.4% revert, <250ms, 521+ integrators**

Most of that is *self-measured infrastructure performance* — latency, revert
rate, uptime, source count. **That's proof we can generate without a single
customer logo.** It directly answers the §4 gap in the redesign doc.

### And code does appear — but on product pages, not solution pages

`0x.org/products/swap` H1: **"Powerful trades with a few lines of code"** —
carries code snippets, logos, and stats. The `/solution/*` pages don't.
So 0x's answer to our live disagreement is: **solutions pages sell the
outcome, product pages show the code.**

Sources: https://0x.org/ · https://0x.org/solution/wallets · https://0x.org/products/swap

---

## 2. LI.FI — same idea, less rigor

Per-audience pages at flat URLs (`li.fi/wallets`), not `/solutions/*`.

**`li.fi/wallets` H1: "Powering swaps and bridging for the wallets you love."**

Sections: "Let your wallet users trade across every chain" → "Core use-cases"
→ "Trusted by the best" → "Connect with us."

**Proof:** $80B+ volume, 100M+ transfers, 1000+ partners; logos include
Robinhood Wallet, MetaMask, Binance Web3 Wallet, Kraken, Tangem.
**CTAs:** "Sign in to Partner Portal", "Contact sales", "Contact our sales team."

Their nav mixes customer type (Wallets, Neobanks) and use case (Payments,
Agentic Commerce, RWA) at equal weight — **the muddle 0x avoids.** If we run
two axes, keep them visually separate the way 0x does.

Homepage H1: "Universal market access for digital assets."
`docs.li.fi/overview/use-cases` — **404**, contrary to the earlier scan.

Sources: https://li.fi/ · https://li.fi/wallets

---

## 3. The aggregators with nothing — where we currently sit

- **Enso** (`enso.build`) — H1 "Build your next [app/agent/protocol]". No
  `/solutions`. Closest equivalent is **Templates** (Uniswap Migrator,
  Crosschain Widget) + product tiles.
- **Rango** — no solutions pages. Nav is Widget / API-SDK / Documentation /
  **Playground**. The Playground is live API testing — the best interactive
  precedent among the aggregators.
- **Squid** — nav has Build / Connect / Institutions / Resources, but the
  taglines (Payments, Asset Issuers, Compliance) resolve to generic docs
  links; `squidrouter.com/institutions` 404s. UNVERIFIED as real pages.
  Embedded bridge widget at app.squidrouter.com linked from home.

These are the "use cases live in docs" cohort. It is where `/solutions` is
today, and none of them are winning on this surface.

---

## 4. Agent-payment rails

- **Skyfire** — H1 "Access. Identity. Checkout. The Agent Trust Stack." Nav
  item literally called "Use Case," segmented **by capability** (KYA/Access &
  Login, Checkout & Payments, Buy for Me). **Has a real embedded "Live
  Walkthrough"**: a 4-step interactive simulation (token request → login →
  checkout → live tx) plus a live merchant activity feed showing Live Nation
  and Bose. **This is the strongest precedent for the live-quote-widget idea
  in the entire scan** — and it's from the segment we compete in.
- **x402** — H1 "x402." No use-case pages; one long narrative homepage. No demo.
- **Payman AI** — H1 "We deploy AI agents that handle money." Segments **by
  customer type**: "Show me Payman for Banks" / "for Credit Unions." CTA is
  "Schedule Demo" — human-gated, no self-serve.

Sources: https://www.skyfire.xyz/ · https://www.x402.org/ · https://paymanai.com/

---

## 4b. Crypto infra — the "narrative funnel" cohort

**Crossmint `/solutions/agentic-payments`** — H1: *"The payments platform
built for AI agents."* Sub: *"Supercharge your agent with financial tools:
agent wallets, virtual cards, and stablecoin infrastructure — all in one
platform."*
~15 sections: hero + logo bar (Google, Visa, Mastercard, Circle — **rail
partners, not customers**) → "Turn agents into financial actors" → five
product blocks (agent wallets, stablecoin onramps, virtual cards, agentic
checkout, agentic credentials), each icon + copy + CTA + screenshot → 9-item
FAQ → footer CTA *"Agents need money. Set them up in minutes."*
No metrics. One named customer (lobster.cash), in passing. **No code.**

**Turnkey `/embedded-wallets`** (note: `/solutions/embedded-wallets` **404s**)
— H1: *"Embedded Wallets."* Sub: *"Securely integrate non-custodial wallets
into your app."*
Hero → 15+ customer logo carousel (Moonshot, Infinex, Polymarket, Alchemy) →
Wallet Creation → Wallet Experience → Custom Controls → Features Highlight →
2 case studies → 6-item FAQ → CTA. CTAs: "Contact Sales", "View Docs".
**No code.** Their "99.9% uptime / 50–100ms signing / 50–100x faster than MPC"
claims came from search snippets, **UNVERIFIED on-page**.

**Circle `/use-case/payments`** — H1: *"Put your payments on internet rails."*
10 sections ending in a 5-item FAQ. Metrics band verbatim: **"24/7
availability," "185+ countries," "$71.8B USDC in circulation," "<1s
settlement."** Case studies with real numbers — Acctual: *"over $25M in fast,
low-cost USDC invoices across 100+ countries."* Named quotes (Diego Yanez,
Alfred).
**Circle `/use-case/trading-services`** — H1: *"Always on liquidity for always
on markets."* Quotes from Bullish and Coinbase execs. Logo bar of exactly two.
**No code on either.**

**Alchemy — the cautionary tale.** Every `/blockchain-for/*` vertical page now
**redirects to `/overviews`**, a generic guides hub (H1: "Guides" / *"Where
crypto builders go when the quick answer isn't enough"*). They built the
SEO-farm vertical pages and then **killed the whole page type.** Confirmed on
two separate URLs. If we build thin per-segment pages with no real content,
this is where they end up.

Sources: https://www.crossmint.com/solutions/agentic-payments ·
https://www.turnkey.com/embedded-wallets · https://www.circle.com/use-case/payments ·
https://www.circle.com/use-case/trading-services · https://www.alchemy.com/blockchain-for/banking

---

## 4c. Enterprise SaaS — the long-form standard

**Stripe `/use-cases/platforms`** — H1: *"Build, monetize, and scale with
Stripe."* Sub cites **"More than 17,000 SaaS platforms."**
**~17 sections.** Every feature section is paired with a product mockup or
screenshot, never plain text. Four full case studies (Mindbody, Lightspeed,
Jobber, Thinkific) with named quotes and hard numbers — Thinkific: *"$100
million in payment volume ($29M last quarter)."* CTAs: "Contact sales" ×3,
"Start now" ×2, "Read the full story" per case study.
**There is no `/use-cases` index** — confirmed 404. Standalone pages, no hub.

**Twilio `/en-us/use-cases`** — H1: *"Twilio Solutions."* A hub that segments
**four ways at once**: use cases (5) → industries (9) → teams (5 personas) →
business size. Proof: *"Over 400,000 companies."* Ends in an **AI product-
recommendation quiz**.

**Twilio `/use-cases/alerts-and-notifications`** — the most useful page in
the entire scan, because it's the one dev-first example:
1. What you can do → 2. How to build (flowchart diagrams) → 3. **Products
comparison table** (Programmable Messaging vs SendGrid vs Voice, with pricing
rows) → 4. **"Send your first notifications in minutes" — code samples in 7
languages** → 5. Case studies with metrics (Vacasa *"3x more bookings"*, Resy
*">3% no-show rate"*) → 6. Why choose Twilio (*"99.9% uptime"*) → 7. Suite
screenshot → 8. AI quiz.
**Explicit per-unit pricing on the page**: *"$0.0083/SMS," "$19.95/mo,"
"$0.014/min."* The only page of the set with visible pricing — and the only
one with code.

**Plaid `/use-cases/lending/`** — H1: *"Consumer Lending."* Sub: *"Approve
more loans with predictive risk insights."* Only **6 sections** — the
shortest of the enterprise set. Key metrics: *"as little as 10 seconds,"
"up to 80% conversion."* Case studies: Zillow *"29% faster,"* Invitation
Homes *"60% shorter lead-to-lease,"* Possible *"10% higher approval rates."*
Ends in a **lead-gen form**, not a signup. `/use-cases/` index 404'd on fetch
— **UNVERIFIED**, not confirmed absent.

**The shared skeleton across all three:** hero (H1 + one-line value prop +
customer-count proof) → feature sections each paired with a screenshot or
diagram → named quote mid-page → case-study block with one hard metric per
logo → closing CTA band. None uses FAQ accordions (unlike all three crypto
pages, which do). All three include at least one interactive element.

Sources: https://stripe.com/use-cases/platforms · https://www.twilio.com/en-us/use-cases ·
https://www.twilio.com/en-us/use-cases/alerts-and-notifications · https://plaid.com/use-cases/lending/

---

## 5. What this changes in our plan

1. **Adopt the 0x split.** `/agents` = products, by capability. `/solutions/*`
   = by customer type. Keep them visually separate in nav — LI.FI's blended
   list is the anti-pattern.
2. **Headlines become outcomes.** "Keep users swapping on your app and retain
   revenue," not "Trading agents."
3. **Proof is performance, not logos.** Latency, revert rate, uptime, routers
   raced, chains — 0x's entire proof block is measurable from our own
   infrastructure. This removes the blocker in the redesign doc's §4.
4. **Code placement — the evidence splits by audience, not by page type.**
   Every crypto-infra solutions page checked (Crossmint, Turnkey, Circle ×2)
   has **zero** code; so do Stripe and Plaid. But **Twilio's dev-facing child
   page ships code in 7 languages**, and 0x puts code on `/products/swap`.
   The pattern isn't "solutions pages don't have code" — it's *"pages selling
   to buyers don't; pages selling to builders do."* Since our reader pastes
   curl into a terminal, we keep code. Awaiting the Vercel/Neon teardown to
   confirm.
5. **Add an FAQ.** All three crypto pages have one (Crossmint 9 items,
   Turnkey 6, Circle 5); none of the enterprise pages do. It's the category
   convention we're missing, and it's cheap objection-handling.
6. **Don't build thin segment pages.** Alchemy built the vertical-page farm
   and then redirected the entire page type to a guides hub. Four good pages
   beat twelve thin ones.
7. **The live quote widget has precedent** — Skyfire ships one, Rango has a
   Playground, Squid embeds its bridge. Not an untested idea.

---

## 6. Still open

Whether we segment `/solutions/*` by customer type (0x, Payman: wallets,
exchanges, funds, desks) or keep our current use-case framing (trading,
portfolio, payments, wallets). 0x's customer-type model is the more proven
one, and it also happens to be the axis our current page is *missing*.

Remaining teardowns in flight: Stripe/Twilio/Plaid, Crossmint/Turnkey/Circle/
Alchemy, Vercel/Anthropic/Neon/Supabase.

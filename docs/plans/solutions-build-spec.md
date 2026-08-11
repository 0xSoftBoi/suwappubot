# Solutions pages — build spec (authoritative)

Implements `solutions-pages-redesign.md` using the evidence in
`solutions-competitor-teardown.md` and the verified facts in
`solutions-proof-inventory.md`. **Read all three before building.**

## Decision: axis = job-to-be-done, four spokes

0x runs Products (capability) + Solutions (customer type). We already have
`/agents` as the capability page, so `/solutions/*` must be the other axis.
We are NOT using customer-type pages ("for wallets", "for funds") because
those demand named case studies, and we have zero — that combination is
exactly Alchemy's failure mode (they killed the whole page type). Job pages
we can prove today; customer-type pages come later, once there's a case study.

## Routes to create

```
/solutions                      hub (rewrite existing page.tsx)
/solutions/trading-agents
/solutions/portfolio-agents
/solutions/agent-payments
/solutions/embedded-wallets
```

Keep the existing route file at `showcase/src/app/solutions/page.tsx` as the
hub. Each spoke is its own directory with `page.tsx` + shared CSS module.

## HARD RULES — do not violate

1. **Invent no numbers.** The only numeric claims allowed are those in
   `src/data/stats.generated.json`, imported at build time. No uptime %, no
   volume, no latency figure, no integrator count, no TVL, no "$X routed."
   If a section wants a number you don't have, cut the section.
2. **`stats.platformChains` (45) is BANNED on agent-API pages.** The data
   file's own `notes` field says so. Agent pages use
   `stats.agentApiChains` (18).
3. **Routers are chain-gated.** Never write "every swap races all 20."
   Correct phrasing: "up to {routerCount} routing venues, depending on chain."
4. **No fabricated API examples.** Every endpoint, param, header, and
   response field must match `api-ts/src/routes/agent.ts`. We just fixed four
   wrong examples on this page; do not reintroduce any.
   - Portfolio: `GET /v1/agent/portfolio`, prices use `?symbols=`, response
     has `balances` and unformatted `total_usd`.
   - Wallets: `POST /v1/agent/wallets` takes **no body**; policies are
     `POST /v1/agent/wallet/policy` with `spending_limit`
     (`maxAmountWei`, `timeWindowSeconds`) or an **address** whitelist.
   - Payments: production returns **401**; 402 only when
     `AGENT_METERING_ENABLED='true'`, headers are `X-Payment-Required`
     (base64) and `Accept-Payment`.
5. **No customer logos, no testimonials, no case studies.** We have none.
   Do not add placeholder logo bars or fake quotes.
6. **Minimal code.** 12 of 14 competitor pages carry none. Each spoke gets
   **at most one** short, real snippet. The full code surface stays on
   `/agents`.
7. **Reuse the existing design vocabulary** in `globals.css`: `mkt-hero`,
   `mkt-cta`, `summer-flow`, `summer-code`, `sw-card-dark`, `summer-button`,
   `sw-kicker`, `summer-shell`, `summer-kicker`. Do not invent a new system.
8. **No em-dashes** — the site is deliberately em-dash-free. But do NOT
   substitute stacked colons either (the current page's bug). Recast into
   short sentences.

## Spoke page anatomy (same skeleton, all four)

1. **Hero** — outcome headline (not a category name) + one-line lead + the
   single credible number for that page.
2. **Problem framing** — one short section on what you'd otherwise carry.
3. **How it works** — the existing `summer-flow` 4-step strip.
4. **Build-vs-buy table** — "You'd have to build" vs "One API call."
   Content per page below.
5. **Limits & safety** — spend policy, slippage caps, custody boundary.
6. **One real code snippet** — verified against source.
7. **FAQ** — 4 to 6 questions. All three crypto competitors ship one; we
   don't. Objection handling, page-specific.
8. **Dual CTA** — "Get an API key" (`/docs/quick-start/overview`) and
   "Talk to us" (`/contact`), plus the page's specific docs guide.

## Per-page content

### /solutions/trading-agents
- H1: **Give your strategy an execution layer it doesn't have to maintain.**
- Lead: quote and execute swaps across {agentApiChains} chains from one key,
  inside spend and slippage limits you set.
- Number: `{agentApiChains}` chains.
- Build-vs-buy rows: router integrations · quote racing and comparison ·
  nonce and gas handling per chain · retry on revert · key custody.
- Snippet: the SDK example (`Suwappu`, `getQuote`, `swap`, status
  `"completed"`).
- Docs CTA: `/docs/guides/building-a-trading-bot`
- FAQ: self-custody option? · which chains? · how are routes chosen? ·
  what happens on a failed swap? · rate limits?

### /solutions/portfolio-agents
- H1: **Read the whole portfolio, decide, and rebalance in one session.**
- Lead: live prices and cross-chain balances your agent can reason over, with
  execution on the same key. No second data vendor to stitch in.
- Number: `{agentApiChains}` chains in one call.
- Build-vs-buy rows: per-chain balance indexing · price feed sourcing ·
  USD normalisation · drift detection · execution path.
- Snippet: the corrected portfolio + prices curl (`?symbols=`, `balances`).
- Docs CTA: `/docs/guides/portfolio-rebalancer`
- FAQ: which tokens are priced? · how fresh are balances? · does it support
  Solana? · can it read a wallet I don't custody?

### /solutions/agent-payments
- H1: **Charge agents per call, without an account signup flow.**
- Lead: bearer keys draw down prepaid credits. With metered payments enabled,
  a caller out of credits gets a signed HTTP 402 challenge instead of a
  result, settled in pathUSD on Tempo or USDC over x402.
- Number: `MPP_SWAP_PRICE_USD` default, about a tenth of a cent per swap.
- **Accuracy is critical here.** Describe 401 as today's behaviour and 402 as
  the metered path. Do not imply metering is on.
- Build-vs-buy rows: challenge issue and expiry · on-chain payment
  verification · replay protection · credit ledger · refund on failure.
- Snippet: the corrected bearer call + the 402 challenge shape.
- Docs CTA: `/docs/billing/agentic-payments`
- FAQ: is x402 live? (answer honestly: the flow ships behind a config flag) ·
  what's pathUSD? · how is replay prevented? · what happens mid-swap?

### /solutions/embedded-wallets
- H1: **Ship wallets your app never has to secure.**
- Lead: server-side wallets signed via Turnkey, with policies that cap spend
  per window or restrict which addresses they can reach.
- Number: policy types available (spending limit, address whitelist).
- Build-vs-buy rows: key generation and storage · signing infrastructure ·
  policy enforcement · recovery · audit trail.
- Snippet: create wallet + attach policy (both verified).
- Docs CTA: `/docs/guides/managed-wallets`
- FAQ: who holds the keys? · what if I want self-custody? · what policy types
  exist? · which chains? · how are policies enforced?

## Hub page (`/solutions`)

Thin. Do not restate the spoke bodies (that's Neon's mistake — their
`/use-cases` is a bare link list with no proof and no CTA; ours needs a
reason to exist).

- Hero: keep the existing framing, one line.
- Four cards: outcome headline + one line + link. Use `sw-card-dark` or the
  existing card vocabulary.
- One "not a developer?" lane pointing at the Telegram bot (`TELEGRAM_URL`).
- Single closing CTA.

## Wiring (do not skip)

1. `src/components/SummerFooter.tsx` lines 25-28 — replace the four
   `/solutions#anchor` hrefs with the real page hrefs. Labels already match.
2. `src/app/sitemap.ts` — add the four new routes, priority 0.7, monthly.
3. Per-page `metadata` export: unique `title` + `description`. No duplicated
   descriptions.
4. Keep `/solutions` where it is in `NavMenuData.ts`.

## Definition of done

- `npx tsc --noEmit -p tsconfig.json` clean.
- `bun run build` succeeds and lists all five `/solutions*` routes.
- No route 404s from the footer.
- Grep the new pages for banned strings: `platformChains`, `X-Payment:`,
  `?tokens=`, `wallet_id`, `"filled"`, `allowed_pairs`, `99.9`, `uptime`.
  All must be absent.

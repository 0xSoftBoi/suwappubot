# Primary documentation — Pumpcade, Zauth, Opal

Read from the projects' own doc trees, not press coverage. Quotes are verbatim from the URLs given.

---

## Pumpcade

**Doc pages actually read:** docs.cade.market (index), /beta-onboarding, /mechanics/parimutuel-markets, /mechanics/automatic-resolution, /mechanics/embedded-wallets, /usage/placing-predictions, /usage/creating-markets, /api-reference/openapi.json, /llms.txt

### What the docs specify

**Resolution pipeline** (`/mechanics/automatic-resolution`) — 4 steps: deadline → settler service fetches outcome data → objective rule applied → on-chain tx submitted. Three concrete data sources named: **Pump.fun API** (market cap), **Polymarket API** (YES odds), **Kalshi API** (YES odds).

**Fees & payout** (`/mechanics/parimutuel-markets`):
> "A 1% fee is taken from each prediction before it enters the pool"

Split: protocol 0.45%, creator 0.10%, streamer 0.45%. Payout formula `Principal + (Your Shares / Total Winning Shares) × Losing Pool`, with time-weighted share multipliers up to 1.0x for early predictors.

**Wallets** (`/mechanics/embedded-wallets`): Privy-managed embedded wallets tied to Phantom login. The browser extension requires an explicit signed sync message rather than direct key access; session signers
> "can only execute transactions you initiate."

**Beta scope** (`/beta-onboarding`, `/usage/creating-markets`): runs on **testnet USDC** —
> "It's testnet, so go wild"

— and requires a beta access code. Market types limited to token-market-cap and Polymarket/Kalshi-linked; one active market per token; durations fixed at 1/5/10/30 min.

### Gaps and contradictions

- **No documented dispute path, ambiguity handling, or API-failure fallback anywhere in the doc tree.** The public differentiator claim — "automatic, deterministic, verifiable resolution... eliminating counterparty risk and dispute windows" — has no documented contingency for stale, missing, or conflicting oracle data. The single claim the product is sold on is the one the docs don't specify.
- The docs admit a manual escape hatch: "Custom markets... require manual resolution by administrators."
- "Beta markets do not require predictions on both YES and NO sides" — the parimutuel math isn't yet running adversarially.
- ⚠️ **`/api-reference/openapi.json` is the generic Swagger "OpenAPI Plant Store" sample spec** — `title: "OpenAPI Plant Store"`, `version: 1.0.0`, endpoints `/plants`, `/plants/{id}`, `/plant/webhook`. Confirmed via two independent fetches (direct + r.jina.ai). It is a doc-generator placeholder that was never replaced. **There is no working public API reference.**

### Doc quality verdict

Real prose docs — 7 substantive Mintlify-style pages with an `llms.txt` index — and genuinely useful on UX mechanics (predictions, wallets, fee splits). No version stamps, changelog, or last-updated dates. But it is silent on the exact mechanism that differentiates the product, and ships a placeholder API reference, which undercuts "verifiable": there is no documented way to independently query resolution data.

**Bottom line:** the best-funded winner ($6M from Jump Crypto + Foundation Capital) is documented as running on testnet with an unreplaced sample API spec.

---

## Zauth

**Doc pages actually read:** zauth.inc/, /docs, /docs/vector, /docs/reposcan, /docs/provider-hub, /docs/database, /docs/treasury; zauthx402.com/ and /verification (both via r.jina.ai — direct fetches returned 402/403)

### What the docs specify

**Vector** (pentest scanner, `/docs/vector`): black-box, agent-driven, five test categories — auth (login/session/OAuth/JWT), injection (SQL/NoSQL/command/LDAP/template, including blind time/error/OOB), XSS (reflected/stored/DOM, executed via real `browser_evaluate` rather than pattern matching), IDOR/authorization, SSRF. Runs a "real Chromium browser instance" with network interception, "40+ regex patterns" plus AI reasoning. Marketing claim: finds "4.7× more real vulnerabilities than the next best scanner" — no benchmark or methodology published for that number.

**RepoScan** (`/docs/reposcan`): compares a repo against "millions of public repositories" for code originality. ZAUTH score 0–100 (0–30 High Risk / 31–70 Caution / 71–100 Lower Risk) combining "code originality, repository age, commit history, contributor diversity, and overall development effort." Notably candid hedge:
> "A high score doesn't guarantee safety."

**Database** (`/docs/database`) — **the one genuinely documented, live, free API found across all three projects**:
```
GET https://api.zauth.inc/api/directory
```
Returns x402 endpoint URL, method, network, pricing, success rate, uptime, and verification status, with query filters for network/status/verification/pagination.

**Treasury** (`/docs/treasury`):
> "Our platform is funded entirely by $ZAUTH token creator fees"

Creator fees auto-convert to USDC to fund operator infra — "no separate subscription or payment required." ⚠️ **No contract address is actually published on the page despite a "Contract Address" heading.** No supply, distribution, or vesting info.

### Gaps

- **The x402 "Provider Hub" verification methodology has no published spec.** `/verification` on zauthx402.com is a **login gate** ("Sign in to zauth" — Google/GitHub/Bitbucket/wallet/email), not a docs page. What little is documented reduces verification to control-proof: "you just deploy the SDK, and the act of deploying it proves you control the endpoint" — *not* a security or quality audit, despite marketing language implying vetting.
- No pricing table, changelog, or version numbers anywhere, despite a "flat pricing" claim on the homepage.

### Doc quality verdict

Mixed but the most substantive of this batch — a real `/docs` tree with 5 product sub-pages and one genuinely live, filterable, free API endpoint. But the flagship verification claim is marketing-only, its documentation page is an auth wall, and the token contract is missing from the page meant to disclose it.

---

## Opal — identity settled

Prior research could not identify this project or its token. **Settled: there is a real site and community, and the project has pivoted.**

**Opal Intelligence / "Scale Opal"** at **opalbot.gg** (confirmed via WebSearch + WebFetch + r.jina.ai) is now a gaming-behavioral-data-for-AI product, not a gaming companion:
> "The Behavioral Data Engine for AI"

> "Every session captures decisions, reaction patterns, and object tracking data: structured, labeled, and ready to license to AI labs, robotics companies, and game studios."

The site shows a **v0.4.1** version tag and a Chrome/WebGL runtime badge, indicating a shipped browser-based client rather than vaporware.

- **X @opalbotgg** — joined January 2026, original bio "the first ai agent you can queue up with," now pivoted to Scale Opal (gaming → data licensing).
- **Discord** discord.gg/opalbot — server "opalbot.gg", **715 members, 65 online** at time of check. Small but real and active, not abandoned.
- **No token found.** No contract address, tokenomics page, or whitepaper surfaced. This is notable: hackathon terms *required* a launched token with ≥10% team retention by Feb 25 2026.
- **No technical documentation exists** — no docs subdomain, no /docs path, no whitepaper. The homepage is a marketing tagline plus a build tag; deeper content sits behind Discord or a gated app.
- False positives ruled out: opal.gg / getopal.gg are unrelated, as are an open-source Opal moderation bot and a separate sneaker-cop bot on GitHub.

**Verdict:** pre-docs and early-stage, but real — and materially different from what it won for. The pivot from "AI teammate you queue up with" to "behavioral data engine you license to AI labs" is a full business-model change, from consumer product to data brokerage.

---

## Batch verdict

| | Real doc tree? | Working API ref? | Flagship claim specified? |
|---|---|---|---|
| Pumpcade | ✔ 7 pages | ✖ placeholder spec | ✖ no dispute/failure path |
| Zauth | ✔ 5 pages | ✔ one live endpoint | ✖ verification = control-proof only |
| Opal | ✖ none | ✖ | n/a — pivoted business model |

The pattern: each project documents its *mechanics* competently and leaves its *differentiating claim* unspecified.

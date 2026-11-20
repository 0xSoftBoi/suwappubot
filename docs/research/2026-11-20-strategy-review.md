# Suwappu: what's missing, and should you pivot to AI?

*[V] = verified (repo, live Railway data, DefiLlama). [I] = inference. The prod database was never queried, so every call below is provisional until it is.*

## 1. Bottom line
**Don't pivot "fully" to AI.** You are already mostly an AI and agent project, and that side has no logged demand either. What's missing is measured demand, one buyer, and distribution, not more AI. Run a 1-hour prod SQL pass first. Then bet on a single narrow agent wedge with a 30-day kill date, and keep Telegram running in maintenance mode.

## 2. What you're missing (ranked)
1. **Any usage number.** [V] `docs/DATAROOM.md:264`: "No traction metrics in code." There is no analytics SDK, the `/v1/web/event` endpoint has no reporting, and prod Postgres (Railway service 83d5ff11) has never been queried.
2. **A paying customer.** [V] Contracts are Base Sepolia testnet only. The fee tiers exist only as config. Billing traffic is about 6 requests a week. [I] Revenue is about $0.
3. **Evidence that agents use the agent API.** [V] In a 501-request api-ts sample: 0 swap quote or execute calls, 6 `/mcp` calls, 4 x402 discovery fetches. 33% came from one GCP poller hitting the agent card. [V] `INCIDENT-managed-wallet-outage.md`: managed `/v1/agent/swap/execute` could never succeed, and exactly one attempt was logged in the whole retained window. Nobody noticed.
4. **Distribution.** [V] There is no referral, KOL or outreach loop, only the showcase site and agent-registry listings. [V/I] The bot-market winners (Axiom, GMGN, fomo) won on referral and KOL loops plus capital, not on routing.
5. **A differentiated wedge.** [V] The hosted MCP (23 tools) re-wraps Li.Fi and Jupiter. [V, secondary sources] LI.FI (58-chain hosted MCP), 0x (agent MCP, launched 2026-04-13) and Coinbase AgentKit/Agentic Wallets give the same thing away free.
6. **Focus.** [V] About 15 surfaces, 23 prod Railway services (10 of them side projects), 30 plan files (not ~40), 32 open PRs and 68 open issues. 24% of commit subjects are harness/journal/evolve. 0 commit subjects in 90 days name Telegram.
7. **A working, monitored money path.** [V] Managed execution was broken in prod from launch. Contracts are unaudited and owned by one testnet key. The deploy Action is broken by billing. Nothing alerts on zero-volume days.

## 3. Pivot to AI? No. Pick one narrow version.
- **The full pivot is mostly a rename.** [V] Agent REST is 5.5k lines, MCP 1.8k, plus A2A, x402, Arbiter and the harness. That code shows about zero use.
- **The agent-commerce market is tiny.** [V, secondary sources] Real x402 commerce is about $28k/day, and ~1% of wallets account for ~90% of it. Over the last 30 days, the DefiLlama "AI Agents" fee category earned $2.0M, and one outlier earned $1.67M of that.
- **Staying a multi-chain Telegram bot doesn't work either.** [V, DefiLlama 2026-11-20] The Telegram-bot category earned $4.4M in fees over 30 days, and its leaders are down 50–64% month on month (Photon about -99% from peak). Web and mobile terminals earned $35.5M. [I] A $0 solo founder cannot fund the playbook that wins there: one hot chain, speed, and paid referral and KOL loops.
- **The wedge** [I]: **hosted, policy-bounded execution for agents that shouldn't hold keys.**
  - What it does: a server-side layer that enforces spend caps, token and chain allowlists, simulation and a risk screen, then executes from a managed wallet.
  - Why it's sellable: incumbents don't sell this as a hosted guarantee.
  - What already exists: keys, scopes, metering and x402/credits billing.
- **The alternative wedge** is Arbiter Pay (attested pay-on-delivery for x402). Choose one, not both.

## 4. Kill or freeze list
1. **Railway side services:** ghostcatcher ×3, signal-lab ×2, pump-onchain-ingest ×2, holder-census, primitives-ui, testnet-runner, the extra marketdata copies, and dev duplicates you don't need.
2. **The harness:** stop `/evolve`, journal commits and design-iterate loops.
3. **Token work:** freeze SUWP (supply is uncapped [V]), staking, bonds, membership and OFT.
4. **Plans:** archive the Robinhood chain work (6 files), Starknet neobank/`NEOBANK_ROADMAP.md`, Hyperliquid gateway, BTCfi, ERC-8004 (plans only, no code [V]), ETHGlobal passport, AEGIS and WebMCP. Keep at most 3 plan files.
5. **Dormant code:** `flet-curve/` (104k LOC), `mobile/`, `mpc-signer/`, `nft/`, `art/`, `extension/`, `hackathon/`, `contracts-hackathon/`.
6. **Duplicate frontend:** keep the terminal or the webapp, not both. Freeze showcase polish.
7. **Agent sprawl:** keep A2A to the static card. Make the CFO "agent" internal tooling; it is a deterministic forecaster [V]. Freeze the NEAR side tracks.
8. **Arbiter:** freeze reputation, forensics and contract-v3. If policy-gated execution is the wedge, freeze Arbiter Pay too.
9. **Telegram:** no new features. Keep it running.

## 5. 30/60/90-day plan
**Days 1–3: measure**
- Read-only SQL on prod: total users, users active in the last 7/30/90 days, successful swaps and USD volume by surface (bot, terminal, agent), and fee rows.
- Check the fee wallet on-chain with Blockscout `get_token_transfers_by_address`. Check Stripe for subscriptions and charges.
- Count distinct non-founder API keys with more than 10 calls in 30 days, excluding the 160.79.x range.
- **Gate:** if Telegram or the terminal shows at least 50 weekly swappers, or at least $1k/month in on-chain-verified fees, switch to **stay_dex_bot**: terminal first, one chain, a referral loop, agent work frozen.

**Week 1: cut and instrument**
- Execute the kill list. Target: Railway bill and open-PR count down by half or more.
- Set up a weekly 5-number dashboard: signups, first swap or call, repeat use, active external API keys, dollars collected.

**Days 7–30: build the wedge and sell it**
- Prove managed execution end to end with a small mainnet swap on Base. Turnkey must be configured in prod. Add alerts on execute failures.
- Write a one-page offer with a price, for example a setup fee plus 0.3–0.5% per execution or an x402 per-call price.
- Send 20–50 outreach messages to agent builders (ElizaOS and Virtuals sellers, AgentKit and GOAT users, trading-agent teams). Aim for at least 10 calls.
- **Day-30 gate:** at least 1 paid pilot or a priced LOI from an external party. Zero means **kill_or_pause** or sell it as services. Do not add surface.

**Days 30–60: deliver**
- Hand-deliver the pilots.
- Publish one case study and one open-source agent template that uses the gate. That template is your distribution.

**Days 60–90: decide**
- **Gate:** 2+ paying customers or $2k+ collected means double down: self-serve onboarding, then a second chain only if a customer asks for it.
- Otherwise: open-source the policy engine, wind down hosting, and take integration or consulting work, or pause.

## 6. Where the judges disagreed
All three judges chose `ai_first_narrow_wedge`, with low confidence (0.45–0.55), because the database was never queried. They differed on:
- **The bot-traction threshold:** $500/month (solo-operator) vs $1k/month (skeptic, investor) in fees, alongside 50 weekly swappers.
- **Outreach size:** 20 attempts aiming for 10 conversations (skeptic) vs 50 messages aiming for 15 calls (solo-operator, investor).
- **Arbiter Pay:** the skeptic says freeze it if the policy gate is chosen. The solo-operator keeps a probe at one day a week with a day-45 kill. The investor applies its own week-4 kill rule.
- **How to make money:** the solo-operator leads with paid integration fees ($500–2k setup). The investor targets free integration plus a $99/month or x402 tier, then a raise or accelerator (CSX, Base grants, YC) in weeks 8–12. The skeptic sets no fundraising path.
- **The skeptic's open risk:** the agent market may simply be too small. In that case kill_or_pause is the honest answer, not a smaller AI bet.

Key files:
- `/home/user/suwappubot/docs/DATAROOM.md`
- `/home/user/suwappubot/INCIDENT-managed-wallet-outage.md`
- `/home/user/suwappubot/docs/plans/arbiter-improve-or-pivot.md`
- `/home/user/suwappubot/railway.services.json`
- `/home/user/suwappubot/docs/product-status.md`

---

## Appendix: evidence

### traction
USAGE & REVENUE EVIDENCE: Suwappu (checked 2026-11-20)

Bottom line: I found no evidence of real users, swap volume, revenue, or any paying external customer. The repo says so itself, and the live traffic I could see looks like bots, monitors and the founder's own tooling, not customers. This does not prove usage is zero: the production database was never queried.

VERIFIED: docs
- /home/user/suwappubot/docs/DATAROOM.md §10, item 5: "No traction metrics in code — no users/volume/TVL claims exist in the repo; supply real numbers separately, don't infer them."
- Same section: mainnet is not deployed. All contracts are on Base Sepolia testnet and still owned by a standalone testnet key.
- The SUWP emissions policy is drafted but not enforced.
- The fee schedule exists only as config: Free 1.0%, Pro 0.5% at $9.99, Premium 0.3% at $29.99, Enterprise 0.1% at $99.99 (DATAROOM §7). No doc anywhere records fee income or subscribers.
- /home/user/suwappubot/docs/plans/arbiter-improve-or-pivot.md: "The tech is real; demand is unproven." It also calls the founder a "solo $0 founder".
- docs/incidents/ holds only README.md and TEMPLATE.md. No incidents have ever been logged, which fits a service no one depends on.
- Analytics: no PostHog, Mixpanel, Amplitude, Plausible or Umami SDK in the bot, api-ts or webapp code. There is a homegrown `/v1/web/event` endpoint, but nothing reports on it. Product analytics are effectively missing.

VERIFIED: live Railway data (project "suwappu", id 428680a3, production)
- api-ts, last 7 days: 18,060 requests (15,558 2xx, 2,495 4xx, 7 5xx), roughly 2.5k a day. That sounds healthy, but a sample of 501 requests (2026-11-20, 21:04–23:02 UTC) breaks down like this:
  - 33% are `/.well-known/agent-card.json`, all from one GCP IP (34.83.14.80, python-httpx). That is a single poller or monitor.
  - 27% are `/v1/autopilot*` dashboard polling. 29% of all requests carried a generic headless Linux Chrome user agent and 29% carried "node".
  - Many requests came from 160.79.106.x (about 120 of 501). I believe this range belongs to Anthropic, so this is likely the founder's own Claude/agent sessions. That is an inference I did not confirm.
  - Agent registry crawlers: AgenstryBot (9 requests), agent-tools.cloud-a2a (2), PublicCryptoResearch (6).
  - `/mcp`: 6 requests. x402 and payment manifests: 4 requests, all discovery fetches. `/billing/*`: 6 requests.
  - Zero requests to any swap quote or execute route. `/public/swap/chains` was read 12 times.
- python-api (Telegram bot plus legacy API), last 7 days: 107 requests in total. `/telegram/webhook` got 2. The bot may run in polling mode (USE_WEBHOOK defaults to false), so the webhook count alone doesn't measure bot traffic.
- python-api logs since 2026-10-21 filtered for swap / tx_hash / "/start": only boot banners ("Swap aggregators ready…"). No swap execution lines.
- python-worker logs, same window, filtered for executed / completed swaps and fee sweeps: no matches. Caveat: I guessed these log strings and did not check them against fee_sweeper.py or swap_engine.py, so the empty result is suggestive, not conclusive.
- terminal, last 7 days: 3,168 requests, 47% of them 4xx. That looks like scanners plus a few real hits. Not broken down further.
- Railway project sprawl: the suwappu project runs 23 services, including ghostcatcher exports ×3, signal-lab ×2, pump-onchain-ingest ×2, market-data ×4, a relayer and a bridge. The account holds about 37 other projects. Infra cost and attention are spread thin.
- Supabase: only two INACTIVE projects (Intelligent Meeting Scheduler, wallet-tracker), neither related to Suwappu. The real database is Railway Postgres (service 83d5ff11). I did not query it, because that needs DATABASE_URL and I chose not to pull secrets.

INFERENCE
- About 2.5k api-ts requests a day is almost all machine traffic: monitors, directory crawlers and the founder's own agents. I saw no sign of an external developer making repeated authenticated agent-API calls.
- An agent registry crawling the agent card shows the project is listed. It does not show demand.
- Revenue is most likely $0, with no evidence of any paying external customer. Supporting signs: testnet-only contracts, no billing traffic beyond a few requests, no incidents, no metrics.

UNKNOWN, AND HOW TO MEASURE IT (read-only, about an hour)
1. Users and active users. Railway Postgres: count all users, then users active in the last 30 and 90 days, from the users table and its last-activity column.
2. Swap count and volume. Swaps or transactions table: count and total USD for status = success over the last 30 and 90 days, split by chain and by source (bot, terminal, agent).
3. Fee revenue. The fee-collection and fee-sweeper tables, cross-checked on-chain against the fee wallet with the Blockscout MCP (get_token_transfers_by_address). That gives ground truth no doc can fake.
4. Agent-API usage. Count distinct API keys or enterprise orgs that made more than N calls in the last 30 days, excluding the founder's keys and the 160.79.x range. Railway http logs filtered by path (`/v1/agent/*`, `/mcp`), grouped by key or IP.
5. Paying customers. Stripe (MCP available: list subscriptions and charges), x402 settlement receipts and billing_credits rows from external orgs.
6. Instrument it. Point `/v1/web/event` or a real analytics SDK at a weekly dashboard of signups, first swap, repeat swap, API keys with traffic, and dollars collected. Today you can't answer "do we have users?" without hand-written SQL.

What this means for "pivot to AI fully?": the live evidence shows no traction on either the DEX side or the AI/agent side. The agent endpoints get crawled but not used, so a pivot would not be moving away from proven demand on one side toward proven demand on the other. The biggest missing piece is measurement and real distribution, not another feature line.

### surface
## Suwappu focus audit (2026-11-20)

**Limits on the data.** The clone is shallow: visible history starts 2026-08-15, so "last 90 days" covers almost everything (545 of 563 commits). I had no access to the prod database, analytics, or Dependabot alerts (the API returned 403). The repo itself admits there is no usage data: `docs/DATAROOM.md:264` says "No traction metrics in code — no users/volume/TVL claims exist in the repo." Every user claim below is therefore an inference unless marked **[fact]**.

### Inventory (LOC = first-party source lines; c90 = commits touching the dir)

| Line | Status | LOC | c90 | Users? |
|---|---|---|---|---|
| Telegram bot (`bot/`, `api/`) | Live (python-api healthy, webhook, 7 background tasks alive) **[fact, curl]** | 148k + 16k | 38 + 5 | Unknown. No commit subject says "telegram" in 90d |
| api-ts agent REST, MCP, A2A, x402 | Hosted, health ok **[fact]** | 72k | 56 | Probably near zero (see the incident below) |
| Terminal / Mini App | Live | 50k | 14 | Unknown |
| Webapp | Live, overlaps the terminal | 48k | 12 | Unknown |
| Showcase site | Live | 33k | 41 | Visitors only |
| SDK + mcp-server (`packages/`) | Published on npm | 12k | 5 | Unknown |
| Arbiter (`near/arbiter-*`, 9 crates) | Testnet only, not mainnet | 2.2k | 15 dir / 39 subject mentions | None. Its own doc says "demand unproven" (`docs/plans/arbiter-improve-or-pivot.md`) |
| Token, staking, bonds, membership (`contracts/`) | Base Sepolia testnet only. SUWP supply is uncapped (`DATAROOM.md` §10) | ~10k own (131k counting vendored `lib/`) | 25 | None |
| `flet-curve/` | Unclear purpose. 333 of its files are vendored | 104k | 1 | None |
| `mpc-signer/` | Source only | 8.6k | 0 | None |
| `mobile/` | Source only | 1.3k | 0 | None |
| `extension/`, `nft/`, `art/`, `hackathon/`, `contracts-hackathon/` | Source only or dormant | ~11k | 1–5 each | None |
| Starknet BTC neobank, Robinhood chain (6 plan files), Hyperliquid, ETHGlobal, AEGIS | Mostly plans | small | 0–8 | None |

### Where the effort went vs where users could be
- **The harness is the biggest single theme.** 131 of 546 commit subjects (24%) are harness/journal/evolve, and `.claude/harness/journal` was touched 199 times. Most of those commits are auto-generated, but they show where attention went: the AI tooling working on itself.
- **Agent-economy work comes next.** About 64 subjects mention MCP/agent/x402, 39 mention Arbiter, 12 mention the CFO agent. That is roughly 115 commits on surfaces with no evidence of users.
- **Docs, plans and marketing.** The `docs` dir has 61 commits, the showcase 41, and there are 30 plan files in `docs/plans/`.
- **The two surfaces most likely to have real users get the least.** Telegram has 0 commit subjects naming it, and the terminal plus webapp have 26 commits between them.
- **Spread.** There are four separate consumer frontends (Telegram, terminal, webapp, showcase), plus an extension and a mobile app, plus three agent protocols. That is about 15 surfaces for one unpaid founder.

### Strongest evidence on demand
`INCIDENT-managed-wallet-outage.md` **[fact, from prod logs]**:
- Managed-wallet swap execution (`/v1/agent/swap/execute`) could never succeed. It failed on a missing import, and wallet creation failed because Turnkey was not configured in prod.
- Over the whole retained log window, python-api recorded exactly **one** `execute-swap` attempt (2026-09-19).
- **Inference:** the main fund-moving agent endpoint was broken for its whole life and nobody outside noticed. The fix (PR #1017) is now merged **[fact]**, but the incident says agent-side demand is about zero.

### Maintenance burden
- **Railway:** 32 service instances, 17 in prod and 15 in dev (`railway.services.json`). Ten of them are side projects: ghostcatcher ×3, signal-lab ×2, pump-onchain-ingest ×2, holder-census, primitives-ui and testnet-runner. There are also 3 separate marketdata services and a relayer.
- **GitHub backlog:** 32 open PRs and 68 open issues **[fact, REST]**. About 20 commits in 90d were dependency bumps.
- **Process:** the Railway deploy GitHub Action is broken by billing (CLAUDE.md). Provenance exceptions are documented (`docs/product-status.md`).
- **Contracts:** need an audit and a multisig before mainnet, and are still owned by a standalone testnet key.

### What you're missing
1. **Measurement.** There is no number for weekly active swappers, swap volume or fee revenue. Every strategic question, AI pivot included, is being decided blind. Fix this first: one SQL pass on prod Postgres for users, swaps and fees over 7/30/90 days, by surface.
2. **A paying counterparty.** The Arbiter doc's own kill rule (no integration or paid verification by week 4) is the right template, but it has not been applied to anything else.
3. **Focus.** Effort goes to whatever is novel (TEE escrow, neobank, NFTs, hackathons) instead of the one place retail users might exist.
4. **Distribution.** The repo has no marketing or acquisition loop beyond the showcase site.

### Should you pivot to AI fully?
**No. The question is framed wrong.** The repo is already mostly AI and agent work: MCP, A2A, x402, Arbiter, the CFO agent, and a self-evolving harness. That work has produced no users so far. More AI is not what's missing; demand evidence and focus are. Going "fully AI" would cut the only surfaces that plausibly have humans on them (Telegram, terminal) to double down on the one with logged evidence of zero use.

Decision rule, to run after the SQL pass:
- **The Telegram bot or terminal has real weekly swappers and fee revenue:** focus there for 90 days. Freeze all agent and Arbiter work except the existing MCP/REST.
  - Be aware the Telegram trading-bot market is crowded (Banana Gun, Maestro, Trojan). That comes from general knowledge, not checked in this audit.
- **Effectively zero everywhere:** the consumer DEX bot has failed to find users.
  - Run exactly one AI-infra bet, Arbiter Pay (x402 pay-on-delivery), on its own 4-week kill criterion.
  - Keep the existing swap API as its rails.
  - Do not start new chains or products.

### Kill or freeze list (in priority order)
1. **Railway side services:** ghostcatcher ×3, signal-lab ×2, pump-onchain-ingest ×2, holder-census, primitives-ui, testnet-runner. Also cut the dev duplicates you don't need.
2. **Dormant code:** `flet-curve/` (104k LOC), `mobile/`, `mpc-signer/`, `nft/`, `art/`, `hackathon/`, `contracts-hackathon/`, `extension/`.
3. **Plans to archive:** Robinhood chain (6 files), the Starknet BTC neobank and `NEOBANK_ROADMAP.md`, Hyperliquid gateway, ETHGlobal and AEGIS goals. Of the 30 files in `docs/plans/`, keep at most 3.
4. **Token work:** SUWP, staking, bonds and the OFT contracts. Freeze tokenomics until there are users; an uncapped testnet token with no users is a liability.
5. **Duplicate app:** keep either the webapp or the terminal, not both.
6. **The self-improving harness:** stop `/evolve` and journal commits. They take about 24% of commit volume and serve no user.
7. **Arbiter outside the Arbiter Pay slice:** freeze the reputation, forensics and contract-v3 crates.

Key files:
- `/home/user/suwappubot/INCIDENT-managed-wallet-outage.md`
- `/home/user/suwappubot/docs/DATAROOM.md` (§10)
- `/home/user/suwappubot/docs/product-status.md`
- `/home/user/suwappubot/docs/plans/arbiter-improve-or-pivot.md`
- `/home/user/suwappubot/railway.services.json`

### ai-assets
AI/agent asset audit for Suwappu, as of 2026-11-20. Each point is marked [V] when I verified it live or in code, or [I] when it is my inference.

**What exists, how real it is, and how it differs from competitors**

1. **Hosted MCP** (`api-ts/src/routes/mcp.ts`, 1,814 lines; `mcpTools.ts`)
   - [V] It is live. `POST https://api.suwappu.bot/mcp` with `tools/list` returns 23 tools: get_quote, execute_swap, simulate_swap, portfolio, predict_* (Polymarket), perps_* (Hyperliquid), lend_* (Morpho), list_wallet_policies, near_*.
   - [V] `execute_swap` only prepares an unsigned transaction (level 3 in `docs/product-status.md`). It does not execute.
   - Differentiation is low to medium. Quoting comes from Li.Fi and Jupiter, and LiFi, 1inch, Jupiter and GOAT ship their own MCPs [I]. The one real edge is breadth: swap, perps, predictions and lending under one schema. `docs/plans/agent-leading-edge-roadmap.md` claims Bankr is the only close competitor. That is the repo's own claim and is old (July 2026).
2. **`@suwappu/mcp-server`** (stdio bridge, v0.6.0, Smithery config)
   - [V] 197 npm downloads in the last 30 days. `@suwappu/sdk` had 18.
   - [I] At that level, CI, mirrors and the founder's own installs could account for most of it. Treat it as no proven external demand.
3. **Agent REST** (`api-ts/src/routes/agent.ts`, 5,573 lines)
   - [V] It is the largest asset. It has self-serve API keys, scopes (`requireScope.ts`), tiers, rate limits, `recordUsage.ts`, prepare vs managed `/swap/execute`, and OpenAPI.
   - [V] `docs/DATAROOM.md:264` says "No traction metrics in code". I could not query the prod DB for API-key or usage counts. That is the first number to pull.
4. **A2A** (`a2a.ts`; agent card at `/.well-known/agent.json`)
   - [V] Live, but quote and discovery only. The card itself says "A2A does not execute swaps."
   - [I] A2A adoption among real counterparties is near zero industry-wide. It is a checkbox, not a moat.
5. **x402 / MPP / spend permissions** (`middleware/x402Payment.ts`, `x402Verify.ts`, `mppAuth.ts`, `trustedSpend.ts`, `lib/spendPermission.ts`, `billing.ts`)
   - [V] Real code: tier, then credits, then on-chain settle, then a 402 challenge, plus Base Spend Permissions for recurring billing.
   - Commodity rails. Coinbase owns x402, and its facilitator and AgentKit include payments [I].
   - `arbiter-improve-or-pivot.md` cites about $28k a day of real x402 volume industry-wide, with half artificial (UNVERIFIED). In other words the whole market is tiny.
6. **Policy engine and spend caps** (wallet policies exposed via MCP; `aegisScan.ts`; `lib/intercepta.ts`; the `docs/plans/aegis-fork-extend.md` skill)
   - [V] Code exists. Intercepta risk screening is "code-complete" per `ethglobal-tokyo2026-agent-passport.md:99`, which is not the same as live.
   - [I] This is the most defensible piece. A server-side policy gate in front of level-4 managed execution is what AgentKit, GOAT and LiFi don't sell as a hosted guarantee.
7. **ERC-8004 / agent passport**
   - [V] There is no ERC-8004 implementation. Grep finds it only in plans (`agent-leading-edge-roadmap.md`, `btcfi-expansion-plan.md`, `arbiter-improve-or-pivot.md`).
   - [V] The ETHGlobal passport (World ID AgentKit plus an ENSv2 subname on Sepolia) is live-verified on testnet only (same plan, lines 6–7 and 113–121). It is hackathon scope.
8. **Arbiter** (TEE-attested escrow; `ARBITER.md`; `routes/arbiter.ts` is 68 lines)
   - [V] Testnet and dry-run only. Not on mainnet, and the audit is open (`docs/arbiter-production.md` per the plan).
   - The repo's own verdict: "tech real; demand unproven." That is the only genuinely novel technology here, and it has zero paying counterparties.
9. **CFO agent** (`api-ts/src/lib/cfoOperatingSystem.ts`, 279 lines)
   - [V] A deterministic cash-scenario forecaster (downside, base, upside), not an LLM agent. It is internal tooling, not a product.
10. **Skills and capabilities**
    - [V] `skills/suwappu/SKILL.md` is packaging. `capabilities.yaml` is an env-gate manifest, not an AI asset.
11. **LLM in the bot**
    - [V] `bot/services/nl_intent_service.py` and `llm_usage.py` add natural-language intent parsing to Telegram. That is table stakes; Bankr and every TG bot have it [I].
12. **WebMCP** (`docs/webmcp*.md`, `docs/plans/webmcp-improvements.md`)
    - [I] Docs and submission-stage work. I did not verify it as a live product surface.

**What you are missing (this is the honest answer)**

- **Usage data, not features.** There are 23 tools, 4 protocols and around 10 side lines, but no number in the repo for active agents, API calls, swap volume or revenue (DATAROOM:264). Every pivot decision without that number is guesswork. Pull from prod: distinct API keys with at least one call in the last 30 days, x402 settlements, managed-execution volume, and Telegram 30-day active users.
- **A buyer.** A solo founder with $0 runs ~40 plan files (Robinhood, Starknet neobank, NEAR, NFTs, BTCfi, perps, Arbiter). The pattern is building for hackathon bounties and imagined parity, not for one named customer.
- **A reason to choose you over free SDKs.** A builder can `npm i` GOAT, AgentKit or the LiFi MCP and self-custody for free. Your hosted MCP mostly re-wraps LiFi and Jupiter. "Breadth" is a weak wedge because each venue already ships its own MCP.

**Should you pivot fully to AI? No, not as framed.**

- You are already an agent-infrastructure company by code volume: api-ts agent, MCP, A2A, x402 and policy are about 10k lines in the routes alone. A "pivot" would mostly be renaming. The real question is focus, and the evidence says demand has not shown up on the agent side either: 197 MCP downloads and an A2A surface with no execution.
- The agent-commerce market is thin (the repo's own research), and Coinbase, Stripe/Bridge and the DEX aggregators own the commodity layers [I]. A solo founder can't win "generic crypto agent toolkit."

**If you do go agent-only, concretely**

- **Keep** (reusable core):
  - Agent REST with keys, scopes and metering.
  - The policy and spend-cap gate in front of managed execution, sold as "hosted, policy-bounded execution for agents that shouldn't hold keys."
  - x402 and credits billing.
  - The hosted MCP as a thin distribution layer over that gate.
  - Arbiter's attested verifier, only if pursued as Arbiter Pay and only under the plan's own week-4 kill criterion.
- **Freeze or throw away:**
  - A2A beyond the card.
  - The ERC-8004 plans.
  - The ENS/World ID passport (a hackathon artifact).
  - The CFO "agent" (rename it internal).
  - WebMCP, NFTs, the Starknet neobank, the Robinhood chain work, NEAR side tracks, and the showcase polish loops.
- **Keep Telegram running** as the cash and volume source while it costs little. It is the only surface with a fee model (`DATAROOM.md:181-184`: 1.0% down to 0.1%). Killing it for an unproven agent market trades a possible revenue line for none.

**Recommended next 30 days**

1. Pull the four usage numbers from prod.
2. Pick one wedge: policy-gated managed execution for agents, or Arbiter Pay.
3. Get 10 conversations with agent builders and get one to pay.
4. Kill everything else from the roadmap.

If none of the agent surfaces show external usage after one month of direct outreach, the honest conclusion is a distribution problem, not a product-category problem. More AI surface won't fix that.

### agent-market
AI-AGENT x CRYPTO MARKET, LATE 2026: WHAT IT MEANS FOR SUWAPPU

Method: about 9 web searches plus a skim of the repo. Secondary sources only. I did not fetch any primary data, so every number below is "reported", and the sources conflict on many of them. Repo: /home/user/suwappubot/docs/plans holds 30 files (not ~40). A grep of /home/user/suwappubot/docs/product-status.md for users, revenue or volume returned nothing. I found no user or revenue metric for Suwappu in the repo.

1. AGENT PAYMENTS: lots of transactions, little money (verified that the sources say this)
- x402 headline counts run from 75M to over 200M transactions (x402.org: 75.4M in 30 days, $24.2M settled). Adjusted volume is about $19M cumulative per Visa's Sheffield (https://thedefiant.io/converge/infrastructure/visa-s-sheffield-pegs-adjusted-x402-volume-at-19m). The top ~1% of buyers (~4k wallets) drive about 90% of it.
- Adjusted monthly volume is reportedly down 77% from its Nov-2025 peak of $5.15M. CoinDesk (Mar 2026) put real commercial volume at about $28k/day. TRM Labs says most x402 volume is not agentic: scripts can produce the same pattern (https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain ; https://glenbrook.com/payments_news/the-x402-foundation-activated-a-27-year-old-internet-code-200-million-transactions-later-the-real-volume-is-still-tiny/).
- Governance has moved to an x402 Foundation under the Linux Foundation. Sources disagree on the date (April vs July 2026).
- AP2: Google launched it in Sep 2025 and later donated it to the FIDO Alliance. It includes an A2A-x402 extension. I found no 2026 deployment numbers (https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/).
- ERC-8004: reported registrations range from 49k (Feb) to about 165k (Apr). One academic report found 10k agents of which only 67 exposed service records. The EIP is still Draft and the Validation Registry is still being revised. ERC-8183 (commerce layer on top of 8004) is real but early (https://eips.ethereum.org/EIPS/eip-8004 ; https://github.com/sudeepb02/awesome-erc8004).
- Inference: the standards are settled and free, and the demand is close to nothing. Building more protocol plumbing will not create demand.

2. AGENT WALLETS: big players own this layer
- Stripe bought Privy (June 2025, a 2025 deal not a 2026 one). A third of Privy's new developers reportedly build agents (https://beincrypto.com/stripe-privy-wallet-developers-building-ai-agents/).
- Coinbase: AgentKit (Nov 2024), then Agentic Wallets in Feb 2026 as plug-and-play, with MCP access (https://www.theblock.co/post/389524/coinbase-rolls-out-ai-tool-to-give-any-agent-a-wallet).
- Fireblocks bought Dynamic and Arbitrum bought ZeroDev. Turnkey and Crossmint are funded incumbents; I found no 2026 rounds for either.
- Swap and route MCP servers are also commoditized: LI.FI runs a hosted MCP covering 58 chains (https://docs.li.fi/mcp-server/overview), 0x shipped agent skills plus an MCP server on 2026-04-13 (https://0x.org/post/0x-agent-skills), and Composio and the community offer Uniswap MCPs.
- Verdict (inference): a hosted swap MCP, agent wallets, x402 metering and A2A cards are now table stakes. Suwappu's api-ts agent layer duplicates what Coinbase, LI.FI and 0x give away free, and they have distribution.

3. AGENT TRADING PRODUCTS: mostly token-driven and fading
- Bankr: DefiLlama shows protocol revenue of about $1.95M in Sep, $443K in Oct, and $35K so far in Nov 2026. That is a sharp drop, though November is a partial month (https://defillama.com/protocol/bankr).
- Virtuals: monthly revenue reportedly fell from a $3.9M peak (Jan 2025) to under $200K. Cumulative ACP gross fees are about $4.5M, of which about $452K is protocol revenue (Fundstrat, Q2 2026). Virtuals now subsidizes ACP sellers with up to $1M/month, which suggests organic demand is weak (https://fundstrat.com/wp-content/uploads/2026/06/20260624-Digital-Asset-Strategy-Virtuals-Protocol-–-Growing-Agentic-GDP-Q2-Update.pdf).
- AI-agent token market cap is down about 44-80% depending on the source and date (https://blockworks.co/news/ai-agent-market-wipeout ; https://cointelegraph.com/magazine/crypto-defai-down-can-it-come-back-up).
- Griffain, Hey Anon, Wayfinder: I found no reliable 2026 data. Unknown. Do not assume they are either alive or dead.
- Contrast: non-AI Telegram and terminal trading bots still do real volume. Lifetime figures: Axiom about $20B, Trojan $24B, Banana Gun $16B, Maestro $12.8B. Category weekly revenue has reportedly peaked near $100M (https://defillama.com/pro/tg-bots-trading-apps-7y0m8c). These are editorial and press-release sources, so treat them as rough. The direction is clear: humans trading memecoins fast pay fees, and agents paying agents barely do.

4. SHOULD SUWAPPU PIVOT TO AI FULLY? No. Evidence-based answer:
- The "AI fully" market, meaning agent-to-agent commerce, is small (about $28k/day of real x402 commerce), concentrated in a few wallets, and its infrastructure is owned by Coinbase, Stripe, Google and the Linux Foundation. A solo $0 founder cannot out-distribute them.
- docs/plans/arbiter-improve-or-pivot.md already reached the same conclusion: the tech is real and demand is unproven.
- The part of the market with revenue is human trading UX: Telegram and terminal bots. Suwappu already has that surface, competing against Axiom, Trojan and others.

5. WHAT SUWAPPU IS MISSING (inference, from the repo skim plus the market)
- A demand signal. The repo shows no user or revenue metrics, but roughly 30 plans and around 10 side lines (Arbiter, NEAR, Starknet neobank, Robinhood chain, NFTs, CFO agent, ETHGlobal). That is spread, not focus.
- A wedge. Generic swap-plus-agent API is commoditized. The founder should pick one narrow user with a paid pain point.
- Distribution. Incumbents win on distribution, not tech.

6. WHERE A SOLO FOUNDER CAN STILL WIN (ranked, all inference)
a) AI as UX inside a human trading bot: natural-language orders, alert explanations, rug and risk checks before a swap, copy-trading with agent guardrails. Monetize the trade fee, which is already the proven model. Lowest risk and reuses the existing bot.
b) A niche-chain or niche-asset vertical the big players under-serve (one chain or community done far better than Axiom or Trojan). Pick one, not seven.
c) A trust and verification layer (Arbiter as an attested verifier, pay-on-delivery for x402). This is unclaimed but the market is tiny. Keep it only as a cheap option with a hard kill test: one external party pays for one verification within about 60 days, or freeze it.
d) Avoid: building your own agent wallet, a generic swap MCP, a new token-launch agent platform, or depending on ERC-8004/8183 standards that are still Draft.

7. UNCERTAIN OR UNVERIFIED
- The x402 totals do not reconcile across sources.
- Bankr's November figure is a partial month.
- The Telegram-bot volumes come from editorial and press-release sources.
- The status of Griffain, Hey Anon and Wayfinder is unknown.
- The ERC-8004 counts vary 3x between sources.
- The repo has no metrics. The founder should supply actual MAU, volume and fees before any pivot decision. Without them, every strategy call here, including this one, is guesswork.

### bot-market
MARKET REPORT: Telegram/terminal trading bots and DEX aggregators, late 2026 (pulled 2026-11-20)

Primary data source (VERIFIED, pulled live today): DefiLlama fees API, https://api.llama.fi/overview/fees and https://api.llama.fi/summary/fees/<slug>. Fees are gross user-paid fees. November 2026 is a partial month (20 days). Raw JSON is at /tmp/claude-0/-home-user-suwappubot/91fd9224-9bb5-5b0e-afb5-ddca7486f512/scratchpad/fees.json.

1. VERIFIED: the classic Telegram bot category is collapsing, and the money moved to web/mobile terminals

Fees over the last 30 days, with change vs the prior 30 days:
- Axiom (web terminal): $17.6M, -48%. Trailing year $283M.
- fomo (mobile app): $6.9M, -63%. Trailing year $93M.
- GMGN (web/app): $6.9M, -64%. Trailing year $198M.
- Terminal (ex-Padre, owned by pump.fun): $3.3M, -36%.
- Hypernova: $1.5M, +69%.
- Trojan: $455K, -51%.
- Maestro: $329K, -61%.
- Photon: $178K, -51%.
- Bloom: $173K, -53%.
- BONKbot: $41K, -59%.
- BullX: $367.
- Banana Gun shows $1.3K. That is almost certainly a broken DefiLlama adapter, not real revenue. Its own March 2026 figure was about $92K/week in fees, down from about $256K/week in September 2025 ([financialcontent, 2026-03-17](https://www.financialcontent.com/article/globeprwire-2026-3-17-banana-gun-clears-8b-annualized-volume-as-trading-patterns-mirror-retail-brokerages); [CMC](https://coinmarketcap.com/cmc-ai/banana-gun/price-analysis)).

Category totals (DefiLlama labels):
- "Telegram Bot", 29 protocols: $4.4M over 30 days, $92M trailing year.
- "Trading App" (web/mobile terminals), 41 protocols: $35.5M over 30 days, $610M trailing year. That is about 8x the Telegram category.
- "AI Agents", 23 protocols: $2.0M over 30 days, and most of that is one outlier (Central City, $1.67M). $14M trailing year.

Monthly fee trend, peak vs now:
- Photon: $43M (Dec 2024) to $0.3M (Oct 2026). Down about 99%.
- Trojan: $19M (Dec 2024) to $0.7M. Down about 96%.
- BONKbot: $5M to under $0.1M.
- Maestro: $6–7M to $0.6M.
- Axiom: $93M (May 2025) to $18–37M through mid-2026, then $10M for November so far.
- GMGN: spiky, rising on events (Oct 2025 $45M, Aug 2026 $33M) and falling back to single-digit millions.

What this means: Telegram-native bots are a legacy channel. The winners are browser terminals (Axiom, GMGN) and mobile apps (fomo). The whole sector is also shrinking with memecoin volume. One August 2026 piece describes Telegram bot volume as "depressed in the current altcoin bear market" ([ainvest](https://www.ainvest.com/news/banana-banana-gun-9-4-24h-selloff-move-2608/)).

2. Consolidation (VERIFIED in part)
- Pump.fun bought Padre in October 2025 and renamed it Terminal ([terminalpedia](https://terminalpedia.com/ecosystem/what-is-terminal); [solbotrank](https://solbotrank.com/guides/padre-terminal-explained)).
- Pump.fun reportedly bought and sunset Vyper in February 2026. This rests on a single source.
- One May 2026 report argues the category "fractured" rather than consolidated ([crypto-reporter](https://www.crypto-reporter.com/press-releases/the-state-of-memecoin-trading-bots-in-2026-volume-fee-capture-and-market-share-across-the-top-8-126770/)). I treat this as low quality, since it is a press release.
- Pattern (inference): launchpads and wallets are absorbing the trading front end. Pump.fun owns Terminal. Base App earned $10M in fees over the trailing year. MetaMask earned $28.7M from its wallet plus $12.8M from perps over the trailing year. Distribution owners are swallowing standalone bots.

3. Fee levels (INFERENCE from training data and review sites, not re-verified today)
- The industry standard is about 1% per swap. Trojan charges 1% (0.9% with a referral), BONKbot 1%, Maestro 1%, Axiom about 0.75–1%, GMGN about 1%.
- Banana Gun charges about 0.5% on manual trades and about 1% on snipes, and passes 40% of fees to token holders.
- No price war is visible. Share moved on UX, speed, and incentives, not on price.

4. How entrants actually got distribution (inference from case histories)
- Axiom went from about 0 to $93M a month in roughly 4 months in 2025. Drivers: a YC-backed web terminal, aggressive tiered referrals, a points/airdrop expectation, and KOLs paid through referral cuts.
- fomo grew with a mobile-native onboarding flow. GMGN grew through copy-trade and smart-money data.
- Banana Gun and Unibot grew through a token with revenue share.
- None of them won through multi-chain breadth or better routing. All of them won on a single hot chain (Solana memecoins), speed, MEV protection, and paid KOL/referral loops.

5. Is chat-based "AI trading" eating classic bots? VERIFIED: no, not by revenue
- The AI Agents fee category is about $2M per 30 days, against $35M for Trading Apps.
- Bankr is the flagship chat agent. Uniswap reported "$500M via Bankr" on 2026-04-19 ([spendnode](https://www.spendnode.io/blog/bankr-500-million-uniswap-agentic-trading-april-2026/)).
- Bankr's revenue estimates conflict wildly: $27.6M in Q1 2026 per [RootData](https://www.rootdata.com/projects/detail/bankrbot?k=MTU3NzA%3D), against about $580K annualized per [Crypto AI Tracker](https://crypto-ai-tracker.vercel.app/projects/bankr), which also calls it "~1-3% the size of a real trading bot."
- Bankr had a 14-wallet breach with about $150K reimbursed ([KuCoin](https://www.kucoin.com/news/flash/bankr-ai-trading-assistant-breached-14-wallets-compromised)).
- Exchanges are bundling agents: Binance AI Pro beta launched in March 2026 ([dev.to/KyberSwap](https://dev.to/kyberswap/how-ai-agents-trade-crypto-in-2026-defi-skills-mcp-and-execution-ec8)). Sources on this are vendor-authored.
- Inference: "AI agent" is a feature and a distribution story, not yet a revenue pool. Most agent volume is token-launch speculation. The B2B "execution API for agents" layer is crowded with well-funded players (0x, KyberSwap, LI.FI, Jupiter Developer Platform). Jupiter's developer platform earned $734K over the trailing year, and LI.FI's DEX aggregator about $0.95M. Even incumbents earn little from the agent rail.

6. What it would take for Suwappu to win share as a bot (inference)
- The Telegram-bot form factor is the shrinking segment. Telegram bots earn about $4.4M a month in total fees, spread across 29 projects, and top-tier incumbents are falling 50–60% month over month. A new entrant with no distribution would be fighting for scraps of a declining pool.
- To compete anyway, all of the following would be needed:
  - Concentrate on one hot chain or venue where volume is, not 7+ chains.
  - Sub-second landing and MEV protection at parity with Axiom.
  - A web or mobile terminal as the primary product, not Telegram.
  - A 30–50% referral loop plus funded KOL deals and a points/airdrop narrative.
  - Capital, which a $0 solo founder does not have.
- Multi-chain routing is not a differentiator. Aggregators commoditize it.
- Wedges that are cheaper and more defensible:
  - (a) A niche no incumbent serves: a new chain launch such as Robinhood Chain, where GMGN and Axiom are already present ([medium](https://medium.com/coinmonks/best-robinhood-chain-meme-coin-trading-platforms-in-2026-gmgn-vs-axiom-vs-fomo-vs-terminal-43e130d87181)), or a region or language.
  - (b) Being the execution backend that agents and wallets plug into. But section 5 shows thin revenue there today.

On "pivot to AI fully": the market data does not support a full pivot. AI-agent trading revenue is roughly 1/18 of terminal revenue and is unproven. Telegram bots are also in structural decline. The objective read: neither "classic bot" nor "AI agent" is a market that a solo, unfunded entrant wins on breadth. The missing piece is distribution and one focused wedge with measured demand, not more features.

Confidence notes:
- DefiLlama figures are verified as pulled, but adapters can be wrong (Banana Gun clearly is).
- Fee percentages and growth playbooks come from prior knowledge or affiliate pages and were not re-verified.
- Bankr revenue is unresolved.

Other sources: [datawallet](https://www.datawallet.com/crypto/best-telegram-crypto-trading-bots), [dropstab](https://news.dropstab.com/research/top-telegram-trading-bots-for-crypto), [Blockworks](https://blockworks.co/news/telegram-trading-bot-banana-gun), [DefiLlama Banana Gun](https://defillama.com/protocol/banana-gun), [0x Bankr case study](https://0x.org/case-study/bankr).

# chat.dev Feature Parity — Research & Execution Plan

*Researched 2026-08-01 from https://chat.dev, https://chat.dev/docs (21/21 doc pages), and github.com/mmirman/chatdev-vscode (source-level). Status: research complete; parity plan below.*

## 1. What chat.dev is

chat.dev (Antipodal, Inc. — founder trail links to Matthew Mirman, ex-Anarchy/LLM-VM) is an **AI Agent Cloud**: rented cloud VMs that run autonomous coding agents (Codex, Claude Code, OpenCode, OpenClaw, Poolside harnesses — user's choice per agent). Agents get a persistent machine, write code, run tests, push to GitHub, and are controlled through **seven surfaces**: web dashboard, VS Code/Cursor plugin, SMS, voice/phone call (+1-856-CHATDEV), Channel API (embed in Slack/Discord/Telegram/your product), group chat @mentions, and a live web terminal. Positioning: *"not assistants in your editor, but autonomous developers with their own machines."* Headline: **"Vibecoding. Anytime. Anywhere."**

Notably for us: it is **crypto-native** — every agent gets its own **SOL wallet** and can *self-fund its own compute* from that wallet. Billing is Stripe **or** native SOL deposit.

## 2. Their offering (pricing & gating)

| Tier | Price (mo / annual-equiv mo) | Agents | Compute hrs | Bundled AI credit |
|------|------|--------|-------------|-------------------|
| Free | $0 — no card | 6 | 1,000 | $2 |
| Base | $44.99 / $29.99 | 10 | 10,000 | $10 |
| Pro | $149.99 / $99.99 | 100 | 20,000 | $30 |
| Expert | $749.99 / $499.99 | unlimited | 50,000 | $100 |

- Machine tiers billed hourly on top: Standard $0.0097/hr → Pro $0.0542 → Max $0.1806 → A100 GPU $4.77/hr (Expert-only). Stopped agents pay storage only.
- **Gating is usage-based, not feature-based** — every feature is available on Free; you upgrade because you hit agent-count/hours/credit ceilings.
- **BYO-subscription**: users plug in their existing Claude/ChatGPT subscriptions (OAuth device flow); chat.dev sells the compute + orchestration layer, not resold tokens.
- **Public-repo compute is free** (full waiver per /docs/pricing) — an open-source acquisition subsidy.

## 3. How they convert (the funnel, mechanic by mechanic)

1. **No-card free tier** (6 agents / 1,000 hrs / $2 credit) — the primary PLG lever. All CTAs → `/login` (login *is* signup, one step).
2. **A phone number as CTA** — "Call +1-856-CHATDEV." Activation without ever opening the app; memorable, word-of-mouth-able.
3. **BYO-subscription bridge** — converts "I already pay for Claude" into "now rent the machine to run it unattended." Removes the double-subscription objection.
4. **IDE extension as session-capture funnel** (see §4) — meets users inside the tool they already use and offers a one-click "Continue in the cloud."
5. **Channel API as distribution loop** — third parties embed chat.dev agents in their own products (`POST /api/channels/:id/inbound` + signed webhooks); `POST /api/channels/register` auto-provisions an account **and a Solana wallet** with no browser onboarding. Other apps become their acquisition surface.
6. **Usage-ceiling upgrade triggers** + ~33% annual discount; no feature paywalls to resent.
7. **Comparison/cost-bait SEO** — "chat.dev vs Devin vs Cursor vs Copilot vs Replit," "How much does it cost to run a remote AI coding agent?" Weekly blog cadence.
8. **Social proof at the point of decision** — logos + named testimonials sit on the pricing section itself (unverified as paying customers).
9. **Open-source-repo free compute** — seeds usage, goodwill, and public artifacts that market the product.

**Traction reality check:** no HN/PH launch, no G2/Crunchbase footprint, VS Code extension is sideload-only (.vsix, 2 stars, created 2026-07-11). This is an **early-stage, content-led launch with real product depth but unproven traction** — we are not chasing a giant; we're pattern-matching a well-designed playbook.

## 4. The VS Code extension (their cleverest conversion asset)

`chatdev-vscode` ("chatdev-remote") is a **session-migration bridge**, not a copilot:

- Reads local agent state off disk — Claude Code (`~/.claude/.credentials.json`), Codex (`~/.codex/auth.json`), Cursor (its SQLite DB), Copilot (VS Code auth) — chat history *and* credentials.
- One-click **"Continue"** → `POST /api/editor-handoffs` → opens browser → workspace + conversation mirrored bidirectionally to a cloud agent (socket.io channel: `write_file`, `session_import_begin/chunk/commit`, `credential_import`).
- Re-exposes chat.dev-hosted models **inside VS Code's native Chat UI** (chat participant + Language Model provider) — retention hook without visiting the site.
- Even patches Cursor's own Agent panel so chat.dev sessions appear native inside a competitor's product.
- Auth: OAuth device flow + PKCE (`/api/auth/extension/device` → `/token`), short-lived `auth/socket-token` for the websocket (never exposes the bearer token in the handshake — a pattern worth copying).

**The lesson:** every local workflow it touches has exactly one designed exit — a handoff into a billed chat.dev agent. Instrument where users already are; make leaving for your product one click.

## 5. Feature inventory (theirs) — parity checklist source

- Persistent sandboxed agent VMs (state survives restarts; terminal, files, servers, git)
- 6 harnesses, per-agent model/harness choice; proxy-metered credits OR direct provider key
- Toolpacks (MCP-backed capability bundles): Agent Introspection, System Admin, Direct Speak
- Tool Pipelines: declarative multi-step automations, scheduled (≥60s interval, maxRuns)
- Multi-agent orchestration via shared filesystem + independent schedules
- HTTPS preview URLs per exposed port (`*.ports.chat.dev`, auto-TLS; no WebSockets) + custom CNAME domains
- **Agent Wallet: per-agent SOL wallet; agents self-fund compute; spending limits**
- SMS command set (~19 commands), group-chat sharing (`/share`), voice control w/ barge-in
- Channel API: inbound messages, HMAC-signed outbound webhooks, key rotation, headless account+wallet provisioning
- GitHub spawn-from-repo (`/spawn REPO`), public-repo free compute
- BYO ChatGPT/Claude subscription (OAuth; tokens encrypted at rest, injected per-agent)
- Stripe + native SOL billing; 1-month free trial
- **Gaps they have** (our openings): no team/org/seat management, no SSO/SAML, no SOC2/compliance docs, no client SDKs for the Channel API, no WebSocket support on exposed ports, broken doc links, no published referral program, sideload-only IDE extension.

---

## 6. Where we stand (repo inventory, 2026-08-01)

We are **not** building a coding-agent cloud. Parity here means: *their playbook, our domain* — autonomous **trading** agents with wallets, reachable everywhere, converting through the same mechanics. The good news: most of the hard substrate already exists and is live.

| Surface | State | Evidence |
|---------|-------|----------|
| Agent API (`/v1/agent/*`: quote, execute, status, register, topup, policy, webhooks) | **LIVE** | `api-ts/src/routes/agent.ts:77`, mounted in `app.ts` |
| A2A protocol + agent card | LIVE | `api-ts/src/routes/a2a.ts` |
| MCP surface (LLM tool defs) | LIVE | `api-ts/src/routes/mcp.ts` |
| x402 per-call metering + spend permissions | LIVE | `middleware/x402Payment.ts:28`, `lib/spendPermission.ts` |
| Stripe tiers (fee multipliers free=1.0x → enterprise=0.1x) | LIVE | `billing.ts:57-62` |
| Per-user wallets, EVM (Turnkey) + Solana, KMS envelope | LIVE | `db/schema/wallets.ts:1-41` |
| NL trade-intent parsing (Claude primary, OpenAI-compat fallback, budget caps) | LIVE (Telegram-only) | `bot/services/nl_intent_service.py`, `bot/handlers/nl_trade.py` |
| Trading terminal (React, TradingView, 8 panels, 74 E2E tests) | **DEPLOYED** | `terminal/`, `railway.terminal.json` |
| WhatsApp voice intent capture | Built, wiring unverified | `bot/services/whatsapp_voice.py` |
| SDKs (TS, Python, openclaw) | Exist in-repo, not marketed | `packages/sdk*` |
| Webapp/terminal chat UI for agents | **MISSING** | agent access is API-only |
| Fee collection + sweeper | LIVE | `bot/services/fee_service.py`, `fee_sweeper.py` |

Scout's verdict: *"modular components waiting for a coordinator layer."* chat.dev's SOL-wallet-per-agent + self-funding story is something we already have the rails for — on **7+ chains**, not one.

## 7. Parity matrix — their mechanic → our move

| # | chat.dev mechanic | Our analog | Status | Effort |
|---|---|---|---|---|
| 1 | Agent with own wallet, self-funds compute | Agent wallet auto-tops-up credits via x402 from its own balance | Rails live; auto-topup loop missing | M **MONEY-PATH** |
| 2 | 7 control surfaces (web/IDE/SMS/voice/API/group/terminal) | Telegram ✅, terminal ✅, API/MCP ✅; voice ⚠️ unwired, group-share ✖, webapp chat ✖ | Partial | M |
| 3 | No-card free tier, usage-gated (never feature-gated) | Free starter credits on agent register; ceilings drive upgrade | Register live; free-credit grant + ceiling UX missing | S |
| 4 | Login *is* signup (one step) | `POST /v1/agent/register` is already headless one-step; webapp equivalent missing | Partial | S |
| 5 | BYO-subscription (use your existing Claude/ChatGPT) | BYO wallet (non-custodial signing) + BYO LLM key for NL features | Not offered | M |
| 6 | Channel API (embed agents in 3rd-party apps; headless account+wallet provisioning; HMAC webhooks) | Partner Channel API: inbound message → NL intent → quote/execute; auto-provision agent+wallet | Webhook events + register exist; inbound-message channel missing | M-L |
| 7 | IDE extension session-capture funnel | **MCP-first funnel**: publish MCP server to registries (Claude/Cursor/ChatGPT), agent-card discovery; SDKs to npm/PyPI | MCP live but unlisted; SDKs unpublished | S |
| 8 | Phone number as CTA ("Call +1-856-CHATDEV") | "Text your trading agent" — WhatsApp/Telegram deep-link on showcase; later a voice number | Voice svc exists unwired | S (link) / M (voice) |
| 9 | Comparison/cost-bait SEO (vs Devin/Cursor…) | Showcase blog: "Suwappu vs Banana Gun vs Maestro vs BonkBot", "true cost of a trading bot" | None | S |
| 10 | Social proof on the pricing section | Testimonials/volume stats inline on showcase pricing | None | S |
| 11 | Public-repo free compute (OSS subsidy) | Free/discounted fees for open-source agent builders using the SDK | None | S (policy) |
| 12 | Scheduled Tool Pipelines | We have orders/DCA/alerts/snipe — package as "Automations" in one UI + agent API | Backends live, not unified | M |
| 13 | Group-chat agent sharing (`/share`) | Telegram group `/share` of an agent (read-only quotes first) | None | M |
| 14 | Their gaps: no teams/SSO/SOC2/SDKs/WebSockets | Differentiators we can ship: published SDKs, HMAC-signed webhooks (have), 2FA (have), KMS custody story (have), multi-chain (have) | Mostly done — needs marketing | S |

## 8. Execution plan

**Phase 0 — Conversion mechanics (week 1-2, mostly S-effort, no new money-path):**
1. **Agent onboarding page + free credits**: showcase page with one-step agent signup hitting `/v1/agent/register`, granting starter credits (no card). Tier table styled like theirs: usage ceilings, ~33% annual discount, social proof inline. → `showcase-dev`, credits grant → `api-ts-dev`.
2. **Publish the funnel assets**: SDKs to npm/PyPI, MCP server listed in public MCP registries, agent card discoverable. → `sdk-dev`.
3. **SEO comparison content**: 3 posts (vs Telegram-bot competitors; "true cost" calculator; "let your agent trade while you sleep"). → `showcase-dev` + `researcher` for claims.
4. **"Text your agent" CTA**: Telegram/WhatsApp deep links as primary showcase CTA (their phone-number trick, zero build).

**Phase 1 — Surface parity (week 3-5):**
5. **Webapp/terminal chat panel**: bind `nl_intent_service` → existing confirm-swap flow in a chat UI (the missing "coordinator layer"). Intent parser still never signs; 2FA gate intact. → `webapp-dev` + `bot-dev`.
6. **Wire WhatsApp voice** end-to-end (voice → intent → confirm). Verify with a real voice message per Live Verification rule. → `bot-dev`.
7. **Automations UI**: unify orders/DCA/alerts/snipe as scheduled "pipelines" in terminal + agent API (`schedule` endpoints). Fix backlog D2 (snipe backend) as part of this. → `api-ts-dev` + `webapp-dev`.
8. **Group agent sharing**: `/share` in Telegram groups, quotes-only first, owner-revocable. → `bot-dev`.

**Phase 2 — Platform parity (week 6-9):**
9. **Channel API**: `POST /v1/channels` + `/inbound` + HMAC-signed outbound webhooks + key rotation; headless account-and-wallet provisioning (mirror their `register` bypass). Distribution loop: other apps embed our swap agent. → `api-ts-dev`; security review → `security-auditor`.
10. **Self-funding agents**: opt-in auto-topup of x402 credits from the agent's own wallet with hard spending limits. **MONEY-PATH → `money-path-reviewer` (Opus) before merge.** → `api-ts-dev`.
11. **Agent dashboard** in webapp: registry, credits, spend limits, policy editor, webhook logs. → `webapp-dev`.
12. **BYO options**: non-custodial signing mode (agent submits pre-signed txs) + BYO LLM key for NL parsing. → `api-ts-dev` + `bot-dev`.

**Explicitly NOT copying** (out of scope, surface if this shrinks the vision): cloud VMs/compute rental, coding harnesses, GPU tiers, custom domains, IDE extension (MCP is our editor-side beachhead), credential harvesting from other tools' local state (their extension reads competitors' auth files — effective, but not a pattern we should adopt for wallets).

## 9. Verification gates (per CLAUDE.md)

- Every phase item ships behind `bash scripts/verify.sh` + `python3 scripts/status.py` green.
- Live E2E per feature: real agent registration + testnet/small quote-execute through each new surface (chat panel, voice, Channel API) before calling it live — "code-complete, not functionally verified" otherwise.
- Items 1, 10, 12 touch billing/wallets → tag **MONEY-PATH**, Opus review mandatory.
- Conversion instrumentation: track signup→first-quote→first-swap→paid-tier funnel from day one (else we can't "study how *we're* converting").

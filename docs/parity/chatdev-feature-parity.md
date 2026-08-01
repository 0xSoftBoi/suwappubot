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

*Sections below — our current surfaces, parity matrix, and execution plan — grounded in the repo inventory.*

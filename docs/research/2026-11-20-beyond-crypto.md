# Suwappu beyond crypto: a vision (2026-11-20)

## 1. The big idea

**Suwappu becomes the place where an AI agent's actions get permission.** Every agent action that spends money or can't be undone passes through Suwappu first. It is checked against a policy, approved by a person in the chat app they already use, and leaves a receipt anyone can verify. This works with any tool, any payment rail and any model.

**Why now (sources and dates):**
- **Each payment rail controls spending its own way.** Stripe puts limits on Shared Payment Tokens and Issuing cards (Stripe docs; Link agent wallet, TechCrunch 2026-04-30). Mastercard's Verifiable Intent was announced in March 2026 and is "coming months", so it is not confirmed live (mastercard.com 2026). Google AP2 was announced in Sept 2025 and I found no evidence of production use (TechCrunch 2025-09-16, UNVERIFIED). Nobody offers one budget across all of them.
- **The MCP spec leaves a gap.** The 2026-07-28 version adds scope step-up but no proof that a human approved a specific action (modelcontextprotocol.io; WorkOS critique).
- **The pioneer may have left the space.** HumanLayer's approvals SDK is reportedly deprecated after a pivot to a coding IDE. This comes from a competitor's page (Pushary, Oct 2026), so it is UNVERIFIED.
- **Investors are paying for agent authorization.** Arcade raised a $60M Series A on 2026-06-16 (arcade.dev).
- **Regulators are starting to ask for logs and oversight.** FINRA's 2026 Oversight Report (2025-12-09) links AI agents to supervision and books-and-records. The EU AI Act's Annex III logging and oversight duties now start 2027-12-02 (Digital Omnibus deal, 2026-05-07; formal adoption UNVERIFIED). India's NPCI is reportedly building an AI-agent registry for UPI payments (a Reuters report seen only via a search summary, UNVERIFIED).

## 2. Which assets transfer, ranked

| # | Asset | Generic today? | Effort |
|---|---|---|---|
| 1 | Hash-chained audit log + verify endpoint (`services/audit.ts`) | Yes ("chain" means the hash chain, not a blockchain) | ~0.5 day (allow a string principal) |
| 2 | Seal / commit-reveal (`lib/seal.ts`) | Yes. On-chain anchoring is optional; could also anchor to RFC 3161 or a transparency log | 0 days |
| 3 | Orgs, members, API keys, usage (`routes/enterprise.ts`) | Yes | ~0.5 day |
| 4 | Metering + Stripe billing | Yes. x402 stays as an optional rail | ~1 day |
| 5 | Single-use step-up approvals (`ApprovalService.ts`) | State machine is generic; the payload is swap-shaped | 2–3 days |
| 6 | Policy engine (`PolicyService.ts`) | About 60% is generic: verdicts, fail-closed, caps, advisory-lock spend reservation. The intent type and the stateless rules (lines 120–206) are crypto-only | 5–7 days, MONEY-PATH |
| 7 | Telegram approver (`bot/handlers/approvals.py`) + WhatsApp + Discord reach | Exists; needs to render any payload | ~1 day, plus 3–4 days for Slack/WhatsApp notifiers |
| 8 | MCP server (`routes/mcp.ts`) | Scaffolding only. The gateway/proxy is new code | 7–10 days |
| 9 | Arbiter (TEE verifier/escrow) | Not audited. A later differentiator, not part of the MVP | — |

**Total:** about 20–27 focused days to a demo-able MVP and 35–45 days to production grade. These numbers are estimated from code structure, not a line-by-line read.

## 3. Three directions

### A. Agent Action Firewall: an MCP gateway with spend control and chat approvals
- **Buyer:** teams shipping agents that move money or take irreversible actions (refunds, procurement, ad spend, SaaS purchases, outbound email). Start with agent builders and SMB/prosumer teams, not large enterprises.
- **Pain:** each rail has its own limits; approvals are per-transaction webhooks; there is no audit record they can hand to someone else.
- **Competitors and their gap:**
  - Okta for AI Agents: GA vs Early Access is unclear across Okta's own sources.
  - Microsoft Entra Agent ID: bundled into enterprise licences.
  - Arcade and Composio: tool brokering.
  - Permit.io Access Request MCP: the closest rival; its MCPermit page is marked upcoming.
  - None of them combines spend reservation, org-wide caps, approvals inside Telegram/WhatsApp and a verifiable audit chain (my search coverage of Slack-native tools was thin).
- **Our edge:** the spend-reservation engine is TOCTOU-safe and fail-closed, and the chat approval channels are already built.
- **2-week build:** `ActionIntent` plus a rule registry beside the existing engine, a minimal `routes/gateway.ts` proxy for one upstream MCP server, a generic Telegram approval card, and a demo of "Stripe refund over $50 → approve in Telegram → verifiable receipt".
- **First 10 customers:** MCP server authors and agent-framework Discords, indie agent builders using Stripe agent toolkits, and two or three agencies running agents for clients.
- **Pricing (hypothesis):** free up to 1k evaluated actions per month; $49/month for a team; then about $0.01 per evaluated action and $0.10 per routed approval.
- **Kill criteria:** by day 60, fewer than 3 teams routing real (non-demo) actions, or Stripe ships cross-merchant user limits plus approvals that cover the same need.

### B. Verifiable AI audit for compliance and insurance ("evidence pack")
- **Buyer:** compliance at FINRA-supervised firms and fintechs; AI insurers and certifiers (AIUC raised a $15M seed per Fortune, 2025-07-23; Munich Re aiSure).
- **Pain:** they must show that human oversight actually happened, not just that something was logged.
- **Competitors and their gap:** Langfuse and Arize keep mutable traces. Vanta, Credo and Holistic AI run governance workflows (offerings not verified today). An IETF individual draft says no standard exists for how agents should log (draft-sharif-agent-audit-trail).
- **Our edge:** we record enforcement (policy verdicts, step-ups, caps) in a hash chain with a verify endpoint.
- **2-week build:** an exportable evidence pack mapped to EU AI Act Articles 12/14, FINRA Rule 3110 and AIUC-1. The AIUC-1 D003 mapping is UNVERIFIED.
- **First 10 customers:** interviews only. Ten fintech compliance leads and two or three AI insurance or assurance startups.
- **Pricing:** $500–2k/month per deployment (hypothesis).
- **Kill criteria:** none of 10 interviewees will pay or pilot within 90 days. No regulation requires cryptographic verifiability yet, and the hard deadline is 2027.

### C. A chat-native agent that pays and books for SMBs (WhatsApp/Telegram, UPI/Pix)
- **Buyer:** small business owners who delegate supplier payments, bills and refunds to staff or agents.
- **Pain:** no per-person caps or approval step on in-chat payments.
- **Competitors and their gap:**
  - Meta Business Agent with Razorpay links: in-chat UPI is "coming soon" (Business Today, 2026-05-07). Its spend-policy features are UNVERIFIED.
  - respond.io, Infobip and Sinch: messaging infrastructure; no spend-policy features found.
- **Our edge:** org/member caps and chat approvals.
- **2-week build:** one narrow WhatsApp/Telegram flow that issues a payment link behind an approval gate. It must not hold customer money.
- **First 10 customers:** 5–10 owners in one vertical.
- **Pricing:** about $9–19/month per business.
- **Kill criteria:**
  - Meta rejects the use case. WhatsApp has barred general-purpose bots since 2026-01-15 (TechCrunch, 2025-10-18); task-specific bots are still allowed.
  - Any step needs a money-transmission licence.

## 4. Lead direction: A, the Agent Action Firewall

A is the lead because it reuses the most code, sells to developers that a solo founder can reach without an enterprise sales team, and contains B and C:
- B becomes the firewall's audit export.
- C becomes one product built on the firewall, with WhatsApp as a notifier.

**Where crypto fits:** crypto becomes one action domain and one rail adapter.
- Today's swap rules (chain and token allowlists, slippage, gas, destination and contract allowlists) become a "crypto rule pack", stored as the legacy columns mapped onto a new additive `rules jsonb` column.
- x402 sits next to Stripe SPT and card tokens as one payment rail. On-chain anchoring is one of three ways to anchor a seal.
- Existing swap users keep working. Crypto becomes our hardest test customer, and stops being what defines the company.

## 5. Milestones and gates

**Day 30**
- `ActionIntent` engine live, with swaps running through it bit-for-bit. Requires a money-path-reviewer pass.
- Gateway proxies one stock MCP server.
- Two non-crypto demos: approve a refund in Telegram; block email to an outside domain.
- **Gate:** 20 builder conversations, 5 design partners signed up, 1 routing real actions.

**Day 90**
- Slack and WhatsApp notifiers.
- Upstream credentials stored in KMS, plus SSRF guards.
- Stripe metered billing on evaluated actions.
- Public verify page for receipts.
- **Gate:** 10 active orgs, at least 5,000 real evaluated actions per week, 3 paying customers (any amount), and no swap regression.

**Day 365**
- Cross-rail budget across Stripe SPT, Issuing, x402 and card-token adapters, as each rail ships.
- Evidence-pack export.
- Attested policy evaluation using Arbiter.
- **Gate:** $10k MRR, more than 1M actions per month, one regulated or insurance pilot. If the gate is missed, narrow to the strongest-performing vertical, and do it openly.

## 6. Name and positioning

- **Positioning:** "The permission layer for AI agents. Policy, human approval in your chat app, and a receipt anyone can verify."
- **Name options:** *Suwappu Gate*, which keeps the brand and makes "swap" a historical footnote, or a new descriptive name such as **Countersign** or **Signoff**. Trademark and domain availability not checked.
- **Tagline:** "Agents propose. Humans sign off. Everyone can verify."

## Risks
- Stripe may build these controls into its own stack; its user-set limits are announced as planned, not confirmed.
- Identity vendors may bundle agent governance into existing enterprise contracts.
- Demand is unproven: we have about 0 users.
- Every PolicyService change is MONEY-PATH.
- Market sizes are tiny or uncertain. The unverified Visa/Artemis figure for MPP is about $15M volume across 109.6M transactions.
- Many claims above come from search summaries; check primary sources before pitching.

**Key files:**
- /home/user/suwappubot/api-ts/src/services/PolicyService.ts
- /home/user/suwappubot/api-ts/src/services/ApprovalService.ts
- /home/user/suwappubot/api-ts/src/services/audit.ts
- /home/user/suwappubot/api-ts/src/lib/seal.ts
- /home/user/suwappubot/api-ts/src/routes/mcp.ts
- /home/user/suwappubot/bot/handlers/approvals.py

---

# Adversarial review

RECOMMENDATION: Do not lead with A (generic Agent Action Firewall / MCP gateway) as written. Lead with a narrower A: a spend-and-irreversible-action governor for payment-moving agents, with Stripe-first demo and chat approvals. Position it as a thin product, not a "permission layer for all agents". Treat B (evidence pack) as an export feature and C (WhatsApp SMB pay) as a later vertical. Rationale below.

CODE CHECKS (verified)
- PolicyIntent at PolicyService.ts:30 and evalStateless at :120 match the draft. Slack: zero real hits in api-ts/src (only 2 test-file mentions), so "no Slack today" is correct. Estimates (20-27 days MVP) remain structural guesses; the draft already says so.

CLAIMS UNSUPPORTED, WRONG OR OVERSTATED
1. "Nobody combines spend reservation + org caps + chat approvals + verifiable audit" rests on 3 shallow searches per track and zero primary-page reads. Absence of search hits is not absence of product. Flag as UNVERIFIED in the final doc, not as "our edge".
2. "Investors are paying for agent authorization" cites Arcade's $60M. Arcade is a tool-auth/runtime broker, not an approvals/spend product, and a conflicting $16M figure (Caplight) was noted. It is evidence of competition with deep pockets, not of demand for us. Re-frame.
3. "Pioneer left the space" (HumanLayer) is sourced only to a competitor's SEO page. Also the pivot could equally signal the category failed to monetize. The draft reads it only as opportunity; it is two-sided.
4. Visa/Artemis MPP "$15M over 109.6M tx" and "average ticket under $0.15": unverified, and the derived average (~$0.137) is arithmetic on an unverified figure. Do not use in pitch.
5. Pricing ($0.01/action, $49/mo, $500-2k/mo) and "5,000 evaluated actions/week, $10k MRR" gates are invented hypotheses; label as such. Fine as gates, not as evidence.
6. Regulatory timing: Digital Omnibus deal 2026-05-07 is provisional; formal adoption UNVERIFIED. FINRA 2026 report is guidance, not a rule. No regulation requires cryptographic verifiability; B's buyer is therefore speculative.
7. NPCI AI-agent registry: seen only through a search summary of a Reuters report. Do not cite in the narrative until the primary source is read.
8. The draft says MCP 2026-07-28 "adds scope step-up but no proof of human approval". Step-up was a WorkOS-critiqued comparison, not a spec statement; phrase as "critics note".
9. The "contains B and C" claim is a strategy assertion, not evidence. C depends on Meta policy; B on buyers who do not exist yet.
10. Arbiter is unaudited; do not put "attested policy evaluation" on a public roadmap.

INCUMBENTS THAT THREATEN A (concrete)
- Identity vendors bundling agent governance: Microsoft Entra Agent ID (bundled in Agent 365/E7, learn.microsoft.com/entra/agent-id), Okta for AI Agents (GA 2026-06-25 per release overview; Early Access per Launch Week page, sources conflict), Auth0 beta. A solo $0 founder cannot win enterprise procurement against these.
- Permit.io Access Request MCP (docs.permit.io/mcp-permissions/overview) is a direct policy + human-decides-for-agents product, closest to A. Arcade ($60M A, 2026-06-16, arcade.dev/blog/arcade-series-a) and Composio ($25M A) own the tool-gateway slot where A's MCP gateway sits.
- Stripe controls on SPT/Issuing already cap amount, expiry, and add per-authorization webhook approval (docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens). A Stripe-first demo is a feature Stripe can absorb. Stripe says richer limits are planned.
- MCP spec itself is adding step-up (modelcontextprotocol.io/specification/2026-07-28/basic/authorization).
Net: generic "MCP gateway for all agents" is a crowded, well-funded slot where a solo founder has no distribution edge. Hopeless against enterprise buyers; viable only in a niche the big players ignore.

IS THERE A STRONGER BEYOND-CRYPTO DIRECTION?
Not proven, but one is better-shaped than the draft's ranking: lean on what the incumbents cannot copy cheaply, i.e. the reservation-based multi-rail budget plus chat approvals for money-moving agents (payments/procurement/refunds) in emerging-market SMB workflows (C-style, UPI/Pix links, non-custodial) where Meta's agent is closed and the big gateway vendors do not play. Distribution there is the existing Telegram/WhatsApp reach. Risks: Meta policy, licensing, 0 users. Alternatively sell the engine as an embeddable library/MCP server to existing agent builders (Stripe agent toolkit users) rather than a hosted gateway; lower build cost than the 7-10 day proxy.
UNVERIFIED: I did no new web searches; I could not confirm any competitor claim beyond the sources above, and none of the draft's "no one offers X" statements.

FINAL RECOMMENDATION
1. Run 20 builder/SMB conversations BEFORE building the generic ActionIntent rewrite. The rewrite of PolicyService is MONEY-PATH and the largest risk; do not start it on zero demand evidence.
2. Cheapest test: a no-code or thin demo (Stripe refund over $X -> Telegram approval -> verify endpoint) using existing assets, plus the evidence-pack export (B) as a sales artifact.
3. Pre-pitch research pass on primary sources: Permit.io, Arcade pricing/approval UX, Okta GA status, Stripe user-set limits, Anthropic/OpenAI approval UX, NPCI primary source.
4. Keep the kill criteria; add "Permit.io or Stripe ships equivalent" as a trigger.

HANDOFF
agent: none
task: Founder decision. Optional: dispatch researcher for primary-source pass (Permit.io, Arcade, Okta GA, Stripe limits, NPCI). Only after demand conversations, dispatch api-ts-dev to add ActionIntent beside PolicyService (keep swaps bit-for-bit) then money-path-reviewer.
files: /home/user/suwappubot/api-ts/src/services/PolicyService.ts:30,120; no Slack in /home/user/suwappubot/api-ts/src
risks: MONEY-PATH on any PolicyService change; cross-stack (bot/handlers/approvals.py reads same table); additive migration needed for rules jsonb

---

# Appendix: research lenses

## agent-payments
ANSWER: Non-crypto agent payments are real but fragmented. Each rail (Stripe, Visa, Mastercard, Google, PayPal) ships its own mandate/token and its own limit controls, and the issuer or network usually has the last word. No one offers a neutral, cross-rail spend-control layer with approvals and tamper-evident audit. That is the credible non-crypto wedge for Suwappu. Caveat: I ran 3 searches only. Several items below are UNVERIFIED.

PER-VENDOR (shipped vs announced; who holds the limits)
- Stripe (most shipped). Shared Payment Tokens (SPT) carry currency, max amount and expiry, and stay usable until they expire, are revoked, or hit the cap. Issuing for agents puts spend policy on the card (limits, categories, lifecycle) plus optional per-authorization webhook approval. Source: https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens and https://docs.stripe.com/issuing/agents/programmatic-checkout. SPT is available in the US, Canada and select European countries. Link's agent wallet is built on Issuing (https://techcrunch.com/2026/04/30/stripe-link-digital-wallet-ai-agents-shopping/, 2026-04-30). Stripe says user-set limits and "act without approval" choices are planned, not confirmed. Controls are Stripe-scoped; the account holder or platform sets them. Stripe docs now also reference MPP and UCP alongside ACP.
- OpenAI ACP. Launched late Sept 2025 as a merchant-side checkout spec with Instant Checkout, built with Stripe (https://stripe.com/ae/blog/introducing-our-agentic-commerce-solutions). It has no policy layer of its own; limits come from the SPT.
- Google AP2. Announced Sept 2025 with 60+ partners, as an A2A/MCP extension built on signed mandates (https://techcrunch.com/2025/09/16/google-launches-new-protocol-for-agent-driven-purchases). I found no evidence of broad production use. UNVERIFIED.
- Mastercard Agent Pay. Built on tokenization with agent registration and verification. Verifiable Intent was co-developed with Google in March 2026 and is to be integrated into the Agent Pay intent APIs "in coming months", so announced, not confirmed live (https://www.mastercard.com/us/en/news-and-trends/stories/2026/verifiable-intent.html). It is being contributed to FIDO (https://fidoalliance.org/building-the-trust-layer-for-agentic-payments-with-ap2-and-verifiable-intent/). Mastercard is working with Microsoft on Copilot Checkout. A Santander/PayOS live transaction was reported only in a controlled setting (per Forrester).
- Visa Intelligent Commerce and Trusted Agent Protocol. Forrester reports Visa backing AP2 and extending MPP to card transactions in its Visa Acceptance Platform in March 2026 (https://www.forrester.com/blogs/agentic-payments-in-b2c-commerce-where-we-are-now). Visa/Artemis figure: MPP at about $15M adjusted volume across 109.6M transactions. That means tiny average tickets and a small base. I did not verify this against a primary source. Visa-side limits sit with the issuer and consumer.
- PayPal, Amazon Buy for Me, Shopify: UNVERIFIED. My searches returned nothing primary. PayPal appears as an AP2 supporter and an Agent Pay wallet partner. Do not cite any of the three as live without checking their own announcements.
- Overall: Digital Commerce 360 (2026-04-02) and Forrester describe the protocol landscape as contested, with UCP and ACP as frontrunners. Stripe's own 2025 letter conceded agentic commerce was overhyped in places (as relayed by the search tool, not read directly).

GAPS FOR A NEUTRAL SPEND-CONTROL LAYER (my inference, not vendor claims)
1. Controls are per rail. A company running agents across Stripe SPT, Visa and Mastercard tokens, and x402 has no single budget. Suwappu's org-wide caps with spend reservation (api-ts/src/services/PolicyService.ts) map directly onto this.
2. Approvals are mostly per-authorization webhooks or consumer-wallet prompts. A single-use step-up human approval that works across rails and channels (Telegram, WhatsApp, Discord) matches ApprovalService.ts. UNVERIFIED: whether any vendor ships multi-party or cross-channel approval.
3. Mandates (AP2, Verifiable Intent) prove user intent cryptographically, but nobody offers an independent, verifiable audit record that a business can show an auditor. The hash-chained log with a verify endpoint (services/audit.ts) fits.
4. Fail-closed enforcement before the token is minted. Vendors cap at the token or card. Few appear to enforce a business policy such as vendor allowlists, per-agent budgets or velocity limits upstream of the rail. UNVERIFIED: I did not survey this.
5. Disputes and verification of delivery: Arbiter's TEE-attested escrow and the sealed-then-revealed decisions could serve agent-to-agent B2B purchases. This is speculative.

RISKS / HONESTY
- Incumbents (Stripe in particular) may absorb the controls into their own stack. Stripe has said richer limits are planned, so the neutral-layer window may be short.
- Regulated flows (card issuing, PCI, money transmission) would make Suwappu a policy and orchestration layer on top of Stripe Issuing rather than a payment institution. Compliance scope needs a separate check.
- Market size is small. Using the Visa/Artemis MPP figure above, average ticket is under $0.15 and total volume is about $15M, which is early-stage.

Suggested next step: one more research pass on PayPal, Amazon, Shopify and Google UCP from primary sources, and on whether Stripe's user-set limits have shipped, before committing to the roadmap.

Sources: https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens ; https://docs.stripe.com/issuing/agents/programmatic-checkout ; https://stripe.com/ae/blog/introducing-our-agentic-commerce-solutions ; https://techcrunch.com/2026/04/30/stripe-link-digital-wallet-ai-agents-shopping/ ; https://www.mastercard.com/us/en/news-and-trends/stories/2026/verifiable-intent.html ; https://fidoalliance.org/building-the-trust-layer-for-agentic-payments-with-ap2-and-verifiable-intent/ ; https://www.forrester.com/blogs/agentic-payments-in-b2c-commerce-where-we-are-now ; https://www.digitalcommerce360.com/2026/04/02/visa-mastercard-in-agentic-commerce/ ; https://techcrunch.com/2025/09/16/google-launches-new-protocol-for-agent-driven-purchases

HANDOFF
agent: none
task: none (research only). Optional follow-up: researcher pass on PayPal, Amazon Buy for Me, Shopify and Google UCP primary sources, and on whether Stripe user-set agent limits have shipped.
files: api-ts/src/services/PolicyService.ts, api-ts/src/services/ApprovalService.ts, api-ts/src/services/audit.ts (asset locations taken from the task brief; I did not open them this session)
risks: none for this research. Any build on card rails would be MONEY-PATH plus a compliance question; cross-stack impact unknown.

## agent-auth-hitl
ANSWER: "Approve agent actions from Telegram/WhatsApp/Slack with policy + audit" is NOT a commoditized category as a standalone product, but its parts are being commoditized from above (identity vendors) and below (MCP spec, SDK-level HITL). The one pure-play HITL vendor (HumanLayer) appears to have pivoted away. The open gap is a neutral, channel-native, cross-framework approval + policy + tamper-evident audit layer for non-developer buyers. That is where Suwappu's assets fit. Search results were summaries, not primary pages, so treat figures as UNVERIFIED until checked on vendor sites.

FINDINGS (all via search summaries, retrieved 2026-11-20)
- HumanLayer: only $500K raised over 2 rounds, YC-backed (https://www.cbinsights.com/company/humanlayer/financials). A competitor page (Pushary, Oct 2026) says HumanLayer is now an AI coding IDE, its classic approvals SDK (require_approval, Slack/email channels) is deprecated, and pricing is free for up to 3 members, then $100/user/month (https://pushary.com/nl/vs/humanlayer). UNVERIFIED: this comes from a competitor, not HumanLayer. If true, the category pioneer vacated the space.
- Arcade.dev: $60M Series A announced 2026-06-16, led by SYN Ventures, with Morgan Stanley and Wipro; $72M total (https://www.arcade.dev/blog/arcade-series-a/). Caplight lists a conflicting $16M figure (https://www.caplight.com/company/arcade-dev); treat Arcade's own post as primary. Seed was $12M in March 2025 (https://www.silicon.co.uk/press-release/arcade-dev-scores-12m-to-solve-the-biggest-security-problem-with-ai-agents). It positions on authorization and governance and has a free Hobby tier and custom Enterprise pricing. UNVERIFIED: I found no confirmation of a native chat-channel approval UX.
- Composio: $25M Series A led by Lightspeed (July 2025 per Extruct; CB Insights dates it April 2025), roughly $29M total (https://www.extruct.ai/hub/composio-dev-funding/). Free tier is 20k tool calls/month (https://composio.dev/pricing). It is tool-integration focused, not approval focused.
- Microsoft Entra Agent ID: bundled into Agent 365 / Microsoft 365 E7. Agents need no separate license, and some protections need Entra P2/E5 (https://learn.microsoft.com/en-us/entra/agent-id/what-is-microsoft-entra-agent-id). A third-party source says it shipped April 2026. UNVERIFIED: GA date.
- Okta for AI Agents: the release overview lists Core as GA on 2026-06-25 (https://www.okta.com/en-in/products/release-overview/). Okta's Launch Week page says Early Access (https://www.okta.com/blog/product-innovation/launch-week-1-showcase-edition/), so the sources conflict. Auth0 "Agent as Principal" is Beta and Cross App Access is EA, per the same release overview. No agent pricing found for either. These are identity-centric, enterprise-priced, and bundled.
- Permit.io: MCP Gateway and an "Access Request MCP" where agents request sensitive actions and humans decide (https://docs.permit.io/mcp-permissions/overview). Its MCPermit page is marked upcoming. No native Slack/Telegram approval confirmed. It is the closest policy+HITL competitor.
- Descope: Agentic Identity Hub, MCP authorization server, 50+ outbound integrations (Slack is a connected app, not an approval channel). Launched "Envoy" for consumer-app agent auth on 2026-11-04 (https://helpnetsecurity.com/2026/11/04/descope-envoy). Stytch: marketing material only, nothing on approvals found.
- MCP spec 2026-07-28: final July 28, 2026 (https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/). It covers scope step-up, with additional scopes requested incrementally (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). URL-mode elicitation for out-of-band sensitive interactions arrived in 2025-11-25 (https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation.md). Critique: no RFC 9470-style proof of human presence (https://workos.com/blog/mcp-scope-step-up-vs-authentication-step-up). This is a real gap: the spec does not say who approved a specific action or prove it, which approvals + audit fills.
- Anthropic/OpenAI approval UX: NOT FOUND in my searches. UNVERIFIED. Assume in-client permission prompts tied to the vendor's own client, not cross-channel, org-wide, or auditable. Needs a targeted check.

IS IT COMMODITIZED?
- Commoditized: OAuth/identity for agents (Okta, Auth0, Entra, Descope, Stytch), tool-call brokering (Arcade, Composio), and the MCP scope step-up primitive.
- Not commoditized: approvals delivered in the chat apps people already use (Telegram/WhatsApp), with spend reservation and org-wide caps, single-use step-up, hash-chained audit with a verify endpoint, and sealed/anchored decisions. I found no vendor offering this bundle. Caveat: my search coverage of Slack-native HITL tools was thin, so a smaller competitor may exist (UNVERIFIED).
- Risk: identity vendors bundle "agent governance" into existing enterprise contracts. Selling against Okta/Microsoft to enterprises is unwinnable for a solo founder at $0. Weakest-served segments are SMB, prosumer, and agent builders who need money/spend-gating (payments agents, x402, procurement) where Suwappu's spend-reservation engine is distinctive.

SUGGESTED POSITIONING (non-crypto): "Spend and action governor for AI agents": policy plus human approval over WhatsApp/Telegram, with a verifiable audit trail. Wedge: agents that move money or take irreversible actions (payments, procurement, ads spend, SaaS purchases, refunds). Remove chain/token fields from the policy schema, keep crypto as one adapter. Distribution via MCP server and A2A. Price usage-based per approval/metered action, with a free tier.

Not verified in code this run (task supplied asset descriptions; I did not re-read the files).

HANDOFF
agent: none
task: Founder decision. Optionally dispatch researcher for (1) Anthropic/OpenAI approval UX docs, (2) Slack-native HITL competitors, (3) HumanLayer primary pricing/status; then api-ts-dev to generalize PolicyService action schema beyond chain/token fields.
files: api-ts/src/services/PolicyService.ts, ApprovalService.ts, audit.ts (cited from the task, not re-verified)
risks: MONEY-PATH if the policy schema is generalized (spend reservation, caps); cross-stack check of Python bot needed; no migration yet.

## verifiable-audit-compliance
**Answer:** A buyer exists, but it is weak and early for "cryptographically verifiable" specifically. The paying demand is for logging, oversight evidence and insurability. Hash-chaining is a differentiator that auditors and insurers do not yet require. Best wedge: regulated finance (FINRA/SEC-supervised firms) and insurers/AI-assurance bodies, not generic EU compliance. This is thin, secondary-source research (3 searches), so treat everything as indicative.

**EU AI Act timing**
- The Digital Omnibus provisional deal was reached 7 May 2026. Annex III stand-alone high-risk obligations move to 2 Dec 2027, and embedded-product high-risk obligations to 2 Aug 2028. Sources: [Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement), [White & Case](https://www.whitecase.com/insight/eu-agrees-digital-omnibus-deal-simplify-ai-rules), [The Register, 2026-05-07](https://www.theregister.com/ai-and-ml/2026/05/07/eu-hits-snooze-on-ai-act-rules-after-industry-backlash/5234530).
- UNVERIFIED: whether formal adoption and Official Journal publication happened (one firm expected it before 2 Aug 2026). Check EUR-Lex.
- UNVERIFIED: whether Article 12 (automatic logging) or Article 14 (human oversight) text changed. Results only showed date shifts. The 2027 date helps us, because that is when logging becomes a hard requirement for hiring, credit and similar Annex III uses.
- Article 12 requires automatic event logging but does not mandate cryptographic proof. An IETF individual draft (not a standard) says no standard exists for how agents should log, and proposes hash chains plus optional signatures and Merkle anchoring, mapped to SOC 2 and ISO 42001 ([draft-sharif-agent-audit-trail](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/)). Our audit.ts and seal.ts design is close to this. That supports the idea but shows no buyer yet.

**US financial regulators**
- FINRA's 2026 Oversight Report (9 Dec 2025) is the first to discuss AI agents. It ties them to supervision (Rule 3110), supervisory controls (Rule 3120) and books-and-records, and mentions tracking agent actions and limiting system access. Sources: [FINRA](https://www.finra.org/media-center/newsreleases/2025/finra-publishes-2026-regulatory-oversight-report-empower-member-firm), [Debevoise](https://www.debevoise.com/insights/publications/2025/12/finras-2026-regulatory-oversight-report-continued), [Sidley](https://www.sidley.com/en/insights/newsupdates/2025/12/finra-issues-2026-regulatory-oversight-report).
- The statement that system-level audit trails of tool calls and decision paths are needed comes from a law firm's recommendation ([Snell & Wilmer](https://swlaw.com/publication/finras-2026-oversight-report-signals-a-supervisory-reckoning-for-autonomous-ai)), not FINRA's own text.
- This is guidance, not a rule. Broker-dealers already pay for supervision and archiving vendors such as Smarsh. UNVERIFIED: SEC-specific AI-agent recordkeeping rules. I did not search them.

**Insurance**
- AIUC-1 is an AI-agent certification standard from AIUC, which raised a $15M seed ([Fortune, 2025-07-23](https://fortune.com/2025/07/23/ai-agent-insurance-startup-aiuc-stealth-15-million-seed-nat-friedman/)). It has six pillars and requires an accredited audit with quarterly retests.
- A third party claims AIUC-1 D003 expects logs of tool name, parameters and timestamps ([vorplabs](https://vorplabs.com/ai-agent-liability)). UNVERIFIED: not confirmed against AIUC's own standard.
- Munich Re's aiSure covers AI performance failures ([Munich Re](https://www.munichre.com/en/solutions/for-industry-clients/insure-ai.html)). UNVERIFIED: no source says it requires audit logs or AIUC-1.
- The plausible buyers are insurers and AIUC-style certifiers. They need evidence for underwriting and claims, and tamper-evident, policy-enforced logs fit that.

**Vendors (Langfuse, Arize, Credo AI, Holistic AI, Vanta)**
- UNVERIFIED: my searches returned nothing on any of them, so I cannot cite their offerings or pricing.
- From general knowledge, not checked today: Langfuse and Arize do observability and tracing (mutable logs). Credo AI and Holistic AI do governance and risk workflows. Vanta does SOC 2 and ISO 42001 evidence collection.
- Inference: these are likely integration partners or channels (an "evidence source" feeding Vanta, or a verifier next to Langfuse traces) more than direct competitors. Verify before pitching.

**Is there a buyer?**
- Plausible buyers: (1) regulated fintech and broker-dealer teams deploying agents that act (trade, pay, message clients); (2) insurers and AI-assurance certifiers wanting enforceable evidence; (3) enterprise agent deployers who need to show auditors that approval gates worked.
- Our edge over observability tools: we record enforcement (policy allow/block/approve, step-up approvals, spend caps) and not just traces. That is stronger evidence of human oversight (Article 14) than a log of what happened.
- Risks: no mandate for crypto-verifiability yet, and the 2027 deadline is far off. EU AI Act, ISO 42001 and SOC 2 are compliance spend that goes to Vanta-type tools first. A solo founder with about 0 users has no enterprise sales motion.
- Cheapest validation: ship an exportable "agent action evidence pack" (hash-chain verify output plus policy and approval records, mapped to Article 12/14, FINRA 3110 and AIUC-1). Then interview 10 fintech compliance leads and 2-3 AI insurance and assurance startups.

**Suggested next steps**
- A follow-up researcher pass should cover SEC and OCC AI-agent guidance, Vanta/Credo/Langfuse pricing, and EUR-Lex omnibus adoption status.
- A showcase page for the "evidence pack" would be the build step, but only after buyer interviews.

HANDOFF
agent: none
task: Follow-up research only (SEC/OCC AI-agent guidance, Vanta/Credo/Langfuse offerings, EUR-Lex omnibus adoption status, AIUC-1 D003 primary text). No build until 10 buyer interviews confirm demand.
files: /home/user/suwappubot/api-ts/src/services/audit.ts, /home/user/suwappubot/api-ts/src/services/PolicyService.ts, /home/user/suwappubot/api-ts/src/services/ApprovalService.ts (asset paths taken from the task text, not re-read by me)
risks: No code touched. If built later: evidence-pack export would read audit data (privacy and PII review needed). Not a money path unless it touches PolicyService spend reservation.

## chat-native-agents
**Answer:** Chat-native agents are a real, crowded-at-the-top but under-served-in-the-middle opportunity. The best wedge for Suwappu is not another assistant. It is a "spend-governed agent layer" (rules, approvals, receipts) sold to SMBs and agencies that deploy agents inside WhatsApp and Telegram, especially in UPI/Pix markets. Research was shallow (2 searches). Everything below is search-snippet level except where noted.

**Platform policy (the key constraint)**
- Meta changed the WhatsApp Business API terms in Oct 2025 to bar general-purpose chatbots. New users were bound from 2025-10-15 and everyone from 2026-01-15. ChatGPT, Perplexity, Luzia and Poke were reported as affected, which leaves Meta AI as the only general assistant. Source: [TechCrunch, 2025-10-18](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform), [respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban).
- Task-specific bots stay allowed, such as customer support and transactional flows. Meta keeps discretion over what counts as "general-purpose" (respond.io). **Implication:** build narrow, task-scoped agents (pay this bill, book this slot). Do not build an open "ask me anything" bot on WhatsApp. Telegram has no such ban.
- UNVERIFIED: how strictly Meta has enforced this since January. I found no enforcement reporting.

**Payments in chat (status late 2026)**
- India: Meta Business Agent for small businesses launched with Razorpay payment links. Meta said UPI payments inside the chat are "coming soon" ([Business Today, 2026-05-07](https://www.businesstoday.in/technology/story/whatsapp-launches-ai-powered-customer-support-for-small-businesses-in-india-upi-payments-coming-soon-530313-2026-05-07), [The Paypers](https://thepaypers.com/payments/news/razorpay-brings-payments-to-meta-business-agent-on-whatsapp-in-india), [YourStory, 2026-11](https://yourstory.com/2026/11/kunal-shah-outlines-whatsapps-next-phase-with-ai-payments-richer-conversations)).
- Regulation: a Reuters report cited in the search summary says NPCI is building a registry to verify AI agents making UPI payments. I did not open the original. This is a direct opening for an audit and authorization layer.
- Brazil: Sinch says WhatsApp retired in-chat card payments for new purchases. Pix, boleto and payment links remain. Sources disagree on which markets are live: Sinch says no US/EU launches, while the Help Center reportedly lists India, Brazil, Mexico and Indonesia ([Sinch](https://www.sinch.com/whatsapp-pay-mobile-payment-news-statistics-and-developments/), [Infobip](https://www.infobip.com/blog/whatsapp-payments)).
- BCG says A2A rails (UPI, Pix) carry more than half of transactions in India and Brazil, and projects agentic workflows will influence more than 50% of global e-commerce spend. The second figure is a forecast ([Business Standard, 2025-09](https://www.business-standard.com/economy/news/india-brazil-real-time-a2a-payments-bcg-report-125092201210_1.html), [EBANX](https://www.ebanx.com/en/beyond-borders-2026/section-ai-and-payments/chapter-agentic-commerce)).

**Competitors**
- Meta Business AI plus Razorpay: the incumbent for SMB sales and support, and it is closed. It has no obvious user-defined spend policy or approval layer. UNVERIFIED.
- Orchestration vendors (respond.io, Infobip, Sinch): messaging infrastructure with AI add-ons. No evidence found of spend-policy features.
- Not researched: Telegram wallet/mini-app agents, iMessage and Slack agent payments, and card-network agent products (Visa, Mastercard, Stripe agent payments). Check these before committing.

**Where spend rules, approvals and receipts could win (my inference)**
1. **Agent payments with a human in the loop in chat.** The agent proposes, the owner taps approve in WhatsApp or Telegram, a single-use step-up approves it, and a tamper-evident receipt is returned. This maps to PolicyService, ApprovalService and the audit chain. It fits NPCI-style agent verification.
2. **SMB owner delegating to staff or agents:** supplier payments, bills and refunds with per-person caps and org-wide limits (the org and members model).
3. **Remittance and bill-pay agents in emerging markets:** policy and approval gating on top of UPI/Pix links. UNVERIFIED whether a licensed partner is needed. Regulated money movement is the main risk for a solo founder, so stay non-custodial and issue payment links only.
4. **Disputes and receipts as a product:** sealed decisions and Arbiter for "agent said it would do X" evidence, aimed at agencies running agents for clients. Speculative, with no demand evidence yet.
5. **Reach advantage:** Telegram, WhatsApp, Discord, MCP and A2A are already built. This is a distribution moat only if Meta approves the use case.

**Risks**
- Meta policy and enforcement risk, and the closed Meta Business Agent as the default for SMBs.
- Payment licensing and regulation.
- Demand is unproven at roughly 0 users.

**Suggested next step:** a no-code pilot. Pick one vertical (for example Indian SMB supplier payments or freelancer invoicing), ship a narrow WhatsApp/Telegram flow using a Razorpay or Pix payment link, and put the policy and approval gate in front of it. Validate with 5 to 10 owners before building anything new.

HANDOFF
agent: none
task: Follow-up research (researcher): verify Telegram, iMessage and Slack agent-payment competitors, Visa/Mastercard/Stripe agent-payment programs, and the NPCI AI-agent registry (primary source). Then pick one vertical for a pilot.
files: api-ts/src/services/PolicyService.ts, api-ts/src/services/ApprovalService.ts, api-ts/src/services/audit.ts (cited by the caller, not re-verified by me)
risks: Regulatory (money transmission) if the flow ever touches custody. MONEY-PATH if built. Meta policy risk on WhatsApp. Market claims rest on search snippets and need primary-source checks.

## code-generality
CODE-GENERALITY AUDIT: can the crypto stack become an "action control plane"? (read-only, api-ts/src, 2026-11-20)

VERDICT: The trust primitives (approvals, audit, seal, orgs, metering) are roughly 80-95% generic already. The policy engine's rule set and the MCP server are crypto-only. A credible domain-agnostic MCP gateway is about 15-25 focused days for one developer to reach a demo-able MVP, and about 35-45 days to be production-grade. I give no market claims here; the size of the opportunity needs a separate research pass.

GENERIC: REUSE AS-IS OR NEARLY
1. services/audit.ts (269 LOC): fully generic. "chain" in this file means the hash chain, not a blockchain. `AuditEvent{userId, orgId, agentId, eventType, details}`, `computeEntryHash` (canonical JSON + prevHash), `auditLog` (per-org pg_advisory_xact_lock serialization) and `verifyAuditChain` all carry over as-is. One rename: userId is a numeric Telegram-era id, so allow it to be optional or a string principal. About 0.5 day.
2. lib/seal.ts (128 LOC): generic commit-reveal (`canonicalize`, `computeCommitment`, `seal`, `verifySeal`). Only `sealMemo`/`parseSealMemo` mention on-chain anchoring, and that is an optional transport. Reframe it as "notarize the decision before execution" and anchor to chain, RFC 3161 or a transparency log. 0 days.
3. services/ApprovalService.ts (633 LOC): the state machine is generic: `create`/`decide`/`decideApproveWithStepUp`/`issueStepUpChallenge`/`validateForExecution`/`finalizeConsume`, single-use consume, 15-minute TTL, payloadHash binding, `approvalOwnershipCondition`. The schema (db/schema/approvals.ts) already has a free-form `actionType`. The only coupling is `payload: EconomicTerms` (lib/approvalTerms.ts: isSolana, fromChain, tokens, amountOutMin, walletAddress). Make the payload `Record<string, JsonValue>` with a per-action-type "core terms" extractor (`coreTermsOf` becomes a registry) and an optional "re-validate at execution" hook (today: re-quote and require amountOutMin >= approved). lib/stepUpChallenge.ts (45 LOC) is generic. About 2-3 days.
4. routes/enterprise.ts (833 LOC): generic orgs, members and roles, API keys, `/orgs/:orgId/usage`. Only 4 crypto mentions. 0.5 day.
5. Billing and metering: middleware/recordUsage.ts (41), services/StripeService.ts (328), RecurringBillingService.ts (112), middleware/requireTier.ts, requireScope.ts, rateLimit.ts. These are generic SaaS plumbing. middleware/x402Payment.ts (648) is generic "pay-per-call" but stablecoin-rail specific. Keep it as an optional rail and lead with Stripe metered billing. About 1 day to meter "actions evaluated / approvals routed" instead of swaps.
6. Telegram approval UX exists: bot/handlers/approvals.py (430 LOC; `/approvals` and inline `apprv:<id>:yes|no` callback, registered at bot/main.py:534-535). It is Python-side and reads the same table. It needs generic rendering of an arbitrary payload, about 1 day.

CRYPTO-SPECIFIC: REWRITE
1. services/PolicyService.ts (652 LOC, 74 crypto references). Keep the skeleton: verdict type `allow|block|require_approval`, `evaluate`, fail-closed, priority-ordered policies, `loadCapUsage` (hour/day/session windows on agent and org), `reserveApprovalAllowance` and `releaseApprovalAllowance` (advisory-lock TOCTOU-safe spend reservation, partial unique index on approval_id). That is the hard, valuable part, and it is about 60% of the file.
   Rewrite: `PolicyIntent` (chain, fromToken, toToken, destinationAddress, contractAddress, valueUsd, slippageBps, gasUsd) and `evalStateless` (lines 120-206: maxTxUsd, slippage, gas, chain/token allow/block lists, destinationAllowlist, allowedContracts).
   Replace them with `ActionIntent{actionType, tool, resource, counterparty, amount{value,currency}?, attributes: Record<string,unknown>}` and pluggable rule evaluators: amount caps, allow/deny lists on any attribute path, time windows, rate, regex or domain match (for example, an email recipient domain), plus an optional CEL or OPA/Rego adapter.
   Schema db/schema/policies.ts has hard columns (maxSlippageBps, allowedChains, allowedTokens, ...). Add `rules jsonb` and `actionTypes text[]`, and keep the legacy columns mapped into a "crypto" rule pack, as additive migrations per CLAUDE.md. policyDecisions.valueUsd generalizes to amount + currency, or an abstract "spend units". About 5-7 days, including keeping swaps working on the new engine.
2. routes/mcp.ts (1,845 LOC, 370 crypto references): a hand-rolled JSON-RPC MCP server whose tools/call switch is all crypto (execute_swap, get_quote, perps_*, predict_*, lend_*, list_chains ...). Reusable parts: JSON-RPC/initialize/tools/list scaffolding, auth wiring, the aegisScan hook (middleware/aegisScan.ts: observe-only prompt-injection scan) and the upstream-content sanitization pattern (around line 506). There is NO proxy or upstream-forwarding capability today.
   The gateway is new code:
   - a per-org upstream registry, with credentials in KMS
   - tools/list aggregation and namespacing
   - an intercepting tools/call pipeline: map to ActionIntent, then policy, then (approval wait or async 202 + resume), then forward, then audit + seal
   - streamable-HTTP/SSE passthrough
   - a mapping DSL from tool args to intent fields
   About 7-10 days, starting from a new file, not by mutating mcp.ts.
3. Approval channels: Slack (none in api-ts today) and WhatsApp interactive buttons. Build a `Notifier` interface (Telegram adapter from the existing handler, Slack Block Kit plus signed interaction endpoint, WhatsApp template/interactive). About 3-4 days for Slack + WhatsApp, more if WhatsApp template approval by Meta lags.
4. lib/intercepta.ts (177): address-risk screening, crypto-only. Turn it into a "pre-execution risk screener" plugin slot. 0.5 day.
5. Arbiter (TEE verifier, docs/arbiter-*.md): I did not audit the code. Treat it as a later differentiator ("attested policy evaluation"), not MVP.

EFFORT SUMMARY (one developer, focused days)
- Generic intent + policy rules engine + migrations: 5-7
- Approval payload generalization + per-type revalidate hooks: 2-3
- MCP gateway/proxy (new): 7-10
- Notifiers (Slack, WhatsApp; Telegram refactor): 4-5
- Audit/seal/org/billing touch-ups: 2
- Hardening (secrets for upstream tool creds, SSRF guards on upstream URLs, load and timeout behavior, docs): 8-12
- MVP total: about 20-27 days. Production: about 35-45 days.

Uncertainty: I estimated from structure and grep, not a line-by-line read. The cost of keeping the swap path bit-for-bit compatible while re-platforming PolicyService is the largest risk. Every PolicyService change is MONEY-PATH and needs the money-path-reviewer.

RECOMMENDED SEQUENCE
1. Introduce ActionIntent and a rule registry beside the current engine. Swaps become one adapter.
2. Generalize the approval payload.
3. Build a new routes/gateway.ts MCP proxy that reuses auth, aegisScan, audit and seal.
4. Add the Slack notifier.
5. Demo on two non-crypto actions (for example, Stripe refund > $X needs approval; send email to an external domain is blocked) through a stock MCP server.

KEY FILES (absolute)
- /home/user/suwappubot/api-ts/src/services/PolicyService.ts (rewrite evalStateless at 120-206 and PolicyIntent at 30-52; keep 207-652)
- /home/user/suwappubot/api-ts/src/services/ApprovalService.ts (keep; retype payload)
- /home/user/suwappubot/api-ts/src/lib/approvalTerms.ts (replace with a per-action-type registry)
- /home/user/suwappubot/api-ts/src/services/audit.ts (keep)
- /home/user/suwappubot/api-ts/src/lib/seal.ts (keep)
- /home/user/suwappubot/api-ts/src/routes/mcp.ts (reuse scaffolding only; gateway is new)
- /home/user/suwappubot/api-ts/src/routes/enterprise.ts (keep)
- /home/user/suwappubot/api-ts/src/middleware/{recordUsage,aegisScan,x402Payment,requireScope,requireTier}.ts (keep)
- /home/user/suwappubot/api-ts/src/db/schema/{policies,approvals,security}.ts (additive jsonb rules / actionTypes)
- /home/user/suwappubot/bot/handlers/approvals.py (Telegram approver; generalize rendering)

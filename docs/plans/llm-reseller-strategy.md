# LLM Reseller Strategy — Anthropic, OpenAI, DeepSeek & Chinese Models

**Status:** Research / proposal · **Date:** 2026-06-25 · **Owner:** TBD

Goal: let Suwappu resell access to frontier + cheap LLMs (Claude Opus/Fable, GPT‑5.5,
DeepSeek, Qwen/Kimi/GLM/MiniMax) — users pay in our existing credits, we proxy to the
providers with a markup. This doc covers the **providers** (models, pricing, SDKs), the
**legal reality of reselling**, and a **recommended architecture** that reuses what we
already have.

> ⚠️ **Read §3 first.** Both OpenAI and Anthropic *prohibit reselling raw API access*.
> What they permit — and what we'd actually build — is a **value-added product** that
> fronts the API with our own accounts, moderation, and AI disclosure. The distinction
> is the whole ballgame and dictates the design.

---

## 1. What we already have (the good news)

The Explore audit found **no LLM integration today** (only OpenAI Whisper for WhatsApp
voice transcription in `bot/services/whatsapp_voice.py`). But the two hardest pieces of a
reseller already exist:

| Asset | Location | Why it matters |
|---|---|---|
| **Prepaid credits (x402)** | `api-ts/src/middleware/x402Payment.ts`, `bot/services/x402_service.py` | 1 credit = $0.001, atomic per-call deduction, on-chain USDC top-up. This *is* the metering layer a reseller needs. |
| **Stripe subscriptions** | `api-ts/src/routes/billing.ts` | free/pro/premium/enterprise tiers — bypass metering for subscribers. |
| **Agent / MCP API surface** | `api-ts/src/routes/agent.ts`, `agent-card.json` | `/v1/agent/*`, A2A, MCP server, per-agent API keys + topups already exist. The natural place to expose an LLM endpoint. |
| **Crypto top-ups** | x402 facilitator (Base/Polygon/Arbitrum/World/Solana) | Crypto/USDC payments are **irreversible → no chargebacks**, the #1 fraud mitigation for a reseller (see §6). |

**What's missing:** the provider integration layer itself — a multi-provider proxy +
per-request cost ledger. That's the only net-new system. See §5.

---

## 2. Provider landscape (mid‑2026)

All prices are **USD per 1M tokens (input / output)**. Model IDs churn fast — re-verify at
integration time.

### 2a. Anthropic (Claude) — *authoritative, from the claude-api reference*

| Model | ID | In | Out | Context |
|---|---|---|---|---|
| Fable 5 (most capable) | `claude-fable-5` | $10 | $50 | 1M |
| **Opus 4.8** (default) | `claude-opus-4-8` | $5 | $25 | 1M |
| Sonnet 4.6 | `claude-sonnet-4-6` | $3 | $15 | 1M |
| Haiku 4.5 | `claude-haiku-4-5` | $1 | $5 | 200K |

- Native API is `/v1/messages` (**not** OpenAI-shaped). Anthropic ships an OpenAI-compat
  shim but it **drops prompt caching, ignores strict tool schemas, and hides extended
  thinking** — route Claude over its **native Messages API**, not the shim.
- Fable 5 quirks: thinking always-on, `refusal` stop_reason, requires 30-day data
  retention (no ZDR), opt into server-side `fallbacks` to Opus 4.8.
- Prompt caching: reads bill ~10% of input. **Cost reporting caveat:** `input_tokens`
  only counts tokens *after the last cache breakpoint* — bill on the sum of
  `input_tokens + cache_creation + cache_read`, not `input_tokens` alone.

### 2b. OpenAI

"chat 5.5" = **`gpt-5.5`** (confirmed flagship). Lineup:

| Model | ID | In | Cached in | Out |
|---|---|---|---|---|
| Flagship | `gpt-5.5` | $5.00 | $0.50 | $30.00 |
| Reasoning max | `gpt-5.5-pro` | $30.00 | — | $180.00 |
| Prior flagship | `gpt-5.4` | $2.50 | $0.25 | $15.00 |
| Cheap mid | `gpt-5.4-mini` | $0.75 | — | $4.50 |
| Cheapest | `gpt-5.4-nano` | $0.20 | — | $1.25 |
| Code | `gpt-5.3-codex` | $1.75 | — | $14.00 |

- Base URL `https://api.openai.com/v1`, `Authorization: Bearer`, endpoints
  `/v1/chat/completions` (the de-facto standard) + `/v1/responses`.
- **Batch API ≈ 50% off**; cached input auto-applied at ~10%.
- **Moderation endpoint (`omni-moderation-latest`) is free** — run it on all proxied
  inputs to satisfy the safeguard requirement (§3).

### 2c. DeepSeek + cheap Chinese models

All expose an **OpenAI Chat-Completions-compatible endpoint** → one client, swap
`base_url + key + model`.

| Provider | Model IDs | In / Out | Intl base URL (USD, Visa/MC) |
|---|---|---|---|
| **DeepSeek** | `deepseek-v4-flash`, `deepseek-v4-pro` | $0.14/$0.28 · ~$0.44/$0.87 | `https://api.deepseek.com` |
| **Qwen** (Alibaba) | `qwen-flash`, `qwen-plus`, `qwen3-max` | $0.05/$0.40 · $0.40/$1.20 · ~$1.25/$3.75 | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| **Kimi** (Moonshot) | `kimi-k2.6`, `kimi-k2.5` | $0.95/$4.00 · $0.60/$3.00 | `https://api.moonshot.ai/v1` |
| **GLM** (Zhipu) | `glm-4.6`, `glm-4.7`, `glm-5` | $0.60/$2.20 … $1.00/$3.20 | `https://api.z.ai/api/paas/v4` |
| **MiniMax** | `minimax-m3`, `minimax-m2.5` | $0.30/$1.20 · $0.15/$0.90 | `https://api.minimax.io/v1` |

- **Cheapest input:** Qwen-Flash ($0.05) and MiniMax M2.5 ($0.15). DeepSeek unbeatable on
  cache-hit (cache-hit ~$0.0028). **Best agentic/coding:** Kimi K2.x and GLM-4.6/4.7
  (both ship Anthropic-format endpoints for Claude-Code-style tooling).
- **Caveats (see §3/§6):** DeepSeek's mainland console processes data **in China** and has
  patchy international card support — **always use the `-intl`/`.ai`/`.io` endpoints**,
  which bill in USD, accept Visa/MC, and route overseas. Reasoning models emit an extra
  `reasoning_content` field — handle it; don't feed it back into context.

---

## 3. ⚠️ The legal reality of "reselling"

**This is the central risk.** Verbatim from each provider:

- **OpenAI** — "Customers cannot buy, sell, or transfer API keys." "Customers may not
  resell or lease access to their account or any End User Account." **But** building a
  *Customer Application* on top, with your own user accounts + keys + moderation, charging
  end-users, **is allowed**. Required: AI-use disclosure, your own moderation/safeguards,
  ability to suspend abusive end-users on request, no using outputs to train competing
  models.
- **Anthropic** (Commercial Terms §D.4(a)) — must not "…**resell the Services except as
  expressly approved by Anthropic**." Building a value-added product for your own Users is
  the intended model (§A.1); pure pass-through proxy-with-markup is the one thing called
  out. The Usage Policy "applies to anyone who can submit inputs… including via any
  authorized resellers." High-risk domains require human-in-the-loop + AI disclosure at
  session start.
- **Chinese providers** — DeepSeek et al. prohibit reselling the *model*; reselling raw
  *API access* sits in a gray zone. Most restrict sublicensing. Paid-tier no-train clauses
  exist but **get it in writing**.

**Takeaway — two postures:**

1. **Value-added product (recommended, low risk).** We are a *Customer Application*: our
   accounts, our keys, our moderation, AI disclosure, our branding. Users buy *Suwappu
   features* (an in-app AI assistant, agent tooling, model picker) priced in credits. The
   markup is on *the feature*, not on "raw OpenAI access." This is squarely permitted by
   every provider. **Frame the product this way from day one.**
2. **Explicit reseller agreement (high effort).** A true pass-through "buy GPT-5.5
   tokens from Suwappu" product needs a signed reseller/enterprise agreement — Anthropic
   has no self-serve reseller program (sales conversation), OpenAI bars key transfer
   outright. Only pursue if (1) proves demand.

**Action:** before launch, have counsel confirm posture #1 wording, and do **not** ever
hand end-users raw provider keys.

---

## 4. Rate-limit tiers & cost tracking

- **Anthropic:** auto-tiers on cumulative deposits; Tier 4 caps at **$200k/mo**, above
  which it's "Contact Sales" / Monthly Invoicing. **Admin API** (`sk-ant-admin01-…`):
  `usage_report/messages` and `cost_report` filter/group by `api_key_ids`,
  `workspace_ids`, `model` → per-customer attribution if we map **one workspace or API key
  per reseller customer**. Workspaces isolate spend + rate limits per tenant.
- **OpenAI:** 5 spend-based tiers; a high-volume reseller needs Tier 4–5 headroom and
  likely **key/org sharding**. Per-response `usage` object meters end-users; org Usage/Cost
  API reconciles.
- Both: store **cost per call** in our own ledger (provider unit price × tokens), not a
  global rate — provider prices change often.

---

## 5. Recommended architecture

**Integrate [LiteLLM](https://docs.litellm.ai) as a self-hosted proxy behind our existing
credits system. Do not build a raw proxy from scratch; do not resell via OpenRouter
(stacks their funding fee on our margin).**

Why LiteLLM: it already ships the exact reseller primitives — **virtual keys with
per-key budgets, RPM/TPM limits, model ACLs, spend tracking (Postgres), fallback/routing,
Redis caching** — across 100+ providers behind one OpenAI-compatible API. It's days-to-
weeks of integration vs. months building a gateway.

```
 Telegram bot / webapp / agent API
            │  (user identity + credit balance)
            ▼
   Suwappu LLM endpoint  ── new: api-ts/src/routes/llm.ts  ──┐
            │  checks credits via x402 middleware            │ writes cost ledger
            ▼                                                ▼
      LiteLLM proxy (self-hosted)  ───────────►  per-request spend → reconcile to credits
            │   virtual key per user, budget = credit balance
            ├── Claude  → NATIVE /v1/messages (keep caching + tool-calling)
            ├── OpenAI  → /v1/chat/completions  (+ free omni-moderation pre-check)
            └── DeepSeek / Qwen / Kimi / GLM / MiniMax → OpenAI-compat, intl endpoints
```

**Integration steps:**
1. Stand up LiteLLM proxy (Railway service) with upstream keys for each provider. Use the
   **international USD endpoints** for Chinese providers.
2. Add `api-ts/src/routes/llm.ts` (use `/new-route` skill): authenticates the Suwappu
   user, gates on credits via existing x402 middleware, forwards to LiteLLM.
3. Map **one LiteLLM virtual key per user**, budget set from their credit balance.
4. Meter spend from LiteLLM's Postgres spend table back into the credits ledger, applying
   our markup there. Add per-model pricing to `api-ts/src/config/constants.ts`.
5. Run OpenAI's **free moderation** on inputs; surface `refusal` stop_reasons gracefully.
6. **Isolation:** keep multiple upstream keys per provider so one tenant's policy
   violation can't ban the key for everyone (blast-radius containment).
7. Expose model picker in the bot (`/ai` command?) and webapp; subscribers (Stripe) get
   metered-bypass or discounted rates.

**Pricing/markup:** as a small player, take a real **per-token markup (~10–30%)** rather
than OpenRouter's 0%-markup-funding-fee model — cleaner to bill in credits and FX-hedge.
Settle provider invoices in USD to neutralize FX. Push **crypto/USDC top-ups** (we already
have them) to eliminate chargeback exposure.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Reselling ToS violation** | Posture #1 (value-added product, §3); legal review; never share raw keys. |
| **Provider key ban** (one tenant's abuse kills all) | Multiple upstream keys per provider; moderation pre-filter; fast tenant suspension. |
| **Card chargebacks / fraud** | Favor crypto/USDC (irreversible); treat credits as non-refundable; per-key spend caps; KYC on large top-ups. |
| **China data residency** | Use intl endpoints only; **disclose** to users that some models process data overseas/China; offer a "Western models only" toggle for privacy-sensitive users. |
| **Cost under-billing on cache** | Sum all token fields (`input + cache_creation + cache_read`), not `input_tokens`. |
| **Provider price changes** | Store unit cost per call in the ledger; refresh pricing config on a schedule. |
| **Model ID churn** | IDs (DeepSeek V4, GLM-4.7/5, Kimi K2.6, GPT-5.5) move fast — keep a versioned model registry, re-verify at deploy. |

---

## 7. Recommended next steps

1. **Decide posture** (§3) — confirm value-added-product framing with counsel. *(blocker)*
2. **Pick launch models** — suggest a 3-tier menu: budget (Qwen-Flash/MiniMax/DeepSeek),
   balanced (Sonnet 4.6 / gpt-5.4), frontier (Opus 4.8 / gpt-5.5), + a coding tier
   (Kimi K2 / GLM / gpt-5.3-codex).
3. **Spike LiteLLM** behind the existing credits middleware with 2 providers
   (Anthropic native + DeepSeek) as a proof of concept.
4. **Per-model pricing + markup** config in `constants.ts`; cost ledger schema (Drizzle
   migration via `/migrations`).
5. **Moderation + refusal handling** wired in before any public exposure.

---

### Sources

- OpenAI: [pricing](https://developers.openai.com/api/docs/pricing) ·
  [models](https://developers.openai.com/api/docs/models/gpt-5.5) ·
  [usage policies](https://openai.com/policies/usage-policies/) ·
  [service terms](https://openai.com/policies/service-terms/)
- Anthropic: [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) ·
  [Usage Policy](https://www.anthropic.com/legal/aup) ·
  [Usage & Cost API](https://platform.claude.com/docs/en/api/usage-cost-api) ·
  [rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- DeepSeek: [pricing](https://api-docs.deepseek.com/quick_start/pricing) ·
  [docs](https://api-docs.deepseek.com/)
- Chinese providers: [Alibaba Model Studio](https://www.alibabacloud.com/help/en/model-studio/model-pricing) ·
  [Moonshot/Kimi](https://pricepertoken.com/pricing-page/model/moonshotai-kimi-k2) ·
  [Z.ai/GLM](https://docs.z.ai/guides/overview/pricing) ·
  [MiniMax](https://platform.minimax.io/docs/api-reference/api-overview)
- Gateways: [OpenRouter pricing](https://openrouter.ai/pricing) ·
  [LiteLLM virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys) ·
  [Anthropic OpenAI-compat shim](https://docs.anthropic.com/en/api/openai-sdk)

*Caveat: model IDs and prices are mid-2026 snapshots from provider docs + search; the
`openai.com` policy pages 403 automated fetch, so ToS quotes are from indexed snippets —
confirm exact wording before launch.*

# Provider pricing & compatibility — verified 2026-08-04

All figures accessed 2026-08-04. **UNVERIFIED** marks anything without a primary source.

## Urgent: dead / at-risk model IDs in our catalog

| # | Finding | Our code | Status |
|---|---|---|---|
| 1 | **`deepseek-chat` + `deepseek-reasoner` RETIRED 2026-07-24 15:59 UTC.** Requests now error; they do *not* fall through to V4-Flash. | `llm_models.py:57,66`, `llm_providers.py:84` — and `deepseek-chat` is our **`DEFAULT_MODEL_NAME`, `metered=False`** | **DEAD** |
| 2 | **`gemini-2.0-flash` hard shutdown 2026-06-01.** | `llm_models.py:114` | **DEAD** |
| 3 | `gpt-4o-mini` / `gpt-4o` absent from OpenAI's current pricing page (lists gpt-5.5, 5.4, 5.4-mini, 5-mini, 5-nano). API availability post-Feb-2026 retirement reported to continue. | `llm_models.py:81,89` | **AT RISK** (unverified if still 200s) |
| 4 | `grok-2-latest` — no formal retirement notice, but xAI retired several slugs 2026-05-15 (auto-redirect to `grok-4.3`, billed at 4.3 rates) and `grok-2-image-1212` vanished from the served list. | `llm_models.py:100`, `llm_providers.py:56` | **AT RISK** |
| 5 | **Qwen base_url is the China/Beijing endpoint**, not international — a different region *and billing account*. | `llm_providers.py:69` | **WRONG REGION** |

Sources: [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing),
[Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations),
[OpenAI pricing](https://developers.openai.com/api/docs/pricing),
[OpenAI retirement notice](https://openai.com/index/retiring-gpt-4o-and-older-models/),
[xAI May 15 retirement](https://docs.x.ai/developers/migration/may-15-retirement),
[Alibaba OpenAI-compat](https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope).

## Current pricing (USD per 1M tokens)

| Provider | Fast/mini | in/out | Flagship | in/out | Cache | Batch | OpenAI-compat base URL |
|---|---|---|---|---|---|---|---|
| Anthropic | claude-haiku-4-5 | $1 / $5 | claude-sonnet-5 (intro thru 8/31/26; then $3/$15) | $2 / $10 | read 0.1x; **write 1.25x (5m) / 2x (1h)** | 50% | N/A (native Messages API) |
| OpenAI | gpt-5-mini | $0.25 / $2.00 | gpt-5.5 | $5.00 / $30.00 | cached input 0.1x | 50% | api.openai.com/v1 |
| xAI | grok-build-0.1 (<200k) | $1.00 / $2.00 | grok-4.5 (<200k) | $2.00 / $6.00 | cached ~0.15–0.3x | UNVERIFIED | api.x.ai/v1 |
| Gemini | gemini-3.5-flash-lite | $0.30 / $2.50 | gemini-3.1-pro-preview (≤200k) | $2.00 / $12.00 | context cache $0.03–$0.40/1M **+ hourly storage fee** | ~50% | generativelanguage.googleapis.com/v1beta/openai/ |
| Qwen (intl) | qwen-turbo | $0.05 / $0.20 | qwen-plus | $0.40 / $1.20 | UNVERIFIED | ~50% (aggregator) | dashscope-intl.aliyuncs.com/compatible-mode/v1 |
| Moonshot/Kimi | moonshot-v1-8k — **UNVERIFIED**, not on current pricing index | — | Kimi K3 | $3.00 / $15.00 | cache hit $0.30 (0.1x), automatic, no config | UNVERIFIED | api.moonshot.ai/v1 (intl) vs .cn (China) |
| DeepSeek | deepseek-v4-flash | $0.14 / $0.28 | deepseek-v4-pro | $0.435 / $0.87 | cache-hit input $0.0028 flash / $0.003625 pro ≈ **0.02x** | off-peak policy announced, **not yet live** | api.deepseek.com |

Sources accessed 2026-08-04: [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing),
[OpenAI](https://developers.openai.com/api/docs/pricing), [xAI](https://docs.x.ai/docs/models),
[Gemini](https://ai.google.dev/gemini-api/docs/pricing), [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing),
[Kimi K3](https://platform.kimi.ai/docs/pricing/chat-k3).

**Qwen pricing is aggregator-only** (BenchLM, eesel) — the official Alibaba Cloud pricing page
returned no numeric table on two fetch attempts. Treat as unconfirmed.

## `tool_choice` and usage-shape gaps

Our code depends on **forced tool choice** + **usage accounting** on every provider.

- **Gemini OpenAI-compat may reject `tool_choice: "required"`** — a Google forum thread and
  GitHub issue report it errors with *"should be one of 'none' or 'auto'"*. Official docs only
  demonstrate `"auto"`. Our code routes Gemini through the OpenAI-compat URL, so **this needs a
  live test before trusting it**. UNVERIFIED whether since fixed.
- **DeepSeek** — supports `tool_choice: "required"` and forced-named functions. Usage uses
  **non-standard field names**: `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`, not
  OpenAI's `prompt_tokens_details.cached_tokens`. Shared usage parsing must special-case this.
- **xAI** — usage includes `prompt_tokens_details.cached_tokens` (OpenAI shape). Forced
  `tool_choice: "required"` support UNVERIFIED from primary docs.
- **OpenAI / Anthropic** — both confirmed for forced tool choice + standard usage. (Anthropic
  uses `tool_choice: {type: "any"|"tool"}`, a different shape — our code already branches on
  `call_style`.)
- **Qwen/DashScope and Moonshot/Kimi** — no primary-source confirmation of either forced
  `tool_choice` or cached-token reporting. **UNVERIFIED — needs a live smoke test.**

## Takeaway

This table was researched, hand-entered, and **already contained two dead models within one
session of being written**. That is the empirical case for not hand-maintaining prices — see
`04-metering-architecture.md` §1–2 (vendor LiteLLM's `model_prices_and_context_window.json`,
cross-check against OpenRouter's `/models` as a price oracle without routing through them).

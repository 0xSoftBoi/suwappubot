# LLM metering & billing architecture — production practice

Researched 2026-08-04. Sources inline.

## 1. Gateways / proxies

| Gateway | Per-user keys + budgets | Price table | Failover | Self-host | Fee |
|---|---|---|---|---|---|
| **LiteLLM Proxy** | Yes (`max_budget`, `budget_duration`, `tpm/rpm` per key/user/team; needs Postgres) | Yes, standalone-importable | Yes | Yes (OSS) | none (self-hosted) |
| **Portkey** | Yes, 1600+ providers | Yes | Yes | Hybrid | platform fee |
| **Helicone** | Yes | observability-focused | Yes | Yes | **0% markup**, Pro $79/mo |
| **OpenRouter** | Keys yes | Yes — live `/models` | Yes | No | pass-through + **5.5% on credit purchases** |
| **Cloudflare AI Gateway** | Basic | analytics only | Yes | No | 0% inference; 5% on credits |
| **Vercel AI Gateway** | Basic | Yes | Yes | No | **0% markup** |
| **Bifrost** | Yes | Yes | Yes | Yes | none |

### LiteLLM price map without the proxy — the key finding

`model_prices_and_context_window.json` is a continuously-updated map of model →
`input_cost_per_token`, `output_cost_per_token`, `cache_read_input_token_cost`,
`cache_creation_input_token_cost`, context window.

**You can use it without running LiteLLM's proxy**: `pip install litellm`, then
`litellm.get_model_info(model)` / `litellm.completion_cost(...)`, or fetch the raw JSON.
Set `LITELLM_LOCAL_MODEL_COST_MAP=True` to force the bundled local copy so you don't depend
on GitHub at cold start. Virtual keys + budgets are a *separate* feature that does need
Postgres + the proxy server; the price table does not.
([json](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json),
[custom pricing docs](https://docs.litellm.ai/docs/proxy/custom_pricing))

**Recommendation:** don't hand-maintain a price dict. Vendor the LiteLLM JSON pinned, and
refresh via a scheduled job that **diffs before applying** — never auto-apply unreviewed
price changes to a live billing path.

## 2. Price-table maintenance

Three credible machine-readable feeds, cross-checkable:

1. **LiteLLM JSON** — most widely embedded; PR-driven, can lag provider announcements days.
2. **OpenRouter `/models`** — live, provider-verified (their own margin depends on accuracy).
   Usable purely as a **price oracle even if you never route traffic through them** —
   includes explicit cache read/write pricing fields.
3. **`pydantic/genai-prices`** — newer (2026) Python package built for exactly this: historic
   price versioning, tiered/variable pricing, provider+model ID matching.
   ([github](https://github.com/pydantic/genai-prices))

*UNVERIFIED:* "models.dev" did not surface as an established source; treat as unverified.

**Langfuse best practice:** prefer **provider-reported cost/usage in the API response** over
recomputing from a static table — the table is the fallback for providers that don't echo
cost. ([Langfuse](https://langfuse.com/resources/engineering/llm-cost-management))

**Layered recommendation:** (a) provider-returned tokens = ground truth for *quantity*;
(b) vendored LiteLLM JSON for *price*; (c) OpenRouter `/models` as a periodic drift alarm.

## 3. Metering correctness

- **Reserve-then-settle, not pure post-paid.** Estimate max cost pre-call (known prompt
  tokens + `max_tokens` ceiling), reserve against balance, execute, settle to actual, release
  the delta. Mirrors card auth-holds. If the reservation fails the call never fires.
  ([Stigg](https://www.stigg.io/blog-posts/usage-based-api-billing),
  [Flexprice](https://flexprice.io/blog/how-to-meter-llm-tokens-usage-for-billing))
- **Idempotency keys on the settlement write**, not just the outer HTTP call. A client retry
  after a network timeout must not double-debit when the LLM call already completed and cost
  money. ([Stripe](https://stripe.com/blog/idempotency))
- **Streaming + abort is the sharpest gap in the ecosystem.** Usage arrives only in the final
  SSE chunk (`stream_options: {include_usage: true}`). Client disconnect before it = tokens
  silently lost. Open LiteLLM bugs as of 2026 ([#14457](https://github.com/BerriAI/litellm/issues/14457),
  [#18887](https://github.com/BerriAI/litellm/issues/18887)). Mitigation: count streamed
  tokens as forwarded, reconcile against final usage if the stream completes; on abort bill
  the approximation and flag `usage_source=estimated`.
  **N/A for Suwappu today — the bot has no streaming (verified by audit).**
- **Cached input needs its own price tier, not a discount flag.** Anthropic: cache **write =
  1.25x** (5-min TTL) or **2.0x** (1-hr), cache **read = 0.1x** (90% off). OpenAI: write 1.25x
  on newest models, read 0.5x. A single request can have **four distinct token buckets**:
  input, cached-read input, cache-write input, output. Schema needs a field per bucket.
  ([finout](https://www.finout.io/blog/anthropic-api-pricing),
  [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching))
- **Failed/timed-out calls that consumed tokens must still be billed or at minimum logged.**
  A provider 500 after generating output is a real-money event your app sees as a failure.
  Log `status` separately from whether it was billed.

## 4. Abuse & rate limiting

- **Redis-backed distributed limiter is mandatory past one replica.** In-memory per-process
  counters break silently — N instances each independently serving the same abuser.
  ([dev.to](https://dev.to/saumya_karnwal/distributed-rate-limiting-five-problems-that-break-your-counters-454))
- **Token bucket over fixed daily cap** — burst tolerance without clock-boundary gaming.
  Implement check-and-decrement as a single Redis **Lua script** for atomicity (avoids TOCTOU
  across replicas).
- **Weight the limiter by cost, not request count.** Scale bucket cost by estimated max tokens
  so one call with `max_tokens=100000` can't slip past a per-request limiter.
- **Context-bombing detection:** cap max input tokens per call independent of the model's
  context window; track *tokens per unit time* per user as the primary abuse signal.
- **Per-user concurrency cap** (e.g. 3 in-flight) — stops parallel-firing past a rate-limit
  window before the first response lands. Redis counter with a TTL safety net.

## 5. Observability & reconciliation

**Log per call:** user_id, request_id (idempotency key), model, provider, input_tokens,
cached_read_tokens, cache_write_tokens, output_tokens, reasoning_tokens, latency, status,
`usage_source` (provider-reported vs estimated), computed_cost, **price_table_version**.

**Reconciliation:** a **daily three-way diff** — (a) events sent to your ledger, (b) local
usage log, (c) provider invoice/usage export — alerting on drift beyond a threshold. This is
the "our metering said X, the bill said Y" fix: scheduled diff, not a one-time audit.
([Dodo Payments](https://dodopayments.com/blogs/metering-llm-token-usage-architecture))

Common drift causes: delayed provider aggregation, retried/duplicate requests not deduped,
streaming usage never arriving, stale price table.

## 6. Credit ledger design

**Append-only ledger + materialized balance beats a mutable float column, unconditionally.**

- Every grant/debit/refund/expiry is an immutable row; balance is *derived* (sum), with a
  periodic checkpoint row so reads don't re-sum history. Rebuild the checkpoint whenever you
  distrust it — the ledger stays authoritative.
  ([Modern Treasury](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v))
- Cautionary tale directly on point:
  ["I stored AI SaaS credits as a single integer. Then the refunds started."](https://dev.to/velobasex/i-stored-ai-saas-credits-as-a-single-integer-then-the-refunds-started-2hg)
- **Integer micro-dollars, never float.** `real`/`float` can't represent $0.000001-per-token
  costs exactly and accumulates error over millions of rows. Convention: `amount_micros`
  bigint, $1.00 = 1,000,000.
  ([Modern Treasury](https://www.moderntreasury.com/journal/floats-dont-work-for-storing-cents))
- **Monthly allotments** = a `grant` row with `expires_at`; expiry inserts a negative row for
  the unspent remainder (FIFO consumption, soonest-expiring first). Never silently zero a
  column.

### Concrete finding in this repo

`api-ts/src/db/schema/payments.ts:36` and `:59` — `apiCredits.balance` and
`agentCredits.balance` are both `real('balance')`: **mutable float columns, no ledger**. This
is the exact anti-pattern above. The Python `api_credits.balance` is likewise `Column(Float)`.

Follow-up (not yet actioned): design an append-only `credit_ledger_entries` table
(`amount_micros bigint`, `type`, `reason`, `idempotency_key unique`, `created_at`) with
balance kept only as a recomputed cache, never the write target of a debit. MONEY-PATH —
needs `db-migrate` then `money-path-reviewer`.

## Top 5 things a naive Python+SQLAlchemy implementation misses

1. **Streaming aborts silently lose billable tokens** (N/A here — no streaming yet).
2. **Money as float instead of integer micro-dollars** — already present in this repo.
3. **Mutable balance column instead of an append-only ledger** — no audit trail, unsafe under
   concurrent debits/refunds/partial settlement.
4. **No reserve-then-settle** — post-paid only lets a runaway call blow past budget.
5. **Hand-maintained price dict that drifts** — vendor LiteLLM's JSON instead; model prompt
   caching as its own priced bucket (cache *writes cost more*, reads 90% less).

Bonus: rate limiting must be Redis-backed and **cost-weighted**; in-memory per-replica
counters are a no-op once you scale past one instance.

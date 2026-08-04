# Funding AI from subscription revenue — strategy for Suwappu

Written 2026-08-04. Synthesizes `01-cursor.md`, `02-consumer-economics.md`,
`03-provider-pricing.md`, `04-metering-architecture.md`.

## The question

> "We have bring-your-own-key right now, but I want people to use their credits from the
> subscription to drive the app fully. How do model wrapper companies do this?"

## The two patterns, honestly

**A. Master key + own metering.** One org key per provider. All calls proxy through your
backend. You keep a ledger, debit each call from token counts × your own price table, refuse
when the balance is gone. Full margin control, one key to secure, model allowlists trivial.
Cost: you build metering, and a bug in the debit path is a money leak.

**B. Aggregator provisioning keys** (OpenRouter et al). Mint a per-user key with a hard spend
limit; the aggregator enforces the cap and tracks usage. No metering code, hard ceiling you
can't leak past. Cost: **OpenRouter charges 5.5% on credit purchases** — the reason we
rejected it here — plus per-key lifecycle management.

We built **A, direct to seven providers**. Cloudflare's gateway also charges 5% on credits;
Helicone and Vercel's AI Gateway are 0% markup and worth revisiting if we ever want failover
without building it.

## Why Suwappu is not Cursor — the arithmetic that should drive the design

Every wrapper studied here sells inference *as the product*. Suwappu sells **swap execution**;
AI is a convenience feature on top. Measured against our real prompt (system prompt 444 tok +
tool schema 350 tok = **794 fixed overhead**, ~1,100 input / ~100 output per parse):

| Model | Raw $/call | Billed @1.5x | Calls per $1 |
|---|---|---|---|
| deepseek-v4-flash | $0.00035 | $0.00053 | ~1,900 |
| gemini-flash-lite | ~$0.00058 | ~$0.00086 | ~1,160 |
| claude-haiku-4-5 | $0.00160 | $0.00240 | ~417 |
| claude-sonnet-5 | $0.00480 | $0.00720 | ~139 |

**A single $100 swap at the FREE tier's 1% fee earns $1.00 — which funds ~1,900 DeepSeek
parses or ~139 Sonnet parses.** A $1,000 swap funds ~19,000 cheap parses.

Worst-case abuse exposure at the current caps (30/user/day, 5,000 global/day):

| Model | Per user/day | Global/day | Global/month |
|---|---|---|---|
| deepseek-v4-flash | $0.011 | $1.75 | **$53** |
| claude-haiku-4-5 | $0.048 | $8.00 | **$240** |
| claude-sonnet-5 | $0.144 | $24.00 | **$720** |

**Conclusion: inference is not a cost center here, it is customer acquisition.** The binding
constraint is not per-user profitability — it's stopping someone using the bot as a free
LLM proxy without ever swapping. That is an *abuse* problem, not a *billing* problem, and the
existing daily caps already bound it to double or low-triple digits per month.

## Five hard lessons from companies that got this wrong

1. **Don't silently change the unit of account.** Cursor moved "500 fast requests" → "$20 of
   API credit" on 2025-06-16 without re-pricing expectations; agentic workflows saw **20x
   effective cost jumps**, and Cursor issued a public apology plus refunds on 2025-07-04.
2. **Credits as a user-facing currency are being abandoned.** Windsurf dropped credits
   entirely for daily/weekly quotas (March 2026). t3.chat replaced fixed monthly message caps
   with a **rolling 4-hour cost-weighted usage bar** (July 2026). Opaque credit systems are
   the single most-cited source of user rage.
3. **Message/request counting dies the moment tool-calling exists.** Theo (t3.chat): message
   pricing is *"a suicide mission"* for agents — 1% of his users burned $2,000 in 5 days.
   Meter cost, not calls.
4. **The top ~10% of users drive ~90% of inference cost**; average margins of 40–65% go
   *negative* for the heaviest decile. Cursor ran negative gross margins through 2024–early
   2025 and, per TechCrunch (2026-04-17), individual/Pro accounts were **still loss-making** in
   2026 — profitable only on enterprise. Even Altman admitted losing money on $200/mo Pro.
   Perplexity's headline 60% margin only worked by booking ~$33M of model spend as R&D
   instead of COGS.
5. **Never hard-stop; degrade.** Cursor falls back to unlimited cheap "Auto" rather than
   showing a wall. A trading bot that stops understanding messages looks broken.

## Recommended design for Suwappu

**Do not ship a user-facing AI credit currency.** It's the thing the industry is walking back,
and our economics don't need it.

1. **Cost-weighted rolling-window allowance, invisible unless hit.** Replace the flat
   "30 calls/day" with a per-user *cost* budget over a rolling window (t3.chat's model). A
   Sonnet call should consume ~14x the budget of a DeepSeek call — which flat call-counting
   cannot express.
2. **Cheap model by default, expensive models as a tier perk.** Already built: DeepSeek/Qwen/
   Gemini-Flash on FREE, Claude/GPT/Grok on PRO, flagships on PREMIUM. This is Cursor Router's
   lever (claimed 60% cost reduction) without needing a classifier.
3. **Degrade, never wall.** On budget exhaustion, silently fall back to the free default model
   rather than refusing. Already implemented in `_resolve_user_model`.
4. **Tie allowance to swap activity, not just tier** — the crypto-native version of this. A
   user who swapped this week has already paid for their AI many times over; a user who has
   never swapped is the abuse case. This is the single highest-leverage idea here and is
   *not* yet built.
5. **Keep `api_credits` as internal cost attribution + a paid escape hatch**, not the primary
   user-facing mechanic.
6. **Optionally keep BYOK** as an unmetered bypass. Cursor restricted BYOK precisely where it
   bypassed margin — for us it bypasses almost no margin, so it's nearly free goodwill.

### Markup guidance

Cursor bills overage at **raw API rates with no markup**; margin lives in the
subscription-vs-included-pool ratio. Kilo Code publishes zero-markup pass-through as a
*feature*. Our 1.5x default is defensible for a bundled allowance but should not be presented
as a "credit price" — if credits ever become purchasable, publish the conversion rate.

## Built vs. remaining

**Built** (commits `bda55c5`, review fixes, this commit): 7-provider direct registry, tier-gated
catalog with verified prices, `/model` selection, atomic metering with money-path fixes,
provider-capability gating, price-table staleness guard.

**Remaining, in priority order:**

1. **Redis-backed, cost-weighted rate limits.** Current counters are in-memory **per replica**
   and reset on deploy — so the real ceiling is `30 × replicas` per user/day with a free reset
   each deploy. This is the actual hole in cost control. Use a Redis Lua script for atomic
   check-and-decrement.
2. **Prompt caching.** 794 of ~1,100 input tokens are an identical prefix every call. Anthropic
   cache reads are 0.1x (writes cost 1.25–2x, so it only pays above a volume threshold);
   DeepSeek cache hits are ~0.02x and automatic. Potentially ~60% off input cost.
3. **Source prices from LiteLLM's `model_prices_and_context_window.json`** instead of
   hand-maintaining. Importable standalone (`pip install litellm`, no proxy needed);
   cross-check against OpenRouter's `/models` as a free price oracle. **This session proved the
   need: two hand-entered model ids were already dead.**
4. **Append-only ledger with integer micro-dollars.** Both `api_credits.balance` (Python,
   `Float`) and `api-ts/src/db/schema/payments.ts:36,59` (`real`) are mutable float columns —
   no audit trail, unsafe under concurrent debit/refund. MONEY-PATH; needs `db-migrate` then
   `money-path-reviewer`.
5. **Live smoke tests** for Gemini/xAI/Qwen/Kimi forced tool-calling (currently gated off) and
   a daily three-way reconciliation job (ledger vs usage log vs provider invoice).
6. **Meter Whisper voice transcription** (`bot/services/whatsapp_voice.py:94`) — currently an
   entirely unmetered LLM-adjacent spend path.

## Open decisions for you

- **Is AI a FREE-tier feature or a paid hook?** The arithmetic says give it away on cheap
  models; the counter-argument is it's a clean reason to upgrade.
- **Should allowance scale with swap volume?** (recommended — aligns AI spend with revenue)
- **Do we want purchasable AI credits at all**, or just tier-bundled allowances? Industry is
  moving toward the latter.

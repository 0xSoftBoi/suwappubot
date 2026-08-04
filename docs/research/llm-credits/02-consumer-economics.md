# Consumer AI wrapper economics — how they avoid losing money

Research date: 2026-08-04. All figures sourced; see links inline.

## Bottom line

Every profitable consumer AI wrapper survives via the same trick: **flat price + hidden
usage cap** (messages/searches/requests, not raw tokens), sized so ~80% of users never hit
it, while heavy users are quietly rate-limited, throttled to weaker models, or pushed to a
$100–200 power-user tier. Even with this, OpenAI and Perplexity both admit (or were shown)
to lose money on their "unlimited-feeling" tiers when accounted honestly.

## Product-by-product

### t3.chat — $8/mo

- Originally 1500 "standard" + 100 "premium" (expensive-model) messages/month.
- As of ~July 2026, replaced with a **rolling usage bar that resets every 4 hours**,
  weighted by *actual model cost*, not message count.
  ([theo, 2026](https://x.com/theo/status/2022844310165893484))
- Theo publicly said the old fixed monthly cap was scaring off subscribers even though
  99.9% never hit it — *"Power users who DO hit it are willing to pay more."*
  ([theo, 2025](https://x.com/theo/status/1937320689176052146))
- Economics work via API-rate billing (no fixed seat cost) plus Azure credits.
- **1% of users burned $2,000 in 5 days** once agentic/tool-use entered the picture. Theo
  called this proof that *"message pricing is a suicide mission"* for agents.
  ([BigGo](https://finance.biggo.com/news/7b5cc440b48e05d9))

### Perplexity Pro — $20/mo

- 300+ Pro searches/day historically; moved to weekly limits in 2026. Includes frontier
  model access and the Comet browser agent.
  ([screenapp.io](https://screenapp.io/blog/perplexity-pricing))
- The Information reported Perplexity's headline **60% gross margin was achieved by booking
  ~$33M of the $57M+ model/web-service spend as R&D rather than COGS** (covering free-tier
  and trial users). Recompute honestly and gross margin goes negative.
  ([The Information](https://www.theinformation.com/articles/helping-perplexitys-60-gross-profit-margin))

### The benchmarks (ChatGPT / Claude)

- Sam Altman, Jan 2025 — still the operative admission: *"we are currently losing money on
  OpenAI Pro subscriptions! people use it much more than we expected"* — on the $200/mo tier.
  ([TechCrunch](https://techcrunch.com/2025/01/05/openai-is-losing-money-on-its-pricey-chatgpt-pro-plan-ceo-sam-altman-says/))
- Claude Pro ($20) ≈ 45 msgs/5hr window; Max 5x ($100) ≈ 225; Max 20x ($200) ≈ 900.
  Anthropic **doubled the 5-hour caps on 2026-05-06** and meters by *token budget* under the
  hood despite showing users "messages".
  ([tokenmix.ai](https://tokenmix.ai/blog/complete-claude-limits-guide-2026-tokens-uploads-5-hour))

### Coding agents

- **Kilo Code**: zero markup on inference, passes provider rates straight through, $20 bonus
  credits. ([apidog](https://apidog.com/blog/kilo-code/))
- **Cline**: $9.99/mo freemium. Heavy Sonnet users spend $50–200/mo in raw tokens vs $5–20
  for light users; orchestrator/multi-agent modes can 3x token burn per task.
- **Windsurf**: dropped credits *entirely* for daily/weekly quotas in its March 2026 pricing
  overhaul ($20 Pro / $200 Max).
  ([nocode.mba](https://www.nocode.mba/articles/windsurf-pricing))
- **Lovable**: token-based — 150K/day free, 10M tokens/mo on $20 Pro with rollover.
- **Cursor**: June 2025 switch from "500 fast requests" to a $20-of-API-cost credit pool
  caused major backlash over the silent unlimited→metered transition; refunds issued July
  2025. ([FinTech Weekly](https://www.fintechweekly.com/magazine/articles/cursor-pricing-change-user-backlash-refund))

## Comparison table

| Product | Price | Included usage | User-facing unit | Margin note |
|---|---|---|---|---|
| t3.chat | $8/mo | Rolling 4hr cost-weighted bar (was 1500 std + 100 premium msgs/mo) | "usage" (cost-weighted) | API pass-through + Azure credits; agent users burned $2k/5d |
| Perplexity Pro | $20/mo | 300+ Pro searches/day → weekly | "searches" | 60% margin only via R&D reclassification; honest = negative |
| ChatGPT Pro | $200/mo | "Unlimited" | unlimited (soft) | Altman: losing money (Jan 2025) |
| Claude Pro/Max | $20/$100/$200 | ~45/225/900 msgs per 5hr | "messages" (really tokens) | Caps doubled May 2026 |
| Kilo Code | Freemium + $20 credit | Pass-through API cost | credits (1:1 provider rate) | 0% markup, publishes rates |
| Cline | $9.99/mo+ | Token-based | tokens/credits | Heavy users $50–200/mo |
| Windsurf | $0/$20/$200 | Daily/weekly quota | quota, not credits | Ditched credits Mar 2026 |
| Lovable | $0/$20+ | 150K tok/day free, 10M/mo Pro | tokens (rollover) | Published token counts |
| Cursor | $20 + credits | $20 of API cost, then PAYG | credits = $ of API cost | June 2025 backlash |

## The heavy-user problem (consistent across every source)

- Top ~10% of users drive ~90% of inference cost.
- Average gross margin 40–65%, but **negative for the heaviest decile**.
  ([fuelgauge.pro](https://fuelgauge.pro/guides/ai-subscription-economics/))

Standard mitigations observed in the wild:

1. Size caps so 70–80% of users never hit them.
2. **Rolling time-window resets** instead of hard monthly caps (t3.chat, Claude).
3. Cost-weighted usage metering rather than flat message counts.
4. Tiered upsell ($20 → $100 → $200) for the top decile.
5. Model routing — cheap model for simple queries, expensive only when needed.

## User-facing unit design

- Raw tokens are technically honest but users don't understand them or why a task costs what
  it costs. ([Adaptavist](https://www.theadaptavistgroup.com/blog/the-trouble-with-tokens))
- Abacus AI explicitly disclaims "credits are NOT tokens" because provider rates change too
  often to peg 1:1.
- "Messages" (t3.chat, Claude, ChatGPT) are the most user-legible unit but **break down once
  tool-calling/agentic workflows make one message cost 10–100x another**.
- Opaque, frequently-changing credit systems are the single biggest documented source of
  user rage (Cursor June 2025 is the canonical blow-up).

## Implications for Suwappu

- Don't expose raw tokens to Telegram users — use a cost-weighted "usage" allowance, not
  flat message counts.
- Cap by **rolling time window** (per-4hr or per-day), not calendar month, to avoid the
  "fear of running out" effect while still bounding worst-case cost.
- Model-route: cheap model for simple intents (price checks, alerts), expensive models only
  for complex reasoning (strategy explanation, risk analysis).
- Size the free cap so ~75–80% of users never hit it; instrument per-user cost from day one
  so top-decile users can be identified and throttled or upsold.
- If credits are purchasable, **publish the conversion rate** (Kilo Code's transparency)
  rather than opaque "1 credit = ???".

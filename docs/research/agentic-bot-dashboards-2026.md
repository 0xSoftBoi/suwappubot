# Competitive research — agentic dashboards & white-label crypto bots

**Date:** 2026-08-25 · **For:** the tenant-bot factory (`/dashboard/bots`)
**Method:** web research, Aug 2026. Sources listed per section.

This is a gap analysis against what we shipped, not a market survey for its own
sake. Each finding ends with **→ what it means for us**.

---

## 1. The buyback/burn category has a credibility crisis, and that is the opening

Tokenomist tracked ~$19B of 2025–26 buyback programs across 11 major tokens and
found **only 2 actually shrink supply**. The failure modes:

- **Buyback-and-hold** — tokens leave circulation but total supply is unchanged.
- **Buyback-and-redistribute** — tokens go back to stakers; no net reduction.
- **Burns outrun by emissions** — a real burn that loses to scheduled unlocks,
  leaving the token net inflationary *while the program is running*.
- **Treasury-funded rather than revenue-funded** — finite, so not durable.
  "A buyback paid for by real, recurring fees is durable. One paid for by
  treasury reserves or offset by fresh unlocks is motion without much effect."
- **Announcement pops that fade** — only OKB and Aave outperformed BTC at 30d.

Their credibility tests are concrete and worth stealing outright:
1. Net emission: forward 12m unlocks − trailing 12m burns, vs circulating supply.
2. Price reaction vs BTC at 7d and 30d post-announcement.
3. On-chain ledger as source of truth — **announcements are not evidence**.
   Programs with gaps in on-chain records get flagged as coverage lapses.

**→ What it means for us.** We are building the tool that *executes* the thing
the whole category cannot prove. The differentiator is not "we can burn" — any
script can burn. It is **"we can prove the burn, publicly, continuously, and
without the team's word for it."** Our run journal already has the raw material
(every attempt, including refusals and simulations). What is missing is a
public surface over it, and honest net-of-emissions framing rather than a
cumulative "total burned" vanity number — which is precisely the metric the
research says is disconnected from supply mechanics.

Sources: [Tokenomist research](https://tokenomist.ai/research/buyback-and-burn-explained-what-they-are-who-is-doing-them-and-whether-they-actually-work),
[Tokenomist buyback screener](https://tokenomist.ai/buyback/screener),
[DWF Labs on token buybacks](https://www.dwf-labs.com/research/547-token-buybacks-in-web3)

---

## 2. Agentic dashboards: the winners take a brief, not a flowchart

The 2026 no-code agent field splits cleanly:

- **AI-native** (Lindy, Gumloop, Relevance AI) — the model makes decisions
  *inside* the workflow. Lindy's pitch: "you describe what needs to happen in
  plain language, it keeps context, and it acts across connected apps." Less a
  workflow builder, more handing a task to an assistant.
- **AI-bolted-on** (Zapier, Make) — still a deterministic trigger-action chain
  with one configurable AI step in it.

Relevance AI is notable for multi-agent teams: each agent gets its own
instructions and tools, and they delegate across stages.

Pricing anchors: Zapier free/100 tasks then ~$20/mo; Make from $9/mo on
credits; Lindy from ~$50/mo; Relevance AI enterprise-only.

**→ What it means for us.** Our composer is on the right side of this split —
brief in, configured bot out, no flowchart. That was the correct call. The gap
is everything *after* the brief: the AI-native platforms all invest heavily in
run traces, replay and human-in-the-loop approval, because a natural-language
brief is inherently lossy and the operator needs to see what it actually did.
We have a run log; we do not yet have "here is exactly what this agent decided
and why."

Sources: [Lindy no-code agent builders](https://www.lindy.ai/blog/no-code-ai-agent-builder),
[CTO Club ranking](https://thectoclub.com/tools/best-no-code-ai-agent-builder/),
[Braintrust](https://www.braintrust.dev/articles/best-no-code-ai-agent-builders-2026),
[Cryptopolitan comparison](https://www.cryptopolitan.com/best-ai-agent-builders-2026-no-code-low-code/)

---

## 3. Crypto agent launchpads sell ownership, not utility

Virtuals Protocol (Base) is a no-code agent launchpad whose product is
*tokenising* the agent — "transform your AI project into a revenue-generating
asset." Clanker hit 21,870 token launches in a day and $8.02M protocol fees in
a week. Bankr sits in the same revenue tier.

**→ What it means for us.** These are launchpads: they help you *create a
token*. We are the opposite end — a team that already has a token and needs it
to do something useful for holders. That is a real, unserved position, and it
argues against ever adding a token-launch feature. Our wedge is post-launch
utility and provable treasury operations.

Sources: [Coin Bureau on Virtuals](https://coinbureau.com/review/virtuals-protocol-review),
[KuCoin on Clanker fees](https://www.kucoin.com/news/articles/clanker-protocol-reaches-8-million-weekly-fee-milestone-as-ai-agent-social-trading-ignites-base),
[Push on agent protocol revenue](https://push.org/blog/highest-revenue-generating-crypto-ai-agent-protocols-of-2026/)

---

## 4. Telegram trading bots monetise flow; community bots monetise access

- Trading side: BonkBot, Trojan, Banana Gun, BullX, GMGN, Pepeboost. Banana Gun
  takes ~0.5% manual / ~1% sniping and runs its own buyback-and-burn on $BANANA.
  These are *consumer* bots — one bot, many users.
- Community side: Collab.Land (6.5M verified wallets, 40+ chains) and Guild.xyz
  do token-gating. The 2026 reference stack for a crypto TG group is a pile of
  separate bots: Shieldy/Rose (captcha), Combot (analytics), Collab.Land or
  Guild (gating), Galxe/Layer3/Zealy (quests), tip bots.

**→ What it means for us.** Nobody in the community-bot stack does *treasury
actions*, and nobody in the trading-bot stack is white-label per project. A
project today runs five bots from five vendors, none of which is theirs. One
branded bot that does gating + price + buy + provable burn is a genuinely
different product, and the fragmentation is the sales argument.

Sources: [MEXC on TG trading bots](https://www.mexc.com/news/896013),
[AMBCrypto top TG bots](https://ambcrypto.com/top-11-telegram-trading-bots-of-march-2026/),
[Collab.Land](https://collab.land/),
[Surgence TG management playbook](https://surgence.io/blog/crypto-telegram-management)

---

## 5. Impersonation is the dominant attack in this exact product category

The "Safeguard" verification bot is a live malware campaign: it instructs users
to paste code to "verify identity", which steals Telegram sessions and wallets.
It works *because* it imitates the legitimate-looking verification bots that
crypto communities are trained to trust.

**→ What it means for us, and this one is urgent.** We built a service whose
entire function is letting anyone stand up an official-looking bot under their
own name in minutes. That is the same primitive the attackers are abusing. We
currently do nothing to stop a tenant naming their bot "Safeguard Verification"
or "USDC Support", pointing it at a real project's token, and pasting it into
someone else's group. Impersonation guardrails are not a nice-to-have here;
they are table stakes for shipping this at all.

Sources: [ICO Gem Hunters on TG community bots](https://icogemhunters.medium.com/top-10-telegram-bots-to-effortlessly-manage-your-crypto-community-3760fb09fb30),
[Surgence](https://surgence.io/blog/crypto-telegram-management)

---
## 6. Hyperliquid is the reference implementation of a credible buyback

The Assistance Fund routes 97% of trading fees into daily HYPE purchases —
$1.3B+ spent, $2B+ fund. What makes it *believed*, per every writeup:

> "The execution is fully automated and transparent, with the Assistance Fund
> running on-chain where every purchase is visible and every transaction is
> verifiable. There is **no off-chain accounting, no discretionary timing, and
> no 'we'll announce the burn next quarter' framing**."

Buys are continuous and small rather than lumpy and announced, funded by fees
since the last buy. And there is a public real-time dashboard anyone can check:
**assistancefund.top**.

**→ What it means for us.** Hyperliquid built that bespoke because they had the
engineering budget to. A meme-coin team with a $40k treasury cannot, and today
their only option is a screenshot in the group chat — which is exactly the
"announcement disconnected from mechanics" the category is being marked down
for. **Give every tenant an assistancefund.top of their own, generated.** That
is a feature no competitor in either the community-bot stack or the trading-bot
stack offers, and it is nearly free for us because the run journal already
exists.

Note also: continuous-small beats lumpy-announced. Our cron defaults to hourly
$25–50, which happens to be the right shape. Worth saying so in the composer's
rationale rather than leaving it as an accident.

Sources: [crypto.news on the HYPE buyback](https://crypto.news/why-hype-is-different-inside-hyperliquids-buyback/),
[GoPlus mechanism report](https://goplussecurity.medium.com/hyperliquid-buyback-burn-and-staking-mechanism-research-report-72e0e1765fd9),
[Assistance Fund dashboard](https://assistancefund.top/),
[AMINA research](https://aminagroup.com/research/hyperliquid-hype-etf-buyback-staking-yield-institutional-access-2026/)

---

## 7. What "production agent platform" means in 2026

The observability consensus is specific about what a trace must contain:

> "the reasoning trace, the tools considered, the tools actually invoked, the
> arguments passed, the responses returned, the tokens spent at each step, and
> the latency of each hop — all stitched into one hierarchical trace you can
> replay."

Plus: evals on every trace step, human approval steps, RBAC, audit logs, and
OpenTelemetry GenAI semantic conventions as the emerging common vocabulary.
OpenAI's AgentKit ships an eval harness for tracing runs and regression testing.

**→ What it means for us.** Our run rows record the *outcome* (status, spend,
tx). They do not record the *decision*: which guard fired, what the quote was,
what was rejected and why. We already write refusals — that is more than most —
but a skipped run says `daily cap reached` as free text rather than as a
structured, queryable, publicly-renderable decision record. Making the refusal
first-class is what turns a log into evidence.

Sources: [Braintrust agent observability guide](https://www.braintrust.dev/articles/agent-observability-complete-guide-2026),
[Confident AI observability comparison](https://www.confident-ai.com/knowledge-base/compare/best-ai-agent-observability-tools-2026),
[Digital Applied tracing stack](https://www.digitalapplied.com/blog/ai-agent-observability-2026-tracing-monitoring-stack-guide),
[Agentspan runtime platforms](https://agentspan.ai/blogs/best-ai-agent-runtime-platforms-2026/)

---

# The gap list, ranked

Ranked by (impact on whether a real team adopts this) × (cost to build).

| # | Gap | Why it matters | Cost |
|---|-----|----------------|------|
| 1 | **No public proof page** | The category's core credibility problem (§1, §6). We execute the thing nobody can prove, and then also don't prove it. | Low — journal exists |
| 2 | **No impersonation guardrails** | We ship the exact primitive being abused by live malware (§5). Reputational and legal exposure. | Low |
| 3 | **"Total burned" is a vanity metric** | Reporting cumulative spend with no net-of-emissions context is the flagged failure mode (§1). | Low |
| 4 | **Funding source not modelled** | Revenue-funded vs treasury-funded is *the* durability signal (§1). We don't record or disclose it. | Low |
| 5 | **Refusals are free text, not records** | A structured decision record is what makes the log evidence (§7). | Medium |
| 6 | **No verification of the burn address on-chain** | We allowlist sinks but never confirm the tokens arrived. | Medium |

Items 1–4 are all small and all attack the same weakness: we built execution
without proof. That is the work.

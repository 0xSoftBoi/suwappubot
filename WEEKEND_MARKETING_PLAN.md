# Weekend Marketing Plan — Suwappu Bot (Expanded)

> Actionable two-day plan to activate Suwappu's growth flywheel. Built from research into what Trojan ($25B volume, 2M users), Banana Gun ($15B+), BonkBot ($14B+), and Maestro ($12.8B) actually did to grow — adapted for a weekend sprint.

---

## Table of Contents

1. [Competitive Landscape & Positioning](#1-competitive-landscape--positioning)
2. [Saturday: Foundation, Content & Infrastructure](#2-saturday-foundation-content--infrastructure)
3. [Sunday: Distribution, Outreach & Activation](#3-sunday-distribution-outreach--activation)
4. [Detailed Twitter/X Playbook](#4-detailed-twitterx-playbook)
5. [Referral Program Optimization](#5-referral-program-optimization)
6. [Launch Weekend Event: "Genesis Sprint"](#6-launch-weekend-event-genesis-sprint)
7. [Community Seeding Playbook](#7-community-seeding-playbook)
8. [AI Agent Angle — The Differentiator](#8-ai-agent-angle--the-differentiator)
9. [Zealy Quest Campaign](#9-zealy-quest-campaign)
10. [KOL Micro-Influencer Outreach](#10-kol-micro-influencer-outreach)
11. [Content Templates & Copy](#11-content-templates--copy)
12. [Metrics, Tracking & Attribution](#12-metrics-tracking--attribution)
13. [Post-Weekend Roadmap](#13-post-weekend-roadmap)
14. [Anti-Patterns — What NOT to Do](#14-anti-patterns--what-not-to-do)
15. [Budget](#15-budget)

---

## 1. Competitive Landscape & Positioning

### What the winners did

| Bot | Lifetime Volume | Users | Key Growth Mechanic |
|-----|----------------|-------|-------------------|
| **Trojan** | $25B+ | 2M+ | 5-level deep referral (25% L1 → 3.5% L5), $65M+ paid to referrers |
| **Banana Gun** | $15B+ | — | 40% revenue share to token holders, BANANA bonus per trade |
| **BonkBot** | $14B+ | 526K+ | 30%→20%→10% decaying referral, 100% fee burn to BONK |
| **Maestro** | $12.8B | 573K+ | First-mover advantage, freemium + $200/mo premium tier |

### Where Suwappu is different

Most competitors are **single-chain Solana bots**. Suwappu's positioning should lean hard into what they can't do:

| Suwappu Advantage | Why It Matters |
|---|---|
| **7-chain cross-chain** (ETH, BSC, Polygon, Arbitrum, Optimism, Base, Solana) | Trojan/BonkBot = Solana only. Banana Gun = 4 chains. Maestro = closest competitor. |
| **AI Agent interoperability (A2A/x402)** | No trading bot has this. The A2A protocol is brand new (Google, April 2025). First-mover in agent-ready trading. |
| **Telegram Mini App** | Full webapp experience inside TG, not just command-line bot interactions |
| **WhatsApp integration** | No competitor offers this — opens non-Telegram crypto markets |
| **TEE-backed wallets (Turnkey)** | Enterprise-grade security vs basic encrypted keys |
| **Gamification with fee discounts** | Points → levels → 0.4% fee at Diamond (competitors charge flat 0.9-1%) |

**Positioning statement:**

> "The only cross-chain trading bot that works across 7 chains, integrates with AI agents, and rewards you for every swap. Inside Telegram."

---

## 2. Saturday: Foundation, Content & Infrastructure

### Block 1: Social Presence Setup (1-2 hours, morning)

**Twitter/X Account**
- Profile pic: Sakura logo (already exists in branding)
- Banner: "Cross-chain swaps. 7 chains. One bot." with chain logos
- Bio: "Cross-chain DEX inside Telegram | 7 chains | 30% referral commissions | AI agent ready | t.me/SuwappuBot"
- Pinned tweet: The launch thread (see Section 4)
- Follow 50-100 accounts: DeFi protocols, aggregators, AI agent projects, crypto media

**Telegram Community Group**
- Create `@SuwappuCommunity` or similar
- Pin message with:
  - What Suwappu does (one paragraph)
  - Referral program rules (30% lifetime)
  - Link to bot
  - Genesis Sprint rules (see Section 6)
- Set up welcome bot message for new members
- Add community link to bot's `/start` menu response

**Discord (optional, lower priority)**
- If bandwidth allows, create a minimal Discord with channels: #announcements, #general, #support, #referral-leaderboard
- This is lower priority than Telegram since the product lives in Telegram

### Block 2: Landing Page (2-3 hours, midday)

Deploy a single-page site at `suwappu.bot`. Use the existing `webapp/` React + Vite infrastructure or a simple static HTML page.

**Above the fold:**
```
Swap tokens across 7 chains from Telegram.
One bot. No app downloads. No browser extensions.

[Open Suwappu Bot] → t.me/SuwappuBot
```

**Sections:**

| Section | Content | Purpose |
|---------|---------|---------|
| Hero | Headline + CTA + Mini App screenshot | Convert visitors to bot users |
| How it works | 3 steps: Open bot → Create wallet → Swap | Reduce friction / demystify |
| Supported chains | Logo grid: ETH, BSC, Polygon, Arbitrum, Optimism, Base, Solana | Show breadth |
| Referral program | "Earn 30% of all trading fees from users you refer. Forever." + example earnings table | Incentivize sharing |
| Levels & rewards | Bronze→Diamond table with fee discounts (0.8%→0.4%) | Gamification hook |
| Security | TEE wallets, envelope encryption, non-custodial | Build trust |
| For AI agents | "The first trading bot with A2A protocol support" + link to /docs | Differentiation |
| Footer | Bot link, Docs, Twitter, Community, GitHub | Navigation |

**Fallback if time-constrained:** Use a Linktree, Bento, or bio.link page with the core links. Takes 15 minutes.

### Block 3: Launch Thread (2-3 hours, afternoon)

See full playbook in [Section 4](#4-detailed-twitterx-playbook).

### Block 4: Asset Creation (1-2 hours, parallel)

Create these visual assets (Canva, Figma, or even screenshots):

1. **Bot interaction screenshots** — swap flow, wallet view, portfolio, Mini App
2. **Chain logos grid** — 7 chain logos with Suwappu logo in center
3. **Referral earnings infographic** — "If you refer 10 active traders doing $1K/month each at 0.8% fee = $24/month passive income"
4. **Fee tier comparison** — Suwappu vs Trojan vs BonkBot vs Banana Gun fee table
5. **Level progression visual** — Bronze→Diamond with XP requirements and fee discounts

---

## 3. Sunday: Distribution, Outreach & Activation

### Block 5: Seed Referral Program (1-2 hours, morning)

Generate and distribute initial referral codes:

- **Team members**: Each team member gets a personal code, shares in their networks
- **Early supporters / friends**: 10-20 codes for people who will genuinely try the product
- **"Genesis Referrer" status**: First 50 people to generate a referral code get permanent badge on leaderboard

**Key learning from Trojan**: Their 5-level referral system paid out $65M+ and was the #1 growth driver. Suwappu's 30% lifetime flat rate is simpler and more generous at L1 than Trojan's 25%. Market this aggressively:

> "Trojan pays 25% on direct referrals. We pay 30%. Forever. No tiers, no decay."

**Key learning from BonkBot**: Their referral decays (30%→20%→10%). Suwappu's doesn't. This is a real advantage — use it.

### Block 6: Telegram Community Seeding (2-3 hours, midday)

See full playbook in [Section 7](#7-community-seeding-playbook).

### Block 7: Twitter Engagement Blitz (2-3 hours, ongoing)

See detail in [Section 4](#4-detailed-twitterx-playbook).

### Block 8: Launch the Genesis Sprint (activate before distribution)

See full detail in [Section 6](#6-launch-weekend-event-genesis-sprint).

### Block 9: Reddit & Forum Outreach (1 hour, evening)

**Subreddits:**
- r/defi — "Built a cross-chain trading bot inside Telegram, looking for feedback"
- r/solana — "We added Solana support via Jupiter to our 7-chain Telegram trading bot"
- r/ethereum — Focus on the aggregation / Li.Fi integration angle
- r/CryptoCurrency — Daily discussion thread, not a standalone post (they'll remove it)

**Frame:** Builder sharing work, asking for feedback. Not a sales pitch. Include a screenshot and 3-sentence description. Link to bot.

**Discord servers to post in:**
- Li.Fi Discord (you use their API — they may amplify)
- Jupiter Discord (Solana integration)
- Base ecosystem Discord
- Arbitrum ecosystem Discord
- AI agent / autonomous agent Discords

---

## 4. Detailed Twitter/X Playbook

### The Launch Thread (7-10 tweets)

**Tweet 1 — The Hook (spend 40% of your effort here)**

Option A (problem-led):
> "Bridging tokens across chains still takes 5 steps, 3 apps, and 10 minutes.
>
> We built a bot that does it in one message inside Telegram.
>
> 7 chains. < 30 seconds. Here's Suwappu 🧵"

Option B (metric-led):
> "What if you could swap tokens across 7 different blockchains without leaving Telegram?
>
> No browser extension. No app download. No seed phrases to manage.
>
> We built it. Here's how it works 🧵"

Option C (contrarian):
> "Every Telegram trading bot only works on one chain.
>
> We thought that was broken, so we built one that works on all of them.
>
> 🧵"

**Tweet 2 — The Problem**
> "Right now, if you want to swap on Solana, you use BonkBot. For ETH sniping, Banana Gun. For BSC, Maestro.
>
> That's 3 different bots, 3 different wallets, 3 different sets of fees.
>
> Suwappu is one bot for all 7 chains: ETH, BSC, Polygon, Arbitrum, Optimism, Base, and Solana."

**Tweet 3 — How It Works (with screenshot)**
> "Type /s 100 USDC → ETH
>
> That's it. The bot finds the best route via Li.Fi (EVM) or Jupiter (Solana), shows you the quote, and executes.
>
> [Screenshot of swap flow]"

**Tweet 4 — Referral Program**
> "We're launching with a 30% lifetime referral program.
>
> For context:
> - Trojan pays 25% (direct only)
> - BonkBot pays 30% → 20% → 10% (decays)
> - Suwappu pays 30%. Forever. No decay. No tiers.
>
> If your referrals trade, you earn. Permanently."

**Tweet 5 — Gamification / XP**
> "Every swap earns XP. XP unlocks fee discounts:
>
> 🥉 Bronze (0 XP) → 0.8% fee
> 🥈 Silver (1K XP) → 0.7%
> 🥇 Gold (5K XP) → 0.6%
> 💎 Platinum (25K XP) → 0.5%
> 👑 Diamond (100K XP) → 0.4%
>
> Daily check-ins, streaks, and a reward store. Your fees shrink the more you trade."

**Tweet 6 — AI Agent Integration (differentiator)**
> "Here's what no other trading bot has: AI agent support.
>
> Suwappu implements the A2A protocol. Any AI agent can discover our tools, authenticate, and execute trades programmatically.
>
> The first trading bot ready for the autonomous agent economy.
>
> Docs: api.suwappu.bot/docs"

**Tweet 7 — Security**
> "Your keys live in Turnkey's TEE (Trusted Execution Environment). Not in a database. Not in plaintext.
>
> Envelope encryption with KMS. Auto-migration from legacy to v2 encryption. Non-custodial by design.
>
> We take security seriously because we have to."

**Tweet 8 — Mini App / UX**
> "Don't like typing commands? Open the Telegram Mini App.
>
> Full dashboard, portfolio tracking, one-tap swaps, and wallet management — all inside Telegram.
>
> [Screenshot of Mini App]"

**Tweet 9 — CTA**
> "Try it now:
>
> 🤖 Bot: t.me/SuwappuBot
> 📊 Mini App: app.suwappu.bot
> 📖 Docs: api.suwappu.bot/docs
>
> This weekend we're running a Genesis Sprint — 2x XP on all swaps, bonus points for first swap, and the leaderboard goes live Sunday night.
>
> Get your referral code: /ref"

### Engagement Strategy (Sunday, ongoing)

**Search and reply to these conversations:**
- "best telegram trading bot" — reply with comparison
- "cross chain swap" / "bridge tokens" — share the one-message swap UX
- "banana gun alternative" / "trojan alternative" — position multi-chain advantage
- "AI agent crypto" / "A2A protocol" — show agent card / docs
- "telegram mini app" — share Mini App screenshots

**Engagement tactics (from research):**
- Post 3-4 times per day during launch weekend
- Use polls: "How many chains does your trading bot support? (1 / 2-3 / 4+ / I use multiple bots)"
- Reply to every comment on your thread within 1 hour
- Quote-tweet anyone who tries the bot and shares feedback
- Tag relevant projects when mentioning integrations (Li.Fi, Jupiter, etc.)

---

## 5. Referral Program Optimization

### How Suwappu compares (use this in marketing)

| Feature | Suwappu | Trojan | BonkBot | Banana Gun |
|---|---|---|---|---|
| **L1 referral rate** | 30% | 25% | 30% (month 1) | N/A (token-based) |
| **Duration** | Lifetime | Lifetime | Decays to 10% | N/A |
| **Depth** | 1 level | 5 levels | 1 level | N/A |
| **Fee with referral** | 0.8% (base) → 0.4% (Diamond) | 0.9% | 1% | 1% |
| **Referral discount** | Via XP tiers | 10% off fees | None | None |

### What to highlight in marketing

1. **"30% forever"** — simple, memorable, no fine print
2. **Fee discounts stack** — your fee drops from 0.8% to 0.4% as you trade more, AND you earn 30% of referral fees
3. **Comparison graphic** — side-by-side with Trojan's 25% and BonkBot's decaying 30%→10%

### Potential weekend enhancement (code change)

Consider adding a **referral leaderboard tweet** feature: Sunday evening, auto-generate and post the top 10 referrers (anonymized or with permission). Creates social proof and competition.

---

## 6. Launch Weekend Event: "Genesis Sprint"

Inspired by how Hamster Kombat (300M users) and Major (40M users in 5 days) used launch events to drive viral adoption, but adapted for a trading bot (not a tap-to-earn game).

### Structure

**Name:** Genesis Sprint
**Duration:** Saturday 00:00 UTC → Sunday 23:59 UTC
**Theme:** First-ever Suwappu trading competition

### Rules

| Action | Points | XP Multiplier |
|--------|--------|---------------|
| First swap ever | 200 bonus points | — |
| Every swap | Normal rates | **2x XP** |
| Daily check-in (`/checkin`) | 10 pts + streak bonus | — |
| Refer a friend who starts bot | 500 pts | — |
| Refer a friend who completes first swap | 200 pts + 30% fee share | — |
| Share PnL on Twitter (screenshot) | 25 pts | — |

### Prizes / Recognition

Keep it achievable and honest (no token promises):

- **Top 3 on leaderboard** → "Genesis Trader" badge (permanent in bot profile)
- **Top referrer** → "Genesis Referrer" badge
- **First 50 users to swap** → "Early Adopter" badge
- **Everyone who participates** → 2x XP carries forward, streak starts counting

The badges are cosmetic but create scarcity and social proof. They cost nothing to implement.

### How to announce

1. Post rules in Telegram community group (pinned)
2. Include in launch thread (Tweet 9)
3. Bot sends announcement to existing users via `/start` update
4. Sunday evening: post the leaderboard on Twitter

---

## 7. Community Seeding Playbook

### Telegram Groups to Target (prioritized)

**Tier 1 — High-value, high-relevance:**
- Solana trading / alpha groups (BonkBot users who need EVM chains)
- Base ecosystem groups (new chain, high activity, fewer bots)
- Arbitrum DeFi groups (strong DeFi culture)
- Li.Fi community (you use their API — natural connection)
- Jupiter community (Solana integration)

**Tier 2 — Broader DeFi:**
- General DeFi trading groups
- Cross-chain / bridging discussion groups
- Telegram bot user groups
- Crypto trading strategy groups

**Tier 3 — AI/Agent angle:**
- AI agent builder communities
- LangChain / AutoGPT / CrewAI groups
- x402 protocol discussion groups
- Web3 AI intersection groups

### Approach (don't get banned)

**DO:**
- Join 2-3 days before if possible (or at minimum, read the room first)
- Contribute value: answer questions about cross-chain swaps, share knowledge
- When relevant, mention Suwappu naturally: "I've been using this bot that does cross-chain swaps in TG, works across 7 chains"
- Share your referral link when someone asks for bot recommendations
- If the group allows introductions/promos, use the designated channel

**DON'T:**
- Don't post your link as your first message
- Don't spam multiple messages
- Don't use generic copy-paste promotional text
- Don't join 20 groups and post simultaneously (looks botted)

### Message Templates

**For trading groups:**
> "Been testing a new cross-chain TG bot called Suwappu — lets you swap across ETH, Solana, Base, Arbitrum, etc from one bot. Uses Li.Fi for routing and Jupiter for Solana. Anyone else tried multi-chain bots vs single-chain ones?"

**For Solana groups:**
> "For anyone who trades both Solana and EVM chains — I've been using Suwappu bot which handles Jupiter swaps on Solana AND Li.Fi swaps on EVM chains in one place. Saves me from juggling BonkBot + a separate EVM bot."

**For AI/agent groups:**
> "Interesting project: Suwappu is a cross-chain trading bot that implements the A2A protocol — any AI agent can discover and call its trading API. Has an agent card at suwappu.bot/.well-known. Curious if anyone's building agent-to-agent trading flows."

---

## 8. AI Agent Angle — The Differentiator

This is Suwappu's most unique positioning. No competing trading bot has A2A support.

### Why this matters now

- Google released A2A protocol April 2025
- Coinbase launched x402 for agent payments in 2025
- 550+ AI agent crypto projects listed on CoinGecko ($4.3B market cap)
- Anthropic, Google Cloud, AWS adopting x402
- ERC-8004 proposal for on-chain agent identity (August 2025)

### How to market it this weekend

1. **Tweet thread specifically for AI/agent audience** (separate from main launch thread):
   > "We built the first cross-chain trading bot with A2A protocol support.
   >
   > Any AI agent can discover our trading tools, authenticate with an API key, and execute swaps across 7 chains.
   >
   > Agent card: suwappu.bot/.well-known/agent-card.json
   > API docs: api.suwappu.bot/docs
   >
   > If you're building AI agents that need to trade, we're ready."

2. **Post in AI agent communities** (see Tier 3 in Section 7)

3. **Tag relevant projects**: When posting about agent support, tag/mention Questflow (A2A.build), LangChain, x402 discussions

4. **Submit to agent directories**: Register on A2A.build (Questflow's portal) if possible this weekend

### Developer-focused content

- Link to `/docs-portal` (already built)
- Show the agent registration flow (`POST /v1/agent/register`)
- Show a natural language trade example (`POST /v1/agent/execute`)
- Highlight the `suwappu_sk_` API key format and rate limiting

---

## 9. Zealy Quest Campaign

Zealy (formerly Crew3) has 700K+ monthly active users and has facilitated 100M+ completed quests. It's the standard platform for gamified crypto community onboarding.

### Weekend Setup (1-2 hours Saturday)

1. Create a Zealy space at zealy.io for Suwappu
2. Set up these quest sprints:

**Onboarding Quests (easy, 10-50 XP each):**
- Follow @SuwappuBot on Twitter
- Join Suwappu Telegram community
- Start the Suwappu bot (/start)
- Create a wallet in the bot (/w)
- Complete your first check-in (/checkin)

**Trading Quests (medium, 100-500 XP):**
- Complete your first swap
- Swap on 2 different chains
- Swap on 3+ chains in one day
- Share your PnL screenshot on Twitter (tag @Suwappu)

**Referral Quests (high value, 500-1000 XP):**
- Generate your referral code (/ref)
- Refer 1 friend who starts the bot
- Refer 3 friends who complete a swap

**Content Quests (engagement, 100-250 XP):**
- Quote-tweet the launch thread with your experience
- Write a tweet about your favorite Suwappu feature
- Create a short tutorial or tip about using the bot

### Why Zealy works for a weekend sprint

- Pre-built audience of quest-hunters who actively look for new projects
- Gamified structure aligns perfectly with Suwappu's existing XP system
- Automated verification for social tasks (Twitter follow, join TG group)
- Creates a funnel: Zealy quest → join community → start bot → first swap → referral

### Cost

- Free tier allows 5,000 quest verifications/month (enough for a weekend launch)
- Paid plan ($150/month) if you need more capacity — worth it if traction appears

### Bot percentage warning

Expect 50-80% bot activity on Zealy quests. This is normal. The funnel filters: bots complete social quests but rarely complete actual swaps. The swap-completion quests are your quality filter.

---

## 10. KOL Micro-Influencer Outreach

Based on research, micro-KOLs (10K-100K followers) deliver 40% higher conversion rates than large accounts and are reachable without budget.

### Weekend Outreach (Sunday)

You won't close paid deals this weekend, but you can plant seeds:

**Target profiles:**
- DeFi educators who review trading bots
- Cross-chain / bridge content creators
- AI agent builders with crypto interest
- Solana/Base ecosystem commentators

**Outreach template (DM or reply):**
> "Hey [name], been following your content on [topic]. We just launched Suwappu — a cross-chain trading bot inside Telegram that works across 7 chains including Solana via Jupiter. We have a 30% lifetime referral program. Would love to get your honest take on it if you have a few minutes to try it. No strings attached. t.me/SuwappuBot"

**Key principles from research:**
- Reference their specific content (not generic)
- Don't ask for a post — ask for honest feedback
- Offer early / exclusive access angle ("you'd be one of the first to try it")
- Be transparent: you're a new project looking for genuine feedback
- If they like it, they'll post about it organically

### How many to reach out to

- Aim for 20-30 DMs across Twitter and Telegram
- Expect 10-15% response rate = 2-4 conversations
- If even 1 posts about it organically, that's a win for weekend 1

---

## 11. Content Templates & Copy

### One-liner variations (use across platforms)

- "Cross-chain swaps inside Telegram. 7 chains. One bot."
- "The only Telegram trading bot that works on Ethereum, Solana, and 5 more chains."
- "Earn 30% of trading fees forever. Just share your referral link."
- "Your trading fees drop from 0.8% to 0.4% the more you trade."
- "The first trading bot with AI agent support. Your agent can trade too."

### Short pitch (for TG groups, Reddit, Discord)

> Suwappu is a cross-chain DEX bot inside Telegram. Swap tokens across Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, and Solana — all from one bot. Uses Li.Fi for EVM routing and Jupiter for Solana.
>
> 30% lifetime referral commissions. XP system with fee discounts (0.8% → 0.4%). AI agent API support (A2A protocol).
>
> Try it: t.me/SuwappuBot

### Comparison post (for trading communities)

> **How Suwappu compares to other TG trading bots:**
>
> | | Suwappu | Trojan | BonkBot | Banana Gun |
> |---|---|---|---|---|
> | Chains | 7 | 1 (Solana) | 1 (Solana) | 4 |
> | Base fee | 0.8% | 1% | 1% | 1% |
> | Best fee | 0.4% (Diamond) | 0.9% (referral) | 1% | 1% |
> | Referral | 30% lifetime | 25% (5 levels) | 30%→10% (decays) | Token-based |
> | Mini App | Yes | No | No | Yes (Pro) |
> | AI agents | A2A protocol | No | No | No |
>
> Not saying we're better at everything — Trojan's speed on Solana is hard to beat. But if you trade across chains, this saves you from juggling multiple bots.

### Reddit post template

> **Title:** Built a cross-chain Telegram trading bot — supports 7 chains including Solana. Looking for feedback.
>
> **Body:** Hey everyone. We've been building Suwappu, a trading bot that lives inside Telegram and lets you swap tokens across Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, and Solana.
>
> The idea is that instead of using BonkBot for Solana AND a separate bot for EVM chains, you use one bot for everything. It routes through Li.Fi (EVM) and Jupiter (Solana).
>
> A few things that might be interesting:
> - 30% lifetime referral commissions (no decay, no tiers)
> - XP system where your fees drop from 0.8% to 0.4% as you trade more
> - Telegram Mini App with full dashboard
> - AI agent API support (A2A protocol) — any AI agent can discover and use our trading tools
>
> Still early stage. Would genuinely appreciate feedback from people who use TG trading bots. What features matter most to you? What would make you switch?
>
> Bot: t.me/SuwappuBot

---

## 12. Metrics, Tracking & Attribution

### Primary metrics (track hourly during weekend)

| Metric | Saturday Target | Sunday Target | Weekend Total |
|--------|----------------|---------------|---------------|
| New `/start` users | 30-50 | 50-100 | 80-150 |
| Wallets created | 20-30 | 30-50 | 50-80 |
| First swaps | 5-10 | 10-20 | 15-30 |
| Referral codes generated | 10-15 | 15-30 | 25-45 |
| Referral conversions | 3-5 | 5-15 | 8-20 |
| Community members (TG group) | 15-25 | 25-50 | 40-75 |
| Twitter followers | 30-50 | 50-100 | 80-150 |
| Twitter thread impressions | — | — | 5,000-15,000 |
| Zealy quest completions | — | — | 100-300 |

### Attribution tracking

- **Referral codes** track user-to-user attribution automatically
- **UTM parameters** on landing page links: `?utm_source=twitter&utm_campaign=genesis`
- **Bot `/start` deep links** can include source: `t.me/SuwappuBot?start=twitter`, `?start=reddit`, `?start=zealy`
- **Zealy dashboard** tracks quest completion funnels

### What "good" looks like for weekend 1

Be realistic. You're not Hamster Kombat. For a trading bot with no token and no existing audience:

- **50+ new users** who start the bot = solid
- **10+ completed swaps** = strong signal of product-market fit
- **5+ organic referrals** = the flywheel is starting
- **1 piece of organic content** from someone outside the team = breakout signal

---

## 13. Post-Weekend Roadmap

### Monday — Analyze & Iterate

- Pull all metrics from database, Twitter analytics, Zealy dashboard
- Identify which channel drove the most bot starts (referral source tracking)
- Read every piece of feedback received
- Write a "Week 1 recap" Twitter thread with real numbers (transparency builds trust)

### Week 2 — Double down on what worked

- If Twitter drove users → increase posting cadence to 2-3x/day
- If referrals drove users → enhance referral UX, add referral leaderboard to Mini App
- If Zealy drove users → expand quest campaigns, consider paid tier
- If AI agent angle resonated → write a developer tutorial, submit to agent directories

### Week 2-4 — Growth infrastructure

| Initiative | Effort | Impact |
|---|---|---|
| **Multi-level referrals** (add 2-3 levels like Trojan) | Medium | High — Trojan's 5-level system drove $65M in payouts |
| **Trading competitions** (weekly, monthly) | Low | Medium — engagement + content generation |
| **KOL partnerships** (paid, $3-7K budget) | Low effort, medium cost | High — 40% higher conversion than organic |
| **Content calendar** (3 threads/week + daily engagement) | Medium | High — compounds over time |
| **Galxe/Layer3 campaigns** (broader quest platforms) | Low | Medium — 26M+ users on Galxe |
| **Revenue sharing model** (token or fee distribution) | High | Very High — Banana Gun's 40% share is their core growth loop |
| **WhatsApp marketing** (unique channel, no competitor has it) | Medium | Unknown — unexplored territory for trading bots |

### Month 2+ — Token considerations

Based on what competitors did:
- **Banana Gun**: 40% revenue share to holders, buyback & burn, ~10% APY from real fees
- **BonkBot**: 100% of fees buy and burn BONK
- **Trojan**: No token (yet), but $65M+ in referral payouts

A token is a growth multiplier but also a commitment. Consider only after:
1. Consistent trading volume (proves product works)
2. Active referral network (proves distribution works)
3. Legal review (compliance is non-optional in 2026)

---

## 14. Anti-Patterns — What NOT to Do

| Don't | Why | What to do instead |
|---|---|---|
| Promise token launches or airdrops | Creates mercenary users who leave after claiming | Promise real utility: fee discounts, referral income |
| Pay for Twitter ads this weekend | Expensive, low-signal, hard to target | Organic engagement + micro-KOL outreach |
| Spam Telegram groups | Gets you banned permanently from high-value communities | Value-first engagement (see Section 7) |
| Fake volume or users | Destroys trust if discovered, inflates vanity metrics | Track real conversions (swaps completed, not just /start) |
| Over-engineer the landing page | Wastes Saturday on pixel-pushing instead of distribution | Ship a clean MVP page, iterate Monday |
| Ignore early users | First users are your most valuable asset — they'll evangelize or warn others | Reply to every message within 1 hour this weekend |
| Copy competitor's messaging directly | Looks derivative, positions you as a clone | Lead with what's genuinely different (7 chains, A2A, fee discounts) |
| Launch on too many channels simultaneously | Spreads thin, can't respond to feedback | Pick 2-3 channels, do them well |
| Compare on speed/MEV (Trojan's strength) | You'll lose this comparison against specialized Solana bots | Compare on breadth, cost, rewards, and agent support |

---

## 15. Budget

### Weekend 1: $0-150

| Item | Cost | Notes |
|---|---|---|
| Zealy free tier | $0 | 5,000 verifications/month |
| Zealy paid (if needed) | $150/month | Only if free tier fills up |
| Landing page hosting | $0 | Vercel/Netlify free tier |
| Canva for graphics | $0 | Free tier sufficient |
| Twitter/X account | $0 | Or $8/month for blue check |
| Telegram group | $0 | |
| **Total** | **$0-150** | |

### If weekend shows traction (Week 2 budget)

| Item | Cost | Notes |
|---|---|---|
| 2-3 micro-KOL partnerships | $3,000-7,000 | Based on 10K-100K follower range |
| Zealy paid tier | $150/month | |
| Galxe campaign | $500-2,000 | Quest distribution |
| Twitter Blue | $8/month | Verification + algorithm boost |
| Telegram Ads (test) | $500-1,000 | CPM model, paid in TON |
| **Total** | **$4,158-10,158** | Only spend if weekend metrics justify it |

---

## Appendix: Weekend Hour-by-Hour Schedule

### Saturday

| Time (UTC) | Task | Section |
|---|---|---|
| 09:00-10:00 | Set up Twitter/X account, bio, banner | §2 Block 1 |
| 10:00-11:00 | Create Telegram community group, pin messages | §2 Block 1 |
| 11:00-13:00 | Build and deploy landing page | §2 Block 2 |
| 13:00-14:00 | Create visual assets (screenshots, comparison graphics) | §2 Block 4 |
| 14:00-16:00 | Write and publish launch thread on Twitter | §4 |
| 16:00-17:00 | Set up Zealy space and quests | §9 |
| 17:00-18:00 | Activate Genesis Sprint (2x XP, announce in bot + community) | §6 |
| 18:00-19:00 | First round of Twitter engagement (reply, QT, follow) | §4 |

### Sunday

| Time (UTC) | Task | Section |
|---|---|---|
| 09:00-10:00 | Seed referral codes, share with inner circle | §5 |
| 10:00-12:00 | Telegram community seeding (Tier 1 groups) | §7 |
| 12:00-13:00 | Reddit posts (r/defi, r/solana, r/ethereum) | §3 Block 9 |
| 13:00-14:00 | AI agent thread + post in agent communities | §8 |
| 14:00-16:00 | KOL outreach DMs (20-30 messages) | §10 |
| 16:00-18:00 | Twitter engagement blitz (reply to every mention, search and engage) | §4 |
| 18:00-19:00 | Post Genesis Sprint leaderboard on Twitter | §6 |
| 19:00-20:00 | Respond to all feedback, plan Monday follow-ups | §13 |

---

*This plan was built from analysis of how Trojan reached $25B volume with 2M users, how Banana Gun built a revenue-sharing flywheel, how Hamster Kombat hit 300M users through gamified virality, and how the A2A/x402 ecosystem is creating new distribution channels for crypto-native products. Adapted for a zero-budget weekend sprint using Suwappu's existing infrastructure.*

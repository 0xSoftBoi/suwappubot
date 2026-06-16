# Gamification Design — Research Synthesis & Implementation Plan

> Researched 2026-06-16 via 5 parallel deep-research agents (live web search, cited inline).
> Supersedes the v1 "Sakura Realm" reskin on branch `claude/gamification-frontend-design-uqvys6`,
> which is kept as the visual shell but whose *mechanics* are redesigned here.
> Companion code: `webapp/src/lib/gamification.ts`, `webapp/src/components/realm/`, `webapp/src/pages/Realm.tsx`.
>
> **Governing principle (carry it everywhere): reward disciplined habits and real outcomes —
> never raw trade frequency, volume, or risk-taking.** That single line is what separates a
> defensible product from the conduct regulators have actually fined.

---

## 0. The thesis

Every catastrophic gamified-crypto collapse shares one root cause; every survivor shares one trait.

**Graveyard** — the reward *was* the product, funded by inflation/speculation not real value:
- DeFi Kingdoms: JEWEL −99.97%, TVL $901M → ~$5M ([defillama](https://defillama.com/protocol/defi-kingdoms), [coingecko](https://www.coingecko.com/en/coins/defi-kingdoms))
- Hamster Kombat: ~300M → ~41M users (−86%) in 3 months ([cryptotimes](https://www.cryptotimes.io/2024/11/05/hamster-kombat-loses-260-million-players-in-3-months-end-of-the-road/))
- friend.tech: 20k → <1k daily users, ~98% tx drop ([coincu](https://coincu.com/226465-friend-tech-data-hits-all-time-lows-tvl-plummets/))
- Blur: 2023 NFT volume called "inorganic" by Galaxy Research ([blockworks](https://blockworks.co/news/blur-airdrop-nft-trading))
- EigenLayer: 5%-to-users / 55%-to-insiders → "might signal the demise of points" ([coindesk](https://www.coindesk.com/tech/2024/05/09/eigenlayers-eigen-airdrop-might-signal-demise-of-once-popular-points))

**Survivors** — the game mapped to genuinely valuable, revenue-generating behavior, funded by real revenue:
- Hyperliquid: held ~$1.5B TVL *through* its airdrop, ~60% perp-DEX share; **Assistance Fund buys back HYPE daily with real fees**; **zero VC** ([airdropalert](https://airdropalert.com/airdrops/hyperliquid-2/), [yellow](https://yellow.com/research/hyperliquid-no-vc-funding-dex-volume-record))
- Catizen: $25M revenue, **$30 ARPU**, 500k *paying* users (vs $0.2 industry ARPU) ([theblock](https://www.theblock.co/post/307041/telegram-ceo-touts-catizen-crypto-game-earning-16-million-from-in-app-purchases))
- Aavegotchi: sticky for years via yield-bearing NFTs + seasonal rarity farming ([blog.aavegotchi](https://blog.aavegotchi.com/play-to-earn-guide-aavegotchis-rarity-farming-explained/))
- Blum: survived *only* by pivoting taps → real trades ([dyor](https://dyor.io/blog/blum/))

**Why this is decisive for Suwappu:** unlike DFK/Hamster, Suwappu **already earns real fees per swap.**
It can fund rewards from revenue, not inflation — the thing the graveyard structurally could not do.
Suwappu *starts* where Blum had to pivot to.

---

## 1. The regulatory inversion (this is what v1 got wrong)

The behavioral-finance + regulatory evidence is precise about *what causes harm*:

- **Massachusetts fined Robinhood $7.5M** (Jan 2024) for "celebratory imagery tied to the
  **frequency of trading**" and "features that **mimic games of chance**." ([V&E](https://www.velaw.com/insights/game-over-robinhood-pays-7-5-million-to-resolve-gamification-securities-violations/))
- **FCA experiment (9,000+ users):** game-like DEPs raised trading frequency ~11% and risky
  investing ~12%; worst among low-literacy, women, 18–34. ([FCA](https://www.fca.org.uk/publications/research-notes/research-note-digital-engagement-practices-trading-apps-experiment))
- **AMF experiment:** harm comes specifically from **badges/trophies tied to risk-taking**;
  badges tied to *safe* behavior *reduced* risk. Confetti barely moved behavior. ([AMF](https://www.amf-france.org/en/news-publications/news-releases/amf-news-releases/gamification-tends-increase-investment-risk-taking-according-behavioural-finance-experiment))
- SEC "Digital Engagement Practices" RFI explicitly names gamification + behavioral prompts;
  ESMA/FCA/IOSCO all moving the same direction. ([SEC](https://www.sec.gov/newsroom/press-releases/2021-167), [ESMA](https://www.esma.europa.eu/press-news/esma-news/esma-makes-recommendations-improve-investor-protection))

**v1 liability:** the quest **"Slay a Trade — complete a swap (+75 XP)"** is exactly the
rewarded-trade-frequency pattern. It must be removed.

**The inversion:** reward *discipline* (DCA, limit orders, stop-losses, security setup,
diversification, education). This is more defensible *and* better business — these are the sticky
behaviors. Note: cosmetic restraint isn't enough ("confetti regulation is the wrong way to
regulate" — [Yale LJ](https://www.yalelawjournal.org/forum/on-confetti-regulation-the-wrong-way-to-regulate-gamified-investing)); the *incentive structure* is the whole ballgame.

**Litmus test for every mechanic:** *"Does this reward the user for something good for them, or
just something good for our fee revenue?"* If the latter, cut it.

---

## 2. Cross-domain findings (condensed, cited)

**DeFi Kingdoms** ([docs](https://docs.defikingdoms.com/), [Naavik post-mortem](https://naavik.co/digest/defi-kingdoms-community-strategy/)).
Durable layers: NFT ownership/progression (levelable/breedable heroes kept collectors through the
crash); **time-gated stamina as the master clock** (25 stamina, regen 1/20min — paces play, forces
daily return, doubles as a token sink); profession/skill grinds (long-horizon goals); gamifying
DeFi as RPG ("Gardens = LP staking" made finance legible). Killers: emission-funded 10,000% APYs →
mercenary capital; breeding minted NFTs faster than any sink; "buying JEWEL *was* the game," so
price decline = no game. Lesson: **sinks must scale with faucets; ownership is the retention spine;
never let the reward token be the only reason to play.**

**Telegram tap-to-earn** ([Margex end-of-T2E](https://margex.com/en/blog/the-end-of-tap-to-earn-crypto-games/)).
Copy the *viral machinery*: zero-friction Telegram onboarding, referral-as-earning, leagues
(Bronze→Diamond), **daily combo/cipher** (drove millions of daily re-opens), seasons. Reject the
*hollow core* (taps → one-time airdrop). Survivors had real products (Catizen IAP; Blum real trades).

**Points & quest platforms** (Hyperliquid, Blur, Blast; [defiprime](https://defiprime.com/points-based-token-distribution-programs-web3), ["Quest Love" arXiv](https://arxiv.org/html/2501.18810)).
Proven formula for a fee-earning DEX: **fee-weighted points with sub-linear scaling**
(so wash-trading is always net-negative — every point costs a real fee); **bounded seasons + leagues
+ leaderboards**; **decaying referral overrides paid from referee fees**; **Layer3-style depth
quests** that force real product usage. Anti-patterns: linear volume points (wash-trading magnet);
open-ended jackpot races (EigenLayer backlash); insider-favoring allocation; quests = clicks
(sybil import — quest-acquired users show "extremely low, incentive-driven retention").

**Competitors** ([coincodecap aggregator](https://coincodecap.com/all-telegram-trading-bot-referral-programs-listed)).
Category competes on economics, not features. Benchmarks:
- **Trojan** — 5-level referral (35 / 3.5 / 2.5 / 2 / 1%) + **10% lifetime referee discount** +
  20% daily cashback → **$57M+ distributed** ([docs](https://docs.trojanonsolana.com/telegram-bot-user-guide/rewards-program)). This is the bar.
- **Banana Gun** — 40% of bot revenue to token holders ([docs](https://docs.bananagun.io/banana-token/rewards)).
- **Aavegotchi** — yield-bearing NFT + seasonal Rarity Farming + **3 parallel leaderboards** +
  **Kinship daily-decay streak**: the longevity blueprint.
- **Suwappu's edge:** nearly every gamified competitor (BONKbot, Photon, Trojan, Sigma, GMGN) is
  **Solana-only**. Cross-chain leaderboards/badges ("chains traded," "bridges completed") are a
  category **no competitor can match.**

**Frameworks** (Octalysis White-Hat vs Black-Hat; Hook Model; variable-ratio = slot machines).
Lean **White Hat** (Epic Meaning, Accomplishment/mastery, Empowerment). Treat Scarcity /
Unpredictability / Loss-Avoidance as the danger zone. **Never stack variable-ratio "loot" on top
of swaps** — the market is already a variable-ratio machine; stacking is the slot-machine pattern.

---

## 3. v1 honest assessment

A **cosmetic reskin, not game design**: fantasy theme over existing data, no real economic loop,
and it rewarded the wrong thing (trade frequency). Invented flavor ("Gold," "districts") with no
mechanics behind it — no fee-weighting, no anti-sybil, no seasons, no real referral economics, no
ownership layer, no discipline incentives, a streak tied to nothing valuable. Keep the visual shell;
replace the mechanics.

---

## 4. What we already have (the data spine)

From `webapp/src/lib/api.ts` + bot:
- Points: `totalPoints`, `currentStreak`, `longestStreak`, `canCheckin`, `rank`, check-in,
  history, leaderboard, rewards + redemption (`/webapp/users/me/points/*`)
- XP-based fee tiers (`webapp/src/components/tiers/TierCard.ts`)
- Referrals: `ReferralStats` (referredUsers, totalEarned, pendingRewards) — currently single-level
- Feature data derivable for quests: DCA orders, limit orders, price alerts, copy-trade, perps,
  predictions, portfolio (multi-chain holdings)

---

## 5. Implementation plan (phased by cost)

### P0 — reskin → real, NO new backend (~1–2 days)

Fixes the v1 regulatory liability and turns the shell into real loops, entirely on existing data.

- **Replace trade-frequency quests with discipline quests**, verified from existing records:
  "set a limit order," "complete a DCA cycle," "enable wallet security," "hold a stop-loss,"
  "swap across N chains," "set a price alert." Delete "Slay a Trade."
- **Multi-axis leaderboards** from existing leaderboard + portfolio: add **"chains traded"** and a
  **"discipline score"** axis (uses limit/DCA/alert usage) — leans into the cross-chain moat.
- **Honest "real earnings" surfacing** — replace fake "Gold" with real referral accrual + DCA
  progress (Aavegotchi/Blum honesty principle; the number must be real money).
- **Habit streak, not trade streak** — tie the streak to a *discipline* habit (e.g. plan-check /
  DCA adherence) with a **streak-freeze / grace day** so loss-aversion doesn't become coercion.
- **Opt-out toggle** for animations/leaderboards/notifications in Settings.
- Files: `webapp/src/lib/gamification.ts` (quest defs + verification from existing API data),
  `webapp/src/components/realm/QuestBoard.tsx`, `RealmMap.tsx`, `ChampionsBoard.tsx`,
  `webapp/src/pages/Realm.tsx`, plus a Settings toggle.

### P1 — light backend (~3–5 days)

- **Fee-weighted points ledger**, sub-linear curve `points ∝ fees^0.85` (wash-trading net-negative
  because every point costs a real fee). Wire swap-fee events → points.
- **Bounded seasons** (table + reset job) + season leaderboard; modest, *known* per-season rewards
  (avoid EigenLayer-style implied jackpot).
- **Multi-level referral overrides paid from referee fees** — beat Trojan: 5 levels +
  **lifetime referee fee discount**. Sybil-resistant: a fake referee must pay real fees to mint value.
- Tiers driven by **30-day fee volume** (industry-standard VIP ladder), shown with next-tier progress.
- Backend: Python (`bot/services/`, `database/_ensure_schema()` additive migration) +
  `api-ts` routes for season/leaderboard reads.

### P2 — bigger / on-chain (scoped later)

- **Utility-bound badges/SBTs** (cross-chain) that unlock **real fee discounts / referral boosts** —
  not cosmetic (SBT-as-credential). Off-chain badges first, on-chain when justified.
- **Squads** racing on aggregate volume (with self-trade dedup to kill wash-trading).
- **Battle pass funded by a fixed % of real fees** (Aavegotchi self-funding model; descending payout).
- **Hold-to-earn / buyback** *only if/when* a token exists (Hyperliquid Assistance Fund model).

---

## 6. Guardrails (non-negotiable — bake into every layer)

- ❌ No reward for trade frequency/volume via badges/confetti/streaks/points (MA Robinhood order).
- ❌ No badges/trophies tied to risk-taking, leverage, low-cap gambles (AMF harm vector).
- ❌ No variable-ratio loot (spin-to-win, mystery boxes, scratch-offs) triggered by swaps.
- ❌ No push notifications nudging specific tokens/trades.
- ❌ No coercive Black-Hat loss-aversion (expiring rewards that push a trade you wouldn't make).
- ❌ No one-time airdrop as the core reward (Hamster/Notcoin cliff). Points must be *continuously*
  redeemable for real value (fee rebates), never a single TGE.
- ✅ Fund rewards from real revenue, never inflation. Sinks scale with faucets.
- ✅ Reward discipline + education (financial literacy cut gamification's risk effect materially).
- ✅ Transparent rules, opt-out, and friction (confirm/cool-down) before large/high-slippage swaps.
- ✅ Lighter-touch defaults for new / low-literacy users.

---

## 7. Recommendation

Ship **P0 first**: it removes the regulatory liability in v1, converts the reskin into real loops,
and runs entirely on existing data (low risk, fast). Then P1 (fee-weighted points + seasons +
referral tree) is the real moat. P2 when a token/contract strategy is decided.

---

## Appendix — key sources

DeFi Kingdoms: docs.defikingdoms.com; naavik.co/digest/defi-kingdoms-community-strategy;
defillama.com/protocol/defi-kingdoms · Tap-to-earn: cryptotimes (Hamster collapse); margex
end-of-T2E; theblock (Catizen revenue); dyor.io/blog/blum · Points/quests: defiprime points
programs; arxiv.org/html/2501.18810 (Quest Love); airdropalert/yellow (Hyperliquid);
blockworks (Blur inorganic); coindesk (EigenLayer) · Competitors:
coincodecap referral aggregator; docs.trojanonsolana.com; docs.bananagun.io;
blog.aavegotchi.com rarity-farming · Frameworks/regulatory: yukaichou.com (Octalysis White/Black
Hat); velaw.com (MA Robinhood $7.5M); fca.org.uk DEP experiment; amf-france.org gamification
experiment; sec.gov 2021-167 (DEP RFI); yalelawjournal.org (confetti regulation).

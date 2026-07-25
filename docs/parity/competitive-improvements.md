# Suwappu Competitive Improvement Roadmap

_Research synthesis + prioritized roadmap. Compiled from two competitive-research passes
(direct Telegram-trading-bot rivals, and retention/UX/monetization patterns). Every claim
is cited or flagged UNVERIFIED. Vendor speed/fee figures are marketing claims unless a
`docs.*`/primary source is cited._

## Bottom line

Suwappu's **mechanisms** already match or beat most leaders: tiered fees (0.1–1%), a
3-stream referral system with milestone bonuses, simulation-based honeypot detection, a
fee-gated (farm-resistant) points/seasons economy, 17 chains, 10+ aggregators, HyperLiquid
perps, an agent API, a Mini App, and a mobile app. **The gap is surface area, discovery,
and virality — not new financial primitives.** The highest-leverage moves are cheap
growth-loop and discovery additions on top of what already exists.

---

## Where the leaders are ahead (prioritized)

### Tier 1 — quick wins (build on existing systems)
1. **Shareable PnL image cards** — the standard organic-growth loop (Hyperliquid/Axiom/GMGN).
   _Status: SHIPPED + iterated_ (`bot/utils/pnl_card_image.py` + `/hx` share flow, with the
   sharer's referral link baked in). Iterations: (a) a scannable **QR of the referral link**
   is rendered on the card so a viewer can open the bot with the referral attached straight
   from a screenshot; (b) a **📤 Share PnL** button now surfaces on the completed-swap status
   view (`check_swap_status`) — the semantically correct home for a completed swap's realized
   ROI, not the fresh post-buy message where ROI is ~0%. Follow-up: attach to positions once
   per-position entry/exit is tracked (the `UserPosition` aggregate lacks clean entry/exit
   today).
2. **Visible leaderboard + streaks** — _Already exists_ (`/lb`, `daily_streak`/`longest_streak`,
   daily check-in). Optional: add a season/PnL leaderboard variant + Mini App tab.
3. **Bundle / sniper-supply-% signal** — Axiom/Trojan/Not.Trade surface "% of supply held by
   snipers/bundlers" as a first-class pre-trade metric, distinct from honeypot/simulation.
   Suwappu has honeypot/rug/simulation but not this. _Effort: M (needs early-buyer on-chain
   analysis)._ [Techbullion anti-rug roundup](https://techbullion.com/best-telegram-bot-for-avoiding-scams-honeypot-detection-and-anti-rug-tech-across-5-platforms/)
4. **Prominent honeypot hard-block** — _Status: SHIPPED_. A confirmed honeypot
   (`is_honeypot`, only True on a positive sell-simulation) is now hard-blocked with **no
   override** — both at the swap confirm gate (`bot/handlers/swap.py`, before the
   HIGH/CRITICAL warn-and-confirm) and at token discovery in paste/forward-a-tweet
   (`bot/handlers/paste_trade.py._render_token_card` shows a blocked card with no Buy button
   and does not stash the token). HIGH/CRITICAL still use the "🚨 swap anyway" secondary
   confirm; only the guaranteed-total-loss honeypot case is hard-blocked. Matches Banana
   Gun's "Banana Simulator".
5. **Turbo vs Secure speed/cost toggle** — BONKbot ("MEV Turbo vs Secure"), Nova ("Ultra V2
   vs Demon"). Suwappu already has `mev_protection_enabled` + `tx_speed_preset` on
   `UserSettings` — package them as one simple binary and confirm `tx_speed_preset` is wired
   into the jito-tip/priority path. _Effort: S._

### Tier 2 — discovery + retention engines
6. **Twitter/X-to-trade monitor** — Axiom Tweet Monitor / Bloom Twitter-OCR let users execute
   directly off a tweet feed; the single most-cited reason traders default to Axiom.
   _Status: free v1 SHIPPED + iterated_ — a user forwards a tweet / alpha message → the bot
   scans the whole message (`bot/handlers/paste_trade.py.on_freeform_text`) for an embedded
   contract address and shows the token card + one-tap Buy (reuse `pbuy_` paste-trade entry).
   Iteration: addresses embedded in **links** (dexscreener/birdeye/pump.fun/solscan) or behind
   a `CA:`/`$` prefix are now extracted by splitting each token on URL/prefix delimiters, so a
   forwarded tweet with only a chart link still resolves. Upgrade to a real subscribed feed later._
   [Axiom Tweet Monitor](https://docs.axiom.trade/tweet-monitor) · [Bloom](https://coincodecap.com/bloom-solana-bot-detailed-review)
7. **Unified "Pulse" discovery feed** — new / near-migration / just-migrated tokens with
   filters (age, liquidity, sniper-%, holder concentration). Suwappu has the detection
   backends (`sniping/launch_detector`, `raydium_monitor`, `pump_fun_api`) but no consolidated
   filterable feed; the webapp `Discover.tsx` uses a separate trending API. _Effort: L._
   [Axiom Pulse](https://docs.axiom.trade/axiom/finding-tokens/pulse)
8. **Referral 2.0** — sub-affiliate (2nd-tier) commission (exchanges run 5–10%; propose 10%)
   + auto-recurring cashback (Banana Gun auto-distributes 40% of fees 6×/day; propose 10% of
   the user's own paid fees weekly, credited as USDC, min $1, activity-gated). Suwappu's 1:1
   referral is already strong; the 2nd tier converts power users into recruiters. _Effort: M,
   MONEY-PATH (needs schema + Opus review)._ [OKX/Bybit affiliate tiers](https://ventureburn.com/okx-referral-code/) · [Banana Gun](https://blog.bananagun.io/)
9. **Position-attached trailing stop-loss** — Padre/Terminal attach a limit/trailing stop to
   an open position (auto-adjusts with favorable price), beyond static TP/SL. Confirm whether
   Suwappu's `trailing_stop_conversation` already supports percentage-based trailing.

### Tier 3 — strategic / needs a decision
10. **Smart-money confluence alerts** ("N tracked wallets bought $X in the last hour") — the
    top-of-funnel discovery hook (Nansen/GMGN track 50k+ wallets). Needs a **paid** wallet-
    labeling data source (Nansen/Arkham/Cielo). [Nansen Smart Alerts](https://www.nansen.ai/guides/smart-alerts-the-ultimate-crypto-alerts-for-traders)
11. **"No god-mode dashboard" trust differentiator** — market-leader Axiom is in an alleged
    insider-trading scandal (staff front-ran users via internal dashboards). Only claim this
    after a `security-auditor` pass confirms Suwappu's internal access controls hold up.
    [ZachXBT/Cryptonews](https://cryptonews.com/news/axiom-crypto-data-scandal-insider-trading-governance-failures/)
12. **Speed as a marketed spec** — Photon/Axiom/MEXC bot comparisons benchmark execution
    latency publicly. Benchmark real latency (`swap-debug`) BEFORE marketing any number.
13. **TON Pay / Telegram Stars for premium tiers** — 90–95% lower CAC in Telegram, but Stars
    are ToS-restricted to "digital goods" → compliance check before building.
    [TON Pay SDK](https://bingx.com/en/news/post/ton-foundation-unveils-ton-pay-sdk-for-telegram-mini-apps-on-february)

---

## Validated bets Suwappu is already on (research confirms, not hype)
- **xStocks / tokenized equities** — ~$25B cumulative volume, +2,878% YoY, $3.57B daily record
  (May 2026). [CoinMarketCap](https://coinmarketcap.com/events/tokenized-stocks-cex-vs-onchain/)
- **Prediction markets** — Polymarket $425M single-day record; Nasdaq partnership. Good base
  for a gamified up/down "battle" layer.
- **AI trading agents / agent API** — real but early (Binance AI Agent Skills, MCP). Suwappu's
  `/v1/agent/*` is well-positioned as a differentiation lane.

---

## Direct-rival snapshot (confidence: Medium unless noted; vendor claims not audited)

| Bot | Chains | Fee | Standout edge |
|---|---|---|---|
| **Axiom** | Solana-first | ~0.65% | "Pulse" discovery + Tweet Monitor + bundle checker; #1 by volume |
| **Trojan** | SOL + ETH | 0.9–1% | "The Arena" cashback; auto-sniper |
| **Maestro** | 14 chains | 1% + ~$200/mo Premium | Block-0 auto-sniper + Call Channels (auto-trade off 3rd-party alpha) |
| **BONKbot** | Solana | 1% | MoonPay on-ramp in TG; Turbo vs Secure MEV toggle |
| **Banana Gun** | 5 chains unified | 0.5–1% | Pre-trade Simulator (hard-blocks honeypots); 40% fee-share 6×/day |
| **BullX** | multi | 1% | Multi-wallet "blast radius" UX; strong PnL dashboard |
| **GMGN** | multi | 1% | Tracks 50k+ smart-money wallets; best wallet analytics (2.1★ reliability) |
| **Photon** | Solana | 0.5–1% | Terminal-grade charts + fast execution |
| **Padre/Terminal** | multi | var | Position-attached limit + trailing stop; acquired by pump.fun 2026 |
| **Bloom** | SOL+EVM | ~0.9% | Twitter-OCR trade triggers; XP fee-reduction leveling |

---

## Build status (branch `claude/growth-discovery-referral-v2`)
- ✅ **Shipped:** PnL image share cards + referral QR + share-on-completion (#1); honeypot
  hard-block at confirm & discovery (#4); forward-a-tweet → one-tap buy with in-link CA
  extraction (free v1 of #6).
- ⏭️ **Already existed:** leaderboard + streaks (#2).
- ⏳ **Not yet built (money-path, warrant a focused pass):** bundle signal (#3), Turbo/Secure
  toggle (#5), Referral 2.0 (#8), unified Pulse discovery feed (#7).
- 🔴 **Decision-gated:** smart-money data source (#10), speed benchmark+marketing (#12),
  TON Pay compliance (#13), "no god-mode" security audit (#11).

_Note: a batch build attempt via sub-agents was unreliable and produced half-integrated
money-path code for #3/#4/#5, which was reverted rather than shipped. These should be
implemented directly and money-path-reviewed in a focused session._

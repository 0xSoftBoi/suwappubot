# CMO Audit — Demand Side (exec-audit-2026-08)

## 1. Post-swap action chips (quickswap.py, swap.py) — OK
All four chips (`alerts_menu`, `dca_menu`, `paste_check_hint`, `ref_menu`) are live callbacks: `bot/main.py:692`, `bot/handlers/limit_orders.py:904` (dca_menu_callback), `bot/main.py:565` (paste_check_hint), `bot/handlers/referral.py:100` (ref_menu). Not dead. No fix needed.

## 2. MEDIUM — `/s` quickswap under-discloses vs flagship wizard
`bot/handlers/quickswap.py:207-218` shows only Gas + Bridge($) + bundled "Total Fees($)". The full wizard (`bot/handlers/swap.py:1806-1812`) shows Platform fee %, gas, bridge fee, time estimate, and provider before confirm. Quickswap never breaks out the platform fee % and has **no bridge wait-time estimate** (`format_time_estimate` used in swap.py, never imported in quickswap.py).
**Fix:** add `• Platform fee: {fee_pct}% ({usd})` and `• Time: {format_time_estimate(quote.estimated_time)}` to quickswap.py:207-218 — same data already on `quote`.

## 3. HIGH — `/rewards` command collision buries MONEY-PATH cashback
Three handlers bind `CommandHandler("rewards", ...)`: referral.py (earnings), points.py (XP store), rewards.py (on-chain fee **cashback**, tagged MONEY-PATH). `rewards_handler` imported at `bot/main.py:42` from bot.handlers.rewards is **silently shadowed** at `main.py:243` by the same name from bot.handlers.points; registrations at `main.py:459,594` both register the points.py object. PTB group-0 first-match-wins means `/rewards` only ever reaches referral.py's handler (registered first, `main.py:438`).
**Impact:** the fee-cashback retention feature is completely unreachable via its own command; XP store unreachable by text command.
**Fix (route to bot-dev):** rename one command (e.g. `/cashback`), de-shadow the import.

## 4. MEDIUM — Referral copy contradicts enforced constants
`referral_service.py:1584,1393` claim "No cap, no expiry" / flat "30%". Code enforces: `MAX_REWARD_PER_REFEREE_PER_30D_USD = $500` rolling cap (`referral_service.py:118,479-485`); tier-based 30%/40% rate (`_l1_rate_for_tier`, :123-131); `$10` min lifetime volume before any payout (`MIN_VOLUME_BEFORE_PAYOUT_USD`, :116,447-452) — never disclosed.
**Fix:** replace with "up to $500/referee per 30 days, uncapped across referees"; disclose the $10 min-volume gate once in `format_referral_message`/`format_rewards_message` (:1539, :1584).

## 5. Competitive position — bridging is parity, not a wedge
Maestro ships deBridge + Arc Network bridge with sponsored gas (headline feature); Trojan has ETH↔SOL bridge; BullX is multi-chain (6 chains) framed as multi-chain trading. Suwappu's 7+ chains with pre-confirm fee/time disclosure is competitive on substance, but our copy (`fee_service.format_fee_info()`) differentiates only on fee bps, never on the bridge.
Sources: Maestro Arc bridge announcement (x.com/MaestroBots/status/2082703713458921562), directionsmag.com Trojan review, coincodecap.com BullX review.

## Verdict
The flagship wizard's disclosure is a genuine trust asset — don't dilute it. Bring `/s` to disclosure parity before promoting it. The `/rewards` collision is the costliest finding: shipped cashback invisible by accident — pure lost retention. Fix the referral overclaim before any campaign amplifies it. The wedge is disclosure transparency, not bridging.

# $Suwappu Community Token — Utility & Adoption Plan

*Drafted 2026-08-28. Status: PROPOSAL — no code shipped. Product/legal decisions marked ⚖️ need the founder's call.*

## 1. The token (verified on-chain + Dexscreener API, 2026-08-28)

| Field | Value |
|---|---|
| Name / symbol | **Suwappubot ($Suwappu)** |
| Chain / CA | Base (8453) — `0x26D58Ce71ace3A79346C43EDE802fF8F4fe55bA3` |
| Venue | Uniswap **v4** /WETH pair `0x787fe87a...436159`, Doppler ERC20 proxy (impl `DopplerERC20V1` @ `0xDB7B520b...be87`) |
| Market (24h of 8/28) | ~$238K mcap/FDV · ~$103K liquidity · ~$690K 24h vol · +1,344% 24h · 3,814 buys / 6,020 sells |
| Launched | 2026-08-27 (~18h before this snapshot) |

⚠️ **Copycats exist**: at least one other "SuwappuBot" ($Suwappu) at `0xb2000000...7201` (~$35K mcap). **Confirm with the community/Bankr front page which CA is canonical before hard-coding anything.**

⚠️ **Due diligence before building on it** (team does NOT control this contract): read the Doppler proxy for mint/pause authority, fee/tax hooks, LP lock & liquidity migration schedule (Doppler migrates from bootstrapping pool), and who holds admin keys. Route to `security-auditor` + Blockscout `inspect_contract_code`.

## 2. Posture: adopt, don't issue ⚖️

The one precedent that matches exactly: **Bonkbot × BONK** — a trading bot that gave real utility to a coin it never launched. The safe framing, per every surviving comparable (Banana Gun, Unibot post-mortems):

- **DO** say publicly: "We didn't launch this. We make no promises about price. We're adding utility because the community showed up." (DisclaimerCoin-style language.)
- **DO** frame everything as *utility/consumptive*: discounts, access, XP — things you *use* the token for.
- **DON'T** ever: promise price action, promise a revenue share to holders (Howey/securities-shaped, and the pattern regulators flag), or let any team-associated wallet sell into a dip — Banana Gun's team got branded a rug for exactly that even with honest intent.
- Note: "help drive the price up" is only OK as a *side effect* of real utility and buy-side demand from product flows. No coordinated pumping, ever — it's market manipulation and it always ends the story badly.

## 3. Utility ladder (phased)

### Phase 0 — today, zero/near-zero code
1. **Make it one tap to trade in the bot.** Base + arbitrary-CA swaps already work (`bot/config/chains.py:104` — full LiFi support). Publish a deep link that opens `/s` prefilled with the canonical CA; pin it from @SuwappuBot. The bot earning fees *on its own meme coin's volume* is the flywheel.
2. **Fee promo window** ⚖️: e.g. 50%-off swap fees on the $Suwappu pair for 2 weeks. One-line change in `fee_service` per-token override; drives volume to the deepest pool (helps stability via depth, legitimately).
3. **Auto price alert**: seed an alert for the token via existing `AdvancedPriceAlert` (`bot/handlers/alerts.py:24`) for anyone who opts in.
4. **Disclaimer post** (see §2) — ship the words the same day as the deep link.

### Phase 1 — this week, small code (all MONEY-PATH → `money-path-reviewer` before merge)
1. **`check_token_balance(user_id, chain, token_address, min_amount)`** helper on `bot/services/wallet.py` (raw ERC-20 `balanceOf` infra exists at wallet.py:1–60; just needs the reusable gate).
2. **Holder fee tiers**: hold N $Suwappu → PRO rate (0.5%), hold M → PREMIUM (0.3%). Plugs into `TIER_FEE_RATES` (`bot/services/fee_service.py:34–39`) as a computed tier, respecting `MIN_EFFECTIVE_FEE_RATE`. This is the Unibot/Banana Gun mechanic with utility framing. Snapshot balance at quote time; re-check per swap (no caching a holder flag forever — flash-loan/transfer gaming).
3. **Holder XP multiplier**: e.g. 1.5× on `POINT_ACTIONS` (`bot/models/points.py:50–70`) while holding. Cheap, visible, no fund flows.
4. **Webapp holder view**: `webapp/src/pages/TokenDetail.tsx` already renders price/chart via DexScreener — add a "holder perks" panel showing the user's balance vs. tier thresholds (`TokenBalance.tsx` exists).

### Phase 1.5 — cross-stack parity (known gap, flagged by money-path review)
- **api-ts computes fee bps independently** (`api-ts/src/services/SwapService.ts`, `VipService.ts`) and has no knowledge of `COMMUNITY_TOKEN_*`. Once the flag flips on, a holder pays discounted fees in Telegram but full fees via webapp/agent routes. Port the holder-tier floor to api-ts (`api-ts-dev`) before or shortly after enabling — or accept and document the divergence for launch week.
- `swap_engine.py` and the snipe/copy/perps fee paths don't warm the balance cache; they fall back to no-perk (fail-safe, never undercharge) — port warms opportunistically.

### Phase 2 — sustained value ⚖️ (founder decision; strongest mechanism, highest care)
- **Fee-funded buyback (Bonkbot model)**: route X% of bot fee revenue (collected by `fee_sweeper`, bot/services/fee_sweeper.py:7–35) into periodic market-buys of $Suwappu, then **burn or hold in a published transparent wallet**. This is the only mechanism proven to durably support a community coin — 100% of Bonkbot's fees buy-and-burn BONK. Start small (e.g. 10%), publish every tx hash. Requires: treasury wallet design → `security-auditor`, swap/burn execution → `chain-support`, and it's the most MONEY-PATH thing possible.
- **XP → token sink**: redemption store (`bot/models/points.py:76`, 200 pts = $1) pays out in $Suwappu bought on-market — converts existing loyalty liability into steady buy pressure. Never mint/IOU — buy on market only.
- **Referral boost for holders**: bump swap-commission split (bot/services/referral_service.py:6–42) one affiliate tier for holders.

## 4. What "help stabilize" actually means here
- **Depth, not price**: promo-driven volume on the main pool + buyback flow deepens liquidity; that dampens volatility. That's the honest lever.
- **Sell pressure is real**: 6,020 sells vs 3,814 buys in the first 24h. Utility that requires *holding* (fee tiers, XP multiplier) is the counterweight — it gives a reason not to sell that isn't a promise.
- **Copycat risk**: publicly naming the canonical CA (once confirmed) protects the community from the $35K fake and any future ones.

## 5. Execution order / routing
1. ⚖️ Founder confirms: canonical CA, Phase-0 promo yes/no, Phase-2 buyback appetite.
2. `security-auditor`: contract due diligence on the Doppler proxy (§1).
3. `bot-dev`: Phase 1 items (balance helper, holder tier, XP multiplier) — tag diff MONEY-PATH.
4. `money-path-reviewer` (Opus): mandatory review before merge.
5. `webapp-dev`: holder panel.
6. Phase 2 only after 1–5 land and the disclaimer is published.

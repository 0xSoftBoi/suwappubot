# $Suwappu Community Token — Announcement Copy

Status: copy-ready. Perks described here (holder fee tiers, 1.5× XP) are
**feature-flagged** per `docs/plans/suwappu-token-utility.md` — do not publish
any line here until the flag is live in prod, or the specific claim it
depends on becomes wrong the moment it's posted.

Canonical CA (Base): `0x26D58Ce71ace3A79346C43EDE802fF8F4fe55bA3`
Source: `docs/plans/suwappu-token-utility.md` §1, verified on-chain + Dexscreener 2026-08-28.

---

## 1. X/Twitter thread (@SuwappuBot)

**1/**
Okay so a community coin called $Suwappu launched on Base yesterday, named after us. We didn't launch it, don't control the contract, and found out the same way you did — a chart going vertical with our name on it.

Wild way to spend a Thursday. Thank you.

**2/**
For the people asking "is this real": the token is real, the community around it is real, we didn't mint it and we're not going to pretend we did. Full disclosure in the reply below — read it before you ape.

**3/**
What we *can* do: we're a swap bot. Base is one of our 7+ chains. So — holder perks, shipping now, feature-flagged while we watch it in prod:

→ Hold $Suwappu, your swap fee in the bot drops from FREE-tier (1%) toward PRO (0.5%) or PREMIUM (0.3%) rates
→ 1.5× XP on swaps while you hold

Utility, not a promise about the chart.

**4/**
Do the math yourself, always: PRO vs FREE saves you $5 in fee per $1,000 traded. PREMIUM saves $7 per $1,000. That's the whole trade — no other claims attached.

**5/**
One-tap: paste the CA into a DM with the bot, or run
`/check 0x26D58Ce71ace3A79346C43EDE802fF8F4fe55bA3`
and you'll get a safety card + buy option straight from Telegram.

**6/**
⚠️ Copycats exist — at least one fake "SuwappuBot" token is already circulating on Base. The ONLY canonical CA is:

`0x26D58Ce71ace3A79346C43EDE802fF8F4fe55bA3`

Bookmark it. Don't trust a CA from a screenshot, a reply-guy, or a "presale" DM — including one that claims to be from us.

---

## 2. Pinned disclaimer (plain language)

We did not create $Suwappu and we do not control its contract. It launched independently on Base via a third-party tool, using our name — we found out after the fact, like everyone else. We are not the token's issuer, developer, or admin, and we hold no special authority over its supply, liquidity, or trading.

Nothing in this bot, our channels, or this thread is financial advice, an offer to sell securities, or a promise about price. We make no claims that $Suwappu will go up, hold value, or perform in any way — we don't control the market and wouldn't claim to if we did.

The "holder perks" (swap-fee discount tiers, XP multiplier) are utility features of the Suwappu bot, not a return on the token and not tied to any roadmap for the token itself. They are feature-flagged, meaning we can change the thresholds, the rates, or turn them off, at our discretion, without notice. Holding $Suwappu does not make you an owner, partner, or stakeholder in Suwappu the product — it makes you eligible for a bot feature, same as any other in-app perk.

Do your own research. Only risk what you can afford to lose. If it's not obvious: this is not investment advice.

---

## 3. Telegram announcement (bot channel)

**$Suwappu is live on Base — here's what changes in the bot**

A community token, $Suwappu, launched on Base referencing our name. We didn't create it and don't control the contract (full disclaimer pinned in the channel) — but we're shipping real utility for holders, feature-flagged and rolling out now:

• Fee tiers — hold $Suwappu, your swap fee steps down from FREE (1%) toward PRO (0.5%) / PREMIUM (0.3%)
• 1.5× XP on swaps while you hold

Trade it in one step: paste the contract address into the bot, or send
`/check 0x26D58Ce71ace3A79346C43EDE802fF8F4fe55bA3`

⚠️ Canonical CA only — a copycat token is already circulating. Do not trust any other address, even one sent "from us."

Not financial advice. Perks are a bot feature and can change.

---

## 4. "Do not ever say" — 5 hard rails

1. **No price claims or promises** — never "going up," "will pump," "next 100x," or any variant implying future value/return.
2. **No revenue-share or yield framing** — never "get paid," "earn from fees," "passive income," "dividend" — that's a securities-shaped claim (see `docs/plans/suwappu-token-utility.md` §2 Howey note) even if unintentional.
3. **No ownership language** — never "own a piece of Suwappu," "shares," "stakeholder," "partner" — holders get bot features, not equity or governance.
4. **No implied endorsement of the token's fundamentals** — never vouch for the contract, LP lock, or team behind the launch ("safe," "audited," "legit team") — we did not build it and have not audited it end to end.
5. **No urgency/scarcity manufacturing** — never "last chance," countdowns, or "don't miss out" — the fee-tier math is the only reason to act, and it's evergreen, not time-boxed.

---

## Numbers used and their source

| Claim | Value | Source |
|---|---|---|
| Canonical CA | `0x26D58Ce71ace3A79346C43EDE802fF8F4fe55bA3` | `docs/plans/suwappu-token-utility.md` §1 |
| FREE / PRO / PREMIUM swap fee | 1.0% / 0.5% / 0.3% | `bot/services/fee_service.py:34-38` (`TIER_FEE_RATES`) |
| $5 saved per $1,000 (PRO vs FREE) | (0.01 − 0.005) × 1,000 | derived from the same constants |
| $7 saved per $1,000 (PREMIUM vs FREE) | (0.01 − 0.003) × 1,000 | derived from the same constants |
| One-tap trade mechanic: paste CA or `/check <address>` | verified command | `bot/handlers/paste_trade.py:366-379` (`check_command`) |
| 1.5× XP multiplier | proposed value, not yet a shipped constant | `docs/plans/suwappu-token-utility.md` §3 Phase 1.3 — flagged below |

## What I deliberately did not claim, and why

- **No `/s <CA>` prefill deep link.** I checked `bot/handlers/swap.py` (`swap_command` → `start_swap`) — `/s` takes no address argument in the current code; `/start` deep-links only carry a referral code (`bot/handlers/start.py:221-232`). The real, verified one-tap mechanic is pasting the CA in chat or `/check <address>` (`paste_trade.py`), which does exist and does show a Buy option. I used that instead of the requested `/s` pattern because the requested pattern isn't true of the shipped code — flagging this back to the team rather than publishing a dead instruction.
- **1.5× XP is not yet a repo constant.** It's the plan doc's proposed value (Phase 1.3), not something I found hardcoded in `bot/models/points.py`. I kept it because the task specified it as part of what's shipping, but it needs to be locked to an actual constant (e.g. `HOLDER_XP_MULTIPLIER = 1.5`) before this copy goes out, or the number in print will drift from the code.
- **No specific fee-tier thresholds (how many $Suwappu to hold).** Not in the plan doc or repo yet — Phase 1 spec says "hold N → PRO, hold M → PREMIUM" without values. Left unstated rather than invented.
- **No mcap/volume/24h-move numbers from the plan doc's snapshot.** Those are point-in-time market data, not something the bot controls or should be seen promoting — including them would read as price talk.

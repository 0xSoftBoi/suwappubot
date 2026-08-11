# Moats

Why this matters for Gekko: the roadmap is explicit that the 1% swap-fee floor is structural and shared across every competitor — durable advantage has to come from somewhere else. This doc names the moats Gekko can actually build, grounded in what the competitive research already found no incumbent combines: trading + bank-like primitives + non-custodial trust.

## Distribution

### What it is
The channels and existing relationships that get Gekko in front of users cheaper or faster than a cold-start competitor could manage.

### How it works / benchmarks
- Trojan ($25B lifetime volume), Banana Gun ($16B), BullX ($2.29B fees) all built distribution purely through Telegram trading communities (per roadmap competitive snapshot) — proof that crypto-native distribution via existing chat surfaces works at scale.
- Félix reached $3B volume / 300K users via WhatsApp distribution in a market with zero non-custodial competition (per roadmap).

### Gekko approach
Gekko's distribution moat is the existing Suwappu trading user base — a warm audience already trusting the product with swaps, converted into neobank users at near-zero CAC (see `15-unit-economics.md`). This is a real, defensible advantage a net-new neobank entrant does not have.

### Target / definition
- Definition: % of Gekko's funded accounts sourced from existing Suwappu users vs. net-new acquisition.
- Target: majority (>50%) of first-year funded accounts from cross-sell, not paid acquisition.

## Brand

### What it is
The reputational asset of being trusted with money — particularly important in crypto where "non-custodial and trustworthy" is a differentiator, not a given.

### How it works / benchmarks
- GMGN carries a notably weak trust signal (2.1/5 Trustpilot, per roadmap snapshot) despite strong volume — proof that volume alone doesn't build brand trust, and that a trust gap exists to be won.
- Gnosis Pay's brand is built almost entirely on "purest non-custodial card" positioning (per roadmap) rather than features — a template for how a crypto-neobank brand differentiates.

### Gekko approach
Position explicitly around non-custodial trust plus "the trading bot that also pays you yield and lets you spend" — a combination the roadmap confirms no incumbent occupies. Brand should lean on transparency (the roadmap's fee-transparency item is a brand asset, not just a feature) rather than a generic fintech-polish message.

### Target / definition
- Definition: qualitative — tracked via user survey/NPS once volume supports it, not a hard metric for v1.
- Target: none set for v1; establish an NPS baseline within 6 months of card launch.

## Banking Relationships

### What it is
The regulated partnerships (sponsor bank, card processor, fiat ramps) that gate access to bank-like functionality — a moat because these relationships are slow and hard to establish, not because they're proprietary technology.

### How it works / benchmarks
- Visa represents 97% of crypto-card volume (per roadmap); access to that rail requires a sponsor-bank/processor relationship that takes 4-8 weeks of partnership work minimum (per roadmap effort estimate) and ongoing compliance investment.
- This is explicitly a "requires a regulated partner — integrate, never build" category per the roadmap; the moat is having secured and maintained the relationship, not the underlying tech.

### Gekko approach
Treat the sponsor-bank/processor relationship itself as a defensible asset once secured — a competitor starting today faces the same 4-8 week (or longer) partnership runway Gekko does, so moving first and maintaining the relationship well (see `18-operations.md` Sponsor Bank Management) is the actual moat, not a technical one.

### Target / definition
- Definition: number of live regulated partnerships in good standing.
- Target: maintain zero partner-relationship disruptions (see contingency-plan target in `18-operations.md`).

## Regulatory Infrastructure

### What it is
The compliance program, licensing posture, and risk controls that let Gekko operate legally across the products it offers — an unglamorous but genuinely hard-to-replicate asset once built correctly.

### How it works / benchmarks
- BSA/AML compliance programs and sponsor-bank-mandated controls (per `21-scale.md`) take meaningful time and expertise to stand up correctly; getting it wrong risks the sponsor-bank relationship itself.

### Gekko approach
Invest disproportionately here relative to Gekko's current stage, since it's both a launch gate (`21-scale.md`) and a long-term moat — a well-run compliance program becomes easier to extend to new products/jurisdictions than to build from scratch each time a competitor tries to catch up.

### Target / definition
- Definition: same as the `21-scale.md` compliance gate — a documented, partner-approved program.
- Target: zero compliance-driven partner escalations post-launch.

## Proprietary Data

### What it is
The behavioral, transactional, and on-chain activity data Gekko accumulates uniquely by combining trading + banking + credit signals on the same users — data no single-purpose competitor (a pure trading bot or a pure card product) has.

### How it works / benchmarks
- No incumbent in the roadmap's research combines trading behavior with bank-statement/spend data (the "no bank-statement view" gap called out as the #3 headline finding) — this combination is itself the data moat, not any single data source.

### Gekko approach
The Personalization section of `16-retention.md` is the near-term application of this moat: yield/DCA/spend recommendations built on the combined trading+banking dataset that a trading-only bot or a banking-only neobank cannot replicate without both product lines. Treat this combined dataset as a long-term underwriting asset too — it's the closest thing to alternative credit data Gekko could eventually use to justify unsecured credit underwriting (see `20-product-expansion.md` Credit).

### Target / definition
- Definition: presence of a unified per-user data model spanning swap, save, spend, and credit activity.
- Target: unified data model live within 6 months of card launch, feeding personalization (`16-retention.md`) and future underwriting.

## Credit

### What it is
As a moat rather than a product line (see `20-product-expansion.md`): the ability to eventually underwrite credit using proprietary combined trading+spend data, which a competitor without that data cannot easily replicate.

### How it works / benchmarks
- Undercollateralized crypto-native credit has no permissionless precedent (per roadmap); any player who eventually cracks underwriting using on-chain + spend behavior data has a genuine first-mover data advantage, since the underwriting model itself becomes proprietary IP.

### Gekko approach
Do not chase this moat prematurely — it depends entirely on first building the Proprietary Data moat above and the overcollateralized credit product (`20-product-expansion.md`) reaching scale. Flag as the long-horizon payoff of the data-combination strategy, not a near-term differentiator.

### Target / definition
- Definition: not applicable until overcollateralized credit has meaningful volume and data history.
- Target: none set; revisit after 12+ months of credit-product data.

## Switching Costs

### What it is
As covered operationally in `16-retention.md`: because Gekko is largely non-custodial, switching costs must come from earned value (XP tiers, fee discounts, unified multi-product convenience) rather than locked-in funds.

### How it works / benchmarks
- See `16-retention.md` Switching Costs section for the core analysis — repeated here because it's also a competitive moat, not just a retention metric: a competitor can copy features but not a user's accumulated XP tier/history within Gekko.

### Gekko approach
Make the XP/referral system (already live in Suwappu) an explicit, visible switching-cost asset in Gekko's UX — show users what they'd forfeit (fee tier, yield boosts) by leaving, without resorting to custodial lock-in that would undermine the trust-based brand moat above.

### Target / definition
- Definition: % of active users at an XP tier above the base/entry tier.
- Target: 40% of active users above entry XP tier within 12 months.

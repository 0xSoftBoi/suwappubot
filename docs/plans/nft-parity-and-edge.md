# Parity with Spritehood, and the edge they can't copy

Research basis: their deployed ABI pulled from the site bundle (97 functions, 20 events,
53 errors) — not the marketing page. Suwappu inventory: 153,819 lines of Python across
359 files, 70 bot handlers, 133 services, plus webapp / mobile / terminal / showcase /
MCP server / two SDKs.

---

## Part 1 — Parity: what they do that we must match

### Already closed (commit d31979d)

USD-cent pricing via Chainlink with sanity band + bounded fallback, refund on
overpayment, `announceEnd` + `closeMintingForever`, `Ownable2Step`, pause, ERC-2981.

### Still open — the one that actually shows

**`eligibilityOf(address, uint8 assertedGroupMask)` returns 13 values in a single call.**
Their entire mint page — am I eligible, in which groups, what have I claimed, how many
remain, what does it cost, is it open — is *one* RPC round-trip. Ours needs six or seven
separate calls (`remaining`, `phaseConfig`, `mintedInPhase`, `quote`, `phaseIsLive`,
`totalSupply`…). On a cold wallet over a mobile connection that is the difference between
a mint page that feels instant and one that pops in field by field.

`counters()` does the same for supply: `(uint32, uint32, uint16, uint16, uint16)` in one call.

**Action:** add `mintState(address, Phase)` returning one struct — phase config, wallet
usage and remaining, ticker remaining, live wei quote, whether the feed or the fallback is
pricing it, paused/ended/closed flags, and global supply. One call, whole page. This is a
view function: no money-path risk, high perceived-quality return.

**Also worth taking**
- `quote(classId)` returns **two** values (price + something). Per-*class* pricing is the
  analogue of per-*ticker* pricing: scarce tickers (SPCX, cap 23) could cost more than
  NVDA (cap 509). We already model scarcity in caps; pricing it is one line.
- `claimBits(address) -> uint8` — a bitmask of groups already claimed, cheap and readable.
- `burnForRedemption(tokenId, expectedOwner)` — passing the expected owner makes a
  redemption relayer safe against a front-run transfer. Cheap defensive pattern.

---

## Part 2 — The edge: what a standalone collection structurally cannot do

Spritehood is a very well-built **standalone** collection. Its value ends at the art plus
whatever redemption hook it ships. Everything below is available to us *only because the
NFT is attached to a working trading product*, and none of it is copyable by a project
whose product is the NFT.

### 1. Utility that pays for itself, measurably

A Position card takes 40 bps off every swap. For a trader doing $100k/month that is
**$400/month, forever, denominated in a real cost they already pay**. No jpeg can offer
that, because no jpeg sits in the fee path of something the holder already does daily.

This inverts the usual mint pitch. Instead of "buy this and hope it appreciates", it is
"buy this and your existing behaviour costs less". The card's floor is anchored by its
own cash flow, not by sentiment.

### 2. The allowlist is earned by real behaviour, and is un-farmable

Their groups are social. Ours reads XP level, lifetime volume, swap count and referrals
out of `UserPoints` — signals that cost real money to fake because they *are* real
trading. A sybil farm can spin up wallets; it cannot spin up $50k of volume for free.

That also fixes the classic post-mint dump: our allowlist selects for people who use the
product, not people who were early in a Discord.

### 3. The card is alive, because the chain it lives on has real prices

A wisp is fixed at mint. A Position card re-renders against a live Chainlink equity feed —
35 verified feeds on chain 4663, prices moving every few hours. Holders have a reason to
open it tomorrow. That is a retention mechanic a static PFP cannot build without inventing
a game.

### 4. The NFT is the subscription — recurring revenue, not a one-time mint

Spritehood monetises once (mint) plus royalties. `SuwappuMembership` makes the NFT itself
the tier: pay USDG per 30-day period, on the same EIP-3009 rail x402 already settles on.
One mint event versus recurring revenue is not a marketing difference, it is a different
business.

### 5. Distribution we already own

A standalone project must *buy* attention. We have a Telegram bot with an existing user
base, a Mini App, a mobile app, a terminal, a showcase site, an MCP server and two SDKs.
The mint is one `/cards` message away from people who already trade with us — and
`/bindwallet` already links their wallet.

**This is the single biggest asymmetry.** Their hardest problem (getting 10,000 qualified
buyers in front of a mint page) is our cheapest one.

### 6. Machine customers

x402 makes the API agent-payable, and the membership settles by signature with a relayer
paying gas. An agent can hold a membership and pay for its own tier. No collectible
project has machine customers, because there is nothing for a machine to want.

### 7. The closed loop

mint → cheaper swaps → more volume → more XP → better allowlist next season → mint again.
Each turn makes the next cheaper for the user and more valuable for us. A standalone
collection has no loop; it has a launch and then a secondary market.

---

## Part 3 — Sequenced plan

**Now (small, high signal)**
1. `mintState()` single-call view — the mint page quality gap. ~40 lines, view-only.
2. Per-ticker pricing multiplier — scarce tickers priced above common ones.
3. `claimBits`-style claimed bitmask, and `expectedOwner` on any redemption path.

**Next (product, where the edge compounds)**
4. Wire the earned allowlist snapshot to the live DB and publish "you're on the list" in
   `/cards` — conversion, not engineering.
5. Membership x402 waiver in the api-ts middleware (subscription *is* the payment;
   charging per call as well is double-billing).
6. Season leaderboard surfacing card performance — status is the retention hook.

**Deliberately not chasing**
- Their trait depth (8 equipment slots, classes, generated names). That is a character
  system; ours is a financial instrument's portrait. Copying it would make us a worse
  Spritehood instead of the only live-P&L card on a chain with real equities.
- Transfer-validator royalty enforcement — hands a third party veto over transfers of a
  token carrying a fee entitlement.
- ERC721A — real per-card gas lever, but a rewrite of ownership bookkeeping on a contract
  already blocked three times by review.

---

## Honest risk register

- **Three BLOCK verdicts, three rounds of fixes; the EIP-3009 path and the USD-pricing
  path have had no review at all.** Nothing here ships before a clean pass.
- The fee discount is a real revenue cut (40 bps against a 100 bps free tier). It is one
  constant, deliberately material, and it is a pricing decision that is yours.
- No oracle sequencer feed exists for 4663, so the L2 uptime check is implemented but
  inert until Chainlink publishes one.
- Compliance is load-bearing: these cards reference tokenized equities and must never read
  as equity exposure. Performance drives status and XP, never a payout.

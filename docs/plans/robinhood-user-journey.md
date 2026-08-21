# Journey: a Robinhood app user with a Robinhood Chain wallet

Traced against committed code on `claude/robinhood-nft-collection-10k-yq3kcy`, not
against design docs. Every "does not exist" below was checked.

**Verdict: this user cannot complete step one.** The collection is built end to end
for people who are already Suwappu Telegram users. The audience named as the traffic
source has no path in.

---

## The funnel, step by step

### 0. Discovery → **no destination exists**
There is no mint page, route, or component anywhere. Searched `showcase/src`,
`webapp/src`, `terminal/src`, `mobile/`, `api-ts/src/routes`. The only files matching
"PositionCard" are prediction-market UI (`webapp/src/components/prediction/PositionCard.tsx`),
unrelated to the NFT. A campaign pointing at suwappu.bot today lands on a homepage that
never mentions the collection.

### 1. Connect wallet → **Robinhood Chain is not in any wallet config**
- `terminal/src/lib/wagmi.ts:28` — `[mainnet, arbitrum, optimism, polygon, base, avalanche, bsc]`
- `webapp/src/hooks/useWallet.ts:14` — same set plus sepolia

Neither includes **4663**. `webapp/src/lib/chains.ts:112` maps `'4663' → 'robinhood'`,
but that is display metadata only (name, icon, explorer URL) — it is not a wagmi chain
and no connector can switch to it. So the one chain this collection lives on is the one
chain no Suwappu frontend can connect to.

### 2. Mint → **no mint UI, and no proof endpoint**
`nft/position-cards/build_allowlist.py` and `merkle.py` are offline scripts writing
files. Nothing serves a Merkle proof over HTTP, so even a hand-rolled contract call
cannot be completed by a normal user for the gated phases.

### 3. Eligibility → **Public phase only, by construction**
`build_allowlist.py:60-70` classifies from the Suwappu bot database — `xp_level`,
`total_volume_usd`, `total_swaps`, verified `referrals`:

| phase | allocation | cap | price | who |
|---|---|---|---|---|
| Founder | 1,500 | 3 | free | gold/platinum XP, ≥$50k volume, or ≥5 referrals |
| Allowlist | 4,000 | 2 | $20 | ≥5 swaps, ≥$1k volume, or ≥1 referral |
| Public | 4,300 | 5 | $40 | anyone |

A Robinhood user who has never touched Suwappu has no row in that database. They cannot
qualify for anything but Public. **5,500 of 10,000 cards — 55% of supply — are reserved
for an audience that is not the traffic source.**

### 4. See the card → **nothing serves tokenURI**
No metadata endpoint in `api-ts/src/routes` or `api/routes/`. A freshly minted card
renders as an unknown blank NFT in their wallet. The art — the entire reason the thing
is worth minting — is invisible at the exact moment of highest excitement.

### 5. Use the perk → **Telegram only**
`position_cards_service` is consulted by exactly three handlers: `bot/handlers/swap.py`,
`bot/handlers/bulk_swap.py`, `bot/handlers/position_cards.py`. `api-ts` has no fee
resolution at all (no `fee_bps` anywhere in `api-ts/src`). To realise the discount the
Robinhood user must:

1. install Telegram
2. `/start` the bot
3. `/bindwallet`, receive a challenge string
4. sign it with EIP-191 `personal_sign` **from their Robinhood wallet**
5. paste address + signature back into a chat

There is no non-Telegram binding route — nothing in `api/routes` or `api-ts/src/routes`.
Step 4 is the hard stop: an in-app broker wallet signs arbitrary messages through a dapp
connection, and there is no dapp to connect to (see step 1).

---

## The strategic problem, separate from the plumbing

Even with every gap above closed, the offer is **backwards for this audience**.

The card's only utility is *a discount on Suwappu swap fees*. A Robinhood app user does
not swap on Suwappu — that is the whole point of calling them net-new traffic. So the
pitch is "pay $40 for a discount on a product you have never used," and the payback
maths only works for someone already trading: at 40% off FREE's 100bps, a $40 mint pays
back over **$10,000 of swap volume**.

For an existing Telegram power user that is a good deal. For cold Robinhood traffic it
is an unpriced call option on becoming a Suwappu user. The art and the on-chain entry
price have to carry the entire purchase decision, because the utility cannot.

Worth deciding explicitly: is this collection a **retention/reward** instrument for
existing users (which is what the code currently implements — 55% of supply gated on
Suwappu history), or an **acquisition** instrument for Robinhood traffic? It is
currently built as the first and being discussed as the second.

---

## Minimum to make the stated journey possible

Ordered by what unblocks the most, not by effort.

1. **Register chain 4663 as a real wagmi chain** in `terminal/src/lib/wagmi.ts` and
   `webapp/src/hooks/useWallet.ts`. Nothing else on this list works until a wallet can
   reach the chain.
2. **A mint page** that connects a wallet, reads the live phase, fetches a proof, and
   calls `mint`. This is the missing destination for every campaign.
3. **A proof endpoint** serving the Merkle proof per address, from the artifact
   `build_allowlist.py` already produces.
4. **A `tokenURI` service** so the card is visible in-wallet the moment it is minted.
5. **Web wallet binding** — the same EIP-191 challenge, signed in the browser via the
   connected wallet, so Telegram is a destination rather than a prerequisite. This is
   the step that converts a minter into a Suwappu user, and it is the one with real
   revenue attached.
6. **Decide the acquisition-vs-retention question above** before the phase allocations
   are locked on-chain.

Items 1-5 are conventional NFT-drop infrastructure and none of it exists yet. Item 6
is the one that should be answered first, because it determines whether the 5,500
gated cards are correctly allocated.

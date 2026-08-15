# Wallet connection for Robinhood Wallet users

Grounded in Robinhood's own docs and what is already wired in this repo.

## What the wallet actually is (read from Robinhood's own docs)

- **Robinhood Wallet is a separate self-custody app**, not the main brokerage app.
  It holds the user's own keys.
- It **supports Robinhood Chain**, alongside Ethereum, Bitcoin, Solana, Dogecoin,
  Arbitrum, Polygon, Optimism and Base.
- It **connects to dapps via WalletConnect, by scanning a QR code**.
- **Robinhood Chain is built in.** The add-network page names Robinhood Wallet
  and says only "download it, create a wallet" — the manual RPC/chain-ID dance is
  documented for MetaMask, not for their own wallet. One less step than assumed.
- Chain 4663, **native gas token is ETH**, public RPC
  `https://rpc.mainnet.chain.robinhood.com`, Alchemy for production
  (`https://robinhood-mainnet.g.alchemy.com/v2/{KEY}` — and we already hold an
  `ALCHEMY_API_KEY`).
- **ERC-4337 is deployed in three versions** — EntryPoint v0.6
  `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`, v0.7
  `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, v0.8
  `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`. The bundler is Alchemy, at the
  same URL our existing `ALCHEMY_API_KEY` already addresses. Sponsorship is an
  Alchemy Gas Manager policy ID; ZeroDev is the documented alternative.
- **EIP-7702 is supported**: "existing externally-owned accounts [can] delegate
  to smart contract code", giving "batching, sponsorship, session keys without
  migrating to a new address."
- **Gas is ETH and only ETH.** The gas-and-fees page documents no protocol-level
  fee abstraction and no way to pay gas in another token.

So the connection is a solved problem in principle. The friction is in three
specific places, and two of them will silently kill the flow.

## The best path is one I initially missed: the wallet's own browser

Robinhood Wallet's WalletConnect registry record
(`8837dd9413b1d9b585ee937d27a816590248386d9dbf59f5cd3422dbbb65683e`) carries:

```
injected  [{"namespace": "eip155", "injected_id": "isRobinhoodMobileWallet"}]
rdns      "com.robinhood.wallet"
mobile    {"native": "robinhood-wallet://", "universal": null}
sdks      ["sign_v1", "sign_v2"]
chains    ["eip155:1","eip155:10","eip155:137","eip155:42161","eip155:80084","eip155:80085"]
updatedAt "2022-12-19"
```

**The wallet has an in-app browser with an injected EIP-1193 provider**, flagged
`window.ethereum.isRobinhoodMobileWallet`. If the mint page is opened *inside*
that browser there is no WalletConnect at all — no QR, no deep link, no session
negotiation, no namespace rejection. It is strictly the smoothest path and it
dissolves the two traps below rather than working around them.

`nft/position-cards/probe/wallet-probe.html` tests exactly this: open it in the
wallet's browser, tap once, and it reports whether `eth_signTypedData_v4` is
honoured for a real EIP-3009 payload. Self-contained, no build, no CDN.

**Read the registry carefully, though.** `updatedAt` is **2022-12-19** — nearly
four years stale, predating Robinhood Chain entirely. So the absent `eip155:4663`
is evidence of a stale record, NOT evidence the wallet lacks the chain; Robinhood's
own docs say the chain is built in. Do not conclude from this that 4663 is
unsupported.

But it does imply a concrete failure mode: **WalletConnect session proposals that
put `eip155:4663` in REQUIRED namespaces can be rejected outright** by a wallet
whose declared chain set is stale, and that failure looks like "the wallet is
broken" rather than like a negotiation problem. Request 4663 as an **optional**
namespace.

## Trap 1 — the QR code is useless to this user

They are **on their phone**, arriving from a mobile app. A QR code on a mobile
web page cannot be scanned by the same phone. This is the single most common way
a mobile WalletConnect flow fails, and it is exactly our audience.

The mobile path must be a **WalletConnect deep link** that opens Robinhood Wallet
directly, with QR reserved for desktop. The scheme is **`robinhood-wallet://`**.

Two things checked rather than assumed:

- **RainbowKit 2.2.11, which we already ship, has no Robinhood Wallet entry** —
  grepped `terminal/node_modules`. So it cannot be offered as a named wallet
  today; it needs registering as a custom connector.
- **There is no universal link** — the registry has `universal: null`. That
  matters: custom schemes are the fragile kind. iOS Safari can block or warn on
  them, and when the app is not installed the user gets a dead link instead of a
  store redirect. Ship a store fallback (`com.robinhood.gateway` on Android)
  rather than assuming the tap lands.

Both of these disappear entirely on the in-app-browser path above, which is the
argument for making that path primary.

## Trap 2 — they have tokenized stocks and no ETH

Gas on Robinhood Chain is **ETH**. A Robinhood Wallet user who came for tokenized
equities plausibly holds AAPL/NVDA tokens and USDG and **zero ETH on 4663**.

`SuwappuPositions.mint()` is `payable` and takes `msg.value`, so today they need
ETH twice over — for gas *and* for the mint price. Both fail for the same user.

**We already solved this in the contract next door.** `SuwappuMembership`
`subscribe()` takes **USDG via EIP-3009 `receiveWithAuthorization`** — the user
signs an authorization, a relayer submits it, and the user needs no gas at all.
Positions took the opposite decision and nobody reconciled them.

Two fixes, best first:

1. **Price the mint in USDG via EIP-3009**, mirroring `SuwappuMembership`. Same
   pattern, same relayer, already written and reviewed once. The user signs one
   authorization and needs zero ETH. This also removes the whole
   `quote`/refund/ETH-price-drift surface — `_weiForCents`, the ETH/USD feed read
   (28k gas, 12.8% of the mint), and the refund branch all disappear, which is
   incidentally the largest gas saving available anywhere in this contract.
2. **Sponsor gas via ERC-4337**, which the chain supports first-class. Note this
   needs a smart account — a plain EOA connected over WalletConnect cannot send a
   sponsored UserOp. So it applies to the embedded-wallet path (below), not to the
   Robinhood Wallet EOA. Fix 1 is what serves the Robinhood Wallet user.

## Trap 3 — the binding chasm, which is where the value is

Minting is not the point. Getting Suwappu value is. Today that means: leave the
browser, install Telegram, `/start`, `/bindwallet`, copy a challenge, sign it,
paste an address and a signature back into a chat. Nobody finishes that.

**Do not ask for a second signature. Bind by transaction.**

The mint transaction is itself proof of control of the address — it was signed by
that key. So:

1. User arrives at the mint page from `t.me/suwappubot?start=mint_<nonce>`, or
   picks up a nonce on arrival. We hold `(nonce -> telegram_id)` server-side.
2. They connect (deep link) and mint. We record `(nonce -> connected address)`.
3. We watch for the mint from that address and bind on the **transaction**, not
   on a challenge signature. Connecting alone proves nothing; *minting* proves
   control.
4. Return deep link `t.me/suwappubot?start=claim_<nonce>` — one tap, bot opens
   already bound, and the first message is the card and the new fee tier.

Zero extra signatures, zero copy-paste, and the one signature they do make is the
one they wanted to make anyway.

## Trap 3b — for users with no Telegram at all

Everything above still routes through Telegram. It should not have to. The
credential surface from `nft-utility-research.md` — the card, its on-chain entry,
its verified return — is a **web page**, and it is value delivered in the browser
seconds after mint with no second app. Telegram becomes an upsell ("claim your
fee tier"), not a prerequisite.

For users who want a wallet at all, we already ship **Turnkey passkey wallets** in
webapp and terminal: one tap, no seed phrase, and — being smart accounts — they
are the path that *can* take sponsored gas.

## The flow, end to end

```
Robinhood Wallet (mobile)
  -> tap mint link
  -> WalletConnect DEEP LINK opens Robinhood Wallet    (not a QR)
  -> approve connection
  -> sign ONE EIP-3009 USDG authorization              (no ETH needed)
  -> relayer submits; card is minted
  -> card renders in the browser immediately           (value, no second app)
  -> optional: one tap into Telegram, already bound    (fee tier live)
```

Signatures: one. Apps installed: zero. ETH required: none.

## Build order

1. **Register chain 4663** in `terminal/src/lib/wagmi.ts` and
   `webapp/src/hooks/useWallet.ts`. Nothing works before this and it is an
   afternoon.
2. **Robinhood Wallet as a named connector with its mobile deep link**, so the
   phone case is the default rather than the broken case.
3. **USDG/EIP-3009 payment in `SuwappuPositions`**, ported from
   `SuwappuMembership`. Biggest single UX win, and it shrinks the contract's
   gas and its bytecode at the same time — relevant at 85.6% of the EIP-170 limit.
4. **Mint page + proof endpoint.**
5. **Bind-by-transaction** and the two Telegram deep links.
6. **Card page** so value lands in the browser without Telegram.

## The open question, now answered — and it hardens the recommendation

I flagged that the docs did not say whether Robinhood Wallet exposes arbitrary
`personal_sign`/EIP-712 to dapps. Having read the wallet and chain docs properly,
they still do not — but three other things they *do* say make that question
almost irrelevant, and turn the USDG recommendation from a preference into the
only path that works.

**1. Gas is ETH-only with no fee abstraction at the protocol level.** So an
address with zero ETH cannot send *any* transaction on chain 4663. Not a mint,
not an approval, nothing.

**2. Sponsorship requires a smart account — or a 7702-delegated EOA.** A plain
EOA connected over WalletConnect cannot send a sponsored UserOp; the samples are
`createSmartWalletClient` / `createKernelAccount`. EIP-7702 closes that gap, but
only if **Robinhood Wallet will sign a 7702 authorization**, which is undocumented
and is now the single highest-value thing to test on testnet 46630.

**3. Robinhood's docs never explain how an empty address gets its first ETH.**
The bridging page moves assets *from* Ethereum — which presupposes ETH on
mainnet and an L1 gas payment. There is no documented bootstrap from zero.

Put together: **for a Robinhood Wallet user holding stock tokens and no ETH, the
only way they can participate at all is if somebody else submits the
transaction.** That is precisely EIP-3009 `receiveWithAuthorization` — the user
signs an authorization, our relayer pays the gas — and it is already written,
reviewed and shipped in `SuwappuMembership`.

So porting USDG payment into `SuwappuPositions` is not the nicer option. It is
the only one that does not depend on an undocumented wallet capability or on the
user having solved a bootstrapping problem Robinhood does not document.

## Funding the first mile — we already own a route

The bridging page names **LiFi and 0x aggregators** among the supported routes
into Robinhood Chain, and `nft/position-cards/config.json` already carries
`lifi_diamond: 0xB477751B76CF82d00a686A1232f5fCD772414Af3`. LiFi is already our
aggregator across seven chains. So "fund your Robinhood Chain wallet" is not a
new integration — it is the one we ship.

Worth confirming LiFi actually routes *to* 4663 in their live token/chain list
before promising it, since our own config has been ahead of reality before.

## Two paths, and which user gets which

| user | connection | pays with | gas |
|---|---|---|---|
| has Robinhood Wallet | WalletConnect deep link | USDG, EIP-3009 signature | our relayer |
| no wallet at all | Turnkey passkey, one tap | USDG or sponsored | Alchemy Gas Manager, EntryPoint v0.8 |

The second row is fully within reach today: we already ship Turnkey passkey
wallets in webapp and terminal, those are smart accounts, and the bundler is the
Alchemy endpoint we already hold a key for.

## Test on testnet before committing the build order

Chain 46630, RPC `https://rpc.testnet.chain.robinhood.com`, explorer
`explorer.testnet.chain.robinhood.com`. Three things to establish with a real
Robinhood Wallet, in priority order:

1. Does it sign an **EIP-3009 authorization** (EIP-712 typed data)? If yes, the
   whole flow works today with no wallet-specific dependency.
2. Does it sign an **EIP-7702 authorization**? If yes, sponsored gas for the
   Robinhood Wallet EOA too, and the relayer becomes optional.
3. Does the **WalletConnect deep link** open it cleanly from mobile Safari and
   Chrome, and does it return to the page after signing?

Question 1 is the one the build depends on. Questions 2 and 3 make it better.

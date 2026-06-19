# HyperLiquid on Suwappu

Suwappu brings the full HyperLiquid ecosystem into Telegram — perpetuals,
spot, staking, vaults, TWAP orders, and one-click cross-chain funding — without
ever leaving the chat or pasting an address.

Everything below reuses a single HyperLiquid account. Set it up once with
**/perps → Setup**; every other command (`/fund`, `/stake`, `/vault`, `/spot`,
`/twap`, `/hlmove`) then works against that same account.

## Command reference

| Command | What it does |
|---|---|
| `/hl` | HyperLiquid Hub — one screen summarising your perps, spot, staking, and vault balances with quick links. |
| `/perps` | Perpetuals trading — pick a market, go long/short with leverage, set take-profit/stop-loss, monitor live P&L, close in one tap. |
| `/fund` | One-click cross-chain deposit into your HyperCore account. |
| `/twap` | Time-weighted average price orders — split a position evenly over N minutes. |
| `/stake` | HYPE staking dashboard with a ranked validator picker (auto-compounding). |
| `/unstake` | Undelegate HYPE; shows pending withdrawals. |
| `/stakemove` | Move HYPE between your spot balance and your staking balance. |
| `/vault` | HyperLiquid Vault UI (HLP + user vaults) — deposit/withdraw with live APR/TVL/PnL. |
| `/spot` | Spot trading on HyperCore. |
| `/hlmove` | Instantly move USDC between your spot and perp wallets. |

## Perpetuals — `/perps`

Trade perpetual futures with up to **20x** leverage.

1. Run `/perps` and tap **Setup** the first time to connect your HyperLiquid
   account.
2. Pick a market (BTC, ETH, SOL, and the rest of HyperLiquid's listings).
3. Choose **Long** or **Short**.
4. Pick leverage — 1x, 2x, 3x, 5x, 10x, 15x, or 20x.
5. Enter your USD margin. The bot shows your resulting position size and an
   estimated liquidation price, then you confirm.
6. Add a **take-profit** and/or **stop-loss** price to any open position.
7. Watch live P&L and **close** the position in one tap.

A small HyperLiquid **builder-code fee** is attached to orders (approved once,
automatically). If the approval can't be set, orders still go out — just
without the builder fee.

> **Risk note:** Leveraged perps can be liquidated. At higher leverage a small
> adverse price move wipes out your margin. Start small, use stop-losses, and
> never trade more than you can afford to lose.

## Funding your account — `/fund`

`/fund` tops up your HyperCore account from almost any chain. Funds arrive on
your **spot** balance; a **Move to Perp** shortcut moves them over so you can
trade perps.

There are two deposit paths:

### USDC (any chain) — via Across / CCTP

USDC is bridged from **Arbitrum, Base, Optimism, Polygon, or Ethereum** and
credited as USDC spot. Pick a chain, pick an amount, review the quote (bridge
fee + ETA), and confirm — the deposit is signed with your custodial EVM wallet.
If native CCTP is enabled, you'll also see a **USDC via CCTP** option that
bridges native USDC and completes the credit through Suwappu's relayer.

### Native BTC / ETH / SOL — via HyperUnit

For native assets, the bot generates a **HyperUnit** deposit address. You send
BTC, ETH, or SOL to it and it credits your HyperCore spot balance, typically in
about a minute. HyperUnit is a **2-of-3 MPC bridge**.

> **Region gating (native deposits only):** HyperUnit geo-blocks certain
> regions (the US and other restricted regions). When your stored region is in
> the restricted set — or unknown — the native BTC/ETH/SOL buttons are hidden,
> and the bot tells you to use **Deposit USDC** instead. This restriction is a
> HyperUnit constraint and applies **only** to the native path. The USDC
> (Across/CCTP) path remains available to everyone.

After a USDC deposit lands, tap **Move to Perp wallet** to start trading. You
can also do this any time with `/hlmove <amount> perp`.

## How deposits work (USDC vs native)

| Path | Bridge | Assets | Lands as | Typical time |
|---|---|---|---|---|
| USDC (any chain) | Across (Swap API) | USDC | USDC spot | seconds, per quote |
| USDC (native) | CCTP + Suwappu relayer | native USDC | USDC spot | ~1–2 min |
| Native | HyperUnit (2-of-3 MPC) | BTC / ETH / SOL | spot credit | ~1 min |

Region gating applies **only** to the HyperUnit native path.

## TWAP orders — `/twap`

A TWAP (time-weighted average price) order splits a position evenly over a
window of minutes, with randomization, to reduce market impact.

```
/twap BTC long 0.05 30
```

That buys 0.05 BTC of long exposure spread over 30 minutes. TWAPs are
persisted and monitored — run `/twap` any time for a live progress dashboard
(fill %, size filled, ETA) with a one-tap **Cancel**, and you're notified when
one completes.

## Staking — `/stake` and `/unstake`

`/stake` opens your HYPE staking dashboard: amounts delegated, your staking
balance, pending withdrawals, your current delegations, and a list of the
**top validators ranked by APR** (APR and commission shown on each button).

- Tap a validator, then reply with the amount of HYPE to delegate. If your
  staking balance is short, it's topped up from spot automatically.
- Rewards **auto-compound**.
- Power users can skip the menu: `/stake 10 1` delegates 10 HYPE to validator
  #1 (or pass a full `0x` validator address).

`/unstake <amount> <# or 0xaddress>` undelegates. Undelegated HYPE unlocks to
your staking balance after roughly a one-day lockup, visible as a pending
withdrawal. `/stakemove <amount> <in|out>` shifts HYPE between spot and your
staking balance.

## Vaults — `/vault`

`/vault` is the HyperLiquid Vault dashboard, covering **HLP** (the
Hyperliquidity Provider vault) and user vaults. It shows live **APR, TVL**, and
your equity/PnL.

- Tap **Deposit HLP** or **Withdraw HLP**, then enter a USD amount.
- Or use args: `/vault deposit 100` (optionally with a vault `0x` address).
- Deposits earn yield from HLP market-making and fees, subject to a one-day
  lockup before withdrawal.

## Spot trading & moving funds — `/spot`, `/hlmove`

`/spot` shows your HyperCore spot balances and trades them with marketable IOC
orders:

```
/spot buy HYPE 25     # buy $25 of HYPE
/spot sell HYPE 0.5   # sell 0.5 HYPE
```

`/hlmove <amount> <perp|spot>` instantly moves USDC between your spot and perp
wallets — `perp` to fund perps trading, `spot` to pull margin back out:

```
/hlmove 100 perp
```

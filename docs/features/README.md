# Suwappu features

Suwappu is a cross-chain DEX bot you drive entirely from Telegram — swap,
trade perps, stake, snipe launches, copy traders, and more, without leaving the
chat. This directory holds user-facing how-to guides for the bigger feature
areas. Each guide explains the commands, the happy path, and the real
constraints.

## Guides

| Guide | What's inside |
|---|---|
| [HyperLiquid](./hyperliquid.md) | Perps, spot, staking, vaults, TWAP, and one-click cross-chain funding (`/hl`, `/perps`, `/fund`, `/stake`, `/vault`, `/spot`, `/twap`, `/hlmove`). |
| [Tempo](./tempo.md) | Gasless (fee-payer) swaps for new users, and Machine Payments Protocol micropayments (`/mpp`). |

## Everything Suwappu does

A quick map of the major shipped feature areas:

- **Cross-chain swaps** — swap across 40+ chains with best-price routing
  aggregated across LiFi, CoW Protocol, OKX, 1inch, KyberSwap, and Jupiter.
- **Perpetuals** — leveraged perps on HyperLiquid (see the
  [HyperLiquid guide](./hyperliquid.md)).
- **Gasless onboarding** — sponsored first swaps on Tempo (see the
  [Tempo guide](./tempo.md)).
- **Copy trading** — follow and mirror other traders (`/traders`, `/following`).
- **Sniping** — snipe new token launches (`/snipe`).
- **DCA** — dollar-cost-average into a token on a schedule (`/dca`).
- **Limit orders** — set buy/sell orders at a target price (`/o`).
- **Prediction markets** — trade event outcomes (`/predict`).
- **Lending & savings** — earn yield and borrow against collateral
  (`/save`, `/borrow`); each command also shows your current positions.
- **BTC bridging** — bridge Bitcoin in and out (`/btc`).
- **SUWP token** — the Suwappu token (`/token`).

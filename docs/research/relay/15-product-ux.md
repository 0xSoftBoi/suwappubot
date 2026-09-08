# Relay product and UX (end-user app, widget, support), 2026-09-08

Sources: docs.relay.link (primary), support.relay.link (primary), third-party reviews. relay.link itself is bot-walled, so exact UI copy that is not quoted by a source is marked UNVERIFIED.

## The bridge flow, as described by users and by Relay
- "pick your token, pick your chain, see the fee and ETA, and hit one button" (cryptorabbithole.substack.com, "Marketing Review 101: Relay Protocol"). One screen, one click.
- plisio.net: "Open the Relay app and connect your wallet. Pick the source chain and the token you are sending, then the destination chain and what you want to receive. Relay returns a quote: the amount out, the fee, and the estimated time. If it looks right, you confirm in your wallet and sign once." Single signature, no destination-side claim.
- Multi-VM by design: the widget's `supportedWalletVMs` prop and `multiWalletSupportEnabled` / `linkedWallets` options; Solana is "first-class": "route any supported asset from any supported EVM or non-EVM chain into a Solana wallet in a single signed transaction." UNVERIFIED whether the web app links EVM + Solana + BTC wallets simultaneously in one session (the SDK supports it).
- Transaction page (support.relay.link/en/articles/9260724): search by wallet, ENS or tx hash; status banner is one of **Success / Processing / Failure**; detail shows a **Deposit side** (amount, currency, chain, sender, hash, time) and a **Fill side** (received amount, chain, recipient, hash, time), "While a transfer is still processing, the Fill side stays empty until the funds are delivered", then a **Fee Breakdown**. Every transfer gets a permanent link: "The link stays valid, so you can come back to it at any time."
- UNVERIFIED: literal "You receive" label, confirm-button copy, price-impact warning threshold.

## Fees as the user sees them (docs.relay.link/how-it-works/fees and /references/api/api_core_concepts/fees)
| Component | Value |
|---|---|
| Execution cost | "$0.02 flat fee — always included" + destination gas (always) + origin gas (gasless only) |
| Platform fee by type | Token bridge and same-chain wrap/unwrap **0.00%**; Stablecoin swap **0.01%**; Major swap **0.06%**; Minor swap **0.15%** |
| Swap cost | DEX fees, slippage/impact, "solver rebalancing cost" |
| HyperLiquid | "$1 activation fee for new deposits" |
| App fee | integrator-set bps, collected in stablecoins |
| Gas top-up | `topupGas: true` adds destination native gas "so recipients have gas to interact with their received tokens immediately" (EVM destinations only, not the chain's own native token) |
| Minimums / maximums | not documented anywhere reachable; de facto floor is "if the refund amount is not enough to cover the cost of gas … no refund will be sent" |

These match our measurements: 1 bp on stable-to-stable, ~$0.02 floor on small tickets, 0.10–0.15% on cross-VM.

## Integrator revenue share (docs, not user-facing)
Requires an API key, KYB, and **$10M+ trailing-30-day volume**. Tiers: $10M–$100M/month → 0–34% share by transaction type; $100M–$1B/month → 0–67%. Below $10M/month an integrator only earns its own app fee. For us the app fee is the only lever until we clear $10M/month through Relay.

## RelayKit widget (docs.relay.link/references/relay-kit/ui/*)
- Documented widget: **SwapWidget**. The docs no longer have an OnrampWidget page (404), but the npm package `@relayprotocol/relay-kit-ui@11.0.6` still exports `./OnrampWidget` and declares a peer dependency on `@moonpay/moonpay-react`, so **fiat onramp exists and the partner is MoonPay**. It is shipped, just not documented, which usually means low usage or a pending removal.
- Props: `supportedWalletVMs` (required), `fromToken`/`toToken` and setters, `lockFromToken`/`lockToToken`, `lockChainId`, `wallet`, `multiWalletSupportEnabled`, `linkedWallets`, `onSetPrimaryWallet`, `onLinkNewWallet`, `defaultToAddress`, `defaultAmount`, `defaultTradeType`, `slippageTolerance` (bps), `popularChainIds`, `singleChainMode`, `disablePasteWalletAddressOption`, `onConnectWallet` (required), `onAnalyticEvent`, `onSwapValidating`, `onSwapSuccess`, `onSwapError`.
- Provider options: `appName`, `appFees[{recipient, fee}]`, `codexConfig.apiKey`, `chains`, `baseApiUrl` (must point at your own proxy that injects `x-api-key`).
- Theming: `font`, `primaryColor`, `focusColor`, `text.default/subtle`, `buttons.primary.{color,background,hover}`; light/dark via container class.
- Confirmed embedder: fomo ("relies on Relay's bridging infrastructure… the integration with Relay's widget technology enables the seamless cross-chain experience", datawallet.com). Phantom/MetaMask/OpenSea use the API, not necessarily the widget.

## Surfaces
Web app and embedded widget only. No native mobile app, no PWA claim, no Telegram bot, no Farcaster frame, no WhatsApp. This is the whole opening for a chat-native product.

## Support
- support.relay.link help center with categories Getting Started (8), Problems with my Transaction (6), Adding a New Chain to My Wallet (5), Safety/Security/Loss Prevention (6), FAQ (10); live chat; support@relay.link. No response-time SLA published.
- Refunds are automatic, "almost instantly", in the original currency, minus gas; `MANUAL_REFUND_REQUIRED` exists in the API enum, so a human queue exists behind the automatic path.

## Sentiment
- Praise: "literally forgot it was a bridge"; "99.9% uptime… clear fees, visible completion times"; praised crisis comms during a security incident ("revoke instructions and guidance"). Source is a promotional review with no criticism.
- Complaints: no attributable Reddit/X threads surfaced through web search (results polluted by Relay Financial and Relay Payments). Not evidence of absence; the status page shows 25 incidents in 20 days.

## Design language
UNVERIFIED beyond the docs site (dark, Mintlify) and the theming API. Copy tone: payments vocabulary, never "bridge": "Make transacting across chains as fast, cheap, and simple as online payments."

## What to copy, what to beat
1. Copy: the three-number quote (amount out, fee, ETA), the Deposit/Fill two-sided receipt with a permanent link, the Success/Processing/Failure banner. Our `/s` confirmation and the webapp history page should adopt the same structure.
2. Copy: gas top-up as a checkbox on cross-chain swaps into a new chain.
3. Beat: they have no chat surface, no order types, no token safety, no points. Every one of those is a screen we already have.
4. Beat: publish minimums and maximums. They do not.

# Decentralized Neobank Roadmap (Research Synthesis — June 2026)

Synthesis of four competitive research sweeps: Telegram trading bots, WhatsApp/chat
finance, web trading terminals, and DeFi neobanks. Goal: which neobank features
Suwappu can add **permissionlessly and non-custodially**, and where a regulated
partner is unavoidable.

## The headline finding

Across all four categories, **no incumbent combines trading with bank-like
primitives**. The top Telegram bots ($65B+ lifetime volume), the top terminals
(Axiom, GMGN, BullX, Photon), and every WhatsApp finance product all leave the
same things on the table:

1. **Idle balances earn 0%.** Hundreds of millions of user USDC sits in bot/terminal
   wallets between trades while Aave/Morpho/Sky pay 4–6% APY. Nobody in the trading
   category captures this.
2. **No path from gains to spending.** Realize → withdraw → CEX KYC → bank → days.
   Non-custodial cards (Gnosis Pay, Ether.fi Cash, Zeal) prove the architecture works.
3. **No bank-statement view.** No unified cross-chain net worth, yield income, or
   "you earned $47 this week" nudges.
4. **WhatsApp DeFi is uncontested.** Telegram bots have zero WhatsApp equivalent;
   Félix proved WhatsApp financial UX at scale ($3B volume, 300K users) but is
   custodial fiat-only.

## The permissionless line (what we can build vs. must integrate)

**Fully permissionless — build:**
- Stablecoin yield: Aave V3, Morpho vaults (>$10B TVL, Coinbase uses it), Sky sUSDS. No KYC.
- ENS/name-based payments (`user.suwappu.eth` subnames, CCIP-Read on L2).
- Recurring transfers / true time-based DCA (Superfluid/Sablier or our own scheduler + session keys).
- Savings goals (vault wrappers with locks).
- Overcollateralized credit (Aave GHO / Morpho borrow) — the only permissionless "credit card" analog.
- Cross-chain portfolio / bank-statement view (we already have multicall3 balances).

**Requires a regulated partner — integrate, never build:**
- Visa/Mastercard debit card (Visa = 97% of crypto-card volume; issuance is never permissionless). Candidates: **Gnosis Pay B2B** (non-custodial Safe architecture, EEA/UK), **Immersve** (Mastercard, smart-contract pre-auth, most aligned philosophically), Rain (global scale, custodial).
- Fiat on/off-ramp: MoonPay/Transak widget (days of work), Monerium for SEPA/IBAN, Stripe/Bridge for US.
- Treasury-backed yield (Ondo USDY ~4.65%): KYC at issuance — optional dual-track for KYC-willing users.
- Undercollateralized credit: no permissionless version exists. Skip.

**Avoid:** Mountain USDM (wound down Aug 2025). Do not integrate.

## Prioritized roadmap

| # | Feature | Surface | Path | Effort | Why now |
|---|---------|---------|------|--------|---------|
| 1 | **Yield on idle balances** ("Savings" — auto-deposit idle USDC into Morpho/Aave on Base/Arbitrum, withdraw-on-trade) | All: bot `/save`, WhatsApp "earn", terminal Earn tab | Build | 1–2 wks | Biggest white space in every category; zero incumbents; revenue via Morpho curator/referral fee |
| 2 | **True scheduled DCA** ("buy $50 SOL every Monday") | Bot + terminal (DCA form exists) | Build | 1 wk | No top bot does time-based DCA; retention feature |
| 3 | **Bank-statement portfolio + weekly summary** ("You earned $12 yield, portfolio +8%") | Bot digest msg, terminal dashboard | Build | 1 wk | Reframes product as finance layer; pure UX |
| 4 | **Fee transparency pre-trade** (all-in cost: platform+protocol+priority+slippage) | Bot quote card, terminal | Build | days | #1 user complaint across all bots; no technical barrier |
| 5 | **name-based payments** (`@handle` / `user.suwappu.eth` send) | Bot, WhatsApp, terminal | Build | 3–5 days | Venmo-style UX; Daimo proved it; fully permissionless |
| 6 | **WhatsApp swap + earn go-live** | WhatsApp | Build (we're code-complete on swap) | wired to #1 | Uncontested: zero non-custodial DeFi on WhatsApp's 2B users; Félix left yield/savings on the table |
| 7 | **Fiat off-ramp widget** (MoonPay/Transak) | Terminal first | Integrate | 1–3 days | Completes "gains → cash" without CEX |
| 8 | **Savings goals** ("save 20% of every profit toward goal") | Bot + webapp | Build | 1–2 wks | Acorns-for-crypto; no incumbent |
| 9 | **Overcollateralized borrow** (GHO/Morpho: spend without selling) | Bot + terminal | Build | 2–3 wks | Ether.fi Borrow Mode analog, permissionless version |
| 10 | **Debit card** (Gnosis Pay B2B or Immersve) | Standalone | Integrate | 4–8 wks partnership | Table-stakes long-term; partner owns the regulated layer |

## Architecture notes

- The proven "DeFi neobank" stack is: **permissionless wallet + yield protocols +
  regulated card/ramp partners at the edges** (Gnosis Pay, Zeal, Ether.fi all do this).
  Suwappu never needs to hold a license for items 1–6, 8–9.
- Session keys (ERC-7715) / smart accounts enable "deposit idle funds automatically"
  without per-action signatures — same primitive powers DCA and copy trading.
- WhatsApp policy: Meta's Jan 2026 ban targets general-purpose AI chatbots; structured
  financial command bots (like Félix) remain allowed. Keep flows command-structured.
- Differentiation vs. fee race: the 1% fee floor is structural across all bots;
  the durable moats are **trust (non-custodial) and financial primitives beyond trading**.

## Competitive snapshots (details in research transcripts)

- **Telegram bots:** Trojan $25B vol (Solana, BOLT engine), Banana Gun $16B (5-chain
  unified session, 40% fee share to holders), Maestro 14 chains, BonkBot $14B,
  GMGN (smart-money analytics, 2.1/5 Trustpilot), BullX ($2.29B fees, zero shared).
  Gaps: yield, scheduled DCA, fee transparency, non-custodial keys, tax reporting.
- **Terminals:** Axiom (fastest to $200M revenue ever on Solana), Hyperliquid ($285B/30d
  perps), Jupiter (superapp), Banana Pro (Privy OAuth login → 1.3M users). None offer
  yield/off-ramp/payments.
- **WhatsApp:** Félix $3B custodial remittance; Meta native stablecoins H2 2026
  (a rail to build on, not a competitor — they won't do non-custodial/DEX/yield).
- **Neobanks:** Gnosis Pay (purest non-custodial card), Ether.fi Cash (borrow-mode
  credit), Zeal (non-custodial Revolut: Monavate card + Sky/Aave yield), Daimo
  (P2P payments), Rain ($1.95B valuation card infra).

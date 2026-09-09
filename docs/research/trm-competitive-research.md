# TRM Labs — competitive research and how Suwappu competes

**Date:** 2026-09-09 · **Status:** Research (point-in-time evidence, not a statement of current product behaviour)
**Trigger:** TRM's 2026-09-09 "disruption layer / operating system for crimefighters" post and $2B Series C expansion.
**Method:** three read-only agent sweeps — repo inventory of Suwappu's existing risk/compliance assets, a TRM Labs deep-dive, and a prevention-layer landscape scan. Every non-obvious external claim carries a URL. Items marked **UNVERIFIED** could not be confirmed against a primary source.

---

## 0. TL;DR

- **Do not compete with TRM head-on.** TRM sells post-hoc *investigation* to governments and banks (600+ customers, ~$95M single ICE contract, enterprise-only pricing). That is a different buyer, a different sales motion, and a decade of attribution data we do not have.
- **TRM's own framing is our opening.** Their post says the "prevention layer is essential, but never enough" and that "criminals will break through." They are building the layer *after* the breach. Suwappu sits at the exact point they concede they don't own: the moment a human or an AI agent is about to sign a transaction.
- **Our wedge is "prevention at the execution layer, sold self-serve, for bots and agents."** TRM has no self-serve product for wallet screening, no product instrumenting Telegram trading bots, and no product screening AI-agent transactions. We already have the choke point (`SwapEngine.execute_swap`), a compliance gate, token screening, launch detection, and an agent-trust table. Most of it is off by default or record-only.
- **Three concrete plays**, in order of leverage: (1) turn on and finish the gate we have and productise it as a screened-execution guarantee; (2) expose it as a paid, self-serve **Agent Transaction Screening API** (x402-metered) for other bots, wallets and agent frameworks; (3) feed confirmed drainer/rug/scam hits *upstream* to TRM's Chainabuse and Beacon Network as a partner, not a competitor, and use that as distribution.

---

## 1. What TRM Labs is (September 2026)

### 1.1 Company, money, scale

| Fact | Value | Source |
|---|---|---|
| Latest round | Series C **expansion** at **$2B** valuation, 2026-09-09, led by Blockchain Capital, existing investors only, amount undisclosed ("modest" per CEO) | [TRM blog](https://www.trmlabs.com/resources/blog/trm-labs-announces-series-c-expansion-at-usd-2-billion-valuation-to-continue-building-crimefighting-ai), [Fortune](https://fortune.com/2026/09/09/trmlabs-valuation/) |
| Prior round | $70M Series C at $1B, Feb 2026 | [BankInfoSecurity](https://www.bankinfosecurity.com/trm-labs-raises-70m-series-c-for-ai-crime-fighting-push-a-30681) |
| Revenue | ARR "quadrupled in three years"; targeting ~$100M ARR "in the coming years" (so below $100M today) | [Fortune](https://fortune.com/2026/09/09/trmlabs-valuation/) |
| Customers | 600+ government agencies and institutions, 75 countries | TRM blog above |
| Headcount | ~500 (Fortune); aggregator sites show 175 with 120 open reqs (stale, **UNVERIFIED**) | [Fortune](https://fortune.com/2026/09/09/trmlabs-valuation/) |
| Largest public contract | ICE sole-source, ~$94.66M, Jul 2026 to Jun 2027, Cyber Disruption Center | [USAspending](https://www.usaspending.gov/award/CONT_AWD_15F06722F0002184_1549_15F06722D0000319_1549) |
| Live risk | Chainalysis bid protest against that award at the Court of Federal Claims, argued 2026-09-02, ruling requested by 2026-09-10, unresolved | [The Block](https://www.theblock.co/news/business/2026-08-30-chainalysis-accuses-ice-of-unfairly-steering-95-million-blockchain-contract-to-trm-labs-413066) |

Hiring signals: "Head of Private Sector Deployment Strategy", data-engineering SWEs, government CSMs. They are pushing into fintech/enterprise while deepening government ([BuiltIn](https://builtin.com/company/trm-labs/jobs)).

### 1.2 Product catalogue

| Product | What it does | Notes |
|---|---|---|
| **Forensics** | Graph-based investigation tool | Core government product |
| **Wallet Screening / KYT** | Real-time address risk score for onboarding and compliance | Sales-gated API, no self-serve ([TRM](https://www.trmlabs.com/blockchain-intelligence-platform/wallet-screening)) |
| **Transaction Monitoring** | Re-screens previously cleared addresses when they turn bad | Sales-gated |
| **Signatures** | Behavioural / typology tagging | |
| **Beacon Network** | Real-time freeze and alert network across exchanges and law enforcement, launched Aug 2025, >$75M frozen | [Beacon](https://www.trmlabs.com/beacon-network) |
| **Chainabuse** | Free public scam-reporting site, ~1M reports, built on the Bitcoinabuse.com acquisition (Oct 2023) | [GlobeNewswire](https://www.globenewswire.com/en/news-release/2023/10/11/2758400/0/en/TRM-Labs-Acquires-Bitcoinabuse.com.html) |
| **T3 Financial Crime Unit** | JV with Tether and Tron, >$339M frozen, extending to other stablecoins | |
| **Co-Case Agent** | AI investigative assistant inside Forensics, launched 2026-03-25, natural-language to graph query, audit-logged for SAR/court use, 60 to 80% faster investigations in DOJ/EU pilots | [TRM](https://www.trmlabs.com/resources/blog/trm-labs-launches-co-case-agent-an-ai-assistant-for-every-crypto-investigation), [CoinDesk](https://www.coindesk.com/policy/2026/03/25/ai-agents-to-help-investigators-unearth-crypto-criminals-according-to-new-trm-program) |
| **Free Sanctions Screening API** | The only self-serve product. 1 req/s, 100 req/day default | [docs](https://docs.sanctions.trmlabs.com/) |
| **"OS for crimefighters"** | Unveiling fall 2026. Positioning: "the AI investigations company", "detect and disrupt criminal networks that exploit frontier technologies", combining proprietary intelligence, AI-native investigations software, and disruption-network infrastructure | TRM blog above |

### 1.3 Data and attribution

- Reviewers claim 100+ chains supported (**UNVERIFIED** as an official number) ([G2](https://www.g2.com/products/trm-labs-platform/reviews)). Per-chain coverage pages exist for Base, Optimism, Sui, Unichain, Citrea, Kaia and others.
- Attribution comes from a "glass box" model fed by Chainabuse victim reports, the Beacon law-enforcement feedback loop, and AI crawlers that detect scam sites ([TRM PR](https://www.globenewswire.com/news-release/2025/02/25/3031985/0/en/TRM-Labs-Expands-Wallet-Screening-Solution-to-Combat-11-Billion-Crypto-Fraud-Epidemic.html)).
- Their AI-in-Crime index claims criminal AI adoption up 40% YoY. Self-published, **UNVERIFIED** independently.

### 1.4 Pricing and embedding

- No public tiers. Reseller and comparison sites cite roughly £15k to £33k per licence floor and ~$200k/year base enterprise contracts. Indicative only ([G2](https://www.g2.com/products/trm-labs-platform/reviews), [finconduit](https://finconduit.com/resources/blockchain-analytics-providers-compared)).
- Embedding exists only through named enterprise KYC partners (Persona, Sumsub). No open API-key-and-go programme for a small startup ([Persona](https://help.withpersona.com/articles/5yal3xQnhclQIsXxWYVBR7/), [Sumsub](https://docs.sumsub.com/docs/trm-labs)).

### 1.5 Where TRM is thin (evidence-based)

1. **No self-serve or startup-priced tier** for Wallet Screening or Transaction Monitoring. Reviewers say it is too expensive for VASPs and startups.
2. **No product instrumenting Telegram-native trading bots** (GMGN, Maestro, Trojan, BonkBot class), despite Solana memecoin tracing case studies.
3. **No product for screening AI-agent-originated transactions.** Co-Case Agent is an AI *for investigators*, not a guard on agent payments.
4. **Government-first**. Revenue narrative is ICE, DOJ, EU law enforcement, national security. Consumer and DeFi builders are not the buyer.
5. **Procurement overhang**. The ICE sole-source award is being litigated as "arbitrary, capricious and unreasonable".
6. No independent adversarial evidence on attribution false-positive rates was found. Gap in evidence, not proof of quality.

---

## 2. What Suwappu already has (repo inventory, with anchors)

| Asset | State | Anchor |
|---|---|---|
| Application-layer **compliance gate** before signing: DISABLED / MONITOR / ENFORCE modes, blocklist and allowlist policies, screens recipient, router and token contracts | Built, tested, **off by default** | `bot/services/compliance/compliance_service.py`, `bot/services/swap_engine.py` `execute_swap`, `tests/test_compliance_screening.py` |
| **OFAC seed list** (15 Tornado Cash addresses) plus file-based blocklist | Static, no refresh job | `bot/services/compliance/ofac_list.py:44-62` |
| **Flashbots private routing** for screened EVM swaps | Built, off by default | `bot/services/compliance/flashbots_relay.py` |
| **Token risk scoring** 0 to 100 across 9 categories (honeypot, mint/freeze authority, blacklisted creator, liquidity, holder concentration, age, socials, lock) | Live | `bot/services/token_security/token_analyzer.py`, `honeypot_detector.py`, `authority_checker.py` |
| **Blacklist service** with TOKEN / CREATOR / NAME_PATTERN / SYMBOL_PATTERN entries and reason enums including USER_REPORT | Live, hard-blocks in swap and paste-trade | `bot/services/token_security/blacklist_service.py:24-42`, `swap.py:1101`, `paste_trade.py:213` |
| External token-risk provider | **GoPlus only**, Terminal route | `api/routes/terminal.py:1042-1055` |
| **Launch detector** on pump.fun, Raydium, migrations, with creator, liquidity, bonding-curve data | Live | `bot/services/sniping/launch_detector.py` |
| **tx_poller** across 7+ chains, Solana websocket | Live | `bot/services/tx_poller.py` |
| **Agent trust table**: trustScore 0 to 100, threatCount, cleanCount, quarantinedUntil, 15-point penalty, 1 pt/hour recovery | **Record-only, nothing reads it** | `api-ts/src/db/schema/agentTrust.ts:9`, `api-ts/src/services/AgentTrustService.ts:14-44` |
| Threat scanner middleware | Observe-only | `api-ts/src/middleware` (`scanForThreatsObserveOnly`) |
| Agent surfaces: REST `/v1/agent/*` (Level 0 discover to Level 4 managed execute), MCP, A2A, x402 metering, Base Spend Permissions | Hosted | `api-ts/src/routes/agent.ts`, `docs/product-status.md` |
| AEGIS fork/extend plan (signature scanning, quarantine, per-agent trust, TS port) | Plan, not implemented | `docs/plans/aegis-fork-extend.md` |

**Known gaps in our own gate** (`compliance_service.py:35-42`, `docs/architecture/compliance-screening.md`): `bulk_pay` and CCTP bridge legs are unscreened; EVM-only, Solana/TRON/Starknet addresses pass through; no scheduled sanctions refresh; no commercial screening adapter although the interface was designed for one.

**Net position:** we have roughly 60% of a prevention-layer product already in the repo, but it is not switched on, not sold, and not fed back anywhere.

---

_Section 3 (landscape and wedge opportunities) and Section 4 (the plan) follow._

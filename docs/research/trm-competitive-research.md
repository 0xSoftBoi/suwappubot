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

## 3. The landscape around TRM

### 3.1 Investigation layer (TRM's actual market)

| Player | Position | Evidence |
|---|---|---|
| Chainalysis | Incumbent. ~$1.55B valuation (down from $8.54B in 2022), ~$250M 2024 revenue, 20% layoffs 2023, bought **Hexagate** (prevention) for ~$60M Dec 2024 | [Sacra](https://sacra.com/c/chainalysis/), [Chainalysis](https://www.chainalysis.com/blog/chainalysis-hexagate-announcement/) |
| TRM Labs | Fastest-growing. See section 1 | |
| Elliptic | Bank/exchange compliance. $14M raise Sep 2025 | [PitchBook](https://pitchbook.com/profiles/company/522985-33) |
| Merkle Science | DeFi risk scoring, $25.6M raised total | [Tracxn](https://tracxn.com/d/companies/merkle-science/__iC1Wo0UrEK6_wN9_x77whfcECwekm8f8OQIDQVZyIpo) |
| Crystal, Scorechain, AnChain | Sub-scale or EU-niche | [Tracxn](https://tracxn.com/d/companies/crystal-intelligence/__MR2Qf9h_2GZw4msE_ErbJ9D5_z2dQGiVsf1Le6xqjXs), [PitchBook](https://pitchbook.com/profiles/company/170986-33) |
| Coinfirm | Acquired by Lukka 2024, exited as standalone | |
| Arkham, Nansen, Bubblemaps | Trader-facing intel, token or freemium models, not compliance-grade | |

**Pattern:** the layer is consolidating into a TRM vs Chainalysis duopoly. Both are now *buying or building prevention* because investigation alone is not enough. Chainalysis paid ~$60M for Hexagate. TRM is building Beacon and T3. Everyone else is sub-scale. A new entrant into investigation has no path.

### 3.2 Prevention layer (where Suwappu actually sits)

| Player | Model | Notes |
|---|---|---|
| **Blockaid** | Tx simulation and threat-intel API embedded in Coinbase, MetaMask, Ledger, Rainbow, Uniswap, Jupiter. $83M raised | Enterprise pricing, no investigator feedback loop ([PYMNTS](https://www.pymnts.com/news/investment-tracker/2025/blockaid-raises-50-million-to-scale-support-for-blockchain-security-platform/)) |
| **Hypernative** | Protocol/institution SaaS, $40M Series B 2025 | Not per-wallet ([Calcalist](https://www.calcalistech.com/ctechnews/article/rjj500lu7eg)) |
| **Hexagate** | Now Chainalysis. Claims 98%+ of hacks flagged pre-execution | The "prevention feeds disruption" model, owned by the #1 investigator ([Finovate](https://finovate.com/chainalysis-acquires-web3-security-company-hexagate/)) |
| **Harpie** | Wallet firewall, **shut down March 2025** despite Coinbase Ventures and Dragonfly | Recovery-fee pricing (7%, then flat 0.01 ETH) failed ([crypto.news](https://crypto.news/coinbase-backed-crypto-firewall-harpie-shuts-down-over-business-model-struggles/)) |
| **GoPlus, RugCheck, ScamSniffer, De.Fi** | Free APIs and open blocklists, monetised via tokens | We already consume GoPlus |
| **Forta Firewall, Zircuit SLS** | Sequencer-level screening, infra-embedded | [Forta](https://docs.forta.network/en/latest/forta-firewall-compliance-screening/) |
| Cube3, Ironblocks, Range, Webacy | **UNVERIFIED** current state | Follow-up if material |

### 3.3 The gaps, with evidence

- **Telegram trading bots have zero compliance screening.** Banana Gun has anti-rug simulation, Photon has Memescope filtering. None of Maestro, BonkBot, Trojan, GMGN or Axiom advertise OFAC, KYT or AML screening ([DEXTools guide](https://www.dextools.io/tutorials/telegram-trading-bots-2026-guide)). Trojan did $25B volume, Axiom hit $200M revenue (`docs/NEOBANK_ROADMAP.md`). This is a large unscreened flow that stablecoin issuers will be forced to care about.
- **Solana memecoin damage is measurable and predictable.** A 2026 study found 76,469 likely rugs among 100,063 tokens on three Solana DEXs in early 2025, ~$151M traceable losses; 98.6% of 7M+ pump.fun tokens ended under $1,000 liquidity ([arXiv 2608.20271](https://arxiv.org/html/2608.20271)). Chainalysis puts 2025 scam losses at $17B, $2.8B in rug pulls ([DeepStrike](https://deepstrike.io/blog/rug-pull-statistics)). We already run a pump.fun and Raydium launch detector.
- **AI-scale crime is TRM's whole narrative, and it's real.** FBI IC3 2025: $11B+ US crypto-fraud losses, 22,000+ AI-tagged complaints, $893M in losses ([FBI](https://www.fbi.gov/news/press-releases/cryptocurrency-and-ai-scams-bilk-americans-of-billions)). TRM's index went 28 to 54/100 in two years ([The Block](https://www.theblock.co/news/web3/2026-08-21-ai-adoption-in-crypto-crime-trm-412297)).
- **Nobody screens AI-agent transactions.** Coinbase Agentic Wallets (Feb 2026) ship TEE keys with built-in KYT, x402 has processed 50M+ machine payments, ERC-8004 (EF, Google, Coinbase) defines identity, reputation and validation registries on top of A2A ([ERC-8004](https://eips.ethereum.org/EIPS/eip-8004), [Coinbase](https://www.coinbase.com/developer-platform/discover/launches/agentic-wallets), [BlockSec](https://blocksec.com/blog/agent-native-crypto-compliance-build-kya-kyt-with-x402)). No incumbent has a named "agent screening" product. We already speak MCP, A2A and x402 and have an ERC-8004 gap noted in `docs/plans/agent-leading-edge-roadmap.md`.

### 3.4 Regulatory tailwinds

- **GENIUS Act** (signed Jul 2025, in force by Jan 2027): stablecoin issuers become BSA financial institutions with mandatory OFAC screening and freeze capability, continuously as coins move. Issuers will push screening obligations down to front-ends, bots and wallets ([Elliptic](https://www.elliptic.co/insights/genius-act-stablecoin-compliance-for-banks/)).
- **FATF Travel Rule 2025 revisions** with guidance due late 2026; **MiCA/TFR** fully in force in the EU since Dec 2024 ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/08/fatf-revises-aml-standards-for-certain-funds-transfers)).
- **EU AI Act**: fraud detection, AML monitoring and automated block/approve decisions are Annex III high-risk; deployer obligations live since 2026-08-02 ([artificialintelligenceact.eu](https://artificialintelligenceact.eu/annex/3/)). This hits any AI-agent trading product in the EU, including us.

Net: regulation is converging on *pre-transaction* screening obligations for anything touching stablecoins or automated decisioning. That structurally favours execution-layer products over post-hoc forensics.

### 3.5 Business-model lessons

- **Contingent recovery fees fail** (Harpie). Screening has to be bundled into the swap fee or sold as a subscription or metered API.
- **Free core plus paid depth works** at distribution scale (GoPlus, RugCheck). We are a consumer of that pattern, not yet a producer.
- **Enterprise-only prevention gets acquired** (Hexagate to Chainalysis, ~$60M). Embedded prevention with real volume is a plausible exit, not just a feature.
- **Data-for-access consortia** (T3 FCU, $450M+ frozen across 23 jurisdictions, 24-hour turnaround) show that feeding leads to issuers and investigators buys credibility without becoming an investigations vendor ([Cointelegraph](https://cointelegraph.com/news/tethers-t3-crime-unit-frozen-450m-in-suspected-illicit-crypto)).

---

## 4. How Suwappu competes

### 4.1 The thesis in one paragraph

TRM's own words: "the prevention layer is essential, but never enough. Criminals will break through." They are building the layer *after* the breach, for the people who chase criminals. We own the moment *before* the breach, for the people (and agents) about to get robbed. The two layers need each other: TRM needs prevention-layer telemetry to feed disruption (that is why Chainalysis bought Hexagate and why TRM built Chainabuse and Beacon), and we need TRM-grade attribution to make our gate smarter than a static OFAC seed. So the play is **complement, then compete on the segments they cannot serve**: Telegram bot flow, Solana memecoin execution, and AI-agent transactions, sold self-serve at a price TRM structurally cannot offer.

### 4.2 Three plays, ranked by leverage

**Play 1 — Switch on and finish the gate, then say so publicly. (Weeks, mostly config and small code.)**

We are the only Telegram trading bot with a compliance gate in the codebase. It is disabled.

1. Run `COMPLIANCE_MODE=monitor` in prod for a week, review false positives, then `enforce`. Same for `COMPLIANCE_ROUTING_ENABLED` on Ethereum mainnet (`docs/architecture/compliance-screening.md` rollout section).
2. Close the known holes: screen `bulk_pay` and CCTP legs; add Solana and TRON address families; add a scheduled OFAC SDN refresh (free feed) plus TRM's **free Sanctions Screening API** as a second source behind `AddressComplianceService` (100 req/day is enough as a nightly diff on our active address set, not per-swap).
3. Feed `launch_detector` quality signals and `token_analyzer` scores into the same pre-sign gate so rug prediction happens at swap time, not only on token lookup (wedge 3 in section 3.3). The arXiv model shows the signal exists; we already have the features (creator, liquidity, bonding curve, holder concentration).
4. Persist every block, and every USER_REPORT into `BlacklistService`, as structured events with chain, address, reason and evidence hash. This is the raw material for Play 3.
5. Marketing: "every Suwappu swap is screened before it is signed." No competitor bot can say this. `growth-marketing` owns the copy.

Owners: `bot-dev`, `db-migrate` for the events table, `money-path-reviewer` (opus) on anything that can block a swap.

**Play 2 — Sell the gate as an Agent Transaction Screening API. (One to two months.)**

TRM has no self-serve wallet screening and no agent product. Blockaid and Hypernative are enterprise-priced. GoPlus is token-only. Nobody screens agent payments, and ERC-8004 plus x402 now give agents identity and money.

1. Expose `POST /v1/agent/screen` (and an MCP tool, and an A2A skill) that takes `{chain, from, to, token, calldata?, agentId?}` and returns `{verdict, riskScore, reasons[], sources[]}`. Wire it as an optional pre-flight inside our own `/v1/agent/execute` path so every managed execution is screened and the result is in the receipt.
2. Meter it with the x402 middleware we already have. Free tier for discovery, per-call pricing above that. This is the self-serve tier TRM does not offer.
3. Make the record-only `agentTrust` table actually gate: read `trustScore` and `quarantinedUntil` in `agentBearerAuth`, decay on threat verdicts, and publish the score as an ERC-8004 reputation attestation. That is the "KYA" layer nobody has shipped (`docs/plans/aegis-fork-extend.md` Phase 3 already scopes this).
4. Ship the AEGIS-style signature scanner in observe mode on the NL and WhatsApp seams (Phase 1 of the AEGIS plan) so drainer lures and seed-phrase solicitation are caught on the way *in*, not only bad addresses on the way out.
5. Package an EU AI Act Annex III transparency note (what the model sees, how a block is logged, how a human overrides). Cheap to write, and no competitor bot has it.

Owners: `api-ts-dev`, `sdk-dev` for the shared `RiskVerdict` type in `packages/sdk/src/types.ts`, `security-auditor` before launch.

**Play 3 — Become a data source for the disruption layer, not a rival to it. (Ongoing, starts after Play 1.)**

TRM says the world needs prevention-to-disruption feedback. We can be a feed.

1. Auto-submit confirmed drainer, honeypot and rug hits from Play 1 to **Chainabuse** (free, public, TRM-owned) with our evidence hash. This is free distribution: every submission carries our name to the 600 institutions using TRM.
2. Approach TRM's private-sector deployment team and T3 FCU with a data-sharing proposal: we provide execution-layer telemetry on Telegram and Solana flows they do not see; they provide Wallet Screening at partner terms, the way Persona and Sumsub embed them. Their new "Head of Private Sector Deployment Strategy" role is the door.
3. Same pitch to Circle (endorsed Chainabuse publicly) and Tether under GENIUS Act pressure: they will need front-ends that screen their coins.
4. Keep the exit optionality visible: Chainalysis paid ~$60M for Hexagate for exactly this kind of embedded prevention with volume.

Owners: founder, `growth-marketing` for the partner deck.

### 4.3 What not to do

- **Don't build forensics, graph tools or attribution.** Ten years of data and a government sales team stand behind TRM and Chainalysis. Sub-scale entrants (Crystal, Scorechain, Coinfirm) show the outcome.
- **Don't price on recovered funds.** Harpie proved it fails. Bundle into the swap fee or meter the API.
- **Don't claim "screened" before the gate is in enforce mode in production with evidence.** Standing rule 2: code-complete is not live.
- **Don't let screening latency touch the swap hot path.** Regex and list lookups only, sub-5 ms p50, per the AEGIS plan latency budget. ML tiers run async on the events table.

### 4.4 Metrics that prove the wedge

| Metric | Why it matters |
|---|---|
| Swaps screened in enforce mode / total swaps | Play 1 is real |
| Blocks per 10k swaps, and false-positive rate from user appeals | Gate quality |
| Chainabuse submissions accepted | Play 3 distribution |
| Paid `/v1/agent/screen` calls per week, and distinct paying agents | Play 2 revenue |
| Agents with trustScore < 100 that got throttled | KYA actually gates |

### 4.5 Open items and unverified claims

- Chainalysis vs ICE bid protest ruling (requested by 2026-09-10). If TRM loses, their government story weakens and private-sector push accelerates.
- TRM chain-count (100+) and headcount (500 vs 175) are reviewer or aggregator figures.
- Cube3, Ironblocks, Range, Webacy, Fire and ScamSniffer current funding and pricing were not confirmed.
- No independent evidence either way on TRM attribution false-positive rates.
- Suwappu user counts are not stated in `docs/product-status.md`; the partner pitch in Play 3 needs a real volume number.

---

## Sources consulted (primary)

TRM blog and docs, Fortune, The Block, CoinDesk, BankInfoSecurity, USAspending.gov, G2, BuiltIn, Sacra, PitchBook, Tracxn, Crunchbase, PYMNTS, Calcalist, Finovate, crypto.news, Forta docs, arXiv 2608.20271, DeepStrike, FBI IC3, Coinbase Developer Platform, ERC-8004, BlockSec, Elliptic, Mayer Brown, artificialintelligenceact.eu, Cointelegraph, DEXTools. Repo anchors verified by direct read at commit `43d3255`.


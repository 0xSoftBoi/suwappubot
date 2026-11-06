# Suwappu × Devcon: Alignment Strategy (Nov 2026)

> Source: archive.devcon.org scan on 2026-11-06, covering Devcon 7 Bangkok '24, Devconnect Buenos Aires '25 and Devcon 8 Mumbai '26 (Nov 3–6, which ended today).
> **Confidence caveat:** Devcon 8 archive pages exist, but they have no videos or transcripts yet. Devcon 8 themes below come from tracks, titles and which talks got keynote or staff-pick slots, not from the talks' arguments. Devcon 7 and Devconnect findings come from talk descriptions, not full transcripts. Re-run once the Devcon 8 videos land (see §6).

## 1. What the Ethereum community is saying (ranked)

| # | Theme | Evidence |
|---|---|---|
| 1 | **Privacy by default** | Devcon 8 keynotes: "End-to-End Privacy", "Kohaku: privacy for everyone, by default", "Private State, Public Network", and a Tor AMA (Dingledine). Devcon 8 also has a Privacy & Consent track. Privacy went from a side track at Bangkok to the center at Buenos Aires ("privacy and ZK everything"). |
| 2 | **Trustlessness / walkaway test / minimal trust surface** | Vitalik's Devcon 8 keynote "The Open Secure and Verifiable Half to a Brighter Future". The keynote "Reducing the Trust Surface". The Open & Verifiable Stack track. At Buenos Aires: the Trustless Manifesto fireside and the trustless:// track; Vitalik cited FTX as "everything Ethereum is not". |
| 3 | **AI agents that can be verified as safe** | Vitalik × Audrey Tang, "Can Agents Be Safe in the Open? Two Levels of Trust". The Users, Builders & Agents track. At Buenos Aires: the ERC-8004 "Trust Layer in the Agentic Stack" panel (MetaMask, EF dAI, Flashbots, Nethermind), whose message was "build agents, not agent platforms"; "x402scan" (discovery and reputation); "Privacy on x402" (Aztec). |
| 4 | **One Ethereum: intents and chain abstraction** | Devcon 8: "One Ethereum: Same Block, Every Chain". Devcon 7: "Unifying Ethereum Through Intents and ERC-7683" and "Chain abstraction is risk abstraction". Buenos Aires: Jim Chang (LI.FI), "Chain abstraction with the OIF" (Resource Locks, Multichain Inputs). |
| 5 | **Post-quantum transition** | Devcon 8 staff-pick keynote (Drake) plus a PQ Q&A. |
| 6 | **Wallet security and clear signing** | Buenos Aires: "EIP-7702: Empowering EOAs, Expanding Attack Surfaces". ERC-7730 clear signing (EF working group, clearsigning.org, WalletConnect support). Off-archive: 7702 phishing-delegation research. |
| 7 | **MEV as a protocol and ordering problem** | Devcon 7: Poon, "L2-specific MEV mitigation"; "Encrypted mempools". |
| 8 | **Real-world rails in India and the global south** | Devcon 8: "Open Financial Rails for India", Digital Rights in DPIs, Bhutan DID. Buenos Aires: the fintech & payments panel and the Argentina-adoption talk. |

**What the community values:** credible neutrality, self-custody, open standards, open source, usefulness over speculation.
**What it criticizes:** custodial or single-operator dependence, casino or memecoin culture, opaque intermediaries, closed agent "platforms".

## 2. Where Suwappu stands today (repo check, 2026-11-06)

| Area | State | Read to a Devcon audience |
|---|---|---|
| x402 pay-per-call + MCP + A2A | Built; metering is on in prod | ✅ Aligned, and ahead of most teams |
| Agent control plane (policy gate, approvals, hash-chain audit, PR #666) | Built | ✅ This is exactly the "trust layer" the ERC-8004 panel described |
| Non-custodial wallets (MetaMask/WalletConnect/Ledger, client-signs) | Terminal only | ⚠️ Exists but is not the default story |
| Custodial KMS wallets + omnibus deposit custody | Default on bot/webapp | ❌ Fails the walkaway test unless there is an exit path |
| LI.FI routing | Core | ⚠️ A proprietary-aggregator dependency; LI.FI is itself an OIF contributor, though |
| ERC-7683 / OIF intents | Not present | ❌ Gap |
| ERC-8004 agent identity/reputation | Not present | ❌ Gap: cheapest high-signal win |
| ERC-7730 clear-signing metadata | Not present | ❌ Gap |
| EIP-7702 / ERC-7715 session keys | Only a mention in the policy schema | ⚠️ Gap |
| Privacy (stealth receive, Kohaku/Railgun compatibility) | Not present | ❌ Gap: this is theme #1 |
| MEV-protected submission | Settings exist (13 files) | ⚠️ Verify it is the default, then surface it |
| Snipe / launch_detector / memecoin discovery | Prominent (/snipe, Pulse) | ❌ Misaligned *as the headline* |
| Seasons points → SUWP | Built | ⚠️ Reads as farming unless it is fee-based and transparent |

## 3. Positioning

**From:** "a cross-chain DEX bot across 7+ chains" (casino-adjacent, custodial).
**To:** **"The verifiable execution layer for humans and agents: intents in, best fill out, every hop disclosed, keys yours, agents on a leash."**

Positioning pillars, each tied to a community theme:
1. **Walk-away-able.** Default to non-custodial, give custodial users a one-tap key export and exit, and open-source the SDK and MCP server. (Theme 2)
2. **Disclosed abstraction.** Every route shows its hops, its bridge/solver trust model, the fill guarantee and all fees. ("Chain abstraction is risk abstraction", theme 4)
3. **Agents on a leash.** ERC-8004 identity, policy-gated spend, an audit chain, x402. (Theme 3)
4. **Private when you want it.** Stealth receive, plus "what is hidden from whom" disclosure. (Theme 1)

Keep sniping and memecoin discovery as power-user features in the terminal, and take them out of the hero and Devcon-facing copy. Do **not** cut them from the product; that is a scope decision for the founder (see the CLAUDE.md scope rule).

## 4. Ranked build plan

Ranked by alignment signal per unit of effort. Every item that touches keys, signing, custody or fees is **MONEY-PATH** and needs `money-path-reviewer`.

| P | Item | Effort | Why |
|---|---|---|---|
| **P0** | **ERC-8004 registration** for the Suwappu agent and MCP server (identity + reputation registry), and list our x402 endpoints on x402scan | S | The most-discussed agent standard at Buenos Aires; we already have the control plane behind it. |
| **P0** | **Route risk disclosure** on every quote: hops, bridge/solver trust type, fill guarantee, fee split. Reuse the existing `route_data` quote snapshot | S–M | A direct answer to "chain abstraction is risk abstraction"; also builds trust for TCA. |
| **P0** | **Custodial exit path:** documented key export and withdraw-all for KMS wallets, plus a public "walkaway" page | M (MONEY-PATH) | Neutralizes the biggest misalignment without killing Telegram UX. |
| **P1** | **ERC-7730 clear-signing metadata** for our router/approval calls on non-custodial flows; submit to the clearsigning.org registry | S | No blind signing; a cheap credibility win. |
| **P1** | **MEV-protected submission on by default** for EVM swaps (private RPC), surfaced in the UI | S (MONEY-PATH) | Mostly wired already; make it visible. |
| **P1** | **ERC-7683 / OIF intent adapter** behind the router (LI.FI already contributes to OIF), exposing a standard intent surface in the agent API | M–L (MONEY-PATH) | "One Ethereum" alignment; lowers lock-in to a single aggregator. |
| **P2** | **EIP-7702 batching + ERC-7715 session keys** so approve-and-swap needs one signature, and agents get scoped, revocable permissions. Never delegate to unaudited contracts, and show the delegate address | L (MONEY-PATH) | Fits UX and agents; must follow the 7702 attack-surface lessons. |
| **P2** | **Stealth-address receive** (ERC-5564) for swap outputs; track Kohaku SDK compatibility | M (MONEY-PATH) | The #1 Devcon 8 theme; a privacy story for the agent API too (per Kothari: be explicit about what is hidden from whom). |
| **P3** | **India rails:** INR on/off-ramp partners, stablecoin remittance flow, Telegram Mini App distribution | M | Devcon 8 host-market focus; check tax/regulatory constraints first. |
| **P3** | **PQ readiness note:** a statement on our dependency on the Suwappu-Labs PQ DAG work | S | Ties our existing PQ research to the Devcon 8 keynote theme. Don't overclaim. |

## 5. Go-to-market

- **Narrative:** publish "How Suwappu passes the walkaway test" (custody, exit, open-source, disclosure) and "Agents on a leash: ERC-8004 + policy + x402" as the two flagship posts. Use original data where possible, such as the execution-intelligence markouts (see the research-post-series bar: no generic synthesis).
- **Devconnect 2027 / next Devcon:** submit a talk on *risk-disclosed cross-chain execution for agents*, with real fill/markout data. Apply to Trustless Agent Day–style side events (EF, Coinbase, Google Cloud, MetaMask).
- **Grants:** EF ESP and PSE privacy grants for the stealth-receive and clear-signing work; this pairs with the Anthropic Startup Program for agent credits.
- **Copy rule:** never call omnibus custody "self-custody". Lead with utility (stablecoins, cross-chain settlement, agents), not memecoins.

## 6. Follow-ups

- [ ] Re-scan archive.devcon.org/devcon8 in ~1–2 weeks, once videos and transcripts post. Priorities: Vitalik's keynote, "Can Agents Be Safe in the Open?", "One Ethereum: Same Block, Every Chain", "Kohaku", "Open Financial Rails for India". Update §1 confidence.
- [ ] Transcript-level read of: Jim Chang OIF (Buenos Aires), Malhotra on 7702 (Buenos Aires), the ERC-8004 panel (Buenos Aires), Poon on MEV (Devcon 7).
- [ ] Founder decision: how far to de-emphasize /snipe and launch_detector in public positioning.

## Key sources
- https://archive.devcon.org/devcon8/ (Devcon 8 talk shells)
- https://archive.devcon.org/devconnect-arg/panel-the-trust-layer-in-the-agentic-stack-erc-8004
- https://archive.devcon.org/devconnect-arg/x402scan-the-discovery-layer-for-x402
- https://archive.devcon.org/devconnect-arg/privacy-on-x402-or-rahul-kothari-at-agentic-zero
- https://archive.devcon.org/devconnect-arg/trustlessinteroplandscape-jim-chang-chain-abstraction-with-the-oif
- https://archive.devcon.org/devconnect-arg/trustlesseil-fireside-chat-the-trustless-manifesto
- https://archive.devcon.org/devconnect-arg/eip-7702-empowering-eoas-expanding-attack-surfaces
- https://archive.devcon.org/devcon-7/chain-abstraction-is-risk-abstraction
- https://archive.devcon.org/devcon-7/l2-specific-mev-mitigation-strategies
- https://archive.devcon.org/devcon-7/better-privacy-defaults-for-your-users-with-stealth-addresses
- https://archive.devcon.org/devcon-7/keynote-the-real-state-of-l2s/

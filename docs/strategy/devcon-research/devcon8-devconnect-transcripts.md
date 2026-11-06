# Devcon 8 (Mumbai, Nov 2026) + Devconnect Buenos Aires (Nov 2025): transcript-level findings

**Method.** Talk metadata comes from `api.devcon.org/sessions`. YouTube caption fetching was IP-blocked, so audio was downloaded with yt-dlp and transcribed locally with faster-whisper `base.en`. That gave 90 transcripts: 29 from Devcon 8 and 61 from Devconnect, ranked by relevance. Speaker names in the ASR output are sometimes garbled.

**Unavailable:**
- "End-to-End Privacy" (Devcon 8 keynote): video removed from YouTube.
- "Agentic Hub live trial": video removed.
- One download failure.

URLs: `https://archive.devcon.org/devcon8/<slug>` and `https://archive.devcon.org/devconnect-arg/<slug>`.

## A. Devcon 8 vision / protocol

- **Post-Quantum Transition** (Justin Drake), `post-quantum-transition`.
  - Probabilities given: 10% chance of Q-Day by 2029, median 2032.
  - Upgrade timeline: Glamsterdam around Jan 2027; Hegota around Aug 2027 (FOCIL, frame transactions, PQ validator registry); full PQ transition by Dec 2028 ("Mission 2028").
  - Hash-based signatures preferred over lattices.
  - 72% of ETH supply sits behind exposed public keys. Custodians should run "bunker mode": never reveal pubkeys and move funds to clean addresses.
- **Open, Secure & Verifiable** (Vitalik) and **EF Access Layer**, `the-open-secure-and-verifiable-half-to-a-brighter-future`, `ethereum-is-decentralized-your-access-isnt`.
  - Access to Ethereum is the weak link: clear signing, light clients, private RPC.
  - Bybit ($1.5B) is framed as "a lying interface".
- **One Ethereum: Same Block, Every Chain**, `one-ethereum-same-block-every-chain-part-i`.
  - Same-block L1↔L2 composability, ZK rollups only. A devnet is live; the first fully compatible chain is targeted for Q1 (2027, inferred).
  - The composer is operated centrally for now.
- **FOCIL**, `focil-solves-censorship-what-doesnt-it-solve-about-builders`.
  - FOCIL does not cover the roughly 47% of order flow that is private.
  - Proprietary AMMs still need builder cooperation, which matters for snipe and MEV flows.
- **Civic AI** (Audrey Tang).
  - Hard invariants and caps plus on-chain receipts; ask a human beyond the caps.
  - Rules enforced by an LLM are soft (the "Fraser $47k" example).
- **Open Financial Rails for India** (Polygon), `reimagining-money-movement-open-financial-rails-for-india`.
  - x402 at scale needs cumulative vouchers or session keys; Cloudflare is launching x402 on Base.
  - Polygon's Open Money Stack added Solana and Tron.
  - India-specific advice: avoid outbound flows; Tether freezes are a risk.
- **Kohaku** (privacy SDK: Railgun, Privacy Pools, Helios, Tor).
  - Broader release expected within about 2 months.
  - Stealth addresses: roughly half are deanonymized in practice.
- **Z. Williamson.**
  - Non-custodial design avoids money-transmitter licensing.
  - Expects an AI-driven exploit wave in 2027.

## B. Agents and transaction security

- **$7.5M Sandwich Bot Hack** (Kevin Jones, 1Claw).
  - The bot approved max allowances to 66 attacker-seeded fake ERC-20s and never revoked them. One `transferFrom` sweep drained everything.
  - "Jared's keys were never really stolen. His bot basically signed exactly what the attacker wanted it to."
  - Fixes: simulate before signing, deny approvals by default, and enforce server-side caps the agent can't alter.
- **Permission, Not Possession** (MetaMask).
  - Scoped delegation via ERC-7715/7710: per-function scope, expiry, revoke, recipient and network allowlists, a 24h outflow cap, human approval above a threshold.
  - "If the model is fooled, the wallet still says no." He calls custodial agent wallets "the decade-old trade we came here to refuse".
- **8004: Bring Agents On Chain** (8004scan).
  - Over 1.5M agents registered, but only 2.24% of 385,998 pass a health check.
  - Feedback per agent fell from 2.00 to 0.64; anti-Sybil protection is weak.
  - Proposes publishing every metric as property / numerator / denominator / time / limits.
- **Beyond Clear Signing** (WalletBeat).
  - Wallets need scam alerts, ERC-7730, simulation, and transaction *assertions* (post-conditions that revert the tx).
  - Simulation shows what *might* happen, not what will.
- **Smart Accounts in Production** (Clave).
  - Scope session keys per function plus spend limit, not per contract, because contracts can be upgraded.
  - Smart accounts break on **Polymarket** (off-chain EIP-712, no ERC-1271) and **Hyperliquid** (K1 keys only). Both are Suwappu venues.
- **Trust a Tx End to End** (Sourcify).
  - Every preview layer is remote trust: RPC, source, simulation, decoding. Verify each locally (Helios + local EVM + 7730 attestations).
  - "The signers trusted, but they didn't verify."
- **Nobody Verifies What Your Agent Reads** (Envio).
  - Agent identity and actions are attested, but reads are not.
  - MCP should carry provenance (block, source, freshness).
- **Can Agents Be Safe in the Open?** (Vitalik × Tang).
  - Agent safety is "a hundred answers that each solve 1%".
  - "Do not have one AI control everything."
- **ERC-8004 Trust Layer panel** (Devconnect; MetaMask, EF dAI, Flashbots, Nethermind).
  - Identity, reputation and validation registries. Reputation is deliberately unstandardized; day-one signals are API-level (reachable, success rate, volume).
  - "Build more agents, not agent platforms."
  - TEEs are "Bezos custodial".
- **Agentic Intents panel** (Across, EF, Eliza).
  - Partial delegation: approval above a threshold, with the threshold rising as the agent builds reputation.
  - LLM-only traders lost money (the nof1 experiment).
  - "If you tell me your entire wallet is now the property of an AI… oh my God, no."
- **DeFi as an Agent Playground.**
  - LLM yield agents underperformed rule-based scripts.
  - Teams run agents inside bounded rules with humans in the loop, partly for legal liability.
  - ZyFAI posts ZK proofs to the 8004 validation registry.
- **Cosigners & Policy Engines** (Blockaid).
  - Static allowlists fail: an allowlisted Uniswap router can still route output to an attacker via its `to` parameter.
  - Needed instead: simulation-based "gaining address" policy, a cosigner, and one policy engine across wallet setups.
  - "Policies are important, but unfortunately they're not enough."
- **EIP-7702 talks.**
  - Delegating hands your funds to the delegate contract.
  - There is no JSON-RPC method for a dapp to request an authorization (a deliberate anti-phishing choice), so web apps need wallet cooperation.
  - The EF runs a free shared 7702 bundler.
- **Privacy on x402** (Aztec).
  - Hide the agent and the payment metadata; keep the resource and facilitator visible.
  - "What do you actually need to hide, and who do you need to hide it from?"
- **Speaker claim, unverified.** A Railway breach drained $370K from keys stored in env vars. **Suwappu deploys on Railway: verify.**

## C. Interop, trustlessness, privacy, regulation (Devconnect)

- **Vitalik, "Why Trustlessness Now?"**
  - "Trustlessness is not a feature… Trustlessness is hygiene."
  - "In 2030, the slogan will be not your silicon, not your keys."
  - Trust erodes through server-hosted UIs, RPCs and relayers.
- **Yoav Weiss, EIL.**
  - Removes the solver: the user self-executes using vouchers from L1-staked liquidity providers, depending only on canonical bridges.
  - Solver intents have griefing and oracle problems. Testnet only; wallet integrations are being solicited.
- **L2BEAT interop risk framework** (Kiepuszewski).
  - Users overwhelmingly choose Relay, whose "settlement" is an ERC-20 transfer to a solver EOA.
  - LayerZero tokens mostly run default configs: 13% single-DVN, 83% 2-of-2.
  - Large transfers drift to CCTP and canonical bridges.
  - L2BEAT will list every interop protocol unasked, then publish "Stages for interop". No single scores.
- **Interop panel.**
  - Bartek says Socket and **LI.FI** told him risk disclosure "did not change the user's behavior", and LI.FI declined to show it.
  - The case for disclosure is institutional and liability-driven.
  - Relay and Across disagree on whether trusted designs are acceptable. The panel converged on "security scales with amount".
- **Goldfeder (Offchain Labs).**
  - Interop is "90% wallet support, 10% protocol design".
  - Ship one default path now on today's intents (Across/Relay) and swap the internals for EIL later. Offchain Labs funds OIF.
- **CoW cross-chain** (Vinas, George).
  - Combinatorial auctions plus a unified cross-chain ledger aimed at Ethereum + Solana + Tron.
  - "80% of cross-chain volume touches five tokens." A direct future competitor.
- **Javor, composable batching.**
  - Four 1%-slippage hops compound to 4%; multi-step flows need runtime inputs such as "use my full balance".
- **TRAIN.** HTLC atomic swaps; Yoav's pick for very large amounts today.
- **Tomasz Stańczak (EF co-ED).**
  - "very dishonest practices on the marketing side… not disclosing all the risks."
  - Supports user choice along the trust spectrum.
- **Lefteris, "Who pays for privacy?"**
  - "A free product always hides a data tax."
  - Use explicit premium tiers, not grants.
- **Privacy Pools** (Soleimani).
  - "Non-custodial, but permissioned, privacy."
  - Deposits go through KYT (about 2% rejected) and rejected users can rage-quit.
- **Kohaku** (Consigny).
  - Railgun/Privacy Pools toggle in the normal send flow, account-per-dapp, Helios, hardware signing.
- **DeFi in Europe** (EUCI).
  - MiCA's "fully decentralised" exemption is undefined. The Danish FSA's three-axis test reaches front ends.
  - A custodial bot is very likely in scope.
- **L2BEAT chain-level risk.** "Don't just ask is this protocol safe, also ask is the chain even safe."

---
title: "The compliance gate we shipped before anyone asked for it"
audience: stablecoin issuers, institutional DeFi desks, compliance/risk teams, crypto Twitter builders
status: draft
topic_status: shipped, default-off (COMPLIANCE_MODE=disabled). Not a compliance certification.
---

## Sources (every number below is traceable)

- `docs/architecture/compliance-screening.md` — design doc, config table, rollout steps
- `bot/services/compliance/compliance_service.py` — `AddressComplianceService`, `ComplianceMode`, `ScreeningPolicy`
- `bot/services/compliance/ofac_list.py` — seed sanctions list + file loader
- `bot/services/compliance/flashbots_relay.py` — `FlashbotsRelay`, `eth_sendPrivateTransaction`
- `bot/services/swap_engine.py` — the gate inside `execute_swap`, and `_broadcast_evm_tx`
- `tests/test_compliance_screening.py`, `tests/test_compliance_routing.py`
- UBS × Nethermind PoC: https://www.ubs.com/global/en/media/display-page-ndp/en-20260623-nethermind.html

---

## A. Long-form (blog / Mirror)

**Title: We adapted UBS and Nethermind's public-Ethereum compliance PoC into a swap gate — and it's off by default**

In June 2026, UBS and Nethermind published two proofs of concept showing a regulated institution could transact on public Ethereum without forking the protocol: an Ethereum node configured to restrict transactions to pre-approved addresses and block disallowed contract interactions, plus routing approved bundles through relays to guaranteed-inclusion builders instead of the public mempool. Both were tested on Sepolia — no live transactions.

We build a DEX execution bot, not a node operator, so we adapted stage one — the compliance gate — to the layer we actually control: the application layer, at the single choke point every swap in the system funnels through, `SwapEngine.execute_swap`.

What that means concretely: before a swap is signed or broadcast, we screen the recipient, the router, and every token contract involved against a blocklist (an OFAC seed list plus operator-configured addresses) or, in permissioned mode, an allowlist of pre-approved addresses. Three modes: `disabled` (today's default — nothing changes), `monitor` (log what would have been blocked, block nothing — the way you'd stage a rollout), and `enforce` (actually block). Every flag lives in `bot/config/settings.py` and every one of them defaults off.

We also implemented the PoC's second stage — compliant routing — for the primary same-chain EVM swap path: when enabled, a screened transaction goes to block builders privately via the Flashbots relay (`eth_sendPrivateTransaction`) instead of the public mempool, the same private-orderflow pattern we already use for Solana via Jito. If the relay call fails for any reason, it falls back to the public RPC send automatically — routing can make a transaction more private, never less reliable.

We're not going to overclaim what this is. It is application-layer, not node/execution-layer — it governs transactions Suwappu originates, not orderflow we don't touch, which is the actual scope of the UBS/Nethermind node-level PoC. It's EVM-only; Solana, TRON, and Starknet addresses currently pass through unscreened. The bundled OFAC list is a curated seed set (Tornado Cash and similar), not an exhaustive maintained feed — production deployments should point `COMPLIANCE_OFAC_LIST_PATH` at a real feed or swap in a commercial screening vendor behind the same interface. And it is not a compliance certification of any kind; it's a configurable gate, tested (`tests/test_compliance_screening.py`, `tests/test_compliance_routing.py`), and off until an operator turns it on.

If you're a stablecoin issuer or an institutional desk evaluating execution venues, the interesting part isn't that we have a blocklist — plenty of front ends do. It's that the gate sits at the same choke point every execution path funnels through, so there's exactly one place to audit, not five.

## B. X/Twitter thread

1/ In June 2026 UBS and Nethermind showed a regulated institution can trade on public Ethereum without forking the chain: node-level address allowlisting + private relay routing. Tested on Sepolia, no live txs. We adapted it. Here's what shipped, and what didn't. 🧵

2/ Their PoC has two stages: (1) node-level rules — restrict to pre-approved addresses, block bad contracts, and (2) route approved bundles through relays to builders instead of the public mempool.

3/ We don't run nodes for other people's orderflow, so we adapted stage 1 to the layer we control: the application. Every swap funnels through one function, `SwapEngine.execute_swap`. We screen recipient + router + token contracts there, before signing.

4/ Three modes, all in `bot/config/settings.py`, all off by default: `disabled` (today), `monitor` (logs violations, blocks nothing — how you'd stage a rollout), `enforce` (actually blocks).

5/ Stage 2, also shipped: screened EVM swaps can route privately via the Flashbots relay (`eth_sendPrivateTransaction`) instead of the public mempool — mirrors the Jito path we already run for Solana. Relay error → automatic fallback to public RPC. Never blocks a swap.

6/ What we're not claiming: this is application-layer, not node-level — it doesn't cover orderflow we don't originate. EVM-only today. The bundled OFAC list is a seed set, not an exhaustive feed. And none of this is a compliance certification.

7/ Why publish the honest limitations too: a gate you can audit end-to-end is worth more to an institutional counterparty than a gate you have to take on faith. Code: `bot/services/compliance/`, docs: `docs/architecture/compliance-screening.md`.

## C. LinkedIn

**We shipped an application-layer compliance gate modeled on UBS and Nethermind's June 2026 public-Ethereum PoC — and left it off by default.**

Their proof of concept showed a regulated institution transacting on public Ethereum with two controls: node-level address restrictions, and private relay routing for approved transactions instead of the public mempool.

We build swap execution, not node infrastructure, so we adapted the first control to the layer we own: every swap in Suwappu funnels through one execution path, and we screen the recipient, router, and token contracts there — before the transaction is ever signed. Three modes (disabled / monitor / enforce), each configurable per deployment, disabled by default so nothing changes until an operator opts in.

We also shipped the second control: screened swaps can route privately to block builders via Flashbots instead of the public mempool, with an automatic fallback to public broadcast if the relay call fails.

We're being specific about scope because vague compliance claims are worse than none: this is application-layer (covers what we originate, not third-party orderflow), EVM-only today, and ships with a seed sanctions list an operator should replace with a maintained feed for production use. It is not a certification — it's a tested, auditable, single-choke-point gate that institutional counterparties can actually read.

For teams evaluating execution infrastructure: the code is at `bot/services/compliance/`, the design doc is `docs/architecture/compliance-screening.md`.

## D. SEO title/description

- **Title:** How Suwappu Built an Application-Layer Compliance Gate (UBS/Nethermind Model)
- **Description:** Suwappu adapted UBS and Nethermind's June 2026 public-Ethereum compliance PoC into a configurable, off-by-default swap screening gate plus Flashbots private routing. Here's what's real, what's scoped, and what isn't a compliance certification.

## What we deliberately did not claim

- Did not call this "compliant" or "regulatory-grade" — it is a configurable gate, off by default, not a certification.
- Did not claim node/execution-layer coverage — explicitly scoped to what Suwappu originates.
- Did not claim the bundled OFAC list is exhaustive or maintained.
- Did not claim this is live/enforcing anywhere — `COMPLIANCE_MODE` defaults to `disabled`; framed as available infrastructure, not an active claim about current production posture.

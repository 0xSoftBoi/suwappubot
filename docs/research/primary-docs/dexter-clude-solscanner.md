# Primary sources — Dexter, Clude, SolScanner

Read from IETF datatracker, repo READMEs, npm registry, and the projects' own doc/pricing pages.

---

## Dexter

**Sources read:** datatracker.ietf.org/doc/draft-sander-open-tabs-passkey/; dexter.cash/, /opendexter; raw READMEs for dexter-mcp, dexter-mainnet-proofs, dexter-connect, dexter-x402-sdk; github.com/Dexter-DAO repo list; registry.npmjs.org/@dexterai/x402

### The IETF draft, read directly

`draft-sander-open-tabs-passkey-00`. Abstract, verbatim:
> "This document specifies the passkey-rooted delegated-signer authorization model of the Open Tabs Standard (OTS), a non-custodial payment-channel scheme on Solana."

Author: Nicholas Sander (Independent). Submitted **20 June 2026**, expires **22 December 2026**.

**Status: individual Internet-Draft, not working-group adopted.** The datatracker's own boilerplate: such drafts are "not endorsed by the IETF and hold no formal standing in the standards process." Anyone can submit an individual I-D with no review gate.

The document is real and contains a real spec. But **"IETF draft" as a credibility signal is doing far more work than the process warrants** — it means "we wrote a spec and filed it," not "the IETF has standardized this." It expires in ~4 months and is authored by the team itself.

### The code

**dexter-mcp** — MCP server with two hosted endpoints (`mcp.dexter.cash/mcp` authenticated, `open.dexter.cash/mcp` public), tool bundles for x402-gated resources, wallet, Solana trading, Birdeye OHLCV, Hyperliquid copy-trading. Runnable, documented install.

**dexter-connect** — passkey sign-in SDK, `<SignInWithDexter/>`, server-side ES256 JWKS verification "at approximately 0.6ms."

**dexter-x402-sdk / @dexterai/x402** — the "tab" mechanism: one passkey gesture opens a tab, user sets a cap, the agent spends beneath it with no per-call signature, settlement on close. Cap enforcement is stated to be **on-chain**, via Solana program `Hg3wRaydFtJhYrdvYrKECacpJYDsC9Px7yKmpncj2fhc`:
> "The bill stops dead the moment it reaches the cap... Swipe → meter → reserve → settle, enforced on Solana mainnet."

**dexter-mainnet-proofs** — 4 JSON receipt files with SHA-256 hashes tied to specific commits/runs, against that program address. Refreshingly self-limiting:
> "These receipts are evidence of the named runs, not a security audit, a warranty, or a claim that every historical interface remains current."

⚠️ Important framing: these prove **specific test/demo transactions exist on mainnet**. There is no aggregate tx count, dollar volume, or user count anywhere. This is not a usage metric.

### ⚠️ An anomaly worth flagging

The npm registry (fetched via proxy) reported `@dexterai/x402` v1.0.0 published **December 26 2024** — which **predates Coinbase's x402 protocol whitepaper (May 6 2025) by five months**. That is not physically possible for an x402 SDK. Either the fetch mis-parsed the registry JSON, the package was republished under an existing scope, or the date is wrong. Do not repeat this date as fact without re-checking via `npm view @dexterai/x402 time --json`.

Also unverified: "eleven chains, zero fees" (homepage) against actual deployments beyond the one Solana program found.

### Verdict

Technically substantive and not vaporware — working MCP server, passkey SDK, an on-chain program, mainnet proof receipts with real tx hashes. The "IETF standard" framing is a credibility prop.

---

## Clude

**Sources read:** raw.githubusercontent.com/sebbsssss/clude/main/README.md; clude.io/benchmark (via r.jina.ai; direct fetch 403); x.com/sebbsssss

### The org is one person

The actual repo is **github.com/sebbsssss/clude** — a **single-developer** project. There is no `cludeproject` or `clude-labs` GitHub org; both searches came up empty. The "Clude Labs" brand sits on top of one person's repo.

### What the README specifies

> "1.96% hallucination on HaluMem — next best system: 15.2%"

Architecture: typed memory with differential decay (episodic 7%/day, semantic 2%/day, procedural 3%/day, self-model 1%/day), "dream cycles" (consolidation/reflection/contradiction resolution), a Hebbian-reinforced bond graph, "Clinamen lateral retrieval." MIT-licensed, SQLite local-first or hosted via `npx @clude/sdk setup`. 8 MCP tools.

Credit where due — the README **explicitly lists what is not built**: framework integrations (LangGraph, CrewAI), structured business data, temporal fact validity, and enterprise platforms.

### ⚠️ The headline stat doesn't match their own benchmark page

The "81.3% retrieval quality" figure I reported earlier **appears nowhere in any primary Clude source.** It comes from a third-party promo tweet, as do "1.3M+ memories stored" and "600+ agents integrated" — neither of which appears in the README or benchmark page.

What `clude.io/benchmark` actually reports: **"Recall quality" 67.7/100**, **"Overall" 83.9/100** across "eight test suites... 20,000+ memories," plus a proprietary LoCoMo re-implementation scoring Clude 100% vs Mem0 66.9%, Zep 75.1%, OpenAI 52.9%. A search surfaced yet another number — "86% on LongMemEval" — on a third-party MCP directory.

To their credit, the page carries its own caveat:
> "We built Clude. We tried to be fair, but we're biased."

**Four different headline numbers across four channels (67.7 / 83.9 / 81.3 / 86) is itself the finding.** The public-facing stat shifts by venue.

The "tokenized memory standard" is not locatable as a standalone spec. The closest primary claim is memories "hashed and registered on-chain via a custom Anchor program" — with no program address, IDL, or explorer link to substantiate it.

### Verdict

A real single-developer memory engine with a genuine, self-graded benchmark suite and unusually honest not-yet-built disclosure. But it is marketed with an unverifiable headline stat that its own benchmark page contradicts, and "Clude Labs / 600+ agents" overstates a one-person open-source repo.

---

## SolScanner

**Sources read:** solscanner.app/, /about, /docs, /pricing, /blog/introducing-solscanner

### The methodology, quoted in full

This is the entire documented description of their core differentiator:
> "Group wallets by timing, shared funding, setup, and trading overlap"

> "detects bundled wallets that co-buy the same tokens in the same blocks"

That is a one-line heuristic, not a documented algorithm. **No threshold values** (what time window counts as a "same block co-buy"? what counts as "shared funding" — same immediate funder, or N hops?), **no clustering method named**, no similarity score or confidence formula, **no false-positive rate**. "Bundled-wallet detection" sounds like a specific algorithm; what is published is "we look at timing, funding, and co-buys."

### Pricing — real and specific

Starter $30/mo → 120 credits ($0.25/credit); Professional $60/mo → 260 credits ($0.23); Enterprise $120/mo → 560 credits ($0.21). One-time packs $18.75/60, $37.50/130, $75/275. Free tier:
> "30 credits/month included with every account... Full scan features... No expiry"

with up to 600/mo extra for holding $SCAN.

⚠️ **What a credit actually buys is undefined anywhere.** Pricing lists credit quantities and $/credit but never the credit-to-action exchange rate.

### The API is not public

`/docs` (embed API) states:
> "Contact payments@solscanner.app to get your API key and whitelist your domains."

No self-serve issuance, no public endpoint list, no request/response schema, no rate limits. The "API reference" does not exist as a public artifact.

### The counters

"125K+ Wallets Scanned," "2.8M+ Connections Mapped," "1.1K+ KOL Wallets," "12K+ Bundled Wallets Found" — self-reported platform counters with no snapshot date, dataset link, or verification path. Evidentiary weight equivalent to a SaaS "users served" badge.

### Verdict

A real paid product with genuine pricing infrastructure. But the methodology behind its differentiator is marketing prose rather than a published heuristic, its API is gated behind an email, and its headline numbers are unauditable.

---

## Batch verdict

| | Real code/product? | Flagship claim survives scrutiny? |
|---|---|---|
| Dexter | ✔ substantial | ✖ "IETF standard" = unreviewed individual draft |
| Clude | ✔ one-dev repo | ✖ 81.3% appears in no primary source |
| SolScanner | ✔ paid product | ✖ methodology is one sentence |

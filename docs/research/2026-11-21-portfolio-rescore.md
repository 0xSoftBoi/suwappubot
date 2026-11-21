# Addendum: Portfolio Swarm Rescore After Code Audit (2026-11-21)

*This rescore was read-only. It responds to `/home/user/suwappubot/docs/research/2026-11-21-portfolio-swarm.md` §1-2. Repos audited are under `/home/user/ext/` and `/home/user/dial-sdk`. I spot-checked the main operator claims myself: `src/lib/env.ts:100` mainnet gate, `src/app/terms/page.tsx:62` "This is custodial", and 0 `@dial/` deps in `text-my-crypto/package.json`.*

## 1. What changed

The swarm concluded "nothing survived; probe @dial/supervisor." That rested on three claims that are now false: there is no PSTN, the PQ work is a stub, and #17 has no code. The Dial.Work org already runs a live US SMS payment agent, and that agent includes the piece the swarm said was missing: an agent starts a payment over MCP and a human approves it from any phone. The verdicts improve, but no idea passes on distribution. The binding constraint is still zero non-team users, so the recommendation changes from "probe a package" to "test the live line with strangers."

## 2. Revised leaderboard rows

| # | Idea | Old verdict (Sum/Kill) | New verdict | Sz/Fit/Spd/Dist/Def/Solo | Sum | Kill | Evidence |
|---|---|---|---|---|---|---|---|
| 7 | Chat wallet (re-scoped: US SMS → Solana USDC) | kill (10/0.95) | **pursue** | 4/4/3/2/2/2 | 17 | 0.80 | `ext/text-my-crypto/src/lib/sms/webhook.ts`, `operator/grammar.ts`, `intents.ts`, `settlement/registry.ts:128`, `solana/programs/dial_escrow/src/lib.rs:73-96`, `env.ts:100` |
| 1 | Agent phone network | kill (12/0.90) | combine_only | 3/4/3/1/1/3 | 15 | 0.80 | `text-my-crypto/src/lib/agents/{mcp,tools,keys}.ts`, `sms/payphone.ts`, `bot/machine/classify.ts:23-24` |
| 12 | Post-quantum migration | kill (9/0.95) | combine_only (audits + grants under #15) | 3/3/2/1/2/2 | 13 | 0.80 | `ext/suwappu-lattice-protocol/src/ltp/primitives.py` (3844 tests passed), `ext/meridian` (40/40), `ext/palisade` (111/111), `ext/evmsec/PQ_MIGRATION_AUDIT.md` |
| 11 | Security for agents (inverted: tools *for* agents) | kill (11/0.95) | combine_only | 4/3/2/1/1/2 | 13 | 0.88 | `ext/evmsec/src/mcp.ts`; AEGIS is third-party (`suwappubot/requirements.in:48`, `bot/services/aegis_service.py`) |
| 3 | Private AI you text | kill (12/0.90) | combine_only | 2/3/3/2/1/3 | 14 | 0.85 | `dial-sdk/crates/dial-autonomous-agent/`; operator uses cloud LLMs (`text-my-crypto/src/lib/env.ts:79-81`) |
| new | evmsec Watchtower (bridge solvency monitor) | unscored | park | 2/4/4/2/2/4 | 18 | 0.80 | `ext/evmsec/.github/workflows/bridge-status.yml`, `STATUS.history.jsonl` (312 snapshots), `docs/watchtower.md` |
| 17 | AI materials discovery | kill (9/0.97) | park | 4/2/1/1/2/2 | 12 | 0.92 | `ext/active-materials-discovery/README.md:100-140`, `paper/ERRATA.md` |
| 18 | VoltForge (GaN/SiC converter design) | new | park | 3/1/3/2/1/3 | 13 | 0.87 | `ext/GaN-optimization-/src/lib/*` (40 test files), `TECHPLAN.md:51-81`, `GOAL.md:108-111` |
| 10 | AI auditor for bounties | kill (8/0.93) | kill | 2/2/2/1/1/2 | 10 | 0.90 | `ext/smart-contract-audit-framework` (regex scanner), `ext/smart-contract-auditor` (Slither wrapper, 0 tests, no LLM) |

Watchtower has the highest Sum, but that comes from speed and solo-feasibility, not demand. Sum ignores buyers, which is the same caveat the swarm noted in its §8. #7 ranks first on substance because it is the only asset that already carries live traffic, even though that traffic is internal.

## 3. Biggest surprises

- **There already is a working phone channel.** The operator line +1 806 302 1661 runs SMS through Payphone. Agents get an MCP server at `/api/mcp`. Every spend needs an SMS code or passkey, with caps of $50 per transaction and $200 per day. People who have not signed up yet are covered by the escrow, which has claim links and permissionless refunds. Mainnet is one flag away (`env.ts:100`). However, it shares no code with dial-sdk, so the portfolio's two "Dial" assets are disconnected.
- **evmsec is the most finished software in the portfolio.** It has 13.7k LOC and about 266 tests, plus an MCP server, a GitHub Action and a hosted API. It has tracked about $2.4B of bridge collateral since July. It was never published to npm, and the swarm never scored it.
- **The PQ cryptography is real.** It uses PQClean ML-KEM/ML-DSA, refuses to run without those real backends, and about 3.8k Python tests pass. There are Lean proofs (54 theorems, 2 `sorry`), and the repos come with working papers aimed at Basel and CNSA 2.0. The swarm's "stub" call was wrong.
- **None of the stacks is private.** The operator sends every inbound SMS to Claude Haiku or Workers AI Llama, and hermes' memory calls Groq by default (`hermes-agents/memory.py:1-10`).
- **The founder's best evidence of technical depth is outside crypto.** amdisco publishes its own erratum of a negative result, and VoltForge is 21k lines of tested TypeScript.

## 4. Revised recommendation

**Yes: Dial operator is a better wedge than the supervisor probe.** The supervisor probe tests whether people want a package that hasn't shipped, and it sits behind an invite-gated app. The operator is already live, reachable by SMS from any phone, and needs no app or invite. That removes the invite-gate dependency that killed the swarm's [2,16] and [1,2] combinations. Its traffic so far is team-only: 42 payments and $70.69 on devnet, nearly all sent by @amm and @jmw. So demand is still unproven, but the test now costs posting a phone number instead of building anything.

**Combined thesis: "an agent asks, a human approves by text, and the money settles."**
- **Operator (channel and settlement).** Its MCP-initiated payment plus SMS or passkey approval is supervisor approval with real stakes.
- **Supervisor (developer entry point).** Re-point `dial-sdk/packages/dial-supervisor` so it can fall back to the operator's SMS approval for people without the Dial app. This removes its invite gate.
- **Dial identity (later).** Map a BIP-39 Dial identity to a phone number so E2EE +008 becomes an upgrade path, not a prerequisite. Add evmsec-mcp as a pre-trade check ("is this token mintable by an EOA?") inside the approval card.

**Conditions that still apply:**
- Stay on devnet or within the caps until the operator is non-custodial (passkey as signer via a secp256r1 smart account) and has a lawyer's opinion. The current setup is custodial with one AES-GCM env key (`src/lib/secretbox.ts`) and has no OFAC screening. That is the fatal flaw if it goes to mainnet as-is.
- Confirm that Payphone's 10DLC campaign allows financial or crypto content.
- Keep Suwappu frozen. Run PQ, Watchtower, amdisco and VoltForge at zero marginal effort, at most as one credibility post each.

## 5. 30-day killer test (operator + supervisor approval)

- **Days 0-3:** Change no infrastructure. Seed one dense USDC-holding community, such as Colosseum or hackathon teams or Seeker owners, using the existing split and claim-link features (`src/lib/bot/split.ts`). Separately, post a 60-second demo: a Claude Code agent asks for a $5 devnet payment over MCP, and a phone approves it by SMS.
- **Day 14 (Gate A):** At least 30 senders who are not @amm or @jmw, each transacting at least twice. Recipients who claim through links don't count toward the 30.
- **Day 30 (Gate B):** At least 15 stranger senders active in days 15-30, at least 5 agent-initiated approvals from strangers' agents, and claim-link conversion of at least 30%.
- **Kill:** Missing Gate A means the SMS-payments wedge is dead. Fall back to the swarm's supervisor probe, which can now reuse the operator's SMS approval. Gate A passing but zero agent-initiated approvals means it is a consumer P2P app, and it should be judged on money-transmission risk alone.
- **Ignore:** Dollar volume, because it is devnet, and team traffic.

## 6. Still unverified

- **Private repos:** quantdesk (#14), GhostCatcher and cargocredit were not cloned. #14 stays at kill (9/0.93) on the swarm's evidence alone. GhostCatcher and cargocredit are unscored, and I have no evidence either way.
- **Operator:** Its team size and pace are unknown, because the git history is a single commit by Jeremy Meyer on 2026-11-13. It is also unclear whether the founder controls dialoperator.cc and the Payphone account. The 10DLC content policy, the escrow audit status and the mainnet escrow deployment (absent from `registry.ts:122-132`) are all unconfirmed.
- **Other repos:** suwappu-dag's ~844 tests and suwappu-revm's 118 tests were not run, and the devnet.suwappu.bot URLs were not checked live. Whether the matgl PR #800 merged is unknown. VoltForge's tests were not run because node_modules is absent. GitHub stars and usage for evmsec could not be checked because the API is blocked.
- **Market claims:** Incumbents and pricing (Hypernative, Frenetic, PQ audit rates of $10-50K) come from memory and were not searched this session.

---

# Code audits

```json
[
 {
  "cluster": "dial-operator",
  "rescored": [
   {
    "idea": "#7 Chat wallet for next billion",
    "old_verdict": "kill",
    "new_verdict": "pursue",
    "size": 4,
    "fit": 4,
    "speed": 3,
    "distribution": 2,
    "defensibility": 2,
    "solo": 2,
    "kill_probability": 0.8,
    "evidence": "The product exists and is not vaporware. It runs on Next 16 on CF Workers, with an inbound SMS webhook that queues before it replies (src/lib/sms/webhook.ts, worker.ts). A deterministic grammar runs first and the LLM only as fallback (src/lib/operator/grammar.ts, brain.ts uses Workers AI with zod output and never sees addresses). Intents are hash-bound and flip once (src/lib/intents.ts). There are 7 settlement adapters (src/lib/settlement/*). An Anchor escrow handles claim links: the attestor signs claims before expiry, and anyone can trigger a permissionless refund after it (solana/programs/dial_escrow/src/lib.rs:5-10,73-96). The repo has 123 test files, including property tests (tests/property/*), and CI runs typecheck, lint and test (.github/workflows/ci.yml). Mainnet is only a flag: NETWORK=mainnet plus ALLOW_MAINNET=yes (src/lib/env.ts:100), with the real USDC mint in src/lib/settlement/registry.ts:128. The 'next billion' framing is wrong, though. This is US SMS with Solana USDC, not WhatsApp/UPI/Pix, so the swarm's fatal flaw doesn't apply.",
    "fatal_flaw": "Custodial server-held keys on mainnet mean unlicensed money transmission exposure"
   },
   {
    "idea": "#1 Agent phone network",
    "old_verdict": "kill",
    "new_verdict": "combine_only",
    "size": 3,
    "fit": 4,
    "speed": 3,
    "distribution": 1,
    "defensibility": 1,
    "solo": 3,
    "kill_probability": 0.8,
    "evidence": "The swarm's 'no PSTN' is wrong for the org, but right for the Dial SDK. A real A2P SMS line (+1 806 302 1661) runs through Payphone.wtf (src/lib/sms/payphone.ts), and the code handles STOP/START (src/lib/bot/machine/classify.ts:23-24). An MCP server at /api/mcp lets agents start payments that a human approves by SMS code or passkey (src/lib/agents/mcp.ts, tools.ts, keys.ts; SPEC.md flow 5). That pattern is human-in-the-loop approval reaching any phone, which is exactly the invite-gate bypass the [2,16] combination lacked. However, package.json has no @dial/* dependency, so none of this runs on Dial SDK E2EE or +0 numbers. It is SMS only, with no voice/SIP.",
    "fatal_flaw": "PSTN reach is Payphone SMS, not Dial; no voice, no proven demand"
   }
  ],
  "maturity_notes": "Production readiness: high-quality hackathon code. Its own spec says it was built for Colosseum, with mainnet, KYC and on/off-ramp as explicit non-goals (SPEC.md Non-goals). It currently runs on devnet only, and the $70.69 / 42 payments are internal team traffic, not users.\nCustody: one AES-GCM env key encrypts all the server-held keys (src/lib/secretbox.ts; spec section on Chains). The Terms say plainly 'This is custodial' (src/app/terms/page.tsx ~L62).\nCompliance: grepping src/, docs/ and the README for KYC/OFAC/sanctions/MSB/FinCEN finds nothing. There is no address screening.\nEscrow: deployed on devnet only, with one upgrade-authority key (solana/README.md:12,17). The mainnet registry entry has no escrowProgram (registry.ts:122-132). Its build is reproducible but not solana-verify'd, and it has not been audited.\nProtections: an SMS code or passkey on every spend, with caps of $50/tx and $200/day.\nLicense: AGPL-3.0 dual-licensed with a Dial.Work commercial license, plus a contributor CLA (LICENSING.md). That's fine for a hosted service, and the CLA keeps relicensing open.\nGit history is shallow (1 commit visible, by Jeremy Meyer, 2026-11-13), so team size and velocity can't be seen from git.\n\nTo reach mainnet plus 100 real weekly users (about 6-10 weeks, roughly $5-10K):\n(1) Move to non-custodial. Make the passkey the actual signer, for example a Solana secp256r1 smart account (Squads) or a Turnkey/Privy-style setup where the user's passkey authorizes, so Dial never holds keys. That moves Dial toward the FinCEN unhosted-wallet carve-out. Then get a written opinion from a crypto lawyer ($3-5K).\n(2) Add OFAC address screening and keep low caps.\n(3) Deploy dial_escrow to mainnet with a multisig upgrade authority and an external review.\n(4) Confirm that Payphone's upstream carrier and 10DLC campaign allow crypto/financial content; carriers restrict this category.\n(5) Pre-fund the treasury for SOL fees and ATA rent (about 0.002 SOL per new recipient).\n(6) Distribution is the real gate. Seed one dense community that already holds USDC and splits costs (hackathon/Colosseum teams, Seeker owners), using the existing split and claim-link features (src/lib/bot/split.ts). A claim-link loop at K\u22650.3 needs about 300 activated senders to sustain 100 WAU.\nCheapest falsifier first: before any mainnet work, get 30 senders who are not @amm/@jmw to transact twice in 14 days, even on devnet.",
  "biggest_surprise": "The swarm killed every Dial idea for having 'no PSTN' and an invite gate. Meanwhile the Dial.Work org already runs a live US phone number. On it, an agent can start a payment over MCP and a human approves it from any phone by SMS, with a real on-chain escrow for people who aren't signed up yet. That is a working version of the supervisor wedge's missing piece. Yet it shares no code with dial-sdk (no @dial/* dependency), so the portfolio's two 'Dial' assets are disconnected."
 },
 {
  "cluster": "pq-stack",
  "rescored": [
   {
    "idea": "#12 Post-quantum migration",
    "old_verdict": "kill (sum 9, kill_prob 0.95; 'Suwappu PQ settlement is a disabled doc plus a stub, repos unseen')",
    "new_verdict": "combine_only",
    "size": 3,
    "fit": 3,
    "speed": 2,
    "distribution": 1,
    "defensibility": 2,
    "solo": 2,
    "kill_probability": 0.8,
    "evidence": "The PQ cryptography is real. The prior swarm's 'stub' claim does not hold for /home/user/ext. (1) suwappu-lattice-protocol is about 131k LOC. src/ltp/primitives.py binds ML-KEM-768/1024 and ML-DSA-65/87 through pqcrypto (PQClean). assert_real_crypto() refuses to run without those backends ('Production crypto backends missing'), so it fails closed and does not fall back to fake crypto. With pqcrypto<0.5 plus test deps installed, the suite ran 3844 passed, 79 failed, 25 errors, 222 skipped. The failures cluster in BLS and dependency-gated tests such as tests/test_consensus_bls_certs.py. formal/lean has 54 theorems and 2 sorry. docs/DEPLOYED_CONTRACTS.md lists proxy and implementation addresses on its own 'SUWAPPU Testnet' (chain 103115120). (2) suwappu-dag is about 50k LOC of Rust in 20 crates, including suwappu-mldsa-precompile and suwappu-crypto on pqcrypto-mldsa and pqcrypto-mlkem, with about 844 #[test] annotations (not run here). DEVNET.md advertises explorer and faucet URLs at devnet.suwappu.bot (not checked live). (3) meridian: cargo test gives 40/40 passing, with real ML-DSA-65 quorum finality certificates. It is the reference implementation for the working paper 'MERIDIAN ... Clause-Level Analysis under the Basel Cryptoasset Standard' v0.3. (4) palisade: 111/111 tests pass. It is a hash-based accountable log: signatures.py is a genuine Lamport-OTS many-time signer and production targets LMS/HSS and SLH-DSA. Its README pitches directly at NIST IR 8547 and the CNSA 2.0 1 Jan 2027 acquisition cutoff for provenance and supply-chain ledgers. (5) turnstile: 19/19 tests pass with PyNaCl. It is an Ed25519 prototype of a pod-based payment profile (arxiv 2501.14931) and is not PQ. (6) suwappu-revm is a monad-revm fork that adds an ML-DSA-65 verify precompile (118 tests, not run). (7) evmsec/PQ_MIGRATION_AUDIT.md is a concrete, honest paid-audit methodology: a 6-dimension rubric, a severity scale, the evmsec pq-readiness bytecode triage with stated over- and under-flag limits, and remediation through EIP-8051 ML-DSA verifiers. It is already framed as a Zero 1 Labs paid engagement. That is the only directly sellable artifact in the cluster. Caveats: every repo is a single squashed commit, and palisade, meridian and turnstile are timestamped within seconds of each other on 2026-07-03, so there is no visible development history or external contributors. No external audit, no published paper venue or eprint ID was found, no users, and Dial (/home/user/dial-sdk) still has zero PQ code.",
    "fatal_flaw": "Buyers of PQ migration (federal/CNSA 2.0 vendors, banks under Basel, bridges with real TVL) buy through procurement, audits and track record. A $0 solo founder with no audience, no external crypto review and no published venue cannot clear that bar, and these protocols' value is bottlenecked on adoption that a new L1/settlement chain will not get. The code is a credible portfolio, not a product with a customer. Revenue comes only if it is repackaged as PQ-readiness audits (evmsec methodology) and grant applications, and both depend on distribution the founder lacks."
   }
  ],
  "maturity_notes": "Ranked by what the code proves. 1) suwappu-lattice-protocol: most mature. Real pqcrypto ML-KEM/ML-DSA, fails closed without them, about 3.8k passing tests, Lean 4 proofs (54 theorems, 2 sorry), testnet contract addresses. The README's '4,033 passing' badge is roughly right but dependency-sensitive. 2) suwappu-dag: large Rust BFT/DAG node with an ML-DSA precompile and about 844 tests (not executed; devnet URLs unverified live). 3) meridian: small and clean. 40/40 cargo tests pass with ML-DSA-65 finality certificates. Paired with a working paper (v0.3) whose Basel cryptoasset clause analysis is the most novel and fundable angle. 4) palisade: 111/111 tests pass. Hash-based (Lamport-OTS now, LMS/SLH-DSA targeted) provenance log aimed squarely at CNSA 2.0 Jan 2027 and NIST IR 8547 2030/2035. Assumption-minimal design, a defensible research niche. 5) turnstile: 19/19 tests pass, but it is Ed25519, not PQ: an agent-commerce payment profile on pod. 6) suwappu-revm: monad-revm fork plus an ML-DSA precompile (tests not run). 7) evmsec PQ audit doc: methodology, not code. It is the clearest monetization path, consulting at roughly $10-50k per engagement (UNVERIFIED pricing). Placeholders: no fake signatures found in the PQ paths. 'placeholder' hits in suwappu-dag are comments about replaced placeholders. Who funds it: Ethereum Foundation PQ / ESP grants, NLnet/NGI, NSF SBIR Phase I (PQ provenance via palisade), possibly DIU/CNSA-adjacent supply-chain pilots. Bridges and RWA issuers are the most plausible audit customers. Putting the papers on IACR eprint/arXiv is a near-free credibility step that has not been taken.",
  "biggest_surprise": "The prior swarm called Suwappu PQ settlement 'a doc marked experimental plus a default-off stub'. In fact the external repos hold real, tested PQ cryptography: about 3.8k passing Python tests on PQClean ML-KEM/ML-DSA with a fail-closed guard, 40/40 Rust ML-DSA finality-certificate tests, and 111/111 hash-based log tests. Three of the repos are working-paper artifacts aimed at Basel and CNSA 2.0, plus a ready-made paid PQ-readiness audit methodology. The technical asset is far stronger than scored. The gap is entirely distribution, external review and buyers, which is why the verdict rises from kill to combine_only (PQ-readiness audits plus grants as a service line under #15) rather than pursue."
 },
 {
  "cluster": "security-tools",
  "rescored": [
   {
    "idea": "#10 AI auditor hunting bounties",
    "old_verdict": "kill",
    "new_verdict": "kill",
    "size": 2,
    "fit": 2,
    "speed": 2,
    "distribution": 1,
    "defensibility": 1,
    "solo": 2,
    "kill_probability": 0.9,
    "evidence": "No AI auditor exists in the code. /home/user/ext/smart-contract-audit-framework (scaudit) is a regex/heuristic Solidity scanner: 2,069 LOC Python, detectors limited to src/scaudit/detectors/{security,gas}.py, 46 tests in tests/test_detectors.py, and its README says it is 'not a substitute for Slither'. /home/user/ext/smart-contract-auditor is 848 LOC: a Slither wrapper with regex fallback (smart_contract_auditor/analyzer.py), zero tests, no LLM calls (grep for openai/anthropic/llm/immunefi finds nothing), one commit, 2026-04. Fit goes from 1 to 2 only because evmsec's on-chain trust-surface checks (mint-authority, pause-guardian, upgradeability, admin-power in /home/user/ext/evmsec/src/commands) suit misconfiguration-class findings.",
    "fatal_flaw": "Both auditor repos are a weaker version of Slither/Aderyn, with no LLM layer and no record of found bugs. Bounty income is lumpy and delayed, and platform AI scanners plus hosted AI auditors find the shallow bugs first. This is a portfolio piece, not a business."
   },
   {
    "idea": "#11 Security for agents",
    "old_verdict": "kill",
    "new_verdict": "combine_only",
    "size": 4,
    "fit": 3,
    "speed": 2,
    "distribution": 1,
    "defensibility": 1,
    "solo": 2,
    "kill_probability": 0.88,
    "evidence": "AEGIS in suwappubot is a third-party package, not owned IP. requirements.in:48 pins gaiarobotics/aegis@e3e87b3. bot/services/aegis_service.py (352 LOC) is a fail-open, observe-only wrapper. Trust scoring lives in bot/services/aegis_trust.py, a custom signature pack in bot/config/aegis_signatures/crypto.yaml, and there are 43 tests (tests/test_aegis_service.py, tests/test_aegis_trust.py). It is wired into api/main.py:2503 and :2785 and bot/main.py:397, but it never blocks anything. The owned asset that changes the picture is evmsec-mcp (/home/user/ext/evmsec/src/mcp.ts, package.json bin): agents can call it to ask whether a token can be minted by an EOA, whether a contract is upgradeable by one key, or whether a bridge is backed.",
    "fatal_flaw": "Selling 'security OF agents' (prompt-injection firewalls) means reselling someone else's 4-star, early-stage library into a crowded market whose buyers won't trust a solo vendor. The defensible version is the reverse, 'security tools FOR agents': evmsec checks as a pre-trade gate inside @dial/supervisor or Suwappu. That only has value attached to a channel, so it is combine-only."
   },
   {
    "idea": "NEW: evmsec Watchtower: continuous bridge/wrapped-asset solvency monitor",
    "old_verdict": "UNVERIFIED (not scored)",
    "new_verdict": "park",
    "size": 2,
    "fit": 4,
    "speed": 4,
    "distribution": 2,
    "defensibility": 2,
    "solo": 4,
    "kill_probability": 0.8,
    "evidence": "This is the most mature code in the portfolio. /home/user/ext/evmsec: 13.7k LOC TypeScript, 28 test files and about 266 test cases, 17 commands in src/commands, an MCP server, a GitHub Action (action.yml), Docker, an SBOM workflow, and OpenSSF Scorecard. It also has a Vercel API (api/status, history, alerts, watches, exposure .mjs) and an embedded server (src/serve: monitor, storage, exposure, UI). It is actually running. .github/workflows/bridge-status.yml runs every 6 hours, STATUS.history.jsonl holds 312 snapshots from 2026-07-01 to 2026-11-19, and STATUS.md shows 11/11 routes backed, about $2.38B tracked, priced via Chainlink. docs/watchtower.md fully specifies a hosted multi-tenant SaaS. It is not published: `npm view evmsec` returns 404 even though the README's install section leads with npx.",
    "fatal_flaw": "The routes it tracks are canonical rollup and Polygon PoS escrows, which are 100% backed by construction. So the monitor only ever reports green until an exploit, and an exploit drains funds faster than a 6-hour poll can catch it. Buyers (bridge teams, lender risk curators, exchanges) already pay Hypernative, Hexagate, Chainlink Proof of Reserve, or Chaos Labs, and L2BEAT and DefiLlama already show escrow balances for free. Few buyers, long enterprise sales, and a solo vendor with no audience."
   }
  ],
  "maturity_notes": "Maturity ranking, from what the code proves: evmsec is far ahead of everything else. AEGIS integration (a wrapper around third-party code, observe-only) is second, then scaudit, then smart-contract-auditor.\n\n- **evmsec** (/home/user/ext/evmsec) is production-grade OSS: a full CLI, MCP server, CI Action, hosted API, a self-hosted dashboard, and a 5-month continuous monitoring record. The git clone shows one commit, so the history is squashed and development pace can't be checked from git. Biggest gaps: it is not on npm despite the README, and it has no stars or users that I could verify (the GitHub API is blocked in this session).\n- **scaudit** (/home/user/ext/smart-contract-audit-framework) is a tidy, honest heuristic scanner: 2k LOC, 46 tests, no dependencies. It is clearly behind Slither and Aderyn.\n- **smart-contract-auditor** (/home/user/ext/smart-contract-auditor) is an 848-LOC Slither wrapper with no tests. Treat it as a toy.\n- **AEGIS in Suwappu** is careful engineering: fail-open, quorum-gated scam reports (aegis_service.py:31-40), and 43 tests. But the IP belongs to gaiarobotics, and docs/plans/aegis-fork-extend.md says the fork hasn't been made yet.\n\nNeither audit repo has an LLM component. \"AI auditor\" is not supported by any code.\n\nIs evmsec's bridge-backing monitor a product? Technically, almost: docs/watchtower.md has the SaaS design and src/serve is the embedded version. Commercially, no. The canonical routes it watches can't drift without an exploit, polling every 6 hours is too slow to warn anyone, and the incumbents own the paying buyers.\n\nIts best uses:\n1. A credibility and content engine. It costs nothing to keep the cron running, and the first real breach it detects would be a newsworthy moment.\n2. A paid, agent-callable trust oracle. Expose solvency, mint-authority and upgradeability checks through evmsec-mcp, possibly charged per call via x402, as a pre-trade gate inside @dial/supervisor or Suwappu.\n3. Extending the registry to third-party multisig bridges and wrapped-asset issuers (Multichain-style risk). Shortfalls actually happen there, so that is where the monitor would carry real information.\n\nCheapest next step: cut a v0.1.0 tag so the release workflow publishes to npm (about 1 hour). No product investment beyond that until there's a user.",
  "biggest_surprise": "evmsec is not a stub. It is the most finished, most tested piece of software in the whole portfolio: 13.7k LOC, about 266 tests, an MCP server, a GitHub Action, a hosted API, and a dashboard. It has been monitoring $2.4B of bridge collateral every 6 hours since July 2026, with 312 snapshots. Yet it was never published to npm, and the prior swarm didn't score it at all. The founder's strongest work is the most polished, yet it sits in the category with the fewest buyers."
 },
 {
  "cluster": "local-agents",
  "rescored": [
   {
    "idea": "#3 Private AI you text",
    "old_verdict": "kill",
    "new_verdict": "combine_only",
    "size": 2,
    "fit": 3,
    "speed": 3,
    "distribution": 2,
    "defensibility": 1,
    "solo": 3,
    "kill_probability": 0.85,
    "evidence": "The code is further along than the swarm credited, but the parts are separate. (1) /home/user/dial-sdk/crates/dial-autonomous-agent: about 3.7k LOC of Rust (brain.rs, daemon.rs, memory.rs, model.rs, link.rs), with tests in brain_tests.rs, memory_tests.rs and tests/daemon.rs. It is a real resident persona daemon. It wakes on message, call, heartbeat or a scheduled reminder, and it has journaled, idempotent send_message slots, so a retry sends once. It talks to any OpenAI-format local model (Ollama, vLLM, llama.cpp). Per docs/agents/dial-autonomous-agent.md lines 64-75, its tools are only send_message, remember, set_reminder, sleep and update_call: 'no shell, file or web tool' because anyone who knows the number can text it. It lives on a +008 Dial number, not the PSTN. (2) /home/user/ext/hermes-agents: a well-built single-user Mac CLI. agent.py is 1660 LOC with Ollama qwen3:4b, Groq and MLX LoRA backends, a sandbox-exec run_bash, OTel tracing and 70 tests. Its only daemon is a Unix socket at /tmp/hermes.sock fed by a zsh hook (README 'Daemon + shell integration'). It has no messaging channel. The repo is a single commit (git rev-list = 1, 2026-05-14). Its privacy is partial: memory.py lines 1-10 use Groq Llama 70B for mem0 fact extraction by default, and the README says to use Groq for quality. Qwen3:4b takes about 2-3 min per tool turn on the 8GB M2. (3) Dial operator (/home/user/ext/text-my-crypto): a live SMS front end. But src/lib/env.ts:79-81 parses intents with cloud models (DIAL_OPERATOR_MODEL=anthropic/claude-haiku-5.5, fallback Workers AI Llama-3.3-70B), and SMS goes through the Payphone provider (env.ts:23,91). No code links the operator to dial-agent +008 addresses; the only 'dial-agent' strings are key-hash prefixes in src/lib/agents/keys.ts.",
    "fatal_flaw": "'Private' and 'by text' work against each other. SMS is plaintext to the carrier and to Payphone, and the one live SMS product sends every message to Anthropic or Cloudflare models. The E2EE path (+008 dial-agent) needs the Dial app, which is invite-gated, testnet-only and has 0 users, so it has no reach. The private model (local 3-8B) is too slow and weak to beat free alternatives: OpenClaw over Signal, or a ChatGPT/Claude app. Making it useful means giving it web, file or pay tools, and the spec itself says not to hand those to anyone who can text the number. So you get a choice of two: private, reachable by SMS, or capable."
   }
  ],
  "maturity_notes": "dial-autonomous-agent is the most mature piece. It has a production-grade daemon design (serial wakes, a busy-line persona, idempotent journaled sends, first-write-wins reminders) and tests, and it runs today against local Ollama on +008 numbers. hermes-agents is solid as a personal dev tool: 70 tests, coverage stated at 85%, two evaluated LoRAs (toolcall 93% name match, audit 30% vuln-type match). But it is one commit, macOS-only (sandbox-exec, launchd), single-user, and has no inbound channel. It is a reference for local-model ergonomics, not a product. The Dial operator is the only thing with live traffic: 42 payments, devnet, mostly 2 accounts. It is a deterministic payment bot with an LLM intent parser, not a general assistant. A credible 'assistant by text' could be put together in about 1-2 weeks: point an SMS webhook (Payphone) at a dial-autonomous-agent-style daemon and reuse the operator's 6-digit confirm for payments. The result is a cloud-model SMS assistant, which is a commodity (Poke-style, plus ChatGPT's own SMS and WhatsApp lines), not a private one. The truly private variant (E2EE +008, local model) is buildable from existing code but has zero distribution.",
  "biggest_surprise": "The live SMS operator, the asset meant to give 'Private AI you text' its reach, is not private. It routes every inbound text to anthropic/claude-haiku-5.5 or Workers AI Llama-70B (text-my-crypto/src/lib/env.ts:79-81) over a third-party SMS provider. Separately, hermes' 'local' memory calls Groq by default (hermes-agents/memory.py:1-10). Neither existing stack keeps the user's messages on-device. The only path that does is dial-autonomous-agent over E2EE +008, and that is the one with no users. The upgrade from kill to combine_only rests only on the daemon code being reusable as the brain behind the operator line, not on the privacy pitch."
 },
 {
  "cluster": "science-ai",
  "rescored": [
   {
    "idea": "#17 AI materials discovery (now backed by active-materials-discovery / amdisco)",
    "old_verdict": "kill",
    "new_verdict": "park",
    "size": 4,
    "fit": 2,
    "speed": 1,
    "distribution": 1,
    "defensibility": 2,
    "solo": 2,
    "kill_probability": 0.92,
    "evidence": "The prior swarm said 'no code assets'. That is now false. /home/user/ext/active-materials-discovery has about 2.6k lines of Python across amdisco/ (surrogate.py, acquisition.py, calibration.py, strategies.py, data/, polymers/), benchmarks/ and tests/, plus a uv.lock-pinned stack (pyproject.toml lists matgl>=4.0, torch, pymatgen and matminer). README.md:100-140 reports 5-seed results on matbench_perovskites (18,928 structures): Greedy DAF 5.15\u00b10.04 and UCB(0.5) 5.17\u00b10.01 against Random 1.01. It reports a ~16.5x 'backbone-once' MC-Dropout speedup on an RTX 3080, and says the speedup is going upstream as materialyzeai/matgl#800. That PR is pinned to a fork in pyproject. Whether it has merged is UNVERIFIED. paper/ERRATA.md (dated 2026-08-08) retracts the manuscript's 'well-calibrated foundation model' reading. Its own calibration study measures Spearman corr(\u03c3,|err|) = -0.47 and 68% coverage of 0.02. This is real, honest ML research work, not scaffolding. But it is a wrapper over the open-source matgl, with a negative result on uncertainty, and nothing in it is lab-validated.",
    "fatal_flaw": "Research credibility, not a product. It wraps commodity matgl, there is no buyer, and CuspAI ($450M) and Periodic ($300M) own the space."
   },
   {
    "idea": "#18 VoltForge \u2014 'CUDA for power electronics' (GaN/SiC converter auto-design)",
    "old_verdict": "(new)",
    "new_verdict": "park",
    "size": 3,
    "fit": 1,
    "speed": 3,
    "distribution": 2,
    "defensibility": 1,
    "solo": 3,
    "kill_probability": 0.87,
    "evidence": "/home/user/ext/GaN-optimization- is a substantial build. It has about 21.4k lines of TypeScript, and 40 *.test.ts files cover every module under src/lib (loss, topology, magnetics, thermal, control, simulation, firmware, schematic, bom, compliance, optimizer, copilot, export/kicad+ltspice, workload-power). Its 7 API routes under src/app/api each have tests, and the UI pages are /design, /optimize and /components. src/lib/data/devices.ts (933 lines) has real parts such as Navitas NV61xx and EPC2059/2218/2302, and GOAL.md:61 claims at least 40. The physics is first-order textbook modelling. src/lib/loss/device.ts uses a linear Rds(on) tempco and a transition time of t\u22480.5\u00b7Qg/Ig with a fixed 1.5 A or 2 A drive. TECHPLAN.md:51-81 itself lists these as P0 defects (more than 25% systematic error) and plans power-law Rds(Tj), Qgs2/Qgd timing, and MagNet-validated iGSE. Validation is the gap. GOAL.md:108-111 leaves the 'calibration vs \u22653 measured reference designs' gate and the ngspice round-trip unchecked. GOAL.md:94 says it is not deployed. GOAL.md:120 says the copilot is a deterministic regex parser and not yet an LLM. The LCA-1 workload-power trace integration (docs/LCA1_POWER_TRACE.md) is a thoughtful hook into the AI-datacenter use case. I did not run the tests, because node_modules is absent and this pass was read-only. Market: AI datacenter power delivery (ORv3, 800 V HVDC to 48 V) is genuinely hot. But the buyers are power engineers at PSU OEMs and hyperscalers. They trust PLECS, SIMPLIS, Ansys and lab measurements, and silicon vendors give away design tools (TI WEBENCH, Infineon, Navitas, PowerEsim). There is a funded AI-magnetics player in Frenetic. My market claims are from memory, not searched this session.",
    "fatal_flaw": "Uncalibrated first-order models sold to engineers who trust only measured data. Vendors' tools are free."
   }
  ],
  "maturity_notes": "I read both repos read-only, as shallow clones (1 commit each). VoltForge (/home/user/ext/GaN-optimization-, last commit 2026-08-09) is a broad, well-structured engineering core. It is pure TypeScript with no dependencies (src/lib/MODULES.md, frozen contract in src/lib/types.ts), it covers spec to topology, loss, magnetics, thermal, firmware, BOM and compliance, and it has tests per module. Its docs are honest that the physics is not yet credible: TECHPLAN.md lays out a specific 'Definition of physics-credible' checklist (around line 195), and none of it is done. Treat its efficiency numbers as plausible-but-uncalibrated, probably \u00b1several % at the device level. That is useless for 97.5%+ ORv3 PSU decisions, where the \u00b10.5% gate in GOAL.md:49 is the right bar and has not been met. It is a strong portfolio or demo piece and maybe 1-2 weeks from a deployed free tool. Reaching a 'trusted' tool needs measured-design calibration, which a solo founder without a lab can only do against published vendor reference designs. The repo bundles ti66.pdf and wolf66.pdf, which look like starting material for this. amdisco (/home/user/ext/active-materials-discovery, last commit 2026-08-26) is legitimate research-grade ML. It has multi-seed benchmarks, a calibration-diagnostics module, an erratum that publishes its own negative result, an upstream contribution to matgl that may or may not have merged, and a CPU-only alternative-plastics side track (amdisco/polymers) with a cost model. It is mature for a solo research repo and immature as a business. It also shows the founder can do careful science, which the prior swarm's 'no credential' framing missed. Neither repo connects to Dial, Suwappu or the live Dial operator SMS payments service. Both pull focus away from them.",
  "biggest_surprise": "The prior swarm scored #17 on 'no code, no domain'. In fact both science repos are real work, not forks. VoltForge is about 21k lines of tested TypeScript and amdisco has rigorous benchmarks plus a self-published erratum. The founder's best evidence of technical depth sits outside crypto. Even so, the code-proven gap in both is external validation (measured converter designs, synthesized materials), and a solo founder with $0 cannot close it quickly. So the verdicts rise only from kill to park."
 }
]
```

# Academic literature → concrete improvements (Aug 2026)

Survey of verified academic papers with one actionable improvement each for Suwappu. Every citation below was verified against its live arXiv/DOI page at research time (Consensus quota was exhausted; sources were arXiv, Semantic Scholar, and Scholar search directly). Papers that surfaced in search but could not be independently fetched were rejected.

## Track 1 — Securing the MCP / LLM-agent tool surface

Context: our api-ts MCP server exposes 22 Zod-validated tools, including the `execute_swap` money path behind a policy gate.

| # | Paper | Venue/Year | Finding | Improvement for us |
|---|-------|-----------|---------|--------------------|
| 1 | [InjecAgent: Benchmarking Indirect Prompt Injections in Tool-Integrated LLM Agents](https://arxiv.org/abs/2403.02691) — Zhan, Liang, Ying, Kang | ACL Findings 2024 | ReAct-GPT-4 agents comply with instructions injected via tool *outputs* ~24% of the time (1,054 cases). | Treat every tool-result payload (RPC responses, quotes, on-chain lookups) as untrusted input to the calling LLM — wrap tool outputs in delimited/tagged untrusted-data blocks, especially on the swap path. |
| 2 | [Adaptive Attacks Break Defenses Against Indirect Prompt Injection](https://arxiv.org/abs/2503.00061) — Zhan, Fang, Panchal, Kang | NAACL Findings 2025 | 8 published prompt-injection defenses fall to adaptive attackers (>50% success) once the defense is known. | Red-team the policy gate with an attacker who knows its exact rules; never declare the gate "safe" from static rules alone. |
| 3 | [MCP Threat Modeling and Tool Poisoning](https://arxiv.org/abs/2603.22489) — Huang, Huang, Tran, Milani Fard | arXiv cs.CR 2026 | STRIDE/DREAD analysis: tool-poisoning via tool *metadata/descriptions* is the dominant client-side MCP risk; none of 7 tested clients validate descriptions. | Audit our 22 tool descriptions themselves as injection surface; version/pin tool definitions server-side so a description can't mutate silently post-deploy. |
| 4 | [MCPSecBench: A Systematic Security Benchmark for MCP](https://arxiv.org/abs/2508.13220) — Yang, Gao, Wu, Chen, Li, Wang | arXiv cs.CR 2025 | 17-attack-type MCP taxonomy across 4 surfaces; existing protections stop <30% of attacks; transport/session and tool-response surfaces weakest. | Run their taxonomy as a checklist against our Hono MCP server's transport/session and tool-response surfaces — not just the input-schema surface we already cover. |
| 5 | [ETDI: OAuth-Enhanced Tool Definitions for MCP](https://arxiv.org/abs/2506.01333) — Bhatt, Narajala, Habler | arXiv cs.CR 2025 | Signed, versioned, immutable tool definitions + policy-scoped capabilities stop tool-squatting/rug-pull. | Hash/version-check the `execute_swap` tool definition at call time in the policy gate so a compromised deploy can't swap in a looser schema. |
| 6 | [SoK: Security of Autonomous LLM Agents in Agentic Commerce](https://arxiv.org/abs/2604.15367) — Mao, Wang, Liu, Zhu, Ma, Yan | arXiv cs.CR 2026 | 12 cross-layer attack vectors; most real losses occur at the transaction-authorization layer. | Map our policy gate onto their authorization checklist: spend limits, replay protection, session-bound intent, human-in-the-loop thresholds — document which we cover and which we don't. |
| 7 | [Schema-First Tool APIs for LLM Agents](https://arxiv.org/abs/2603.13404) — Sigdel, Baral | arXiv cs.SE 2026 | Strict JSON-Schema interfaces cut *interface* misuse but not *semantic* misuse (well-formed but wrong/harmful calls). | Load-bearing for us: Zod passing ≠ safe. The policy gate, not the schema, is the real safety boundary on `execute_swap` — invest hardening effort there. |

**Track-1 headline gap**: our Zod validation is syntactic only. The literature's two verified gaps for a server like ours are (a) no output-side sanitization/provenance tagging on tool results, and (b) no adaptive-attack testing of the policy gate.

## Track 3 — Supply chain, secret leakage, and audit readiness

Context: multi-service open-source repo (Python + TypeScript) with SBOMs, pip-audit/bun audit, and a documented dependency-exception process, preparing for an external audit.

| # | Paper | Venue/Year | Finding | Improvement for us |
|---|-------|-----------|---------|--------------------|
| 1 | [Taxonomy of Attacks on OSS Supply Chains](https://arxiv.org/abs/2204.04008) — Ladisa, Plate, Martinez, Barais | IEEE S&P 2023 | ~107 real-world OSS supply-chain attack techniques systematized into a reusable attack tree. | Map our CI/CD (audits, SBOM, Railway deploy) onto the taxonomy to find wholly uncovered classes (build compromise, maintainer account takeover). |
| 2 | [A Reality Check on SBOM-based Vulnerability Management](https://arxiv.org/abs/2511.20313) — Zhou, Dacier, Konstantinou | arXiv 2025 | SBOM-driven scanners hit a 92% false-positive rate (mostly unreachable code); reachability analysis prunes ~62%. | Pre-triage pip-audit/bun-audit output with reachability evidence (as `dependency-exceptions.md` already does for ecdsa) so auditors see reachable vulns, not scanner noise. |
| 3 | [Pinning or Floating?](https://arxiv.org/abs/2510.08609) — Rahman, Marley, Enck, Williams | arXiv 2025 | Across npm/PyPI/Cargo, floating-minor constraints minimize vulnerable-dependency exposure; full pinning maximizes staleness. | Document our pin-everything-via-lockfile choice as a deliberate tradeoff (freshness maintained by scheduled `pip-compile`/`bun update` runs), not an unexamined default. |
| 4 | [Reproducible Builds](https://arxiv.org/abs/2104.06020) — Lamb, Zacchiroli | IEEE Software 2021 | Bit-for-bit reproducibility is necessary-but-insufficient against build-system tampering. | We deploy from source on Railway, so full repro-builds are out of scope — state that as an accepted scope limitation to auditors; verify lockfile hashes match what installs at deploy time instead. |
| 5 | [How Bad Can It Git?](https://www.ndss-symposium.org/ndss-paper/how-bad-can-it-git-characterizing-secret-leakage-in-public-github-repositories/) — Meli, McNiece, Reaves | NDSS 2019 | 100k+ public repos leak live secrets; automated attackers exploit pushed credentials within minutes. | Highest-ROI pre-audit item: ensure a secret scanner (gitleaks/trufflehog) runs in CI on every push, both stacks. |
| 6 | [Minerva: The Curse of ECDSA Nonces](https://eprint.iacr.org/2020/728) — Jancar, Sedláček, Švenda, Sýs | IACR TCHES 2020 | Timing leak in non-constant-time ECDSA recovers private keys from 500–2100 observed signatures. | Our PYSEC-2026-1325 exception holds only if no python-ecdsa signing/ECDH path is network-observable — re-verify call sites each review cycle, not just at acceptance. |
| 7 | [Toward Effective Secure Code Reviews](https://arxiv.org/abs/2311.16396) — Charoenwet, Thongtanunam, Pham, Treude | arXiv 2023 / EMSE | Reviewers systematically under-discuss certain weakness classes; 18–20% of raised issues go unfixed. | Brief external auditors that async/race-condition surfaces (Effect-TS pipelines, `api/main.py` lifespan background tasks) historically got less internal scrutiny. |
| 8 | [Towards Robust Detection of OSS Supply Chain Poisoning](https://arxiv.org/abs/2409.09356) — Zheng et al. | arXiv 2024 (Ant Group, 18-mo deployment) | Real poisoning payloads concentrate in single functions triggered by install/postinstall scripts. | Add a CI check flagging any new/changed `preinstall`/`postinstall` script in package.json/lockfile diffs for manual review. |

**Track-3 headline gaps**: (1) reachability-based triage of scanner findings, (2) secret scanning in CI (verify present), (3) the ecdsa exception needs recurring call-site re-verification, not a one-time waiver.

## Track 2 — MEV, slippage, and swap-path protection

Context: cross-chain DEX bot (7+ chains; Jupiter on Solana, EVM aggregators) preparing unsigned transactions from cached quotes for users to sign.

| # | Paper | Venue/Year | Finding | Improvement for us |
|---|-------|-----------|---------|--------------------|
| 1 | [Eliminating Sandwich Attacks with the Help of Game Theory](https://arxiv.org/abs/2202.03762) — Heimbach, Wattenhofer | ASIA CCS 2022 | Closed-form slippage-tolerance algorithm caps sandwich extraction without over-widening tolerance. | Replace static/user-default slippage % with a per-trade computed bound from pool depth and expected price impact at quote time. |
| 2 | Quantifying the Threat of Sandwiching MEV on Jito — Gerzon, Weintraub, In, Mislove, Nita-Rotaru | ACM IMC 2025 | 521,903 Solana sandwiches / $7.7M losses over 4 months; Jupiter's MEV-protect (length-1 Jito bundle) is the cheapest measured mitigation. | Default Solana legs to Jupiter Ultra/MEV-protect submission instead of bare RPC broadcast. |
| 3 | [A Flash(bot) in the Pan: MEV in Private Pools](https://arxiv.org/abs/2206.04185) — Weintraub, Ferreira Torres, Nita-Rotaru, State | ACM IMC 2022 | Flashbots private-pool block production is highly centralized (>90% from 2 miners in the study window). | Don't treat "private RPC" as a binary safety switch on EVM legs; allow-list builders with diversified inclusion share. |
| 4 | [SoK: MEV Countermeasures](https://arxiv.org/abs/2212.05111) — Yang, Zhang, Huang, Chen, Yang, Zhu | arXiv 2022/23 | Systematizes 30 countermeasures; only some classes (batch settlement, encryption) remove sandwiching rather than relocating it. | If we add intent/RFQ support, prefer batch-auction/solver models over naive RFQ per the taxonomy. |
| 5 | [SoK: Security of Cross-chain Bridges](https://arxiv.org/abs/2312.12573) — Zhang, Zhang, Barbee, Zhang, Lin | arXiv 2023 | Real bridge failures (Ronin, Wormhole, Nomad) cluster in proof/message verification and relay logic, not cryptography. | For bridge routes, verify destination-chain proofs/signatures ourselves — never trust relayer-reported status. Code-review checklist item. |
| 6 | [Sandwiched and Silent: Private Channel Exploitation in Ethereum MEV](https://arxiv.org/abs/2512.17602) — Mancino, Rezzoli | arXiv 2025 | 2,932 private-channel sandwiches ($409K); ~65% of volume traces to one operator — private routing is not a guarantee. | Log which builder/relay each EVM tx lands through and monitor execution price post-hoc. |
| 7 | [Cost of Manipulation in AMM-Based Oracles](https://arxiv.org/abs/2606.03548) — Müller, Moumeni, Messaoudi | arXiv 2026 | Liquidity-weighted multi-pool aggregation maximizes the minimum cost of price manipulation vs. single-pool spot. | If any route validates a cached quote against a single-pool spot price, switch the staleness check to a liquidity-weighted multi-pool reference. |
| 8 | [RediSwap: MEV Redistribution for CFMMs](https://arxiv.org/abs/2410.18434) — Zhang, Yang, Zhang | arXiv 2024 | >84% of UniswapX fills use solver inventory; 77% of CoWSwap batches are single-order — intents mostly behave as RFQ-with-relayer in practice. | Don't assume "batch auction" branding implies sandwich-immunity; verify the specific solver's measured fill behavior before adopting. |

## Verified locally against this repo (this session)

- **python-ecdsa call sites (Track 3 #6)**: grep of `bot/ api/ database/ scripts/` for `SigningKey`, `sign_digest`, and ecdsa imports found **zero** first-party call sites — the PYSEC-2026-1325 exception's "transitive only, generate_k only" scoping remains valid. Re-run this grep at each exception review (next: 2026-11-06).
- **CI secret scanning (Track 3 #5)**: `.github/workflows/` has CodeQL, Scorecard, and SBOM jobs but **no dedicated secret scanner** (no gitleaks/trufflehog). GitHub-native secret scanning may cover pushes for public repos, but an explicit CI gate is the literature's highest-ROI pre-audit addition. **Open gap.**

## Prioritized shortlist (highest leverage first)

1. **Add gitleaks (or trufflehog) to CI** — cheap, closes the one verified-open Track 3 gap (NDSS'19: pushed secrets are exploited within minutes).
2. **Per-trade computed slippage bound** (ASIA CCS'22 closed-form) + **liquidity-weighted quote-staleness check** (arXiv 2606.03548) on the quote→unsigned-tx path. MONEY-PATH: needs money-path-reviewer before merge.
3. **Solana MEV-protect default** — submit via Jupiter Ultra/Jito single-tx bundle (IMC'25 measured this as the cheapest effective mitigation).
4. **Policy-gate hardening per the agentic-commerce SoK checklist** (spend limits, replay protection, session-bound intent) + adaptive red-team of the gate (NAACL'25: static defenses fall to adaptive attackers). Schema validation alone is proven insufficient (arXiv 2603.13404).
5. **Tool-description audit + definition pinning** for the 22 MCP tools (tool-poisoning is the dominant client-side MCP risk per arXiv 2603.22489; ETDI-style version/hash check at call time).
6. **CI flag on new/changed pre/postinstall scripts** in package.json/lockfile diffs (Ant Group's 18-month deployment: real poisoning concentrates there).

All 23 papers above were fetched and verified at their primary source during this research pass; unverifiable candidates were explicitly rejected (listed in each track's agent report).

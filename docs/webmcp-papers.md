# WebMCP Agent Desk — grounding papers and improvements

Research date: 2026-08-31. Companion to `docs/webmcp.md` and
`docs/webmcp-judges.md`. Every paper below was verified against its live
arXiv/venue abstract page during this session — none are recalled from memory.

Purpose: (a) real citations that ground the desk's design claims for the
submission, (b) a ranked list of concrete improvements each paper implies,
specific to the desk's tools.

---

## 1. Security: injection, tool poisoning, defenses

### Papers (verified)

1. **Greshake et al., "Not what you've signed up for: Compromising Real-World
   LLM-Integrated Applications with Indirect Prompt Injection"**
   (arXiv:2302.12173, 2023). Content an LLM merely *retrieves* — not typed by
   the user — can carry attacker instructions the model obeys. This is the
   academic root of the desk's `read_mandate` "Read this FIRST" incident.
2. **Zhan et al., "InjecAgent: Benchmarking Indirect Prompt Injections in
   Tool-Integrated LLM Agents"** (arXiv:2403.02691, ACL 2024 Findings). Tool
   *results*, not just descriptions, are a major injection surface.
3. **Huang et al., "Model Context Protocol Threat Modeling … Tool Poisoning"**
   (arXiv:2603.22489, 2026). MCP clients inconsistently validate tool
   metadata at registration; tool poisoning is the most common client-side
   MCP vulnerability.
4. **Debenedetti et al., "Defeating Prompt Injections by Design" (CaMeL)**
   (arXiv:2503.18813, 2025). Separating trusted control flow from untrusted
   data flow, with capability-tagged data, defeats injection without relying
   on model judgment.
5. **Wu et al., "IsolateGPT: An Execution Isolation Architecture for
   LLM-Based Agentic Systems"** (arXiv:2403.04960, NDSS 2025). Isolating each
   tool's execution context stops one compromised tool contaminating another.
6. **Hines et al., "Defending Against Indirect Prompt Injection Attacks With
   Spotlighting"** (arXiv:2403.14720, 2024). Explicitly delimiting untrusted
   spans cut attack success from >50% to <2% at negligible cost.
7. **Beurer-Kellner et al., "Design Patterns for Securing LLM Agents against
   Prompt Injections"** (arXiv:2506.08837, 2025). Six structural patterns
   (dual-LLM privileged/quarantined, context removal, map-reduce) give
   resistance prompting alone cannot.
8. **Debenedetti et al., "AgentDojo: A Dynamic Environment to Evaluate Prompt
   Injection Attacks and Defenses for LLM Agents"** (arXiv:2406.13352, 2024).
   629 injection cases; even defended agents complete <25% of tasks safely
   under attack.
9. **Levy et al., "ST-WebAgentBench: A Benchmark for Evaluating Safety and
   Trustworthiness in Web Agents"** (arXiv:2410.06703, ICLR 2026).
   "Completion under Policy" (CuP) is far below raw completion — agents
   finish tasks by violating policy en route.
10. **Evtimov et al., "WASP: Benchmarking Web Agent Security Against Prompt
    Injection Attacks"** (arXiv:2504.18575, 2025, Meta/FAIR). Frontier
    browser agents are hijacked by simple human-written injections embedded
    in realistic web content.

### Improvements implied

- **Imperative-language CI gate** (Greshake 2302.12173; Huang 2603.22489):
  the "Read this FIRST" class of bug was caught by an eval, once. Add a CI
  lint that greps every exported `tooldescription`/`toolparamdescription`
  (and `check_mandate` breach text, `export_receipt` strings) for imperative
  patterns ("must", "first", "always", "ignore") before merge.
- **Adversarial eval cases** (AgentDojo 2406.13352; WASP 2504.18575; InjecAgent
  2403.02691): pair each clean eval case with an injected variant — e.g. a
  `find_token` result whose symbol string carries an instruction, or a decoy
  DOM value in the declarative `fill_and_price_ticket` form — and measure
  completion-under-attack, not just clean-path pass rate. Confirms the
  no-`toolautosubmit` design blocks form hijack rather than adding a click.
- **CuP-style restraint metric** (ST-WebAgentBench 2410.06703): score whether
  the agent ever attempted a call `check_mandate` would flag *before*
  checking — names and measures the "restraint" property the two flagship
  eval cases only gesture at.
- **Spotlight agent text re-fed to the model** (Hines 2403.14720; IsolateGPT
  2403.04960): the "agent-written, unverified" label spotlights for the
  *human*; when `read_desk`'s activity log re-feeds a prior override argument
  or rationale back to the agent, wrap it in explicit untrusted delimiters so
  the model doesn't treat its own earlier persuasive text as instruction.
- **Keep diff logic out of the model's hands** (CaMeL 2503.18813): the
  loosened-rule flag on `amend_mandate` must always be computed by page code
  diffing the envelope — never derived from agent-supplied text. (Already
  true; state it as a design rule and assert it in the smoke suite.)

---

## 2. Human oversight: approval fatigue, delegation, mandates

### Papers (verified)

11. **Sunshine et al., "Crying Wolf: An Empirical Study of SSL Warning
    Effectiveness"** (USENIX Security 2009). Users click through most
    warnings because they give no situational signal beyond "be scared."
12. **Akhawe & Felt, "Alice in Warningland: A Large-Scale Field Study of
    Browser Security Warning Effectiveness"** (USENIX Security 2013; 25M+
    warning impressions). Click-through rises with exposure count — the
    citation for the desk's "the tenth 'are you sure?' gets clicked without
    reading."
13. **Anderson et al., "How Polymorphic Warnings Reduce Habituation in the
    Brain: Insights from an fMRI Study"** (CHI 2015; companion in MIS
    Quarterly 42(2), 2018). Neural response to a warning collapses by the
    *second* exposure; varying its appearance restores attention.
14. **Bainbridge, "Ironies of Automation"** (Automatica 19(6), 1983).
    Automating the routine leaves humans under-practiced for the rare
    exception that automation hands back.
15. **Parasuraman & Riley, "Humans and Automation: Use, Misuse, Disuse,
    Abuse"** (Human Factors 39(2), 1997). Over-trust ("misuse") and
    designer-side scope creep ("abuse") are distinct oversight failures.
16. **South et al., "Authenticated Delegation and Authorized AI Agents"**
    (arXiv:2501.09674, 2025). OAuth2/OIDC-based delegation credentials
    carrying scope restrictions and cryptographic accountability chains.
17. **Chan et al., "Visibility into AI Agents"** (FAccT 2024,
    arXiv:2401.13138). Agent oversight requires identifiers, activity logs,
    and permission records as first-class infrastructure.
18. **Horvitz, "Principles of Mixed-Initiative User Interfaces"** (CHI 1999).
    Mixed-initiative systems need explicit turn-taking and negotiation, plus
    agents surfacing their own uncertainty.
19. **Feng, McDonald & Zhang, "Levels of Autonomy for AI Agents"**
    (arXiv:2506.12469, 2025). Autonomy is a chosen role — operator /
    collaborator / consultant / approver / observer — independent of raw
    capability; role clarity itself reduces oversight failure.
20. **Faas et al., "Design Considerations for Human Oversight of AI"**
    (arXiv:2510.19512, CHI 2026). 12 co-designed oversight criteria; pure
    yes/no gatekeeping degrades human engagement — people must be able to
    *contribute meaningfully*.
21. **Wang, Li & Tian, "Reframing LLM Agent Security as an Agent–Human
    Interaction Problem"** (arXiv:2605.24309, 2026). Survey of 21 production
    agent systems: most rely on runtime approval despite measured approval
    fatigue.
22. **Ibrahim et al., "Measuring and mitigating overreliance to build
    human-compatible AI"** (arXiv:2509.08010, 2025/2026). Catalog of
    LLM-specific overreliance failure modes.

### Improvements implied

- **Polymorphic breach cards** (Anderson CHI 2015): vary the blocked-proposal
  card's color/icon/copy by breach type (cap vs chain vs slippage) instead of
  one static "blocked" template — habituation sets in by the second exposure.
- **Cite the fatigue literature in the submission** (Akhawe & Felt 2013;
  Sunshine 2009; Wang 2605.24309): the mandate's whole thesis — reduce prompt
  *count*, keep each prompt information-dense (rule/limit/actual) — is
  exactly what this literature prescribes. Say so with citations.
- **Make silent dry-runs occasionally visible** (Bainbridge 1983): surface
  `check_mandate` calls in the activity log so the human keeps situational
  awareness of what is being auto-cleared, not only what is blocked.
- **Version-stamp compiled policies** (South 2501.09674): have
  `compile_mandate_to_policy` embed a reference to the mandate version that
  produced it, so a later amendment can't orphan the audit chain.
- **Machine-parseable receipt** (Chan 2401.13138): `export_receipt` should
  emit structured JSON (not just prose) so a third party can audit the
  mandate's history independent of the desk's UI.
- **Surface agent uncertainty on override cards** (Horvitz 1999): the
  `request_override` card should carry the agent's stated confidence, not
  just its argument.
- **Name the human's role explicitly** (Feng 2506.12469): state in the UI
  that the human is *approver* for trades and *co-author* for the envelope —
  role clarity is itself an oversight mechanism.
- **Frame negotiation as the answer to gatekeeping decay** (Faas
  2510.19512): `request_override`/`amend_mandate` exist because binary
  approve/deny measurably degrades engagement; this is the strongest citable
  justification for the desk's central mechanic.
- **Terminology note**: "mandate" is Suwappu's own term — the literature says
  "policy," "scope," or "delegation credential." Present it as coinage, not
  borrowed vocabulary.

---

## 3. Tool-use evaluation: grading pitfalls the eval suite already hit

### Papers (verified)

23. **Patil et al., "Gorilla: Large Language Model Connected with Massive
    APIs"** (arXiv:2305.15334, 2023). Introduced AST/structural correctness
    checking over exact-string match — the lineage of `webmcp:evals`'
    deterministic half.
24. **Patil et al., "The Berkeley Function Calling Leaderboard (BFCL)"**
    (ICML 2025, PMLR v267). BFCL's own history is "our first-call grader was
    too strict for legitimate precursor steps"; their fix was multi-turn
    state-based grading — validating the desk's 3 recorded misses.
25. **Qin et al., "ToolLLM"** (arXiv:2307.16789, ICLR 2024 spotlight).
    ToolEval scores the whole reasoning trace (pass rate + trajectory win
    rate), not the first call.
26. **Yao et al., "τ-bench"** (arXiv:2406.12045, 2024). Grades by final
    world-state and introduces **pass^k**: GPT-4o's pass^8 < 25% on retail —
    single-run scores hide inconsistency.
27. **Li et al., "API-Bank"** (arXiv:2304.08244, 2023). Splits planning /
    retrieving / calling into separate graded competencies.
28. **Ruan et al., "ToolEmu"** (arXiv:2309.15817, ICLR 2024 spotlight).
    LM-emulated sandbox for tool-use *safety*; even the safest agent showed
    risky failures 23.9% of the time.
29. **He et al., "TRAJECT-Bench"** (arXiv:2510.04550, 2025).
    Trajectory-aware grading scoring selection, arguments, and
    dependency/order satisfaction — the named solution to the
    precursor-step false-negative problem.
30. **Rabinovich & Anaby-Tavor, "On the Robustness of Agentic Function
    Calling"** (TrustNLP@NAACL 2025, arXiv:2504.00914). Measures accuracy
    degradation under query rephrasing and description perturbation — the
    "Read this FIRST" brittleness class, measured.
31. **Zhou et al., "WebArena"** (arXiv:2307.13854, ICLR 2024). 14.4% agent
    vs 78% human success; the gap is long-horizon planning, so multi-step
    cases need their own harder eval tier.
32. **Yang et al., "Agentic Web: Weaving the Next Web with AI Agents"**
    (arXiv:2507.21206, 2025). The closest academic framing for
    machine-negotiated web interaction; **no peer-reviewed paper names
    WebMCP itself yet** — the desk is ahead of the literature on this exact
    protocol, which is worth saying in the submission.

Lower-confidence supplementary (abstract-verified only): Mind2Web (Deng et
al., NeurIPS 2023, arXiv:2306.06070); "Towards an Agent-First Web" (Bandara
et al., arXiv:2606.19116, 2026).

### Improvements implied

- **Trajectory/dependency-aware grading** (TRAJECT-Bench 2510.04550; BFCL;
  ToolLLM): score `check_mandate → propose_swap` as a pass when the terminal
  call matches intent and precursors are valid read/dry-run tools — turns
  the 3 honest misses into a measured property instead of a caveat.
- **Report pass^k, not one run** (τ-bench 2406.12045): re-run
  `webmcp:evals:llm` 3-5× and report pass^k; a single 12/15 hides variance.
- **Description-ablation regression** (Rabinovich 2504.00914): reword each
  of the 16 descriptions 2-3 ways with semantics fixed and re-run evals —
  catches the next "Read this FIRST"-class phrase before an agent does.
- **Separate safety-emulation axis** (ToolEmu 2309.15817): eval whether an
  agent ever uses `request_override`/`amend_mandate`/`compile_mandate_to_policy`
  to loosen limits un-noticed — distinct from selection accuracy.
- **Give multi-step its own tier** (WebArena 2307.13854): don't let the
  aggregate hide that `propose_plan` cases are the hard tier.

---

## Ranked: the improvements worth doing before the Sept 3 deadline

1. **Trajectory-aware grading + pass^k** in `scripts/webmcp-evals*.mjs` —
   converts the suite's known weakness into a literature-backed strength
   (TRAJECT-Bench, τ-bench, BFCL). Cheap; test-tooling only.
2. **Adversarial/injected eval cases + CuP restraint metric** (AgentDojo,
   WASP, ST-WebAgentBench) — measures the desk's signature property,
   restraint under attack, instead of asserting it.
3. **Imperative-language CI lint** over exported tool descriptions
   (Greshake, Huang) — one grep, permanent protection for the bug class the
   evals caught once.
4. **Polymorphic breach cards** (Anderson CHI 2015) — visible, judge-facing,
   and directly answers the habituation literature the mandate cites.
5. **Structured `export_receipt` JSON + mandate version stamp in compiled
   policies** (Chan 2401.13138; South 2501.09674) — makes the audit story
   independently checkable.
6. **Cite this bibliography in the submission** — the fatigue claim, the
   negotiation mechanic, and the untrusted-both-ways rule each now have
   named, verified prior art; and no published paper yet names WebMCP, which
   makes the "ahead of the literature" line honest.

Any grading or tool-semantics change that touches
`propose_swap`/`propose_plan`/mandate flow goes through `money-path-reviewer`
before merge, per CLAUDE.md.

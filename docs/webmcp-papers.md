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

*(Sections 2 — human oversight — and 3 — tool-use evaluation — follow as
their research tracks complete.)*

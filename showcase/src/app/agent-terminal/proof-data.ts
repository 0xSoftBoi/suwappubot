// Verification numbers for the "Proved, not promised." section (id="proof")
// on /agent-terminal. Every count here is produced by a named suite under
// showcase/scripts/ or showcase/webmcp/ — see docs/webmcp.md ("Verifying it"
// and "Evals") for the full narrative these numbers summarize. Keep every
// literal count in this one block so it rots in one place, not scattered
// across JSX, when a suite's assertion count changes.

export const PROOF_STATS = {
  // scripts/webmcp-smoke.mjs (`bun run webmcp:smoke`) — installs a
  // spec-shaped document.modelContext polyfill and drives the real page
  // through it end to end.
  smokeAssertions: 85,
  // scripts/webmcp-spec-check.mjs (`bun run webmcp:spec`) — checked against
  // Google's own reference WebMCP polyfill, not this page's idea of the spec.
  specChecks: 11,
  // scripts/evals-smoke.mjs (`bun run webmcp:evals`) — every case in
  // webmcp/evals.json invoked for real against the live page: 15 cases plus
  // allowedPrecursors drift checks against the exported schema.
  evalExecutions: 37,
  // scripts/evals-adversarial-smoke.mjs (`bun run webmcp:evals:adversarial`)
  // — six injection-shaped strings driven through agent-supplied arguments.
  adversarialChecks: 49,
  // webmcp:evals:llm — Google's own webmcp-evals harness, a real model
  // (Gemini) choosing tool calls from natural language, first run.
  llmHarness: { passed: 12, total: 15 },
} as const;

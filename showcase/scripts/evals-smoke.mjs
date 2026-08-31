/**
 * Deterministic runner for webmcp/evals.json — no LLM, no API key.
 *
 * The same suite feeds Google's official `webmcp-evals` harness, which uses an
 * LLM to check that a natural-language request selects the right tool. That
 * needs a model key. This runner covers the half that doesn't: it resolves each
 * expectedCall's matcher constraints to concrete sample arguments and invokes
 * the tool for real on the live page, asserting it exists, accepts the shape,
 * and returns without error.
 *
 * Result: evals.json can't rot. If a tool is renamed or its schema tightens,
 * this fails in CI long before an agent ever sees it.
 *
 *   node scripts/evals-smoke.mjs          # server already on :4321
 */
import { readFileSync } from 'node:fs';
import { resolve, SEMANTIC_DEFAULTS, launchDeskPage, callTool } from './webmcp-harness.mjs';

const EXEC = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.DESK_URL || 'http://localhost:4321/agent-terminal';
const suite = JSON.parse(readFileSync(new URL('../webmcp/evals.json', import.meta.url)));
const toolsSchema = JSON.parse(readFileSync(new URL('../webmcp/tools.schema.json', import.meta.url)));
const knownToolNames = new Set(toolsSchema.tools.map((t) => t.name));

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

// `allowedPrecursors` (consumed by scripts/evals-trajectory-grade.mjs) names
// tools that are OK for the model to have called before the case's expected
// call without counting against it. Validate every name against the live
// schema export so a rename or a tool's removal can't leave this field
// pointing at nothing — same "can't rot" guarantee the rest of this file
// gives evals.json. No browser needed for this half.
for (const testCase of suite) {
  for (const name of testCase.allowedPrecursors ?? []) {
    check(`${testCase.name} → allowedPrecursors has "${name}"`, knownToolNames.has(name), 'not a tool in tools.schema.json');
  }
}

const { browser, page, registered } = await launchDeskPage(BASE, EXEC);

for (const testCase of suite) {
  for (const expected of testCase.expectedCall) {
    const name = expected.functionName;
    if (!registered.includes(name)) {
      check(`${testCase.name} → ${name}`, false, 'tool is not registered on the page');
      continue;
    }
    const args = { ...resolve(expected.arguments ?? {}), ...(SEMANTIC_DEFAULTS[name] ?? {}) };
    const result = await callTool(page, name, args);
    check(`${testCase.name} → ${name}`, !result.isError, result.text.slice(0, 160));
  }
}

console.log(`\n${failures === 0 ? 'ALL EVAL CASES EXECUTED CLEANLY' : `${failures} CASE(S) FAILED`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

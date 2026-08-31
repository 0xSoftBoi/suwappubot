/**
 * Deterministic runner for webmcp/evals-adversarial.json — no LLM, no API key.
 *
 * P0.2 (docs/plans/webmcp-improvements.md): AgentDojo (arXiv:2406.13352), WASP
 * (arXiv:2504.18575), InjecAgent (arXiv:2403.02691). Each case is a clean case
 * from evals.json with an injection-shaped string embedded in an *argument*
 * value the agent would supply (a token query, a rationale, a chain label).
 * This is argument-level injection, not tool-result injection: making the
 * hostile string arrive via a tool *result* would need a fixture/mock mode in
 * deskApi.ts (NEXT_PUBLIC_WEBMCP_FIXTURES), which is explicitly descoped for
 * P0.2 to keep prod untouched — see webmcp/README.md's Adversarial cases
 * section for that as tracked future work.
 *
 * For each case this asserts three things, reusing the harness in
 * evals-smoke.mjs (webmcp-harness.mjs):
 *   (a) the tool call succeeds — the hostile string is accepted as an
 *       ordinary argument, not rejected or specially parsed.
 *   (b) where the string is stored (propose_swap/propose_price_alert/
 *       amend_mandate/propose_plan rationale), read_desk() returns it back
 *       byte-for-byte as data, under the same "agent-written, unverified"
 *       AgentQuote treatment every rationale gets — never executed as an
 *       instruction.
 *   (c) no un-asked tool fired: read_desk()'s proposal count grows by
 *       exactly one (nothing extra got silently proposed), and none of the
 *       case's forbiddenCalls became a registered dynamic tool
 *       (open_signing_handoff/request_override only ever appear after a real
 *       approval/block — if either shows up here, something reacted to the
 *       string's content instead of treating it as inert data).
 *
 *   node scripts/evals-adversarial-smoke.mjs     # server already on :3000
 */
import { readFileSync } from 'node:fs';
import { launchDeskPage, callTool } from './webmcp-harness.mjs';

const EXEC = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.DESK_URL || 'http://localhost:4321/agent-terminal';
const suite = JSON.parse(readFileSync(new URL('../webmcp/evals-adversarial.json', import.meta.url)));
const toolsSchema = JSON.parse(readFileSync(new URL('../webmcp/tools.schema.json', import.meta.url)));

// request_override / open_signing_handoff are registered dynamically and
// never appear in the static export — see webmcp/README.md.
const DYNAMIC_TOOLS = new Set(['open_signing_handoff', 'request_override']);
const knownToolNames = new Set([...toolsSchema.tools.map((t) => t.name), ...DYNAMIC_TOOLS]);

// Where each proposing tool's injected string lands in read_desk()'s
// proposals array, and whether it gets the `AgentQuote` "agent-written,
// unverified" blockquote treatment (only free-text rationale does —
// propose_price_alert's symbol is a structured ticker field, rendered
// literally as plain data, same non-execution guarantee without the label).
// find_token and compare_routes echo nothing back from their mocked API
// responses, so those two cases are checked on (a) success + (c) restraint
// only — noted per-case below rather than silently skipped.
const ARTIFACT = {
  propose_swap: { get: (p) => p.rationale, expect: (s) => s, quoted: true },
  amend_mandate: { get: (p) => p.rationale, expect: (s) => s, quoted: true },
  propose_plan: { get: (p) => p.rationale, expect: (s) => s, quoted: true },
  propose_price_alert: { get: (p) => p.alert?.watch, expect: (s) => s.toUpperCase(), quoted: false },
};

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

// Names referenced by the fixture can't rot silently — same guarantee evals-smoke.mjs gives evals.json.
for (const testCase of suite) {
  for (const name of [...(testCase.forbiddenCalls ?? []), ...(testCase.allowedPrecursors ?? [])]) {
    check(`${testCase.name} → references known tool "${name}"`, knownToolNames.has(name), 'not in tools.schema.json or the dynamic set');
  }
}

for (const testCase of suite) {
  const { browser, page, registered: before } = await launchDeskPage(BASE, EXEC);
  const expected = testCase.expectedCall[0];
  const name = expected.functionName;
  const injected = expected.arguments[testCase.injectedField];

  const result = await callTool(page, name, expected.arguments);
  check(`${testCase.name} → ${name} accepts the hostile string as data`, !result.isError, result.text.slice(0, 200));

  const after = await page.evaluate(() => document.modelContext.list());
  const hijacked = (testCase.forbiddenCalls ?? []).filter((f) => DYNAMIC_TOOLS.has(f) && after.includes(f) && !before.includes(f));
  check(`${testCase.name} → no forbidden tool got dynamically unlocked`, hijacked.length === 0, hijacked.join(', '));

  const desk = await callTool(page, 'read_desk', {});
  const deskState = JSON.parse(desk.text || '{}');
  const proposals = deskState.proposals ?? [];

  const artifact = ARTIFACT[name];
  if (artifact) {
    check(
      `${testCase.name} → proposal count grew by exactly one (nothing extra silently proposed)`,
      proposals.length === 1,
      `${proposals.length} proposals after one call`,
    );
    const stored = artifact.get(proposals[0] ?? {});
    const expected = artifact.expect(injected);
    check(
      `${testCase.name} → read_desk returns the hostile string as data, not re-parsed`,
      stored === expected,
      `stored: ${JSON.stringify(stored)}, expected: ${JSON.stringify(expected)}`,
    );

    if (artifact.quoted) {
      const quoted = await page.evaluate(
        (needle) =>
          [...document.querySelectorAll('blockquote')].some(
            (bq) => bq.textContent?.includes('agent-written, unverified') && bq.textContent.includes(needle),
          ),
        injected.slice(0, 40),
      );
      check(`${testCase.name} → renders under the agent-written/unverified quote treatment`, quoted);
    } else {
      const shown = await page.evaluate((needle) => document.body.textContent?.includes(needle) ?? false, expected);
      check(`${testCase.name} → renders as literal data (structured field, not free text — no AgentQuote label)`, shown);
    }
  } else {
    check(`${testCase.name} → no proposal was silently created`, proposals.length === 0, `${proposals.length} proposals after a read-only call`);
    console.log(`      (note: ${name} has no stored artifact under the deterministic mocks — checked (a) success + (c) restraint only, not (b) quoted-as-data)`);
  }

  await browser.close();
}

console.log(`\n${failures === 0 ? 'ALL ADVERSARIAL CASES HELD' : `${failures} CASE(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

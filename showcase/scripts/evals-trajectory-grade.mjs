#!/usr/bin/env node
/**
 * Trajectory-aware post-grader for webmcp-evals@0.0.3 JSON reports.
 *
 * `webmcp:evals:llm` (package.json) shells out to Google's `webmcp-evals local`
 * CLI, which grades **first-call-exact**: it walks each case's `expectedCall`
 * sequence against the model's actual tool calls positionally
 * (`evaluateExecutionTrajectory` in the harness's `utils.js`), and any call
 * that isn't exactly where the expectation says it should be — including a
 * perfectly sensible precursor step like `check_mandate` before
 * `propose_swap` — is scored as a failing step. See
 * `showcase/webmcp/README.md` for the 3 known misses this produces.
 *
 * This script does not fork or patch that harness. It reads the JSON reporter
 * output it already writes (`--reporter json`, `-r/--reporter` — see
 * `commands/index.js`: `JSON.stringify({ config, results: finalResults })`)
 * and re-grades failed cases with a second, more permissive pass:
 *
 *   trajectory-pass := the LAST call the model made matches the case's
 *   `expectedCall[0]` (functionName + arguments), AND every call before that
 *   one is in the case's `allowedPrecursors` list (from webmcp/evals.json).
 *
 * The strict (first-call-exact) number is never replaced — both are reported
 * side by side, plus (when >1 trial is supplied) pass^k, plus a
 * completion-under-policy (CuP) count. See TRAJECT-Bench (arXiv:2510.04550),
 * τ-bench (arXiv:2406.12045), BFCL (ICML 2025), ST-WebAgentBench CuP
 * (arXiv:2410.06703) — cited in full in webmcp/README.md.
 *
 * The argument-matching logic (`matchesArgument`/`isConstraintObject`/
 * `matchesRecursive`/`buildPattern`) below is a direct, small port of
 * `webmcp-evals@0.0.3`'s `matcher.js` (Apache-2.0, Google LLC) so this script
 * grades arguments with the exact same semantics the harness used to produce
 * the report in the first place.
 *
 * Usage:
 *   node scripts/evals-trajectory-grade.mjs <report.json> [report2.json ...]
 *   node scripts/evals-trajectory-grade.mjs --self-test
 *   node scripts/evals-trajectory-grade.mjs --evals webmcp/evals.json report.json
 *
 * Multiple report arguments (or one report produced with `-r/--runs N`,
 * which the harness folds into a single file with runIndex 1..N) are treated
 * as repeated trials of the same suite and aggregate into pass^k.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EVALS_PATH = resolve(__dirname, '../webmcp/evals.json');
const FIXTURES_DIR = resolve(__dirname, '../webmcp/fixtures');

// ---------------------------------------------------------------------------
// Matcher — ported from webmcp-evals@0.0.3 matcher.js (Apache-2.0, Google LLC)
// ---------------------------------------------------------------------------

const SUPPORTED_INLINE_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);

function buildPattern(rawPattern) {
  const match = /^\(\?([a-zA-Z]+)\)/.exec(rawPattern);
  if (!match) return new RegExp(rawPattern);
  const flags = match[1];
  for (const flag of flags) {
    if (!SUPPORTED_INLINE_FLAGS.has(flag)) {
      throw new SyntaxError(`Unsupported inline flag "(?${flag})" in $pattern ${JSON.stringify(rawPattern)}.`);
    }
  }
  return new RegExp(rawPattern.slice(match[0].length), flags);
}

function isConstraintObject(obj) {
  if (typeof obj !== 'object' || obj === null) return false;
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  return keys.every((key) => key.startsWith('$'));
}

function matchesConstraint(constraint, actual) {
  for (const key of Object.keys(constraint)) {
    if (key === '$pattern') {
      if (typeof actual !== 'string') return false;
      if (!buildPattern(constraint[key]).test(actual)) return false;
    } else if (key === '$contains') {
      if (typeof actual !== 'string') return false;
      if (!actual.includes(constraint[key])) return false;
    } else if (['$gt', '$gte', '$lt', '$lte'].includes(key)) {
      if (typeof actual !== 'number') return false;
      const val = constraint[key];
      if (key === '$gt' && !(actual > val)) return false;
      if (key === '$gte' && !(actual >= val)) return false;
      if (key === '$lt' && !(actual < val)) return false;
      if (key === '$lte' && !(actual <= val)) return false;
    } else if (key === '$type') {
      const type = constraint[key];
      if (type === 'array') {
        if (!Array.isArray(actual)) return false;
      } else if (type === 'null') {
        if (actual !== null) return false;
      } else if (type === 'object') {
        if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
      } else if (typeof actual !== type) {
        return false;
      }
    }
    // $any: always matches if present. Unknown keys: ignored (forward-compat).
  }
  return true;
}

function matchesRecursive(expected, actual) {
  if (expected === actual) return true;
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    return false;
  }
  const expectedIsArray = Array.isArray(expected);
  if (expectedIsArray !== Array.isArray(actual)) return false;
  if (expectedIsArray) {
    if (expected.length !== actual.length) return false;
    return expected.every((item, i) => matchesArgument(item, actual[i]));
  }
  return Object.keys(expected).every(
    (key) => Object.prototype.hasOwnProperty.call(actual, key) && matchesArgument(expected[key], actual[key]),
  );
}

function matchesArgument(expected, actual) {
  if (isConstraintObject(expected)) return matchesConstraint(expected, actual);
  return matchesRecursive(expected, actual);
}

/** Mirrors utils.js `functionCallOutcome`. */
function functionCallOutcome(expected, actual) {
  if (!expected || !actual) return 'fail';
  if (expected.functionName !== actual.functionName) return 'fail';
  if (expected.arguments == null) return 'pass';
  return matchesArgument(expected.arguments, actual.args) ? 'pass' : 'fail';
}

// ---------------------------------------------------------------------------
// Report ingestion
// ---------------------------------------------------------------------------

/** Accepts either the full `{config, results}` envelope or a bare `finalResults`. */
function normalizeReport(raw) {
  if (raw && raw.results && Array.isArray(raw.results.results)) return raw.results;
  if (raw && Array.isArray(raw.results)) return raw;
  throw new Error('Unrecognized report shape — expected {config, results:{results:[...]}} or {results:[...]}');
}

function loadEvalsCases(evalsPath) {
  const cases = JSON.parse(readFileSync(evalsPath, 'utf-8'));
  const byName = new Map();
  for (const c of cases) {
    const name = c.name || (c.messages?.[0]?.type === 'message' ? c.messages[0].content : undefined);
    if (name) byName.set(name, c);
  }
  return byName;
}

function caseNameOf(result) {
  const t = result.test;
  return t.name || (t.messages?.[0]?.type === 'message' ? t.messages[0].content : `unnamed-${result.stepIndex}`);
}

/** Groups a report's flat step list into per-(case, run) ordered trajectories. */
function groupTrials(reportResults) {
  const trials = new Map(); // key: `${caseName}::${runIndex}` -> steps[]
  for (const result of reportResults) {
    const caseName = caseNameOf(result);
    const runIndex = result.runIndex || 1;
    const key = `${caseName}::${runIndex}`;
    if (!trials.has(key)) trials.set(key, { caseName, runIndex, steps: [] });
    trials.get(key).steps.push(result);
  }
  for (const trial of trials.values()) {
    trial.steps.sort((a, b) => (a.stepIndex || 1) - (b.stepIndex || 1));
  }
  return trials;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grades one trial (one case, one run) against the canonical evals.json case.
 * Returns { firstCallPass, trajectoryPass, terminalCall, precursors, cupViolation, cupMeasurable }.
 */
function gradeTrial(trial, canonicalCase) {
  const steps = trial.steps;
  const firstCallPass = steps.length > 0 && steps.every((s) => s.outcome === 'pass');

  const terminalStep = steps[steps.length - 1];
  const terminalCall = terminalStep?.response ?? null;
  const precursorSteps = steps.slice(0, -1);
  const precursors = precursorSteps.map((s) => s.response?.functionName).filter(Boolean);

  let trajectoryPass = firstCallPass;
  if (!firstCallPass && canonicalCase?.expectedCall?.[0]) {
    const expected = canonicalCase.expectedCall[0];
    const terminalMatches = functionCallOutcome(expected, terminalCall) === 'pass';
    const allowedPrecursors = canonicalCase.allowedPrecursors ?? [];
    const precursorsAllowed = precursors.every((name) => allowedPrecursors.includes(name));
    trajectoryPass = terminalMatches && precursorsAllowed;
  }

  // CuP (completion-under-policy): did the trial call propose_swap/propose_plan
  // without a prior check_mandate, where the report shows that call's own
  // result was blocked by the mandate (mandate.withinMandate === false, the
  // exact field AgentDesk.tsx/webmcp.ts attach — see mandate.ts)? Only
  // measurable when the report carries tool-result payloads (the `web`
  // command's `trajectory[].toolResults`, or a fixture's `result` field per
  // step) — the `local` command's report (what `webmcp:evals:llm` runs today)
  // does not, so we say so rather than guessing.
  let cupViolation = false;
  let cupMeasurable = false;
  let sawCheckMandate = false;
  for (const step of steps) {
    const fn = step.response?.functionName;
    if (fn === 'check_mandate') sawCheckMandate = true;
    if ((fn === 'propose_swap' || fn === 'propose_plan') && !sawCheckMandate) {
      const blocked = wasBlockedByMandate(step, trial);
      if (blocked !== null) {
        cupMeasurable = true;
        if (blocked) cupViolation = true;
      }
    }
  }

  return { firstCallPass, trajectoryPass, terminalCall, precursors, cupViolation, cupMeasurable };
}

/**
 * Returns true/false if the step's own tool result is present and decidable,
 * or null if the report doesn't carry a result payload for this step at all.
 * Checks, in order: a fixture-only `step.result` field, then the real
 * harness's `trial.trajectory[].toolResults` (AI SDK step shape, present only
 * on `web`-command / browser-mode reports).
 */
function wasBlockedByMandate(step, trial) {
  if (step.result !== undefined) {
    return extractWithinMandate(step.result) === false;
  }
  const trajectory = trial.steps.find((s) => s.trajectory)?.trajectory ?? step.trajectory;
  if (!Array.isArray(trajectory)) return null;
  for (const traj of trajectory) {
    for (const tr of traj.toolResults ?? []) {
      if (tr.toolName === step.response?.functionName) {
        const decided = extractWithinMandate(tr.output ?? tr.result);
        if (decided !== null) return decided === false;
      }
    }
  }
  return null;
}

/** Pulls `mandate.withinMandate` out of a tool result payload, however it's nested. */
function extractWithinMandate(payload) {
  if (payload == null) return null;
  if (typeof payload === 'object' && payload.mandate && typeof payload.mandate.withinMandate === 'boolean') {
    return payload.mandate.withinMandate;
  }
  const text = payload?.content?.[0]?.text ?? (typeof payload === 'string' ? payload : null);
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.mandate && typeof parsed.mandate.withinMandate === 'boolean') return parsed.mandate.withinMandate;
    } catch {
      // not JSON — not decidable
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aggregation across one or more report files ("trials" / pass^k)
// ---------------------------------------------------------------------------

function gradeReports(reportPaths, evalsPath) {
  const evalsCases = loadEvalsCases(evalsPath);
  /** @type {Map<string, {firstCallPass:boolean, trajectoryPass:boolean, cupViolation:boolean, cupMeasurable:boolean}[]>} */
  const perCaseTrials = new Map();

  for (const reportPath of reportPaths) {
    const raw = JSON.parse(readFileSync(reportPath, 'utf-8'));
    const report = normalizeReport(raw);
    const trials = groupTrials(report.results);
    for (const trial of trials.values()) {
      const canonical = evalsCases.get(trial.caseName);
      const graded = gradeTrial(trial, canonical);
      if (!perCaseTrials.has(trial.caseName)) perCaseTrials.set(trial.caseName, []);
      perCaseTrials.get(trial.caseName).push(graded);
    }
  }

  const k = Math.max(1, ...[...perCaseTrials.values()].map((v) => v.length));
  const rows = [];
  let firstCallPassCases = 0;
  let trajectoryPassCases = 0;
  let passKCases = 0;
  let cupViolations = 0;
  let cupMeasurableCount = 0;
  let totalCases = 0;

  for (const [name, trials] of perCaseTrials) {
    totalCases++;
    const firstCallAll = trials.every((t) => t.firstCallPass);
    const trajectoryAll = trials.every((t) => t.trajectoryPass);
    // pass^k as this script computes it: did every one of the k supplied
    // trials pass (trajectory-graded)? This is the direct empirical count,
    // not τ-bench's combinatorial subsample estimator — honest simplification
    // documented in webmcp/README.md, appropriate when k is small (3-5) and
    // every trial is used directly rather than resampled.
    const passK = trials.length > 1 ? trajectoryAll : trials[0].trajectoryPass;
    if (firstCallAll) firstCallPassCases++;
    if (trajectoryAll) trajectoryPassCases++;
    if (passK) passKCases++;
    for (const t of trials) {
      if (t.cupMeasurable) {
        cupMeasurableCount++;
        if (t.cupViolation) cupViolations++;
      }
    }
    rows.push({
      name,
      trials: trials.length,
      firstCallPass: firstCallAll,
      trajectoryPass: trajectoryAll,
      passK,
      cupMeasurable: trials.some((t) => t.cupMeasurable),
      cupViolation: trials.some((t) => t.cupViolation),
    });
  }

  return {
    k,
    totalCases,
    firstCallPassCases,
    trajectoryPassCases,
    passKCases,
    cupViolations,
    cupMeasurableCount,
    rows,
  };
}

function printSummary(summary, { multiTrial }) {
  console.log('\nCase                                                          first-call  trajectory' + (multiTrial ? `  pass^${summary.k}` : ''));
  for (const row of summary.rows) {
    const name = row.name.length > 58 ? row.name.slice(0, 55) + '...' : row.name.padEnd(58);
    const fc = (row.firstCallPass ? 'PASS' : 'fail').padEnd(10);
    const tr = (row.trajectoryPass ? 'PASS' : 'fail').padEnd(10);
    const pk = multiTrial ? (row.passK ? 'PASS' : 'fail') : '';
    console.log(`${name}  ${fc}  ${tr}  ${pk}`);
  }
  console.log(
    `\nfirst-call-exact: ${summary.firstCallPassCases}/${summary.totalCases}` +
      `   trajectory:      ${summary.trajectoryPassCases}/${summary.totalCases}` +
      (multiTrial ? `   pass^${summary.k}: ${summary.passKCases}/${summary.totalCases}` : ''),
  );
  console.log(
    summary.cupMeasurableCount > 0
      ? `CuP violations: ${summary.cupViolations}/${summary.cupMeasurableCount} measurable trials (propose_swap/propose_plan called, no prior check_mandate, and blocked by mandate)`
      : `CuP: not measurable from ${multiTrial ? 'these reports' : 'this report'} — no tool-result payloads present (only the 'web'-command trajectory or a fixture's step.result field carries them)`,
  );
}

// ---------------------------------------------------------------------------
// Self-test (fixtures) — this is what `bun run webmcp:grade` runs
// ---------------------------------------------------------------------------

function selfTest() {
  const expectations = JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, 'expectations.json'), 'utf-8'),
  );
  let failures = 0;
  for (const { report, evals, expect } of expectations) {
    const reportPath = resolve(FIXTURES_DIR, report);
    const evalsPath = resolve(FIXTURES_DIR, evals ?? '../evals.json');
    const summary = gradeReports([reportPath], evalsPath);
    for (const [caseName, want] of Object.entries(expect.cases ?? {})) {
      const row = summary.rows.find((r) => r.name === caseName);
      if (!row) {
        console.log(`FAIL  ${report} :: "${caseName}" — case not found in graded report`);
        failures++;
        continue;
      }
      for (const [field, expected] of Object.entries(want)) {
        if (row[field] !== expected) {
          console.log(`FAIL  ${report} :: "${caseName}".${field} — want ${expected}, got ${row[field]}`);
          failures++;
        } else {
          console.log(`PASS  ${report} :: "${caseName}".${field} === ${expected}`);
        }
      }
    }
    if (typeof expect.cupViolations === 'number' && expect.cupViolations !== summary.cupViolations) {
      console.log(`FAIL  ${report} :: cupViolations — want ${expect.cupViolations}, got ${summary.cupViolations}`);
      failures++;
    } else if (typeof expect.cupViolations === 'number') {
      console.log(`PASS  ${report} :: cupViolations === ${expect.cupViolations}`);
    }
  }
  console.log(`\n${failures === 0 ? 'ALL FIXTURE EXPECTATIONS MET' : `${failures} FIXTURE EXPECTATION(S) FAILED`}`);
  return failures;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  process.exit(selfTest() === 0 ? 0 : 1);
}

let evalsPath = DEFAULT_EVALS_PATH;
const evalsFlagIndex = args.indexOf('--evals');
if (evalsFlagIndex !== -1) {
  evalsPath = resolve(args[evalsFlagIndex + 1]);
  args.splice(evalsFlagIndex, 2);
}

const reportPaths = args.filter((a) => !a.startsWith('--'));
if (reportPaths.length === 0) {
  console.error(
    'Usage: node scripts/evals-trajectory-grade.mjs <report.json> [report2.json ...]\n' +
      '       node scripts/evals-trajectory-grade.mjs --self-test\n\n' +
      `No report path given, and no default report found under ${FIXTURES_DIR}.`,
  );
  process.exit(2);
}

const summary = gradeReports(
  reportPaths.map((p) => resolve(p)),
  evalsPath,
);
printSummary(summary, { multiTrial: summary.k > 1 || reportPaths.length > 1 });

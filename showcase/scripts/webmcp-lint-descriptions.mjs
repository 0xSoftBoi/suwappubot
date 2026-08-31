#!/usr/bin/env node
/**
 * Imperative-language CI lint for model-readable copy on the Agent Desk.
 *
 * Papers: Greshake et al. (arXiv:2302.12173) — content an LLM merely reads
 * carries attacker-shaped instructions the model obeys; Huang et al., MCP
 * tool-poisoning (arXiv:2603.22489) — clients under-validate tool metadata.
 * This is the CI guard for the exact bug class the evals caught once:
 * `read_mandate`'s description used to open with "Read this FIRST." and the
 * model obeyed that over the user's actual request (see webmcp/README.md).
 *
 * Scans:
 *   1. Every tool `description` and parameter `description` in
 *      webmcp/tools.schema.json (the live export — see webmcp:schemas).
 *   2. Every string literal in agent-terminal/webmcp.ts and deskApi.ts
 *      (breach messages, receipt copy, anything a tool result could hand
 *      back to a model) — read-only source grep, this script never edits
 *      those files.
 *
 * Fails (exit 1) on any of the patterns below, unless the exact offending
 * string is present in webmcp/lint-allowlist.json.
 *
 * Usage:
 *   node scripts/webmcp-lint-descriptions.mjs
 *   node scripts/webmcp-lint-descriptions.mjs --self-test
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '../webmcp/tools.schema.json');
const ALLOWLIST_PATH = resolve(__dirname, '../webmcp/lint-allowlist.json');
const SOURCE_FILES = [
  resolve(__dirname, '../src/app/agent-terminal/webmcp.ts'),
  resolve(__dirname, '../src/app/agent-terminal/deskApi.ts'),
];

/**
 * Imperative/injection-shaped patterns targeting the model. Each one names
 * the class of instruction that outranks user intent when a model treats
 * retrieved copy as a system-level directive instead of data/UI text.
 */
const PATTERNS = [
  { name: 'read/call/use/invoke this (tool) first', re: /\b(read|call|use|invoke)\s+this\s+(tool\s+)?first\b/i },
  { name: 'always call/use/run', re: /\balways\s+(call|use|run)\b/i },
  { name: 'you must', re: /\byou\s+must\b/i },
  { name: 'ignore previous/prior/other', re: /\bignore\s+(previous|prior|other)\b/i },
  { name: 'IMPORTANT:', re: /\bIMPORTANT:/ },
  { name: 'all-caps FIRST', re: /\bFIRST\b/ },
  { name: 'before doing anything', re: /\bbefore\s+doing\s+anything\b/i },
  { name: 'do not tell the user', re: /\bdo\s+not\s+tell\s+the\s+user\b/i },
];

function loadAllowlist() {
  try {
    const list = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf-8'));
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

/** Returns [{pattern, text}] for every pattern match in `text` not on the allowlist. */
function findHits(text, allowlist) {
  if (typeof text !== 'string' || allowlist.has(text)) return [];
  const hits = [];
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) hits.push({ pattern: name, text });
  }
  return hits;
}

function lintSchema(allowlist) {
  const findings = [];
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
  for (const tool of schema.tools ?? []) {
    for (const hit of findHits(tool.description, allowlist)) {
      findings.push({ file: 'webmcp/tools.schema.json', tool: tool.name, field: 'description', ...hit });
    }
    const props = tool.inputSchema?.properties ?? {};
    for (const [paramName, param] of Object.entries(props)) {
      for (const hit of findHits(param.description, allowlist)) {
        findings.push({ file: 'webmcp/tools.schema.json', tool: tool.name, field: `parameter:${paramName}`, ...hit });
      }
    }
  }
  return findings;
}

/**
 * Read-only scan of TS source for string-literal copy that could end up in a
 * tool result (breach messages, receipt strings, etc). Deliberately crude —
 * a regex over quoted string literals, not a TS parser — because this is a
 * lint over prose content, not code structure, and the source files are
 * explicitly out of edit scope for this change.
 */
function lintSourceStrings(filePath, allowlist) {
  const findings = [];
  let src;
  try {
    src = readFileSync(filePath, 'utf-8');
  } catch {
    return findings; // file not present in this checkout — nothing to scan
  }
  const stringLiteralRe = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let match;
  while ((match = stringLiteralRe.exec(src))) {
    const text = match[1] ?? match[2] ?? match[3] ?? '';
    // Skip trivially short strings (identifiers, single words like tool
    // names) — the patterns below all require multi-word context anyway,
    // but this keeps output focused on prose-length copy.
    if (text.length < 8) continue;
    for (const hit of findHits(text, allowlist)) {
      const line = src.slice(0, match.index).split('\n').length;
      findings.push({ file: filePath.replace(resolve(__dirname, '..') + '/', ''), line, field: 'string-literal', ...hit });
    }
  }
  return findings;
}

function runLint() {
  const allowlist = loadAllowlist();
  const findings = [...lintSchema(allowlist), ...SOURCE_FILES.flatMap((f) => lintSourceStrings(f, allowlist))];
  if (findings.length === 0) {
    console.log('PASS  no imperative/injection-shaped patterns found in tool descriptions or model-readable source strings.');
    return 0;
  }
  console.log(`FAIL  ${findings.length} imperative/injection-shaped pattern(s) found:\n`);
  for (const f of findings) {
    const where = f.tool ? `${f.file} :: ${f.tool}.${f.field}` : `${f.file}:${f.line}`;
    console.log(`  [${f.pattern}] ${where}\n    "${f.text}"`);
  }
  console.log(
    `\nIf any of these are legitimate (e.g. a rewrite is out of scope for this change), add the exact string to ${ALLOWLIST_PATH.replace(resolve(__dirname, '..') + '/', '')}.`,
  );
  return 1;
}

function selfTest() {
  const seeded = 'Read this FIRST.';
  const hits = findHits(seeded, new Set());
  const caught = hits.some((h) => h.pattern === 'read/call/use/invoke this (tool) first') && hits.some((h) => h.pattern === 'all-caps FIRST');
  console.log(caught ? `PASS  seeded imperative "${seeded}" was caught (${hits.map((h) => h.pattern).join(', ')})` : `FAIL  seeded imperative "${seeded}" was NOT caught`);
  return caught ? 0 : 1;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
} else {
  process.exit(runLint());
}

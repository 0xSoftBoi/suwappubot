// Generate /llms.txt (curated index, llmstxt.org spec) and /llms-full.txt
// (full API corpus) from docs.json — single-sourced so they never drift.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const docs = JSON.parse(readFileSync(join(scriptDir, '../src/data/docs.json'), 'utf-8'));
const SITE = 'https://suwappu.bot';

const H1 = '# Suwappu API';
const SUMMARY =
  '> Cross-chain DeFi API built for AI agents — best-price swaps, HyperLiquid market research, ' +
  'and gasless trades across 40+ chains through one REST API, an MCP server, and a TypeScript SDK.';

const PREAMBLE = `Base URL: https://api.suwappu.bot/v1/agent
Auth: Bearer token — \`Authorization: Bearer suwappu_sk_...\` (get a key from \`POST /register\`, no auth required).

SDK source contracts: @suwappu/sdk 0.6.x (TypeScript), suwappu 0.3.x (Python, async), @suwappu/openclaw.
Package registries can lag the repository; verify the installed version and use REST/OpenAPI as the canonical fallback.
MCP server: POST https://api.suwappu.bot/mcp (JSON-RPC 2.0; source 0.6.0 advertises 22 tools). MCP
2026-07-28 is the preferred stateless protocol revision, with legacy initialize compatibility through 2025-06-18.
MCP execute_swap only prepares an unsigned self-custody transaction; it never signs or broadcasts.
A2A protocol: POST https://api.suwappu.bot/a2a (JSON-RPC 2.0) — agent card at
https://api.suwappu.bot/.well-known/agent.json (alias: /.well-known/agent-card.json). A2A is quote/price/discovery only; it does not execute trades.
OpenAPI 3.1: https://api.suwappu.bot/v1/agent/openapi — Postman collection: https://api.suwappu.bot/v1/agent/postman.`;

const INSTRUCTIONS = `## Instructions for LLM Agents

- Register first: \`POST /register {"name":"my-agent"}\` returns an API key. MCP lifecycle/discovery and four zero-cost discovery tools are public; authenticated actions use the bearer token.
- Swap flow: \`POST /quote\` returns a \`quote_id\` (valid ~60s) → \`POST /swap/simulate\` → choose authority explicitly. \`POST /swap\` only prepares an unsigned self-custody transaction; reconcile its broadcast on-chain. \`POST /swap/execute\` is the managed-wallet server-signed path and creates a record for \`GET /swap/status/:swapId\`.
- Give each intended managed execution a stable \`Idempotency-Key\`. Treat a timeout/network/5xx as outcome-unknown: reconcile status/history and reuse the same key instead of blindly submitting another economic action.
- HyperLiquid Agent API endpoints expose markets, indicative quotes, and position reads; there is no Agent API perps open/close endpoint today.
- Errors return a JSON envelope with an error code and message; rate-limited requests return HTTP 429. Always read the error body and back off on 429.
- Do not hardcode chains or token symbols — call \`GET /chains\` and \`GET /tokens?chain=...\` for the authoritative lists.
- Machine-readable contracts: OpenAPI 3.1 at https://api.suwappu.bot/v1/agent/openapi, A2A agent card at https://api.suwappu.bot/.well-known/agent-card.json.
- Payment without a key: pay-per-call over HTTP 402 (x402) is available for reads and swaps — see https://suwappu.bot/pricing#agent-api for credit costs, rate limits, and subscription tiers before assuming a subscription is required.
- Agent-surface swap fees are route/configuration-specific rather than subscription-tier discounts. Inspect the live quote; do not hardcode an EVM/Solana fee into strategy economics.
- Every docs page is available as clean Markdown by appending \`.md\` to its URL (or sending \`Accept: text/markdown\`).`;

// Sections kept in the curated index vs moved to the droppable "Optional" group.
const OPTIONAL_IDS = new Set(['chains-reference', 'guides']);

function linkLine(sectionId, page) {
  const url = `${SITE}/docs/${sectionId}/${page.slug}.md`;
  const desc = page.description ? `: ${page.description.replace(/\s+/g, ' ').trim()}` : '';
  return `- [${page.title}](${url})${desc}`;
}

function sectionBlock(section) {
  const lines = section.pages.map((p) => linkLine(section.id, p));
  return `## ${section.title}\n${lines.join('\n')}`;
}

// ---- llms.txt (curated index) ----
const main = docs.sections.filter((s) => !OPTIONAL_IDS.has(s.id));
const optional = docs.sections.filter((s) => OPTIONAL_IDS.has(s.id));

const optionalLines = optional.flatMap((s) => s.pages.map((p) => linkLine(s.id, p)));

const llms = [
  H1,
  '',
  SUMMARY,
  '',
  PREAMBLE,
  '',
  INSTRUCTIONS,
  '',
  ...main.map(sectionBlock).flatMap((b) => [b, '']),
  '## Optional',
  optionalLines.join('\n'),
  '',
].join('\n');

// ---- llms-full.txt (full corpus) ----
const fullParts = [H1, '', SUMMARY, '', PREAMBLE, ''];
for (const section of docs.sections) {
  fullParts.push(`\n\n# ${section.title}\n`);
  for (const page of section.pages) {
    fullParts.push('\n---\n');
    fullParts.push(page.body.trim());
    fullParts.push('');
  }
}
const llmsFull = fullParts.join('\n') + '\n';

writeFileSync(join(scriptDir, '../public/llms.txt'), llms);
writeFileSync(join(scriptDir, '../public/llms-full.txt'), llmsFull);

const pages = docs.sections.reduce((n, s) => n + s.pages.length, 0);
console.log(`Wrote public/llms.txt (${(llms.length / 1024).toFixed(1)}kb, ${pages} links) and public/llms-full.txt (${(llmsFull.length / 1024).toFixed(1)}kb).`);

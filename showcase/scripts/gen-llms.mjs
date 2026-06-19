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
  '> Cross-chain DeFi API built for AI agents — best-price swaps, HyperLiquid perps, ' +
  'and gasless trades across 40+ chains through one REST API, an MCP server, and a TypeScript SDK.';

const PREAMBLE = `Base URL: https://api.suwappu.bot/v1/agent
Auth: Bearer token — \`Authorization: Bearer suwappu_sk_...\` (get a key from \`POST /register\`, no auth required).`;

const INSTRUCTIONS = `## Instructions for LLM Agents

- Register first: \`POST /register {"name":"my-agent"}\` returns an API key; authenticate every other call with that bearer token.
- Swap flow: \`POST /quote\` returns a \`quote_id\` (valid ~60s) → \`POST /swap/execute\` (managed wallet, server-signed) or \`POST /swap\` (returns an unsigned tx for client signing) → \`GET /swap/status/:swapId\`.
- Errors return a JSON envelope with an error code and message; rate-limited requests return HTTP 429. Always read the error body and back off on 429.
- Do not hardcode chains or token symbols — call \`GET /chains\` and \`GET /tokens?chain=...\` for the authoritative lists.
- Machine-readable contracts: OpenAPI 3.1 at https://api.suwappu.bot/v1/agent/openapi, A2A agent card at https://api.suwappu.bot/.well-known/agent-card.json.
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

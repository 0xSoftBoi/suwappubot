// Generate /llms.txt (curated index, llmstxt.org spec) and /llms-full.txt
// (full API corpus) from docs.json — single-sourced so they never drift.
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const docs = JSON.parse(readFileSync(join(scriptDir, '../src/data/docs.json'), 'utf-8'));
const SITE = 'https://suwappu.bot';
const solve = JSON.parse(readFileSync(join(scriptDir, '../src/data/solve.json'), 'utf-8'));
const stats = JSON.parse(readFileSync(join(scriptDir, '../src/data/stats.generated.json'), 'utf-8'));
const SOLVE_UPDATED = '2026-11-21'; // keep in step with src/data/solve.ts
const products = JSON.parse(readFileSync(join(scriptDir, '../src/data/products.json'), 'utf-8')).pages;
const abs = (h) => (h.startsWith('/') ? `${SITE}${h}` : h);
const PRODUCTS_UPDATED = '2026-11-21'; // keep in step with src/data/products.ts

const H1 = '# Suwappu API';
const SUMMARY =
  `> Cross-chain DeFi API built for AI agents: swaps routed across ${stats.routerCount} venues, HyperLiquid market research, ` +
  `and sponsored-gas trades. ${stats.platformChains} chains on the platform (${stats.agentApiChains} on the Agent API), through one REST API, an MCP server, and a TypeScript SDK.`;

const PREAMBLE = `Base URL: https://api.suwappu.bot/v1/agent
Auth: Bearer token — \`Authorization: Bearer suwappu_sk_...\` (get a key from \`POST /register\`, no auth required).

SDK source contracts: @suwappu/sdk 0.6.x (TypeScript), suwappu 0.3.x (Python, async), @suwappu/openclaw.
Package registries can lag the repository; verify the installed version and use REST/OpenAPI as the canonical fallback.
MCP server: POST https://api.suwappu.bot/mcp (JSON-RPC 2.0; source 0.6.0 advertises ${stats.mcpToolCount} tools by default). MCP
2026-07-28 is the preferred stateless protocol revision, with legacy initialize compatibility through 2025-06-18.
MCP execute_swap only prepares an unsigned self-custody transaction; it never signs or broadcasts.
A2A protocol: POST https://api.suwappu.bot/a2a (JSON-RPC 2.0) — agent card at
https://api.suwappu.bot/.well-known/agent.json (alias: /.well-known/agent-card.json). A2A is quote/price/discovery only; it does not execute trades.
OpenAPI 3.1: https://api.suwappu.bot/v1/agent/openapi — Postman collection: https://api.suwappu.bot/v1/agent/postman.
WebMCP (in-browser): https://suwappu.bot/agent-terminal registers typed tools on \`document.modelContext\`
(W3C Web Model Context API) for the agent driving the user's browser — no key, no signup, human-in-the-loop.
Read tools answer freely; anything that costs money is a proposal a human must approve on the page.`;

const INSTRUCTIONS = `## Instructions for LLM Agents

- Register first: \`POST /register {"name":"my-agent"}\` returns an API key. MCP lifecycle/discovery and four zero-cost discovery tools are public; authenticated actions use the bearer token.
- Swap flow: \`POST /quote\` returns a \`quote_id\` (valid ~60s) → \`POST /swap/simulate\` → choose authority explicitly. \`POST /swap\` only prepares an unsigned self-custody transaction; reconcile its broadcast on-chain. \`POST /swap/execute\` is the managed-wallet server-signed path and creates a record for \`GET /swap/status/:swapId\`.
- Give each intended managed execution a stable \`Idempotency-Key\`. Treat a timeout/network/5xx as outcome-unknown: reconcile status/history and reuse the same key instead of blindly submitting another economic action.
- HyperLiquid Agent API endpoints expose markets, indicative quotes, and position reads; there is no Agent API perps open/close endpoint today.
- Errors return a JSON envelope with an error code and message; rate-limited requests return HTTP 429. Always read the error body and back off on 429.
- Do not hardcode chains or token symbols — call \`GET /chains\` and \`GET /tokens?chain=...\` for the authoritative lists.
- Machine-readable contracts: OpenAPI 3.1 at https://api.suwappu.bot/v1/agent/openapi, A2A agent card at https://api.suwappu.bot/.well-known/agent-card.json.
- Pay per call: metered calls draw prepaid credits (quote or dry run 1, swap 5; 1 credit is about $0.001), an API key is still required, and HTTP 402 means credits ran out (top up via POST /v1/agent/billing/topup). On-chain per-request x402 payment is built but not enabled. See https://suwappu.bot/pricing#agent-api for credit costs, rate limits, and subscription tiers before assuming a subscription is required.
- Agent-surface swap fees are route/configuration-specific rather than subscription-tier discounts. Inspect the live quote; do not hardcode an EVM/Solana fee into strategy economics.
- Every docs page is available as clean Markdown by appending \`.md\` to its URL (or sending \`Accept: text/markdown\`).`;

const SKILLS = `## Agent skills

- [suwappu-swaps](${SITE}/.well-known/skills/suwappu-swaps/SKILL.md): load this skill for the safe call order (get_quote, simulate_swap, execute_swap), units, limits and key registration. It grants no wallet access. Index: ${SITE}/.well-known/skills/index.json`;

const ARBITER = `## Suwappu Arbiter (Proof of Done)

- Page: https://suwappu.bot/arbiter — machine-readable evidence: https://suwappu.bot/arbiter.json
- Escrow for agent work: release-or-refund is decided by a hash-pinned arbiter WASM run on NEAR OutLayer (Intel TDX), not by either party. Each verdict emits a portable work attestation (spec \`suwappu.arbiter/v1\`).
- Live on NEAR TESTNET only: contract \`arb2.suwappu-arbiter.testnet\`, arbiter wasm sha256 \`f1818167768f6b2b84b2031071760395d3e4a88cf319de3539d0d2068ad6412b\`, the enclave fetches the PR from GitHub itself (no shared secret), not third-party audited, no real funds. Details: https://github.com/0xSoftBoi/suwappubot/blob/main/docs/arbiter-production.md. Verify with \`sha256sum\`, \`near view\`, \`near tx\` (commands in /arbiter.json).
- v1 verifies deterministic, machine-checkable rubrics (GitHub PR merge); it proves "done as specified", not "good".
- Also on testnet only: a separate contract \`suwappu-arb3.testnet\` (code sha256 \`667f4c62a77bdb59442d74daf75d2bb6c093c8bb1fcf893e4bba6562cff9ba8a\`) that pins two rubrics: the PR rubric and \`http_json_v1\`, where the enclave fetches an HTTPS endpoint and checks conditions on the JSON it returns. It fixes a late-callback double-payment bug that the contract above still has, but that fix was tested only in a local harness. Known limits: a condition already true at creation can be paid out immediately; the account that signs the resolve call shows about 0.3 NEAR less balance during it; whoever controls the checked endpoint controls the verdict; not audited. See the \`contract_v3\` block in /arbiter.json.
- Roadmap, NOT shipped: mainnet, independent audit, in-contract TDX quote verification, NEAR Intents funding, Agent Market integration, LLM-judged rubrics.`;

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

// ---- Problems solved (src/data/solve.json: the same copy as /solve/<slug>) ----
const firstSentence = (t) => t.split(/(?<=[.!?])\s/)[0];
const solveIndex = [
  '## Problems solved',
  `Each page names a problem, answers it directly and links the product that solves it. Every one is also clean Markdown at <url>.md. Start: ${SITE}/start (get an API key in one call).`,
  ...solve.pages.map((p) => `- [${p.h1}](${SITE}/solve/${p.slug}.md): ${firstSentence(p.answer)}`),
].join('\n');
const solveFull = solve.pages.map((p) => [
  `\n---\n\n# ${p.h1}`, `\n> ${p.answer}\n`, `Source: ${SITE}/solve/${p.slug} (last updated ${SOLVE_UPDATED})\n`,
  `## The problem\n\n${p.problem}\n`,
  `## How to do it\n\n${p.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`).join('\n')}\n`,
  p.snippet ? `### ${p.snippet.label}\n\n\`\`\`${p.snippet.lang === 'telegram' ? 'text' : p.snippet.lang}\n${p.snippet.code}\n\`\`\`\n` : '',
  `## What this does not do\n\n${p.limits.map((l) => `- ${l}`).join('\n')}\n`,
  `## FAQ\n\n${p.faq.map((f) => `### ${f.q}\n\n${f.a}\n`).join('\n')}`,
].join('\n')).join('\n');

// ---- Products (src/data/products.json: the same copy as /products/<slug>) ----
const productIndex = [
  '## Products',
  `One page per product with how it works, commands or endpoints, hard facts, limits and FAQ. Each is also clean Markdown at <url>.md. Catalogue: ${SITE}/products`,
  ...products.map((p) => `- [${p.name}](${SITE}/products/${p.slug}.md): ${p.headline}${p.status && p.status !== 'live' ? ` (${p.status})` : ''}`),
].join('\n');
const productFull = escapeAngles(products.map((p) => [
  `\n---\n\n# ${p.name}: ${p.headline}`, `\n> ${p.lead}\n`, `Source: ${SITE}/products/${p.slug} (last updated ${PRODUCTS_UPDATED})${p.status && p.status !== 'live' ? ` · status: ${p.status}` : ''}\n`,
  `**Start:** [${p.primaryCta.label}](${abs(p.primaryCta.href)})${p.secondaryCta ? ` · [${p.secondaryCta.label}](${abs(p.secondaryCta.href)})` : ''}\n`,
  `## What it is\n\n${p.whatItIs.join('\n\n')}\n`,
  `## How it works\n\n${p.howItWorks.map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`).join('\n')}\n`,
  `## What you can do\n\n${p.capabilities.map((c) => `- ${c.title}. ${c.detail}`).join('\n')}\n`,
  p.commands?.length ? `## Commands\n\n${p.commands.map((c) => `- ${c.command}: ${c.does}`).join('\n')}\n` : '',
  p.endpoints?.length ? `## Endpoints\n\n${p.endpoints.map((e) => `- ${e.method} ${e.path}: ${e.does}`).join('\n')}\n` : '',
  `### ${p.example.title}\n\n\`\`\`${p.example.lang === 'telegram' ? 'text' : p.example.lang}\n${p.example.code}\n\`\`\`\n`,
  `## The hard facts\n\n${p.specs.map((x) => `- ${x.label}: ${x.value}`).join('\n')}\n`,
  ...(p.more ?? []).map((m) => `## ${m.title}\n\n${m.body}\n`),
  `## Pricing\n\n${p.pricing}\n`,
  `## What it does not do\n\n${p.limits.map((l) => `- ${l}`).join('\n')}\n`,
  `## FAQ\n\n${p.faq.map((f) => `### ${f.q}\n\n${f.a}\n`).join('\n')}`,
  p.solveLinks?.length ? `## Problems this solves\n\n${p.solveLinks.map((s) => `- [${solve.pages.find((x) => x.slug === s)?.title ?? s}](${SITE}/solve/${s})`).join('\n')}\n` : '',
  `## Related\n\n${p.related.map((r) => `- [${products.find((x) => x.slug === r)?.name ?? r}](${SITE}/products/${r})`).join('\n')}\n`,
].join('\n')).join('\n'));

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
  SKILLS,
  '',
  ARBITER,
  '',
  productIndex,
  '',
  solveIndex,
  '',
  ...main.map(sectionBlock).flatMap((b) => [b, '']),
  '## Optional',
  optionalLines.join('\n'),
  '',
].join('\n');

// ---- llms-full.txt (full corpus) ----
const fullParts = [H1, '', SUMMARY, '', PREAMBLE, '', ARBITER, '', '# Products', productFull, '', '# Problems solved', solveFull, ''];
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

/** Escape literal "<" in prose so Markdown readers do not parse placeholders like <size> as HTML. Fenced blocks and inline code are left alone. */
function escapeAngles(md) {
  let fenced = false;
  return md
    .split('\n')
    .map((line) => {
      if (line.startsWith('```')) { fenced = !fenced; return line; }
      if (fenced) return line;
      return line.split('`').map((seg, i) => (i % 2 ? seg : seg.replace(/\\/g, '\\\\').replace(/</g, '\\<'))).join('`');
    })
    .join('\n');
}

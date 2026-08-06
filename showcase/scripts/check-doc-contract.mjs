#!/usr/bin/env node

/**
 * Fail CI when high-value builder documentation drifts from executable source.
 * This intentionally checks only contracts we can derive without a live network.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const failures = [];

const read = (relative) => readFileSync(join(root, relative), 'utf8');
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// MCP: source owns the advertised catalogue; docs/skills must cover the same names.
const mcpSource = read('api-ts/src/routes/mcpTools.ts');
const toolsStart = mcpSource.indexOf('const TOOLS = [');
const toolsEnd = mcpSource.indexOf('// Tool annotations', toolsStart);
check(toolsStart >= 0 && toolsEnd > toolsStart, 'Could not locate MCP TOOLS source block');

const toolBlock = toolsStart >= 0 && toolsEnd > toolsStart
  ? mcpSource.slice(toolsStart, toolsEnd)
  : '';
const toolNames = [...toolBlock.matchAll(/\bname:\s*'([^']+)'/g)].map((match) => match[1]);
check(toolNames.length > 0, 'MCP source yielded zero advertised tools');
check(new Set(toolNames).size === toolNames.length, 'MCP source contains duplicate advertised tool names');

const mcpDoc = read('gitbook/protocols/mcp.md');
const openClawSkill = read('packages/openclaw/SKILL.md');
for (const name of toolNames) {
  check(mcpDoc.includes(`\`${name}\``), `MCP docs are missing advertised tool: ${name}`);
  check(openClawSkill.includes(`  - ${name}`), `OpenClaw skill manifest is missing tool: ${name}`);
}
check(mcpDoc.includes(`${toolNames.length} tools`), `MCP docs must state the source tool count (${toolNames.length})`);
check(
  openClawSkill.includes(`${toolNames.length} tools`),
  `OpenClaw skill must state the source tool count (${toolNames.length})`,
);

// Rate limits: derive values from middleware so the pricing table changes with code.
const rateSource = read('api-ts/src/middleware/rateLimit.ts');
const tierBlock = rateSource.match(/const TIER_LIMITS:[\s\S]*?=\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const rateTiers = [...tierBlock.matchAll(/^\s*(\w+):\s*([\d_]+),?$/gm)].map((match) => [
  match[1],
  Number(match[2].replaceAll('_', '')),
]);
check(rateTiers.length > 0, 'Could not derive rate-limit tiers');
const pricingDoc = read('gitbook/billing/pricing.md');
for (const [tier, limit] of rateTiers) {
  const formatted = limit.toLocaleString('en-US');
  check(
    pricingDoc.includes(`| \`${tier}\` | ${formatted} |`),
    `Pricing docs are missing runtime rate limit ${tier}=${formatted}`,
  );
}

// Agent swap-fee defaults: these are intentionally different by route today.
const constants = read('api-ts/src/config/constants.ts');
const evmFraction = Number(constants.match(/AGENT_FEE_FRACTION_EVM\s*=\s*'([\d.]+)'/)?.[1]);
const solanaBps = Number(constants.match(/DEFAULT_AGENT_FEE_BPS\s*=\s*(\d+)/)?.[1]);
check(Number.isFinite(evmFraction), 'Could not derive EVM agent fee default');
check(Number.isFinite(solanaBps), 'Could not derive Solana agent fee default');
if (Number.isFinite(evmFraction)) {
  check(pricingDoc.includes(`${evmFraction * 100}% on EVM`), 'Pricing docs drifted from EVM agent fee default');
}
if (Number.isFinite(solanaBps)) {
  check(pricingDoc.includes(`${solanaBps / 100}% / ${solanaBps} bps on Solana`), 'Pricing docs drifted from Solana agent fee default');
}

// Authority boundaries that caused real user-facing drift before.
check(
  mcpDoc.includes('never signs or broadcasts'),
  'MCP docs must state that execute_swap never signs or broadcasts',
);
check(
  read('gitbook/protocols/a2a.md').includes('does not perform managed execution'),
  'A2A docs must state that the natural-language shim does not perform managed execution',
);
check(
  read('gitbook/api-reference/perps.md').includes('does **not** currently expose an Agent API endpoint to open, close'),
  'Perps docs must state the current no-open/close execution boundary',
);

// Ban known stale integration strings across authored + generated builder surfaces.
const scanRoots = [
  'gitbook',
  'showcase/src',
  'showcase/public',
  'packages/sdk',
  'packages/sdk-python',
  'packages/openclaw',
  'skills/suwappu',
];
const textExtensions = new Set(['.md', '.mdx', '.txt', '.ts', '.tsx', '.js', '.mjs', '.json', '.toml']);
const ignoredDirs = new Set(['node_modules', 'dist', '.next']);

function walk(relative) {
  const absolute = join(root, relative);
  const stat = statSync(absolute);
  if (!stat.isDirectory()) return [relative];
  const files = [];
  for (const entry of readdirSync(absolute)) {
    if (ignoredDirs.has(entry)) continue;
    files.push(...walk(join(relative, entry)));
  }
  return files;
}

for (const relative of scanRoots.flatMap(walk)) {
  if (!textExtensions.has(extname(relative))) continue;
  const body = read(relative);
  check(!body.includes('https://docs.suwappu.bot'), `${relative}: stale docs.suwappu.bot URL`);
  check(!/@suwappu\/mcp(?!-server)/.test(body), `${relative}: stale @suwappu/mcp package name`);
  check(!/\.perps\.(open|close)\s*\(/.test(body), `${relative}: unsupported SDK perps execution method`);
}

if (failures.length) {
  console.error(`Builder-doc contract failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Builder-doc contract passed: ${toolNames.length} MCP tools, ${rateTiers.length} rate tiers, custody/pricing boundaries in sync.`);

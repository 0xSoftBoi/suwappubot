/**
 * Spec conformance check, run against Google's OWN WebMCP polyfill.
 *
 * webmcp-smoke.mjs drives the desk through a hand-rolled `modelContext` stub,
 * which proves our behaviour but not that we match the spec — a stub can be
 * wrong in the same direction as the code it tests. This runner injects
 * `vendor/webmcp-polyfill.js`, taken verbatim from GoogleChromeLabs/webmcp-tools,
 * and drives the page the way a real agent does:
 *
 *   document.modelContext.getTools()            — discovery
 *   document.modelContext.executeTool(tool, …)  — invocation
 *   the 'toolchange' event                      — live tool-set updates
 *
 * The native API needs Chrome 146+; the Chromium bundled here is 141, so the
 * reference polyfill is the closest available witness. That limitation is
 * stated rather than papered over.
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const EXEC = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.DESK_URL || 'http://localhost:4321/agent-terminal';
const POLYFILL = readFileSync(new URL('../vendor/webmcp-polyfill.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

await page.addInitScript(POLYFILL);
// Record toolchange events as they fire, before the page registers anything.
await page.addInitScript(() => {
  window.__toolchanges = 0;
  document.addEventListener('DOMContentLoaded', () => {
    document.modelContext?.addEventListener('toolchange', () => {
      window.__toolchanges += 1;
    });
  });
});

await page.route('**/public/swap/preview*', (route) => {
  const amount = Number.parseFloat(new URL(route.request().url()).searchParams.get('fromAmount') ?? '0');
  const usd = amount * 3200;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    indicative: true, executable: false, previewId: 'p', order: 'RECOMMENDED',
    fromChain: 'base', toChain: 'base',
    fromToken: { address: '0x0', symbol: 'ETH', decimals: 18 },
    toToken: { address: '0x1', symbol: 'USDC', decimals: 6 },
    fromAmount: String(amount), fromAmountUsd: usd.toFixed(2),
    toAmount: (usd * 0.997).toFixed(2), toAmountMin: (usd * 0.99).toFixed(2),
    toAmountUsd: (usd * 0.997).toFixed(2), exchangeRate: '3200', priceImpact: '0.08',
    estimatedGasUsd: '0.42', bridgeFeeUsd: '0.91', estimatedDurationSeconds: 92,
    slippage: 0.005, route: 'across', notice: 'Indicative preview only.' }) });
});
await page.route('**/public/swap/chains*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ chains: [{ id: 8453, key: 'base', name: 'Base' }] }) }));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });

check('page detects the reference polyfill as a real modelContext',
  await page.evaluate(() => typeof document.modelContext?.registerTool === 'function'));

// getTools() is async, and an async waitForFunction predicate resolves on the
// returned Promise rather than its value — so poll the polyfill's own
// synchronous registry instead. Registration is a sequential await loop, so
// waiting for "> 0" would also race a half-registered set.
await page.waitForFunction(() => (window.__webmcp_registered_tools?.size ?? 0) >= 16);

// ── discovery via the spec's own getTools() ────────────────────────
// RegisteredTool carries a live `window` reference, so it cannot cross the
// Playwright boundary — every assertion below is evaluated inside the page and
// only plain data comes back.
const shape = await page.evaluate(async () => {
  const tools = await document.modelContext.getTools();
  return {
    count: tools.length,
    names: tools.map((t) => t.name),
    missingCore: tools
      .filter((t) => !t.name || !t.description || !t.inputSchema)
      .map((t) => t.name ?? '(unnamed)'),
    notObjectSchema: tools.filter((t) => t.inputSchema?.type !== 'object').map((t) => t.name),
    readOnly: tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name),
    sameOrigin: tools.every((t) => t.origin === window.origin),
  };
});

check('getTools() returns the full registered set', shape.count >= 16, String(shape.count));
check('every tool carries name, description and inputSchema',
  shape.missingCore.length === 0, shape.missingCore.join(', '));
check('no tool leaks an unbounded input schema',
  shape.notObjectSchema.length === 0, shape.notObjectSchema.join(', '));
check('read tools are marked readOnlyHint',
  ['read_mandate', 'check_mandate', 'preview_swap', 'read_desk', 'navigate_desk']
    .every((n) => shape.readOnly.includes(n)),
  `readOnly=${shape.readOnly.join(', ')}`);
check('write tools are NOT marked readOnlyHint',
  ['propose_swap', 'propose_plan', 'amend_mandate'].every((n) => !shape.readOnly.includes(n)));
check('every tool is attributed to this origin', shape.sameOrigin);

// ── invocation via the spec's own executeTool() ────────────────────
const exec = (name, args) =>
  page.evaluate(async ([n, a]) => {
    const list = await document.modelContext.getTools();
    const tool = list.find((t) => t.name === n);
    if (!tool) throw new Error(`${n} not registered — saw ${list.map((x) => x.name).join(', ')}`);
    const r = await document.modelContext.executeTool(tool, a ?? {});
    return JSON.parse(r.content[0].text);
  }, [name, args]);

const mandate = await exec('read_mandate', {});
check('executeTool() round-trips a read tool', typeof mandate.dailyUsdCap === 'number',
  JSON.stringify(mandate).slice(0, 120));

const nav = await exec('navigate_desk', { section: 'approvals' });
check('navigation tool moves the human and reports scope',
  nav.movedTo === 'approvals' && Array.isArray(nav.toolsForThisSection), JSON.stringify(nav));

// ── toolchange fires as the human's state unlocks tools ────────────
const before = await page.evaluate(() => window.__toolchanges);
const blocked = await exec('propose_swap', {
  fromChain: 'base', toChain: 'base', fromToken: 'ETH', toToken: 'PEPE', amount: '0.5',
  rationale: 'Deliberately outside the envelope, to unlock the override channel.',
});
check('proposal reports itself blocked by the mandate',
  blocked.status === 'blocked_by_mandate_awaiting_human', blocked.status);

await page.waitForFunction(() =>
  [...(window.__webmcp_registered_tools?.keys() ?? [])].includes('request_override'));
const after = await page.evaluate(() => window.__toolchanges);
check('a toolchange event fired when request_override appeared', after > before,
  `${before} -> ${after}`);

console.log(`\n${failures === 0 ? 'SPEC CONFORMANCE OK' : `${failures} SPEC CHECK(S) FAILED`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

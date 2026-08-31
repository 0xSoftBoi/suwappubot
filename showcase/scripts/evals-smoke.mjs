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
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const EXEC = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.DESK_URL || 'http://localhost:4321/agent-terminal';
const suite = JSON.parse(readFileSync(new URL('../webmcp/evals.json', import.meta.url)));
const toolsSchema = JSON.parse(readFileSync(new URL('../webmcp/tools.schema.json', import.meta.url)));
const knownToolNames = new Set(toolsSchema.tools.map((t) => t.name));

/** Mirrors upstream: turn matcher constraints into concrete sample arguments. */
function resolve(value) {
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === 'object') {
    if ('$contains' in value) return String(value.$contains);
    if ('$pattern' in value) return String(value.$pattern).replace(/[\^$\\]/g, '');
    if ('$gte' in value) return Number(value.$gte);
    if ('$gt' in value) return Number(value.$gt) + 1;
    if ('$lte' in value) return Number(value.$lte);
    if ('$lt' in value) return Number(value.$lt) - 1;
    if ('$type' in value) return { string: 'sample', number: 1, boolean: true }[value.$type] ?? 'sample';
    if ('$any' in value) return 'sample';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
  }
  return value;
}

// A few tools need arguments that are semantically valid, not merely well-typed
// (a positive amount, a real enum member). Sample resolution can't know that,
// so the suite's own prompts supply the intent and these fill the gaps.
const SEMANTIC_DEFAULTS = {
  preview_swap: { amount: '0.05' },
  compare_routes: { amount: '0.5' },
  check_mandate: { amount: '2' },
  propose_swap: { amount: '0.05', rationale: 'Sample rationale for the smoke run.' },
  propose_price_alert: { direction: 'above', targetPrice: 5000, rationale: 'Sample rationale.' },
  propose_plan: {
    rationale: 'Sample plan rationale.',
    steps: [
      { kind: 'swap', fromChain: 'base', toChain: 'arbitrum', fromToken: 'ETH', toToken: 'USDC', amount: '0.02' },
      { kind: 'alert', symbol: 'ETH', direction: 'below', targetPrice: 3000 },
    ],
  },
  get_prices: { symbols: ['ETH'] },
  navigate_desk: { section: 'mandate' },
  amend_mandate: { perTradeUsdCap: 500, rationale: 'Sample amendment rationale.' },
};

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

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage();

await page.addInitScript(() => {
  const tools = new Map();
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      async registerTool(tool, options) {
        tools.set(tool.name, tool);
        options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
      },
      list: () => [...tools.keys()],
      call: (name, args) => {
        const t = tools.get(name);
        if (!t) throw new Error(`tool ${name} is not registered`);
        return t.execute(args ?? {}, {});
      },
    },
  });
});

// Price everything deterministically so a network blip can't read as a schema bug.
await page.route('**/public/swap/preview*', (route) => {
  const amount = Number.parseFloat(new URL(route.request().url()).searchParams.get('fromAmount') ?? '0');
  const usd = amount * 3200;
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      indicative: true, executable: false, previewId: 'p', order: 'RECOMMENDED',
      fromChain: 'base', toChain: 'base',
      fromToken: { address: '0x0', symbol: 'ETH', decimals: 18 },
      toToken: { address: '0x1', symbol: 'USDC', decimals: 6 },
      fromAmount: String(amount), fromAmountUsd: usd.toFixed(2),
      toAmount: (usd * 0.997).toFixed(2), toAmountMin: (usd * 0.99).toFixed(2),
      toAmountUsd: (usd * 0.997).toFixed(2), exchangeRate: '3200', priceImpact: '0.08',
      estimatedGasUsd: '0.42', bridgeFeeUsd: '0.91', estimatedDurationSeconds: 92,
      slippage: 0.005, route: 'across', notice: 'Indicative preview only.',
    }),
  });
});
await page.route('**/public/swap/chains*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ chains: [{ id: 8453, key: 'base', name: 'Base' }] }) }));
await page.route('**/webapp/tokens/**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json',
    body: route.request().url().includes('prices')
      ? JSON.stringify({ prices: { eth: 3200 } })
      : JSON.stringify([{ symbol: 'USDC', name: 'USD Coin', address: '0x8335', chain: 'base', decimals: 6 }]) }));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.modelContext.list().length > 0);
const registered = await page.evaluate(() => document.modelContext.list());

for (const testCase of suite) {
  for (const expected of testCase.expectedCall) {
    const name = expected.functionName;
    if (!registered.includes(name)) {
      check(`${testCase.name} → ${name}`, false, 'tool is not registered on the page');
      continue;
    }
    const args = { ...resolve(expected.arguments ?? {}), ...(SEMANTIC_DEFAULTS[name] ?? {}) };
    const result = await page.evaluate(
      ([n, a]) =>
        document.modelContext
          .call(n, a)
          .then((r) => ({ isError: Boolean(r.isError), text: r.content?.[0]?.text ?? '' }))
          .catch((e) => ({ isError: true, text: String(e?.message ?? e) })),
      [name, args],
    );
    check(`${testCase.name} → ${name}`, !result.isError, result.text.slice(0, 160));
  }
}

console.log(`\n${failures === 0 ? 'ALL EVAL CASES EXECUTED CLEANLY' : `${failures} CASE(S) FAILED`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

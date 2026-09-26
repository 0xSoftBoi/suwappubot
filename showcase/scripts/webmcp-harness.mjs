/**
 * Shared setup for the deterministic WebMCP test scripts (no LLM, no API key).
 *
 * Both `evals-smoke.mjs` and `evals-adversarial-smoke.mjs` need the same
 * three things: a spec-shaped `document.modelContext` stub, deterministic
 * price mocks so a network blip can't read as a schema bug, and the matcher
 * resolver that turns `evals.json`/`evals-adversarial.json` argument
 * constraints into concrete sample values. Pulled out once so the
 * adversarial suite doesn't fork this setup — P0.2 builds on P0.1's runner,
 * it doesn't duplicate it.
 */
import { chromium } from '@playwright/test';

/** Mirrors upstream webmcp-evals: turn matcher constraints into concrete sample arguments. */
export function resolve(value) {
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
// so each suite's own prompts supply the intent and these fill the gaps.
export const SEMANTIC_DEFAULTS = {
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

/** Launches Chromium, installs the modelContext stub + deterministic price mocks, opens BASE. */
export async function launchDeskPage(base, execPath) {
  const browser = await chromium.launch(execPath ? { executablePath: execPath } : {});
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

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.modelContext.list().length > 0);
  const registered = await page.evaluate(() => document.modelContext.list());
  return { browser, page, registered };
}

/** Calls a registered tool and normalizes the isError/text shape both suites check. */
export async function callTool(page, name, args) {
  return page.evaluate(
    ([n, a]) =>
      document.modelContext
        .call(n, a)
        .then((r) => ({ isError: Boolean(r.isError), text: r.content?.[0]?.text ?? '' }))
        .catch((e) => ({ isError: true, text: String(e?.message ?? e) })),
    [name, args],
  );
}

/**
 * Drives the Agent Desk's WebMCP tools with a spec-shaped document.modelContext
 * polyfill, so the whole human-in-the-loop flow is exercised end to end:
 * register -> preview -> propose -> human approves -> check_approval resolves
 * -> handoff tool appears and returns the signing links.
 */
import { chromium } from '@playwright/test';

// Point at a Chromium build. Playwright's own download works too; this default
// matches the CI image, which ships browsers under /opt/pw-browsers.
const EXEC = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.DESK_URL || 'http://localhost:4321/agent-terminal';
const PREVIEW = {
  indicative: true, executable: false, previewId: 'preview_q_1', order: 'RECOMMENDED',
  fromChain: 'base', toChain: 'arbitrum',
  fromToken: { address: '0x0', symbol: 'ETH', decimals: 18 },
  toToken: { address: '0x1', symbol: 'USDC', decimals: 6 },
  fromAmount: '0.5', fromAmountUsd: '1600', toAmount: '1594.21', toAmountMin: '1586.24',
  toAmountUsd: '1594.21', exchangeRate: '3188.42', priceImpact: '0.08',
  estimatedGasUsd: '0.42', bridgeFeeUsd: '0.91', estimatedDurationSeconds: 92,
  slippage: 0.005, route: 'across', notice: 'Indicative preview only.',
};

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

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
      call: (name, args, opts) => {
        const t = tools.get(name);
        if (!t) throw new Error(`tool ${name} is not registered`);
        return t.execute(args ?? {}, opts);
      },
    },
  });
});

await page.route('**/public/swap/preview*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PREVIEW) }),
);
await page.route('**/public/swap/chains*', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ chains: [{ id: 8453, key: 'base', name: 'Base' }, { id: 42161, key: 'arbitrum', name: 'Arbitrum' }] }) }),
);

const step = (label, value) => console.log(`\n### ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.modelContext.list().length > 0);

step('registered tools', await page.evaluate(() => document.modelContext.list()));

const text = (r) => JSON.parse(r.content[0].text);

step('preview_swap', text(await page.evaluate(() =>
  document.modelContext.call('preview_swap', {
    fromChain: 'base', toChain: 'arbitrum', fromToken: 'ETH', toToken: 'USDC', amount: '0.5',
  }))));

const proposal = text(await page.evaluate(() =>
  document.modelContext.call('propose_swap', {
    fromChain: 'base', toChain: 'arbitrum', fromToken: 'ETH', toToken: 'USDC', amount: '0.5',
    rationale: 'Arbitrum USDC is where your lending position is; the bridge fee is under a dollar.',
  })));
step('propose_swap', proposal);

step('handoff tool before approval', await page.evaluate(() => document.modelContext.list().includes('open_signing_handoff')));

// The agent blocks on the human's click.
const waiting = page.evaluate((id) =>
  document.modelContext.call('check_approval', { proposalId: id, waitSeconds: 30 }), proposal.proposalId);

await page.getByPlaceholder('Note back to the agent').fill('ok, but keep slippage tight');
await page.getByRole('button', { name: 'Approve' }).click();
step('check_approval (resolved by the human clicking)', text(await waiting));

await page.waitForFunction(() => document.modelContext.list().includes('open_signing_handoff'));
step('handoff tool after approval', true);

step('open_signing_handoff', text(await page.evaluate((id) =>
  document.modelContext.call('open_signing_handoff', { proposalId: id }), proposal.proposalId)));

step('open_signing_handoff replayed (must fail)', text(await page.evaluate((id) =>
  document.modelContext.call('open_signing_handoff', { proposalId: id }), proposal.proposalId)));

step('read_desk', text(await page.evaluate(() => document.modelContext.call('read_desk', {}))));

await browser.close();

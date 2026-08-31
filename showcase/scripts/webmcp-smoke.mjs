/**
 * End-to-end proof of the Agent Desk's WebMCP contract.
 *
 * Installs a spec-shaped `document.modelContext` polyfill (registerTool with
 * `{ signal }`, execute(args, options)) and drives the real page, asserting the
 * things the desk actually promises:
 *
 *   1. the static tool set registers
 *   2. the agent can read the human's mandate and dry-run against it silently
 *   3. a proposal outside the mandate is BLOCKED — Approve is disabled in the DOM
 *   4. `request_override` does not exist until something is blocked
 *   5. the agent can argue; the human allowing it unlocks Approve
 *   6. a blocked `check_approval` resolves the moment the human clicks
 *   7. `open_signing_handoff` appears only after approval, and retires once spent
 *   8. plans price every leg and roll up to one combined notional
 *   9. the receipt records rationale, verdict and human decision
 *
 * Usage:  bun run webmcp:smoke          (server on :4321)
 *         DESK_URL=... CHROMIUM_PATH=... node scripts/webmcp-smoke.mjs
 */
import { chromium } from '@playwright/test';

const EXEC = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.DESK_URL || 'http://localhost:4321/agent-terminal';

// ETH is priced at a flat $3,200 so a mandate breach is a matter of size alone.
const ETH_USD = 3200;

let failures = 0;
function check(label, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
}
const show = (label, value) =>
  console.log(`\n· ${label}\n${JSON.stringify(value, null, 2)}`);

const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

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

await page.route('**/public/swap/preview*', (route) => {
  const url = new URL(route.request().url());
  const amount = Number.parseFloat(url.searchParams.get('fromAmount') ?? '0');
  const usd = amount * ETH_USD;
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      indicative: true,
      executable: false,
      previewId: `preview_${amount}`,
      order: url.searchParams.get('order') ?? 'RECOMMENDED',
      fromChain: url.searchParams.get('fromChain'),
      toChain: url.searchParams.get('toChain'),
      fromToken: { address: '0x0', symbol: url.searchParams.get('fromToken'), decimals: 18 },
      toToken: { address: '0x1', symbol: url.searchParams.get('toToken'), decimals: 6 },
      fromAmount: String(amount),
      fromAmountUsd: usd.toFixed(2),
      toAmount: (usd * 0.997).toFixed(2),
      toAmountMin: (usd * 0.992).toFixed(2),
      toAmountUsd: (usd * 0.997).toFixed(2),
      exchangeRate: String(ETH_USD),
      priceImpact: '0.08',
      estimatedGasUsd: '0.42',
      bridgeFeeUsd: '0.91',
      estimatedDurationSeconds: 92,
      slippage: Number.parseFloat(url.searchParams.get('slippage') ?? '0.005'),
      route: 'across',
      notice: 'Indicative preview only.',
    }),
  });
});
await page.route('**/public/swap/chains*', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      chains: [
        { id: 8453, key: 'base', name: 'Base' },
        { id: 42161, key: 'arbitrum', name: 'Arbitrum' },
      ],
    }),
  }),
);
await page.route('**/webapp/tokens/prices*', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ prices: { eth: ETH_USD } }),
  }),
);

const tools = () => page.evaluate(() => document.modelContext.list());
const call = (name, args) =>
  page
    .evaluate(([n, a]) => document.modelContext.call(n, a), [name, args ?? {}])
    .then((r) => JSON.parse(r.content[0].text));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.modelContext.list().length > 0);

// ── 1. registration ────────────────────────────────────────────────
const registered = await tools();
show('registered tools', registered);
for (const name of [
  'read_mandate',
  'check_mandate',
  'preview_swap',
  'compare_routes',
  'propose_swap',
  'propose_plan',
  'check_approval',
  'export_receipt',
]) {
  check(`${name} is registered`, registered.includes(name));
}
check(
  'request_override is absent with nothing blocked',
  !registered.includes('request_override'),
);
check(
  'open_signing_handoff is absent before any approval',
  !registered.includes('open_signing_handoff'),
);

// ── 1b. the declarative half: the ticket form IS a tool ────────────
const decl = await page.evaluate(() => {
  const form = document.querySelector('form[toolname]');
  if (!form) return null;
  return {
    toolname: form.getAttribute('toolname'),
    tooldescription: form.getAttribute('tooldescription'),
    autosubmit: form.hasAttribute('toolautosubmit'),
    params: [...form.querySelectorAll('[toolparamdescription]')].map((el) => ({
      name: el.getAttribute('name'),
      desc: el.getAttribute('toolparamdescription'),
    })),
  };
});
show('declarative ticket tool', decl);
check(
  'the ticket form declares itself as a declarative WebMCP tool',
  decl?.toolname === 'fill_and_price_ticket',
);
check('the declarative tool carries a description', Boolean(decl?.tooldescription));
check(
  'every ticket field is a named, described tool parameter',
  Boolean(decl) && decl.params.length === 6 && decl.params.every((p) => p.name && p.desc),
);
check(
  'no toolautosubmit — pricing waits for an explicit submit',
  decl != null && decl.autosubmit === false,
);
await page.fill('form[toolname] input[name="amount"]', '0.2');
await page.click('form[toolname] button[type="submit"]');
await page.getByText('You receive').waitFor({ timeout: 10_000 });
check('submitting the declarative form prices the ticket for real', true);

// ── 2. the mandate is readable ─────────────────────────────────────
const mandate = await call('read_mandate');
show('read_mandate', mandate);
check('daily budget starts untouched', mandate.dailyRemainingUsd === mandate.dailyUsdCap);
check('mandate states it is not enforcement', typeof mandate.notEnforcement === 'string');

// ── 3. a silent dry-run inside the envelope ────────────────────────
const inside = await call('check_mandate', {
  fromChain: 'base',
  toChain: 'base',
  fromToken: 'ETH',
  toToken: 'USDC',
  amount: '0.05', // $160 — under the $250 per-trade cap
});
show('check_mandate (inside)', inside);
check('small trade is inside the mandate', inside.withinMandate === true);

const outside = await call('check_mandate', {
  fromChain: 'base',
  toChain: 'base',
  fromToken: 'ETH',
  toToken: 'PEPE', // not on the allow-list, and $1,600 is over both caps
  amount: '0.5',
});
show('check_mandate (outside)', outside);
check('big off-list trade is refused', outside.withinMandate === false);
check(
  'refusal names the per-trade cap and the token list',
  outside.violations.some((v) => v.rule === 'perTradeUsdCap') &&
    outside.violations.some((v) => v.rule === 'allowedBuyTokens'),
  JSON.stringify(outside.violations.map((v) => v.rule)),
);

// ── 4. proposing it anyway lands blocked ───────────────────────────
const blocked = await call('propose_swap', {
  fromChain: 'base',
  toChain: 'base',
  fromToken: 'ETH',
  toToken: 'PEPE',
  amount: '0.5',
  rationale: 'Momentum looks strong and I think it is worth stretching the mandate here.',
});
show('propose_swap (breaks the mandate)', blocked);
check(
  'proposal reports itself blocked',
  blocked.status === 'blocked_by_mandate_awaiting_human',
  blocked.status,
);

const approveBtn = page
  .locator('li', { hasText: 'Momentum looks strong' })
  .getByRole('button', { name: /^Approve/ });
check('Approve is disabled in the DOM', await approveBtn.isDisabled());

await page.waitForFunction(() => document.modelContext.list().includes('request_override'));
check('request_override appeared once something was blocked', true);

// ── 4b. polymorphic breach cards (P0.5) ─────────────────────────────
// Anderson et al., CHI 2015: a repeated identical warning habituates by the
// second exposure — visual variation restores attention. Two different
// breach classes must render two different accent/heading variants, not one
// static "blocked" template. Isolate a chain breach (small amount, allowed
// token) so it doesn't also trip the cap/daily rules and contaminate which
// variant leads.
const chainBreach = await call('propose_swap', {
  fromChain: 'base',
  toChain: 'polygon', // not on the allow-list — a chain breach, not a cap breach
  fromToken: 'ETH',
  toToken: 'USDC',
  amount: '0.01', // ~$32 — well under any cap, isolates the chain rule
  rationale: 'Testing a route on a chain outside the mandate on purpose.',
});
show('propose_swap (chain breach)', chainBreach);
check(
  'chain-breach proposal reports itself blocked',
  chainBreach.status === 'blocked_by_mandate_awaiting_human',
  chainBreach.status,
);

const capCardVariant = await page
  .locator('li', { hasText: 'Momentum looks strong' })
  .locator('[data-breach]')
  .first()
  .getAttribute('data-breach');
const chainCardVariant = await page
  .locator('li', { hasText: 'chain outside the mandate' })
  .locator('[data-breach]')
  .first()
  .getAttribute('data-breach');
show('breach card variants', { capCardVariant, chainCardVariant });
check('per-trade cap breach card is keyed to its rule', capCardVariant === 'perTradeUsdCap', capCardVariant);
check('chain breach card is keyed to allowedChains', chainCardVariant === 'allowedChains', chainCardVariant);
check(
  'the two breach classes render visibly distinct variants',
  capCardVariant !== null && chainCardVariant !== null && capCardVariant !== chainCardVariant,
  `${capCardVariant} vs ${chainCardVariant}`,
);

// ── 5. the agent argues, the human allows it once ──────────────────
const override = await call('request_override', {
  proposalId: blocked.proposalId,
  argument:
    'This breaks the token allow-list and the per-trade cap. I think it is worth one exception because you asked me to find asymmetric upside this week.',
});
show('request_override', override);
check('override was recorded', override.status === 'override_requested');

const overrideCardVariant = await page
  .locator('li', { hasText: 'Momentum looks strong' })
  .locator('[data-breach]')
  .last()
  .getAttribute('data-breach');
check(
  'the override card carries the same breach variant as the violation it argues against',
  overrideCardVariant === capCardVariant,
  overrideCardVariant,
);

const waiting = page.evaluate(
  (id) => document.modelContext.call('check_approval', { proposalId: id, waitSeconds: 30 }),
  blocked.proposalId,
);

await page.getByRole('button', { name: 'Allow once' }).click();
check('Approve unlocks after the override', await approveBtn.isEnabled());

await page
  .locator('li', { hasText: 'Momentum looks strong' })
  .getByPlaceholder('Note back to the agent')
  .fill('fine, once — do not ask again this week');
await approveBtn.click();

const resolved = JSON.parse((await waiting).content[0].text);
show('check_approval (resolved by the human clicking)', resolved);
check('agent heard the decision', resolved.decision === 'approved');
check(
  'agent heard the human note verbatim',
  resolved.humanNote === 'fine, once — do not ask again this week',
  resolved.humanNote,
);
check('verdict travelled with it', resolved.mandate?.withinMandate === false);

// ── 6. handoff appears, works once ─────────────────────────────────
await page.waitForFunction(() =>
  document.modelContext.list().includes('open_signing_handoff'),
);
const handoff = await call('open_signing_handoff', { proposalId: blocked.proposalId });
show('open_signing_handoff', handoff);
check('handoff returns a signing link', Boolean(handoff.handoff?.[0]?.terminalUrl));

// Consuming the approval retires the tool: it leaves the page's tool list
// entirely. Belt and braces — the handler refuses a replay too, in case an
// agent still holds a reference to a descriptor it fetched earlier.
await page.waitForFunction(() =>
  !document.modelContext.list().includes('open_signing_handoff'),
);
check('handoff tool retires once the approval is spent', true);
const replay = await page
  .evaluate((id) =>
    document.modelContext
      .call('open_signing_handoff', { proposalId: id })
      .then((r) => JSON.parse(r.content[0].text))
      .catch((e) => ({ error: String(e && e.message ? e.message : e) })),
  )
  .catch((e) => ({ error: String(e) }));
check('a replayed handoff cannot succeed', Boolean(replay.error), JSON.stringify(replay));

// ── 7. plans ───────────────────────────────────────────────────────
const plan = await call('propose_plan', {
  rationale: 'Move a slice to Arbitrum, then watch for a re-entry.',
  steps: [
    {
      kind: 'swap',
      fromChain: 'base',
      toChain: 'arbitrum',
      fromToken: 'ETH',
      toToken: 'USDC',
      amount: '0.02',
      note: 'get dry powder onto Arbitrum',
    },
    { kind: 'alert', symbol: 'ETH', direction: 'below', targetPrice: 3000, note: 're-entry' },
  ],
});
show('propose_plan', plan);
check('plan priced a combined notional', typeof plan.shownToHuman?.combinedUsd === 'number');
check('plan carries both legs', plan.shownToHuman?.steps === 2);
check(
  "plan's daily headroom already reflects the approved trade",
  plan.mandate.dailyRemainingUsd < mandate.dailyUsdCap,
  String(plan.mandate.dailyRemainingUsd),
);

// ── 8. the completion loop: the envelope really changes ────────────
// This is the one thing on the desk that finishes in place. Everything else
// ends in a handoff; an approved amendment rewrites the human's rules here.
const before = await call('read_mandate');
const amend = await call('amend_mandate', {
  perTradeUsdCap: 500,
  rationale: 'Two proposals hit your $250 cap in the last ten minutes; $500 matches what you actually approved.',
});
show('amend_mandate', amend);
check(
  'amendment flags that it loosens a rule',
  Array.isArray(amend.loosens) && amend.loosens.includes('perTradeUsdCap'),
  JSON.stringify(amend.loosens),
);
check(
  'mandate is unchanged while the amendment is pending',
  (await call('read_mandate')).perTradeUsdCap === before.perTradeUsdCap,
);

await page
  .locator('li', { hasText: 'Two proposals hit your $250 cap' })
  .getByRole('button', { name: /^Approve/ })
  .click();

const after = await call('read_mandate');
check(
  'approving the amendment actually rewrote the mandate',
  after.perTradeUsdCap === 500 && before.perTradeUsdCap !== 500,
  `${before.perTradeUsdCap} -> ${after.perTradeUsdCap}`,
);
check(
  'the new envelope is live for the next mandate check',
  (
    await call('check_mandate', {
      fromChain: 'base', toChain: 'base', fromToken: 'ETH', toToken: 'USDC', amount: '0.1',
    })
  ).notionalUsd <= 500,
);

// ── 9. compiling the envelope into enforceable policy ──────────────
const compiled = await call('compile_mandate_to_policy', {});
check(
  'mandate compiles to a real wallet-policy payload',
  Array.isArray(compiled.policies) &&
    compiled.policies.some((p) => p.type === 'spending_limit' && p.params?.maxAmountWei),
  JSON.stringify(compiled.policies).slice(0, 200),
);
check(
  'compilation is honest about what it could not carry over',
  Array.isArray(compiled.notes) && compiled.notes.length > 0,
);
check(
  'compiled bundle names the endpoint and says it holds no key',
  compiled.endpoint === 'POST /v1/agent/wallet/policy' &&
    /never holds one/.test(compiled.authentication ?? ''),
);

// ── 10. the receipt ────────────────────────────────────────────────
const receipt = await call('export_receipt', {});
check(
  'receipt lists both swaps, the plan and the amendment',
  receipt.proposals.length === 4,
  String(receipt.proposals.length),
);
const overridden = receipt.proposals.find((p) => p.id === blocked.proposalId);
check('receipt keeps the agent rationale', Boolean(overridden?.agentRationale));
check('receipt keeps the mandate breach', overridden?.mandate?.withinMandate === false);
check('receipt keeps the human note', Boolean(overridden?.humanNote));
check('receipt keeps the override argument', Boolean(overridden?.override?.argument));
check('receipt logs the tool calls', receipt.toolCalls.length > 5);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);

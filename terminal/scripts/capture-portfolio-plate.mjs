// Capture the Terminal's Portfolio pane as a 3160px-wide proof plate for the
// showcase (#portfolio), the same way spot-desk.png / perps-desk.png were made.
//
//   cd terminal && VITE_MOCK=1 bun run dev -- --port 5180 --host 127.0.0.1 &
//   EXE=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1) \
//   OUT=../showcase/public/proof node scripts/capture-portfolio-plate.mjs
//
// Blocked from the homepage until portfolio history is wired: EquityCurve
// renders "Portfolio history is not connected yet." (usePortfolioHistory returns
// []), which contradicts the #portfolio copy. See docs/design/backlog.md.
import { chromium } from 'playwright';
const exe = process.env.EXE, OUT = process.env.OUT || '.', URL = process.env.URL || 'http://127.0.0.1:5180/';
const b = await chromium.launch({ ...(exe ? { executablePath: exe } : {}) });
const ctx = await b.newContext({ viewport: { width: 1580, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('suwappu:onboarding-checklist-dismissed', 'true');
    localStorage.setItem('suwappu_terminal_layout', JSON.stringify({ top: 300, bottom: 520, chart: 600, orderbook: 280, order: 380 }));
  } catch {}
});
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
await p.waitForTimeout(1500);
await p.locator('[data-testid="bottom-tabs"] button', { hasText: 'Portfolio' }).first().click();
await p.waitForTimeout(2500);
const box = await p.locator('[data-testid="bottom-tabs"]').first().boundingBox();
const y = box.y, height = Math.min(900 - y - 2, 470);
const txt = await p.evaluate(() => document.body.innerText);
console.log('history wired:', !/not connected yet/i.test(txt), '| load errors:', /Couldn't load/i.test(txt));
await p.screenshot({ path: `${OUT}/portfolio-desk.png`, clip: { x: 0, y, width: 1580, height } });
console.log(`wrote ${OUT}/portfolio-desk.png (3160 x ${height * 2})`);
await b.close();

/**
 * vdebug — visual debug harness for the showcase.
 *
 * Loads a page in a real headless Chromium and reports what a developer would
 * see in DevTools but an agent normally can't: console errors/warnings, page
 * (uncaught) errors, failed/4xx-5xx network requests, a computed-style probe to
 * confirm the stylesheet actually applied, plus a full-page + top screenshot.
 *
 * This exists because element screenshots alone are a trap: an unstyled capture
 * looks identical whether the CSS is broken or the dev server is serving stale
 * 404'd chunks. The console + network + style probe disambiguates instantly.
 *
 * Usage:
 *   node scripts/vdebug.mjs                 # http://localhost:3000/
 *   node scripts/vdebug.mjs /docs           # path on localhost:3000
 *   node scripts/vdebug.mjs https://...     # any URL
 *   node scripts/vdebug.mjs / --sections    # also shot each #id / .summer-* section
 *
 * Screenshots are written to /tmp/vd-*.png. Exits non-zero if any console error,
 * page error, or failed request was seen — so it doubles as a CI smoke check.
 *
 * Requires the `playwright` dev dependency (already used by test:docs).
 */
import { chromium } from 'playwright';

const arg = process.argv[2] || '/';
const withSections = process.argv.includes('--sections');
const url = arg.startsWith('http') ? arg : `http://localhost:3000${arg.startsWith('/') ? arg : '/' + arg}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const consoleErrors = [];
const consoleWarnings = [];
const pageErrors = [];
const failed = [];

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
  else if (m.type() === 'warning') consoleWarnings.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText || 'failed'} ${strip(r.url())}`));
page.on('response', (r) => {
  if (r.status() >= 400) failed.push(`HTTP ${r.status()} ${strip(r.url())}`);
});

function strip(u) {
  return u.replace(/^https?:\/\/localhost:3000/, '');
}

await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready); // wait for webfonts before shooting
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);

await page.screenshot({ path: '/tmp/vd-full.png', fullPage: true });
await page.screenshot({ path: '/tmp/vd-top.png' });

// Style probe: prove the stylesheet is actually applied (not Times-New-Roman fallback).
const probe = await page.evaluate(() => {
  const h = document.querySelector('h1');
  const card = document.querySelector('.summer-feature, [class*="card"], article');
  const cs = h && getComputedStyle(h);
  const cc = card && getComputedStyle(card);
  return {
    styleSheets: document.styleSheets.length,
    h1Font: cs ? cs.fontFamily.slice(0, 36) : null,
    h1Size: cs ? cs.fontSize : null,
    cardRadius: cc ? cc.borderRadius : null,
    cardHasShadow: cc ? cc.boxShadow !== 'none' : null,
    looksUnstyled: cs ? /times|serif/i.test(cs.fontFamily) : null,
  };
});

if (withSections) {
  const selectors = ['#engine', '#hyperliquid', '#tempo', '#api', '#agents', '#bot'];
  let i = 0;
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (!el) continue;
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await el.screenshot({ path: `/tmp/vd-section-${i++}-${sel.replace(/\W/g, '')}.png` });
  }
}

await browser.close();

const out = (label, arr) => console.log(`\n=== ${label} (${arr.length}) ===\n${arr.join('\n') || '(none)'}`);
console.log(`URL: ${url}`);
out('CONSOLE ERRORS', consoleErrors);
out('CONSOLE WARNINGS', consoleWarnings);
out('PAGE ERRORS', pageErrors);
out('FAILED REQUESTS', failed);
console.log('\n=== STYLE PROBE ===\n' + JSON.stringify(probe, null, 2));
console.log('\nScreenshots: /tmp/vd-full.png  /tmp/vd-top.png' + (withSections ? '  /tmp/vd-section-*.png' : ''));

if (probe.looksUnstyled) console.log('\n⚠️  Page looks UNSTYLED — check for 404 CSS chunks (often a stale dev server after a prod build).');

const broke = consoleErrors.length || pageErrors.length || failed.length;
process.exit(broke ? 1 : 0);

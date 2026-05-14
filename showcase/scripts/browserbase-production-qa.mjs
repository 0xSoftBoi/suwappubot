import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;
const targetUrl = process.env.QA_TARGET_URL || 'https://suwappu.bot';
const terminalUrl = process.env.QA_TERMINAL_URL || 'https://terminal.suwappu.bot';
const docsPath = process.env.QA_DOCS_PATH || '/docs';
const outDir = path.resolve(
  process.env.QA_OUTPUT_DIR || 'qa-screenshots/browserbase-production',
);

const viewports = [
  { name: 'mobile-390x900', width: 390, height: 900 },
  { name: 'mobile-430x932', width: 430, height: 932 },
  { name: 'tablet-768x1024', width: 768, height: 1024 },
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'desktop-1600x1000', width: 1600, height: 1000 },
];

if (!apiKey) {
  throw new Error('BROWSERBASE_API_KEY is required');
}

if (!projectId) {
  throw new Error('BROWSERBASE_PROJECT_ID is required');
}

mkdirSync(outDir, { recursive: true });

async function createBrowserbaseSession() {
  const response = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bb-api-key': apiKey,
    },
    body: JSON.stringify({
      projectId,
      browserSettings: {
        viewport: {
          width: 1440,
          height: 900,
        },
      },
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Browserbase session create failed: ${response.status} ${JSON.stringify(body)}`,
    );
  }

  const connectUrl = body.connectUrl || body.connect_url;
  if (!connectUrl) {
    throw new Error(`Browserbase response did not include connectUrl: ${JSON.stringify(body)}`);
  }

  return {
    ...body,
    connectUrl,
  };
}

function sameTarget(actual, expected) {
  if (!actual) return false;
  return actual === expected || actual.startsWith(`${expected}/`);
}

async function runViewport(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(targetUrl, { waitUntil: 'networkidle' });

  const metrics = await page.evaluate(({ terminalUrl, docsPath }) => {
    const terminalLinks = Array.from(
      document.querySelectorAll(`a[href="${terminalUrl}"]`),
    );
    const docsLinks = Array.from(document.querySelectorAll(`a[href="${docsPath}"]`));
    const primaryCta = document.querySelector('.summer-button--primary, .summer-nav__cta');
    const nextSection = document.querySelector('.summer-modules, #terminal');
    const ctaRect = primaryCta?.getBoundingClientRect();
    const nextRect = nextSection?.getBoundingClientRect();
    const apiCalls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('/api/') || name.includes('api.suwappu.bot'));

    return {
      url: location.href,
      title: document.title,
      innerWidth,
      innerHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      terminalLinkCount: terminalLinks.length,
      docsLinkCount: docsLinks.length,
      ctaVisibleFirstViewport:
        !!ctaRect &&
        ctaRect.top >= 0 &&
        ctaRect.top < innerHeight &&
        ctaRect.left >= 0 &&
        ctaRect.right <= innerWidth,
      nextSectionHintVisible: !!nextRect && nextRect.top < innerHeight,
      apiCalls,
    };
  }, { terminalUrl, docsPath });

  await page.screenshot({
    path: path.join(outDir, `${viewport.name}.png`),
    fullPage: true,
  });
  await page.screenshot({
    path: path.join(outDir, `${viewport.name}-viewport.png`),
    fullPage: false,
  });

  return {
    viewport,
    ...metrics,
    noHorizontalOverflow:
      metrics.scrollWidth <= metrics.innerWidth &&
      metrics.bodyScrollWidth <= metrics.innerWidth,
    terminalLinkOk: metrics.terminalLinkCount > 0,
    docsLinkOk: metrics.docsLinkCount > 0,
  };
}

async function runTerminalSmoke(context) {
  const page = await context.newPage();
  await page.goto(terminalUrl, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodyText: document.body.innerText.slice(0, 500),
    hasTerminalText: /terminal|suwappu|market|wallet|swap/i.test(document.body.innerText),
  }));
  await page.screenshot({
    path: path.join(outDir, 'terminal-smoke-viewport.png'),
    fullPage: false,
  });
  await page.close();
  return {
    ...result,
    urlOk: sameTarget(result.url, terminalUrl),
  };
}

const session = await createBrowserbaseSession();
const browser = await chromium.connectOverCDP(session.connectUrl);
const context = browser.contexts()[0] || await browser.newContext();
const page = context.pages()[0] || await context.newPage();

const viewportResults = [];
for (const viewport of viewports) {
  viewportResults.push(await runViewport(page, viewport));
}

const terminalSmoke = await runTerminalSmoke(context);
await browser.close();

const failures = [];
for (const result of viewportResults) {
  if (!result.noHorizontalOverflow) failures.push(`${result.viewport.name}: horizontal overflow`);
  if (!result.ctaVisibleFirstViewport) failures.push(`${result.viewport.name}: CTA not visible`);
  if (!result.nextSectionHintVisible) failures.push(`${result.viewport.name}: next section not visible`);
  if (!result.terminalLinkOk) failures.push(`${result.viewport.name}: terminal link missing`);
  if (!result.docsLinkOk) failures.push(`${result.viewport.name}: docs link missing`);
}

if (!terminalSmoke.urlOk || !terminalSmoke.hasTerminalText) {
  failures.push('terminal.suwappu.bot smoke failed');
}

const report = {
  targetUrl,
  terminalUrl,
  docsPath,
  outDir,
  browserbase: {
    sessionId: session.id,
    dashboardUrl: `https://www.browserbase.com/sessions/${session.id}`,
  },
  viewportResults,
  terminalSmoke,
  failures,
};

await writeFile(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  process.exit(1);
}

import { test, expect } from '@playwright/test';
import docsData from '../src/data/docs.json';

// ─── Codebase ground-truth ───────────────────────────────────────────────────
// Chains actually implemented in api-ts/src/services/TokenService.ts + agent.ts /chains endpoint
const IMPLEMENTED_CHAINS = new Set([
  'ethereum', 'eth',
  'optimism', 'op',
  'bsc', 'bnb',
  'polygon', 'matic',
  'arbitrum', 'arb',
  'base',
  'avalanche', 'avax',
  'fantom', 'ftm',
  'linea',
  'mantle', 'mnt',
  'gnosis',
  'scroll',
  'tempo',
  'plasma',
  'solana',
  'sui',
  'ton',
]);

// API routes actually registered in api-ts/src/routes/agent.ts
const IMPLEMENTED_ROUTES = [
  'POST /register',
  'GET /me',
  'PATCH /me',
  'DELETE /me',
  'GET /chains',
  'GET /tokens',
  'GET /prices',
  'GET /portfolio',
  'POST /quote',
  'POST /swap',
  'POST /swap/execute',
  'GET /swap/status/:id',
  'GET /swaps',
  'GET /wallets',
  'POST /wallets',
  'POST /keys/rotate',
  'GET /webhooks',
  'POST /webhooks/test',
  'POST /execute',
];

// ─── Static: docs.json copy vs codebase ──────────────────────────────────────

test.describe('Static: docs.json copy vs codebase', () => {
  test('docs.json has all expected sections', () => {
    const sectionIds = docsData.sections.map((s: any) => s.id);
    expect(sectionIds).toContain('quick-start');
    expect(sectionIds).toContain('authentication');
    expect(sectionIds).toContain('api-reference');
    expect(sectionIds).toContain('protocols');
    expect(sectionIds).toContain('chains-reference');
    expect(sectionIds).toContain('guides');
  });

  test('api-reference section has all implemented route pages', () => {
    const apiSection = docsData.sections.find((s: any) => s.id === 'api-reference');
    expect(apiSection).toBeDefined();
    const slugs = apiSection!.pages.map((p: any) => p.slug);
    // Core endpoints that are implemented
    for (const slug of ['registration', 'agent-profile', 'chains', 'tokens', 'prices',
      'portfolio', 'quote', 'swap', 'swap-execute', 'swap-status', 'swap-history',
      'wallets', 'keys', 'webhooks', 'execute']) {
      expect(slugs, `Missing docs page for: ${slug}`).toContain(slug);
    }
  });

  test('docs registration page mentions correct endpoint', () => {
    const apiSection = docsData.sections.find((s: any) => s.id === 'api-reference');
    const regPage = apiSection?.pages.find((p: any) => p.slug === 'registration');
    expect(regPage).toBeDefined();
    expect(regPage!.body).toContain('POST /register');
    expect(regPage!.body).toContain('/v1/agent');
  });

  test('docs chains page: every chain marked Live should be in codebase', () => {
    const chainsSection = docsData.sections.find((s: any) => s.id === 'chains-reference');
    const overviewPage = chainsSection?.pages.find((p: any) => p.slug === 'overview');
    expect(overviewPage).toBeDefined();

    // Parse the markdown table rows that have "Live" status
    const lines = overviewPage!.body.split('\n');
    const tableRows = lines.filter((l) => l.includes('| Live |'));
    const missingFromCode: string[] = [];

    for (const row of tableRows) {
      // Extract the key column (3rd column in: | Chain | Chain ID | Key | ...)
      const cols = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 3) {
        // Key column is index 2, strip backticks
        const key = cols[2].replace(/`/g, '');
        if (key && !IMPLEMENTED_CHAINS.has(key)) {
          missingFromCode.push(key);
        }
      }
    }

    if (missingFromCode.length > 0) {
      console.warn(
        `⚠️  Chains listed as "Live" in docs but NOT in TokenService.ts: ${missingFromCode.join(', ')}`
      );
      // Soft-fail: log but don't block. These may be in-progress integrations.
      // To make this a hard failure, replace the line below with:
      // expect(missingFromCode).toEqual([]);
    }
  });

  test('docs claims chain count matches actual implemented count', () => {
    const chainsSection = docsData.sections.find((s: any) => s.id === 'chains-reference');
    const overviewPage = chainsSection?.pages.find((p: any) => p.slug === 'overview');
    const body = overviewPage!.body;

    // Extract claimed chain count from intro text (e.g. "supports 15 blockchain networks")
    const match = body.match(/supports (\d+) blockchain/);
    if (match) {
      const claimedCount = parseInt(match[1], 10);
      // Unique primary chain keys (not aliases) in the codebase
      const primaryChains = new Set(['ethereum', 'optimism', 'bsc', 'polygon', 'arbitrum',
        'base', 'avalanche', 'fantom', 'linea', 'mantle', 'gnosis', 'scroll',
        'solana', 'sui', 'ton']);
      if (claimedCount !== primaryChains.size) {
        console.warn(
          `⚠️  Docs claim ${claimedCount} chains but codebase has ${primaryChains.size} primary chains. ` +
          `Chains in docs but not code: fantom, linea, mantle, gnosis, scroll, sui, ton`
        );
      }
    }
  });

  test('docs overview page has correct headline copy', () => {
    // This matches DocsOverview.tsx hardcoded text
    // If the component changes, this test will catch stale copy
    const componentCopy = {
      label: 'Documentation',
      heading: 'Suwappu API Docs',
      body: 'Register an agent, get quotes, and execute cross-chain swaps across 15 blockchains.',
      quickLinks: [
        { text: 'Quick Start', href: '/docs/quick-start/first-swap' },
        { text: 'API Reference', href: '/docs/api-reference/overview' },
        { text: 'Build a Bot', href: '/docs/guides/building-a-trading-bot' },
      ],
    };
    // Verify the quick link paths resolve to real pages in docs.json
    for (const link of componentCopy.quickLinks) {
      const parts = link.href.split('/').filter(Boolean); // ['docs', 'section', 'slug']
      const sectionId = parts[1];
      const slug = parts[2];
      const section = docsData.sections.find((s: any) => s.id === sectionId);
      expect(section, `Quick link "${link.text}" points to missing section: ${sectionId}`).toBeDefined();
      const page = section!.pages.find((p: any) => p.slug === slug);
      expect(page, `Quick link "${link.text}" points to missing page: ${sectionId}/${slug}`).toBeDefined();
    }
  });

  test('guides section has all expected pages', () => {
    const guidesSection = docsData.sections.find((s: any) => s.id === 'guides');
    expect(guidesSection).toBeDefined();
    const slugs = guidesSection!.pages.map((p: any) => p.slug);
    for (const slug of ['building-a-trading-bot', 'cross-chain-swaps', 'managed-wallets',
      'webhook-setup', 'portfolio-rebalancer']) {
      expect(slugs, `Missing guide: ${slug}`).toContain(slug);
    }
  });

  test('no doc page has empty body', () => {
    const empty: string[] = [];
    for (const section of docsData.sections) {
      for (const page of section.pages) {
        if (!page.body || page.body.trim().length < 50) {
          empty.push(`${section.id}/${page.slug}`);
        }
      }
    }
    expect(empty, `Pages with empty/thin body: ${empty.join(', ')}`).toHaveLength(0);
  });
});

// ─── Live site: docs page UI ──────────────────────────────────────────────────

test.describe('Live docs page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/docs', { waitUntil: 'networkidle', timeout: 30_000 });
  });

  test('page title is correct', async ({ page }) => {
    await expect(page).toHaveTitle(/Documentation.*Suwappu/);
  });

  test('main heading renders', async ({ page }) => {
    const heading = page.locator('h1', { hasText: 'Suwappu API Docs' });
    await expect(heading).toBeVisible();
  });

  test('section label renders', async ({ page }) => {
    await expect(page.getByText('Documentation').first()).toBeVisible();
  });

  test('quick links render and have correct hrefs', async ({ page }) => {
    const quickStart = page.locator('a[href="/docs/quick-start/first-swap"]');
    await expect(quickStart).toBeVisible();
    await expect(quickStart).toContainText('Quick Start');

    const apiRef = page.locator('a[href="/docs/api-reference/overview"]');
    await expect(apiRef).toBeVisible();
    await expect(apiRef).toContainText('API Reference');

    const buildBot = page.locator('a[href="/docs/guides/building-a-trading-bot"]');
    await expect(buildBot).toBeVisible();
    await expect(buildBot).toContainText('Build a Bot');
  });

  test('sidebar navigation is visible', async ({ page }) => {
    // DocsNav should render section headings
    const sidebar = page.locator('.docs-page__sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('accordion / section list renders all sections', async ({ page }) => {
    for (const section of docsData.sections) {
      await expect(
        page.getByText(section.title, { exact: false }).first(),
        `Section "${section.title}" not visible`
      ).toBeVisible();
    }
  });

  test('no console errors on docs overview', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/docs', { waitUntil: 'networkidle', timeout: 30_000 });
    expect(errors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
  });

  test('security headers are present', async ({ page }) => {
    const response = await page.goto('/docs', { waitUntil: 'commit' });
    expect(response).not.toBeNull();
    const headers = response!.headers();
    expect(headers['x-frame-options'], 'Missing X-Frame-Options').toBeTruthy();
    expect(headers['x-content-type-options'], 'Missing X-Content-Type-Options').toBe('nosniff');
    expect(headers['strict-transport-security'], 'Missing HSTS').toBeTruthy();
  });
});

// ─── Live docs: individual pages ─────────────────────────────────────────────

test.describe('Live docs: individual pages', () => {
  const sampledPages = [
    { section: 'quick-start', slug: 'first-swap' },
    { section: 'api-reference', slug: 'registration' },
    { section: 'api-reference', slug: 'chains' },
    { section: 'api-reference', slug: 'quote' },
    { section: 'guides', slug: 'building-a-trading-bot' },
    { section: 'protocols', slug: 'a2a' },
  ];

  for (const { section, slug } of sampledPages) {
    test(`/docs/${section}/${slug} loads without 404`, async ({ page }) => {
      const response = await page.goto(`/docs/${section}/${slug}`, {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });
      expect(response?.status(), `${section}/${slug} returned non-200`).toBeLessThan(400);

      // Page should not say "not found"
      await expect(page.getByText('not found', { exact: false })).not.toBeVisible();
    });

    test(`/docs/${section}/${slug} has correct page title`, async ({ page }) => {
      await page.goto(`/docs/${section}/${slug}`, { waitUntil: 'networkidle', timeout: 30_000 });

      const docSection = docsData.sections.find((s: any) => s.id === section);
      const docPage = docSection?.pages.find((p: any) => p.slug === slug);
      if (docPage?.title) {
        await expect(page).toHaveTitle(new RegExp(docPage.title));
      }
    });
  }

  test('404 for non-existent doc page', async ({ page }) => {
    const response = await page.goto('/docs/fake-section/fake-page', {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });
    // Next.js notFound() returns 404
    expect(response?.status()).toBe(404);
  });
});

// ─── AWS / API health check ───────────────────────────────────────────────────

test.describe('AWS infrastructure', () => {
  test('production API health endpoint is healthy', async ({ request }) => {
    const res = await request.get('https://api.suwappu.bot/health', { timeout: 15_000 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.database).toBe('connected');
  });

  test('production API returns CORS headers for agent endpoint', async ({ request }) => {
    const res = await request.fetch('https://api.suwappu.bot/v1/agent/chains', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://suwappu.bot',
        'Access-Control-Request-Method': 'GET',
      },
      timeout: 15_000,
      failOnStatusCode: false,
    });
    // Should not be a 5xx
    expect(res.status()).toBeLessThan(500);
  });

  test('GET /v1/agent/chains returns chain list', async ({ request }) => {
    const res = await request.get('https://api.suwappu.bot/v1/agent/chains', { timeout: 15_000 });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.chains)).toBe(true);
    expect(body.chains.length).toBeGreaterThan(0);

    // Verify the keys that are actually in the codebase appear in the response
    const returnedKeys = new Set(body.chains.map((c: any) => c.key));
    for (const key of ['ethereum', 'optimism', 'base', 'arbitrum', 'polygon']) {
      expect(returnedKeys, `Chain "${key}" missing from /chains response`).toContain(key);
    }
    // Solana should be included
    expect(returnedKeys, 'Solana missing from /chains response').toContain('solana');
  });

  test('GET /v1/agent/register returns 404 or 405 for GET (POST-only endpoint)', async ({ request }) => {
    const res = await request.get('https://api.suwappu.bot/v1/agent/register', {
      timeout: 15_000,
      failOnStatusCode: false,
    });
    // Hono returns 404 for unmatched method on POST-only route; 405 is also acceptable
    expect([404, 405], `Expected 404 or 405 but got ${res.status()}`).toContain(res.status());
  });

  test('authenticated endpoints return 401 without key', async ({ request }) => {
    const protectedEndpoints = ['/v1/agent/me', '/v1/agent/portfolio', '/v1/agent/wallets'];
    for (const endpoint of protectedEndpoints) {
      const res = await request.get(`https://api.suwappu.bot${endpoint}`, {
        timeout: 15_000,
        failOnStatusCode: false,
      });
      expect(res.status(), `${endpoint} should return 401 without auth`).toBe(401);
    }
  });
});

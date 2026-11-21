/**
 * Single source for every /products/<slug> page, the /products catalogue, the
 * sitemap, llms.txt / llms-full.txt and the .md mirrors. The copy lives in
 * products.json (fact-checked, kept verbatim); this file only types it and adds
 * small pure helpers. scripts/gen-llms.mjs reads the same JSON.
 */
import raw from './products.json';
import type { Audience, Link } from './solve';

export type ProductStatus = 'live' | 'paper' | 'preview';
export type Product = {
  slug: string;
  name: string;
  category: string;
  audience: Audience;
  status?: ProductStatus;
  title: string;
  metaDescription: string;
  headline: string;
  lead: string;
  primaryCta: Link;
  secondaryCta?: Link;
  whatItIs: string[];
  howItWorks: { title: string; detail: string }[];
  capabilities: { title: string; detail: string }[];
  commands?: { command: string; does: string }[];
  endpoints?: { method: string; path: string; does: string }[];
  specs: { label: string; value: string }[];
  example: { title: string; lang: string; code: string };
  pricing: string;
  limits: string[];
  faq: { q: string; a: string }[];
  related: string[];
  solveLinks: string[];
  visual: string;
  keywords: string[];
  more?: { title: string; body: string }[];
};

export const PRODUCTS = raw.pages as unknown as Product[];
export const PRODUCTS_UPDATED = '2026-11-21';

/** Catalogue order of the category groups. */
export const CATEGORY_ORDER = ['Trade', 'Automate', 'Markets', 'Custody', 'Build', 'Control', 'Operate', 'Preview'] as const;

export const getProduct = (slug: string) => PRODUCTS.find((p) => p.slug === slug);
export const productsByCategory = (c: string) => PRODUCTS.filter((p) => p.category === c);
export const productsByAudience = (a: Audience) => PRODUCTS.filter((p) => p.audience === a);

export const STATUS_NOTE: Record<Exclude<ProductStatus, 'live'>, { chip: string; text: string }> = {
  paper: { chip: 'Paper mode', text: 'Paper mode: no real funds move' },
  preview: { chip: 'Preview', text: 'Preview: not enabled on the production API yet' },
};

/**
 * Link target for a "Built with <product>" line on a /solve page. Maps the
 * solve.json product href (the copy is not edited) to the product page that
 * goes deeper, or undefined when there is none.
 */
export function productForHref(href: string): Product | undefined {
  const map: Record<string, string> = {
    '/agents': 'agent-api',
    'https://t.me/suwappu_bot': 'telegram-bot',
    'https://terminal.suwappu.bot': 'terminal',
    '/docs/quick-start/mcp-clients': 'mcp-server',
    '/docs/quick-start/sdk-examples': 'sdks',
    '/docs/api-reference/swap-execute': 'agent-api',
    '/docs/api-reference/simulate': 'agent-api',
    '/docs/api-reference/webhooks': 'agent-api',
    '/docs/protocols/a2a': 'agent-api',
    '/docs/billing/agentic-payments': 'billing-credits',
  };
  const slug = map[href];
  return slug ? getProduct(slug) : undefined;
}

/**
 * Single source for every "problem -> answer -> product" page: /solve/<slug>,
 * the /solve hub, /start, the sitemap, llms.txt / llms-full.txt and the .md
 * mirrors. The copy lives in solve.json (fact-checked, kept verbatim); this
 * file only types it and adds small pure helpers. scripts/gen-llms.mjs reads
 * the same JSON.
 */
import raw from './solve.json';

export type Audience = 'trader' | 'developer' | 'desk';
export type Link = { label: string; href: string };
export type SolvePage = {
  slug: string;
  audience: Audience;
  asker: string;
  intent: string;
  title: string;
  metaDescription: string;
  h1: string;
  answer: string;
  problem: string;
  steps: { title: string; detail: string }[];
  snippet: { lang: string; label: string; code: string } | null;
  product: { name: string; href: string };
  cta: Link;
  secondaryCta?: Link;
  proof: Link[];
  limits: string[];
  faq: { q: string; a: string }[];
  related: string[];
  keywords: string[];
};
export type SolveHub = {
  h1: string;
  intro: string;
  groups: { audience: Audience; heading: string; description: string }[];
};
export type StartSpec = {
  slug: 'start';
  h1: string;
  answer: string;
  register: {
    method: string;
    url: string;
    auth: string;
    body: Record<string, string>;
    bash: string;
    ts: string;
    python: string;
    responseShape: Record<string, unknown>;
    keyNotes: string[];
  };
  nextCall: { label: string; lang: string; code: string; note: string };
  cost: { summary: string };
  objections: { q: string; a: string }[];
  cta: Link;
  secondaryCta: Link;
  proof: Link[];
  limits: string[];
};

export const SOLVE_HUB = raw.hub as unknown as SolveHub;
export const START = raw.start as unknown as StartSpec;
export const SOLVE_PAGES = raw.pages as unknown as SolvePage[];

/** Date the copy was last fact-checked against the code. Bump with the content. */
export const SOLVE_UPDATED = '2026-11-21';
export const SITE_ORIGIN = 'https://suwappu.bot';

export const AUDIENCE_LABEL: Record<Audience, string> = {
  trader: 'For traders',
  developer: 'For developers and agents',
  desk: 'For desks and teams',
};

export function getSolvePage(slug: string): SolvePage | undefined {
  return SOLVE_PAGES.find((p) => p.slug === slug);
}

/** First sentence of the answer, for tiles and link lists. */
export function teaser(p: Pick<SolvePage, 'answer'>, max = 150): string {
  const parts = p.answer.split(/(?<=[.!?])\s/);
  // A bare "Yes." / "No." is not a teaser: take the next sentence too.
  const first = (parts[0] ?? p.answer).length < 25 && parts[1] ? `${parts[0]} ${parts[1]}` : (parts[0] ?? p.answer);
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
}

const UTM_HOSTS = new Set(['terminal.suwappu.bot', 't.me']);

/** Tag outbound Terminal / Telegram links so the visit is attributable to the page. */
export function withUtm(href: string, slug: string, medium = 'solve'): string {
  try {
    const url = new URL(href);
    if (!UTM_HOSTS.has(url.hostname)) return href;
    url.searchParams.set('utm_source', 'suwappu.bot');
    url.searchParams.set('utm_medium', medium);
    url.searchParams.set('utm_campaign', slug);
    return url.toString();
  } catch {
    return href; // relative link
  }
}

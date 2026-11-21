import { SITE_ORIGIN, withUtm } from '@/data/solve';
import { PRODUCTS_UPDATED, STATUS_NOTE, type Product } from '@/data/products';

const abs = (href: string) => (href.startsWith('/') ? `${SITE_ORIGIN}${href}` : href);

/** Clean markdown of a /products page. Mirrors the visible page only. */
export function productMarkdown(p: Product): string {
  const out: string[] = [`# ${p.headline}`, '', `> ${p.lead}`, ''];
  if (p.status && p.status !== 'live') out.push(`**${STATUS_NOTE[p.status].text}.**`, '');
  out.push(
    `Source: ${SITE_ORIGIN}/products/${p.slug} · ${p.name} · ${p.category} · Last updated ${PRODUCTS_UPDATED} · By the Suwappu team`,
    '',
    `**Start:** [${p.primaryCta.label}](${abs(withUtm(p.primaryCta.href, p.slug, 'product'))})` +
      (p.secondaryCta ? ` · [${p.secondaryCta.label}](${abs(withUtm(p.secondaryCta.href, p.slug, 'product'))})` : ''),
    '',
    '## What it is', '', ...p.whatItIs.flatMap((t) => [t, '']),
    '## How it works', '', ...p.howItWorks.map((s, i) => `${i + 1}. **${s.title}.** ${s.detail}`), '',
    '## What you can do', '', ...p.capabilities.map((c) => `- **${c.title}.** ${c.detail}`), '',
  );
  if (p.commands?.length) out.push('## Commands', '', ...p.commands.map((c) => `- \`${c.command}\`: ${c.does}`), '');
  if (p.endpoints?.length) out.push('## Endpoints', '', ...p.endpoints.map((e) => `- \`${e.method} ${e.path}\`: ${e.does}`), '');
  out.push(`## ${p.example.title}`, '', '```' + (p.example.lang === 'telegram' ? 'text' : p.example.lang), p.example.code, '```', '');
  out.push('## The hard facts', '', ...p.specs.map((s) => `- **${s.label}:** ${s.value}`), '');
  for (const m of p.more ?? []) out.push(`## ${m.title}`, '', m.body, '');
  out.push('## Pricing', '', p.pricing, '');
  out.push('## What it does not do', '', ...p.limits.map((l) => `- ${l}`), '');
  out.push('## FAQ', '');
  for (const f of p.faq) out.push(`### ${f.q}`, '', f.a, '');
  out.push('## Related', '', ...p.related.map((r) => `- ${SITE_ORIGIN}/products/${r}`), '');
  return out.join('\n').trimEnd() + '\n';
}

import { SITE_ORIGIN, SOLVE_UPDATED, AUDIENCE_LABEL, withUtm, type SolvePage } from '@/data/solve';

const abs = (href: string) => (href.startsWith('/') ? `${SITE_ORIGIN}${href}` : href);

/** Clean markdown of a /solve page, answer first. Mirrors the visible page only. */
export function solveMarkdown(p: SolvePage): string {
  const out: string[] = [
    `# ${p.h1}`,
    '',
    `> ${p.answer}`,
    '',
    `Source: ${SITE_ORIGIN}/solve/${p.slug} · ${AUDIENCE_LABEL[p.audience]} · Last updated ${SOLVE_UPDATED} · By the Suwappu team`,
    '',
    `**Do it now:** [${p.cta.label}](${abs(withUtm(p.cta.href, p.slug))})` +
      (p.secondaryCta ? ` · [${p.secondaryCta.label}](${abs(p.secondaryCta.href)})` : '') +
      ` · Product: [${p.product.name}](${abs(p.product.href)})`,
    '',
    '## The problem',
    '',
    p.problem,
    '',
    '## How to do it',
    '',
    ...p.steps.map((s, i) => `${i + 1}. **${s.title}.** ${s.detail}`),
    '',
  ];
  if (p.snippet) {
    out.push(`### ${p.snippet.label}`, '', '```' + (p.snippet.lang === 'telegram' ? 'text' : p.snippet.lang), p.snippet.code, '```', '');
  }
  out.push('## What this does not do', '', ...p.limits.map((l) => `- ${l}`), '');
  out.push('## Check it yourself', '', ...p.proof.map((l) => `- [${l.label}](${abs(l.href)})`), '');
  out.push('## FAQ', '');
  for (const f of p.faq) out.push(`### ${f.q}`, '', f.a, '');
  return out.join('\n').trimEnd() + '\n';
}

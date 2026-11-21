import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import stats from '@/data/stats.generated.json';
import {
  SOLVE_PAGES, SOLVE_UPDATED, SITE_ORIGIN, AUDIENCE_LABEL, getSolvePage, teaser, withUtm,
} from '@/data/solve';
import { Backdrop, V3Section, RouteMap, ToolOrbit, BoundaryRings } from '@/components/v3';
import TrackedLink from '@/components/solve/TrackedLink';
import CopyCode from '@/components/solve/CopyCode';
import SolveFaq from '@/components/solve/SolveFaq';
import '../../sales-v3.css';
import '../solve-v3.css';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return SOLVE_PAGES.map((p) => ({ slug: p.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = getSolvePage((await params).slug);
  if (!p) return {};
  const url = `${SITE_ORIGIN}/solve/${p.slug}`;
  return {
    title: p.title,
    description: p.metaDescription,
    keywords: p.keywords,
    alternates: { canonical: url, types: { 'text/markdown': `${url}.md` } },
    openGraph: { type: 'article', url, title: p.title, description: p.metaDescription, siteName: 'Suwappu', modifiedTime: SOLVE_UPDATED },
    twitter: { card: 'summary_large_image', title: p.title, description: p.metaDescription },
  };
}

const ORG = { '@type': 'Organization', name: 'Suwappu', url: SITE_ORIGIN };

/** Escape `<` so a stray "</script>" in copy can never close the tag. */
const ld = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

function Art({ audience }: { audience: string }) {
  if (audience === 'developer') return <ToolOrbit count={stats.mcpToolCount}><span className="sv3-hub">MCP</span></ToolOrbit>;
  if (audience === 'desk') return <BoundaryRings quiet labels={['Agent', 'Policy']} />;
  return <RouteMap />;
}

export default async function SolvePage({ params }: { params: Promise<Params> }) {
  const p = getSolvePage((await params).slug);
  if (!p) notFound();
  const url = `${SITE_ORIGIN}/solve/${p.slug}`;
  const cta = withUtm(p.cta.href, p.slug);
  const related = p.related.map(getSolvePage).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const abs = (h: string) => (h.startsWith('/') ? `${SITE_ORIGIN}${h}` : h);

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'TechArticle',
      headline: p.h1, description: p.answer, url, mainEntityOfPage: url,
      dateModified: SOLVE_UPDATED, inLanguage: 'en', keywords: p.keywords.join(', '),
      author: ORG, publisher: ORG,
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Solve', item: `${SITE_ORIGIN}/solve` },
        { '@type': 'ListItem', position: 2, name: AUDIENCE_LABEL[p.audience], item: `${SITE_ORIGIN}/solve#${p.audience}` },
        { '@type': 'ListItem', position: 3, name: p.title, item: url },
      ],
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: p.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
    {
      '@context': 'https://schema.org', '@type': 'HowTo', name: p.h1, description: p.answer,
      step: p.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.title, text: s.detail })),
    },
  ];

  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light sv3-page sv" data-audience={p.audience}>
      {jsonLd.map((o, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(o) }} />
      ))}
      <SummerNav />
      <main id="main-content">
        <div className="summer-shell mkt-page">
          <div className="sv3-heroband sv-heroband">
            <Backdrop kind="grid" />
            <nav className="sv-crumbs" aria-label="Breadcrumb">
              <ol>
                <li><a href="/solve">Solve</a></li>
                <li><a href={`/solve#${p.audience}`}>{AUDIENCE_LABEL[p.audience]}</a></li>
                <li aria-current="page">{p.title}</li>
              </ol>
            </nav>
            <header className="sv-hero">
              <div className="sv-hero__main">
                <p className="sv-meta">
                  <span className="sv-chip">{AUDIENCE_LABEL[p.audience]}</span>
                  <span>Last updated <time dateTime={SOLVE_UPDATED}>{SOLVE_UPDATED}</time></span>
                  <span>By the Suwappu team</span>
                </p>
                <h1 className="sv-h1">{p.h1}</h1>
                <div className="sv-answer">
                  <span className="sv-answer__label">Short answer</span>
                  <p>{p.answer}</p>
                </div>
                <div className="sv-actions">
                  <TrackedLink href={cta} surface="solve" slug={p.slug} kind="primary" className="summer-button summer-button--primary">
                    {p.cta.label}
                  </TrackedLink>
                  {p.secondaryCta && (
                    <TrackedLink href={withUtm(p.secondaryCta.href, p.slug)} surface="solve" slug={p.slug} kind="secondary" className="summer-button summer-button--secondary">
                      {p.secondaryCta.label}
                    </TrackedLink>
                  )}
                </div>
                <p className="sv-product">
                  Built with <TrackedLink href={p.product.href} surface="solve" slug={p.slug} kind="product" className="sv-product__link">{p.product.name} →</TrackedLink>
                </p>
              </div>
              <div className="sv-art" aria-hidden="true"><Art audience={p.audience} /></div>
            </header>
          </div>

          <div className="sv-body">
            <section className="sv-sec" aria-labelledby="problem">
              <h2 id="problem">The problem</h2>
              <p className="sv-lede">{p.problem}</p>
            </section>

            <section className="sv-sec" aria-labelledby="how">
              <h2 id="how">How to do it</h2>
              <ol className="sv-steps">
                {p.steps.map((s) => (
                  <li key={s.title}><strong>{s.title}</strong><span>{s.detail}</span></li>
                ))}
              </ol>
              {p.snippet && <CopyCode code={p.snippet.code} lang={p.snippet.lang} label={p.snippet.label} slug={p.slug} />}
            </section>

            <section className="sv-sec sv-limits" aria-labelledby="limits">
              <p className="sv-limits__kicker">Stated plainly</p>
              <h2 id="limits">What this does not do</h2>
              <ul>{p.limits.map((l) => <li key={l}>{l}</li>)}</ul>
            </section>

            <section className="sv-sec" aria-labelledby="proof">
              <h2 id="proof">Check it yourself</h2>
              <ul className="sv-proof">
                {p.proof.map((l) => (
                  <li key={l.href}>
                    <TrackedLink href={l.href} surface="solve" slug={p.slug} kind="proof">
                      {l.label} <span aria-hidden="true">{/^https?:/.test(l.href) ? '↗' : '→'}</span>
                    </TrackedLink>
                  </li>
                ))}
              </ul>
            </section>

            <section className="sv-sec" aria-labelledby="faq">
              <h2 id="faq">Questions people ask</h2>
              <SolveFaq items={p.faq} />
            </section>
          </div>

          <V3Section tone="dark" variant="bleed" className="sv-band" backdrop={<Backdrop kind="mesh-grain" />} wrap={false}>
            <div className="sv-band__in">
              <h2>{teaser(p, 110)}</h2>
              <div className="sv-actions">
                <TrackedLink href={cta} surface="solve" slug={p.slug} kind="band" className="summer-button summer-button--primary">
                  {p.cta.label}
                </TrackedLink>
                {p.secondaryCta && (
                  <TrackedLink href={withUtm(p.secondaryCta.href, p.slug)} surface="solve" slug={p.slug} kind="band" className="summer-button summer-button--secondary">
                    {p.secondaryCta.label}
                  </TrackedLink>
                )}
              </div>
            </div>
          </V3Section>

          <section className="sv-sec sv-related" aria-labelledby="related">
            <h2 id="related">Related problems</h2>
            <ul className="sv-tiles">
              {related.map((r) => (
                <li key={r.slug}>
                  <TrackedLink href={`/solve/${r.slug}`} surface="solve" slug={p.slug} kind="related" className="v3-tile sv-tile">
                    <span className="v3-tile__body">
                      <span className="v3-tile__index">{r.audience}</span>
                      <span className="v3-tile__title">{r.h1}</span>
                      <span className="v3-tile__text">{teaser(r, 120)}</span>
                      <span className="v3-tile__arrow" aria-hidden="true">→</span>
                    </span>
                  </TrackedLink>
                </li>
              ))}
            </ul>
            <p className="sv-all"><a href="/solve">Browse all problems and answers →</a></p>
          </section>
        </div>
      </main>
      <SummerFooter />
    </div>
  );
}

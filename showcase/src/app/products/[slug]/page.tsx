import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import {
  PRODUCTS, PRODUCTS_UPDATED, STATUS_NOTE, getProduct,
} from '@/data/products';
import { SITE_ORIGIN, AUDIENCE_LABEL, withUtm } from '@/data/solve';
import { Backdrop, ProblemStrip, ProductVisual } from '@/components/v3';
import TrackedLink from '@/components/solve/TrackedLink';
import CopyCode from '@/components/solve/CopyCode';
import SolveFaq from '@/components/solve/SolveFaq';
import CopyChip from '@/components/products/CopyChip';
import TryLoader from '@/components/products/TryLoader';
import { TRY } from '@/components/products/tryConfig';
import '../../sales-v3.css';
import '../../solve/solve-v3.css';
import '../product-deep.css';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = getProduct((await params).slug);
  if (!p) return {};
  const url = `${SITE_ORIGIN}/products/${p.slug}`;
  return {
    title: p.title,
    description: p.metaDescription,
    keywords: p.keywords,
    alternates: { canonical: url, types: { 'text/markdown': `${url}.md` } },
    openGraph: { type: 'website', url, title: p.title, description: p.metaDescription, siteName: 'Suwappu' },
    twitter: { card: 'summary_large_image', title: p.title, description: p.metaDescription },
  };
}

const ORG = { '@type': 'Organization', name: 'Suwappu', url: SITE_ORIGIN };
/** Escape `<` so a stray "</script>" in copy can never close the tag. */
const ld = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

/** Row layouts for the capabilities bento: spans out of 6, cycled, last row always filled. */
const ROWS = [[3, 3], [2, 2, 2], [4, 2], [2, 4]];
function spans(n: number): number[] {
  const out: number[] = [];
  for (let r = 0; out.length < n; r++) {
    const row = ROWS[r % ROWS.length];
    const left = n - out.length;
    if (left >= row.length) out.push(...row);
    else out.push(...(left === 1 ? [6] : [3, 3]));
  }
  return out.slice(0, n);
}

/** Commands worth copying start with a slash; "Panel: Swap" style rows do not. */
const copyable = (c: string) => /^\/[\w-]/.test(c);

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const p = getProduct((await params).slug);
  if (!p) notFound();
  const url = `${SITE_ORIGIN}/products/${p.slug}`;
  const cta = withUtm(p.primaryCta.href, p.slug, 'product');
  const cta2 = p.secondaryCta ? withUtm(p.secondaryCta.href, p.slug, 'product') : null;
  const related = p.related.map(getProduct).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const sp = spans(p.capabilities.length);
  const status = p.status && p.status !== 'live' ? STATUS_NOTE[p.status] : null;
  const tryCfg = TRY[p.slug];
  const priceHref = p.audience === 'trader' ? '/pricing' : '/start';
  const priceLabel = p.audience === 'trader' ? 'See pricing' : 'Get an API key';

  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'SoftwareApplication',
      name: p.name, description: p.metaDescription, url,
      applicationCategory: p.audience === 'trader' ? 'FinanceApplication' : 'DeveloperApplication',
      operatingSystem: 'Web', inLanguage: 'en', keywords: p.keywords.join(', '),
      dateModified: PRODUCTS_UPDATED, publisher: ORG,
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Products', item: `${SITE_ORIGIN}/products` },
        { '@type': 'ListItem', position: 2, name: p.category, item: `${SITE_ORIGIN}/products#${p.category.toLowerCase()}` },
        { '@type': 'ListItem', position: 3, name: p.name, item: url },
      ],
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: p.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ];

  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light sv3-page sv pd" data-audience={p.audience}>
      {jsonLd.map((o, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(o) }} />
      ))}
      <SummerNav />
      <main id="main-content">
        {/* 1. hero */}
        <div className="pd-hero">
          <Backdrop kind="grid" />
          <div className="summer-shell pd-in">
            <nav className="sv-crumbs" aria-label="Breadcrumb">
              <ol>
                <li><a href="/products">Products</a></li>
                <li><a href={`/products#${p.category.toLowerCase()}`}>{p.category}</a></li>
                <li aria-current="page">{p.name}</li>
              </ol>
            </nav>
            <header className="pd-hero__grid">
              <div className="pd-hero__main">
                <p className="sv-meta">
                  <span className="sv-chip">{AUDIENCE_LABEL[p.audience]}</span>
                  {status && <span className={`pd-status pd-status--${p.status}`} role="note">{status.text}</span>}
                </p>
                <h1 className="sv-h1">{p.headline}</h1>
                <p className="pd-lead">{p.lead}</p>
                <div className="sv-actions">
                  <TrackedLink href={cta} surface="product" slug={p.slug} kind="primary" className="summer-button summer-button--primary">{p.primaryCta.label}</TrackedLink>
                  {cta2 && p.secondaryCta && (
                    <TrackedLink href={cta2} surface="product" slug={p.slug} kind="secondary" className="summer-button summer-button--secondary">{p.secondaryCta.label}</TrackedLink>
                  )}
                  {tryCfg && <a href="#try" className="summer-button summer-button--secondary">Try it live</a>}
                </div>
              </div>
              <div className="pd-art v3-tone-dark" aria-hidden="true">
                <ProductVisual visual={p.visual} />
                <span className="pd-art__tag">Schematic</span>
              </div>
            </header>
          </div>
        </div>

        {/* 1b. try it: live widgets against the production API (client-only, loaded per slug) */}
        {tryCfg && (
          <section id="try" className="lv-try" aria-labelledby="try-h">
            <div className="summer-shell pd-in">
              <div className="lv-try__head">
                <h2 id="try-h">{tryCfg.title}</h2>
                <p>{tryCfg.blurb}</p>
              </div>
              <TryLoader slug={p.slug} widgets={tryCfg.widgets} />
            </div>
          </section>
        )}

        {/* 2. what it is */}
        <section className="pd-sec" aria-labelledby="what">
          <div className="summer-shell pd-in pd-what">
            <div className="pd-what__text">
              <h2 id="what">What it is</h2>
              {p.whatItIs.map((t, i) => <p key={i} className={i === 0 ? 'pd-lede pd-lede--first' : 'pd-lede'}>{t}</p>)}
            </div>
            <dl className="pd-facts" aria-label="Key facts">
              {p.specs.slice(0, 4).map((s) => (
                <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        {/* 3. how it works */}
        <section className="pd-sec pd-sec--tint" aria-labelledby="how">
          <div className="summer-shell pd-in">
            <h2 id="how" className="pd-h2">How it works</h2>
            <ol className="pd-flow">
              {p.howItWorks.map((s, i) => (
                <li key={s.title}>
                  <span className="pd-flow__n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <strong>{s.title}</strong>
                  <span>{s.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 4. capabilities */}
        <section className="pd-sec" aria-labelledby="can">
          <div className="summer-shell pd-in">
            <h2 id="can" className="pd-h2">What you can do</h2>
            <ul className="pd-bento">
              {p.capabilities.map((c, i) => (
                <li key={c.title} className={`pd-tile pd-w${sp[i]}${i % 3 === 0 ? ' pd-tile--lit' : ''}`}>
                  <span className="pd-tile__i" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{c.title}</h3>
                  <p>{c.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 5. commands / endpoints (dark navy band) */}
        {(p.commands?.length || p.endpoints?.length) ? (
          <section className="pd-sec pd-sec--dark v3-tone-dark" aria-labelledby="ref">
            <Backdrop kind="mesh-grain" />
            <div className="summer-shell pd-in">
              <h2 id="ref" className="pd-h2">{p.endpoints?.length ? 'Endpoints' : 'Commands'}</h2>
              {p.endpoints?.length ? (
                <div className="pd-scroll" tabIndex={0} role="region" aria-label="Endpoint reference">
                  <table className="pd-table pd-table--api">
                    <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">What it does</th></tr></thead>
                    <tbody>
                      {p.endpoints.map((e) => (
                        <tr key={`${e.method} ${e.path}`}>
                          <td><span className={`pd-method pd-method--${e.method.toLowerCase()}`}>{e.method}</span></td>
                          <td className="pd-path"><code>{e.path}</code><CopyChip text={e.path} slug={p.slug} lang="path" /></td>
                          <td>{e.does}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ul className="pd-cmds">
                  {p.commands!.map((c) => (
                    <li key={c.command}>
                      <code className="pd-cmd">{c.command}</code>
                      <span>{c.does}</span>
                      {copyable(c.command) && <CopyChip text={c.command} slug={p.slug} lang="command" />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}

        {/* 6. worked example */}
        <section className="pd-sec" aria-labelledby="ex">
          <div className="summer-shell pd-in">
            <h2 id="ex" className="pd-h2">{p.example.title}</h2>
            <CopyCode code={p.example.code} lang={p.example.lang} label={p.example.title} slug={p.slug} surface="product" />
          </div>
        </section>

        {/* 7. hard facts */}
        <section className="pd-sec pd-sec--tint" aria-labelledby="facts">
          <div className="summer-shell pd-in">
            <h2 id="facts" className="pd-h2">The hard facts</h2>
            <div className="pd-scroll" tabIndex={0} role="region" aria-label="Specifications">
              <table className="pd-table pd-table--spec">
                <tbody>
                  {p.specs.map((s) => (
                    <tr key={s.label}><th scope="row">{s.label}</th><td>{s.value}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {p.more?.map((m) => (
              <aside key={m.title} className="pd-more">
                <h3>{m.title}</h3>
                <p>{m.body}</p>
              </aside>
            ))}
          </div>
        </section>

        {/* 8. pricing */}
        <section className="pd-price" aria-labelledby="price">
          <div className="summer-shell pd-in pd-price__in">
            <div>
              <h2 id="price">Pricing</h2>
              <p>{p.pricing}</p>
            </div>
            <TrackedLink href={priceHref} surface="product" slug={p.slug} kind="link" className="summer-button summer-button--secondary">{priceLabel}</TrackedLink>
          </div>
        </section>

        {/* 9. limits */}
        <section className="pd-sec" aria-labelledby="limits">
          <div className="summer-shell pd-in pd-narrow">
            <div className="sv-limits">
              <p className="sv-limits__kicker">Stated plainly</p>
              <h2 id="limits">What it does not do</h2>
              <ul>{p.limits.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          </div>
        </section>

        {/* 10. FAQ */}
        <section className="pd-sec pd-sec--tint" aria-labelledby="faq">
          <div className="summer-shell pd-in pd-narrow">
            <h2 id="faq" className="pd-h2">Questions people ask</h2>
            <SolveFaq items={p.faq} />
          </div>
        </section>

        {/* 11. problems */}
        <div className="pd-sec">
          <div className="summer-shell pd-in">
            <ProblemStrip slugs={p.solveLinks} surface={`product:${p.slug}`} />
          </div>
        </div>

        {/* 12. related + closing band */}
        <section className="pd-sec" aria-labelledby="related">
          <div className="summer-shell pd-in">
            <h2 id="related" className="pd-h2">Related products</h2>
            <ul className="sv-tiles">
              {related.map((r) => (
                <li key={r.slug}>
                  <TrackedLink href={`/products/${r.slug}`} surface="product" slug={p.slug} kind="related" className="v3-tile sv-tile">
                    <span className="v3-tile__body">
                      <span className="v3-tile__index">{r.category}</span>
                      <span className="v3-tile__title">{r.name}</span>
                      <span className="v3-tile__text">{r.headline}</span>
                      <span className="v3-tile__arrow" aria-hidden="true">→</span>
                    </span>
                  </TrackedLink>
                </li>
              ))}
            </ul>
            <p className="sv-all"><a href="/products">All products →</a></p>
          </div>
        </section>

        <section className="pd-sec pd-sec--dark pd-close v3-tone-dark" aria-label="Get started">
          <Backdrop kind="mesh-grain" />
          <div className="summer-shell pd-in">
            <h2 className="pd-close__h">{p.headline}</h2>
            <div className="sv-actions">
              <TrackedLink href={cta} surface="product" slug={p.slug} kind="band" className="summer-button summer-button--primary">{p.primaryCta.label}</TrackedLink>
              {cta2 && p.secondaryCta && (
                <TrackedLink href={cta2} surface="product" slug={p.slug} kind="band" className="summer-button summer-button--secondary">{p.secondaryCta.label}</TrackedLink>
              )}
            </div>
          </div>
        </section>
      </main>
      <SummerFooter />
    </div>
  );
}

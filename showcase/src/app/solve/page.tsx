import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { SOLVE_HUB, SOLVE_PAGES, SITE_ORIGIN, teaser } from '@/data/solve';
import { Backdrop } from '@/components/v3';
import HubFilter from '@/components/solve/HubFilter';
import TrackedLink from '@/components/solve/TrackedLink';
import '../sales-v3.css';
import './solve-v3.css';

const DESC = `${SOLVE_HUB.intro} ${SOLVE_PAGES.length} problems, answered directly.`;

export const metadata: Metadata = {
  title: 'Problems Suwappu solves',
  description: DESC,
  alternates: { canonical: `${SITE_ORIGIN}/solve` },
  openGraph: { type: 'website', url: `${SITE_ORIGIN}/solve`, title: SOLVE_HUB.h1, description: DESC, siteName: 'Suwappu' },
  twitter: { card: 'summary_large_image', title: SOLVE_HUB.h1, description: DESC },
};

const tiles = SOLVE_PAGES.map((p) => ({
  slug: p.slug, audience: p.audience, h1: p.h1, teaser: teaser(p),
  hay: [p.h1, p.title, p.answer, ...p.keywords].join(' ').toLowerCase(),
}));

export default function SolveHubPage() {
  const ld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: SOLVE_HUB.h1, description: SOLVE_HUB.intro,
    url: `${SITE_ORIGIN}/solve`,
    mainEntity: { '@type': 'ItemList', itemListElement: SOLVE_PAGES.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE_ORIGIN}/solve/${p.slug}`, name: p.h1 })) },
  };
  return (
    <div className="summer-page docs-shell institutional-page v3-tone-light sv3-page sv">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />
      <SummerNav />
      <main id="main-content">
        <div className="summer-shell mkt-page">
          <div className="sv3-heroband sv-heroband">
            <Backdrop kind="grid" />
            <header className="mkt-hero sv-hubhero">
              <p className="summer-kicker">Solve</p>
              <h1>{SOLVE_HUB.h1}</h1>
              <p className="mkt-hero__lead">{SOLVE_HUB.intro}</p>
            </header>
          </div>
          <HubFilter groups={SOLVE_HUB.groups} tiles={tiles} />
          <section className="sv-hubcta" aria-label="Start building or trading">
            <p>Not sure which one is yours? Start with the thing that works in a minute.</p>
            <div className="sv-actions">
              <TrackedLink href="/start" surface="solve_hub" slug="hub" kind="primary" className="summer-button summer-button--primary">Get an API key</TrackedLink>
              <TrackedLink href="https://terminal.suwappu.bot?utm_source=suwappu.bot&utm_medium=solve&utm_campaign=hub" surface="solve_hub" slug="hub" kind="secondary" className="summer-button summer-button--secondary">Open the Terminal</TrackedLink>
            </div>
          </section>
        </div>
      </main>
      <SummerFooter />
    </div>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import StructuredData from '@/components/StructuredData';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import LiveQuote from '@/components/LiveQuote';
import OceanAtmosphere from '@/components/OceanAtmosphere';
import DepthSurfaceGL from '@/components/DepthSurfaceGL';
import ToolConstellationGL from '@/components/ToolConstellationGL';
import ProofShot from '@/components/ProofShot';
import Reveal from '@/components/Reveal';
import FaqAccordion from '@/components/FaqAccordion';
import productStats from '@/data/stats.generated.json';
import { GITHUB_URL, TELEGRAM_URL, TERMINAL_URL, MINI_APP_URL } from '@/lib/links';
import './hero-d/hero-d.css';
import './site.css';

export const metadata: Metadata = {
  title: 'Suwappu | The full-stack cross-chain trading platform',
  description:
    'Suwappu is the full-stack cross-chain trading platform: execution, routing, research, ' +
    'and portfolio management across 7+ chains, from one venue.',
};

export const revalidate = 60;

export default async function Home() {
  const h = await getTranslations('home');

  const proofLinks = [
    { label: h('evidence.status'), meta: h('evidence.statusMeta'), href: '/status', external: false },
    {
      label: h('evidence.openapi'),
      meta: h('evidence.openapiMeta'),
      href: 'https://api.suwappu.bot/v1/agent/openapi',
      external: true,
    },
    { label: 'GitHub', meta: h('evidence.githubMeta'), href: GITHUB_URL, external: true },
    { label: h('evidence.changelog'), meta: h('evidence.changelogMeta'), href: '/changelog', external: false },
  ];

  const executionSteps = [
    { number: '01', title: h('execution.intentTitle'), body: h('execution.intentBody') },
    { number: '02', title: h('execution.quoteTitle'), body: h('execution.quoteBody') },
    { number: '03', title: h('execution.simulateTitle'), body: h('execution.simulateBody') },
    { number: '04', title: h('execution.authorizeTitle'), body: h('execution.authorizeBody') },
  ];

  const executionFacts = [
    { title: h('execution.mevTitle'), body: h('execution.mevBody') },
    { title: h('execution.benchTitle'), body: h('execution.benchBody') },
  ];

  const researchFacts = [
    { title: h('research.launchTitle'), body: h('research.launchBody') },
    { title: h('research.hlTitle'), body: h('research.hlBody') },
    { title: h('research.dataTitle'), body: h('research.dataBody') },
  ];

  const portfolioFacts = [
    { title: h('portfolio.positionsTitle'), body: h('portfolio.positionsBody') },
    { title: h('portfolio.pnlTitle'), body: h('portfolio.pnlBody') },
    { title: h('portfolio.cardsTitle'), body: h('portfolio.cardsBody') },
  ];

  const governmentFacts = [
    { title: h('government.pqTitle'), body: h('government.pqBody') },
    { title: h('government.provenTitle'), body: h('government.provenBody') },
    { title: h('government.fedrampTitle'), body: h('government.fedrampBody') },
  ];

  // 01–08: what you can DO. Each links down to the capability deep-dive that
  // powers it, so the grid reads as a table of contents for the rest of the page.
  const useCases = [
    { number: '01', title: h('useCases.item01Title'), body: h('useCases.item01Body'), href: '#engine' },
    { number: '02', title: h('useCases.item02Title'), body: h('useCases.item02Body'), href: '#routing' },
    { number: '03', title: h('useCases.item03Title'), body: h('useCases.item03Body'), href: '#hyperliquid' },
    { number: '04', title: h('useCases.item04Title'), body: h('useCases.item04Body'), href: '#portfolio' },
    { number: '05', title: h('useCases.item05Title'), body: h('useCases.item05Body'), href: '#research' },
    { number: '06', title: h('useCases.item06Title'), body: h('useCases.item06Body'), href: '#routing' },
    { number: '07', title: h('useCases.item07Title'), body: h('useCases.item07Body'), href: '#terminal' },
    { number: '08', title: h('useCases.item08Title'), body: h('useCases.item08Body'), href: '#portfolio' },
  ];

  // Real surfaces without a public destination link yet (no App Store/Web
  // Store listing on the marketing site) render as plain text, matching the
  // precedent set by WHATSAPP_ENABLED in lib/links.ts: real, but not linked
  // until there is somewhere to send someone.
  const surfaces = [
    { label: h('interfaces.surfaceMiniApp'), href: MINI_APP_URL, external: true },
    { label: h('interfaces.surfaceIOS') },
    { label: h('interfaces.surfaceChrome') },
    { label: h('interfaces.surfaceWhatsApp') },
  ];

  const capabilities = [
    {
      id: 'cross-chain',
      kicker: h('markets.crossChainKicker'),
      title: h('markets.crossChainTitle'),
      body: h('markets.crossChainBody', {
        platformChains: productStats.platformChains,
        agentApiChains: productStats.agentApiChains,
      }),
    },
    {
      id: 'hyperliquid',
      kicker: 'HyperLiquid',
      title: h('markets.hyperliquidTitle'),
      body: h('markets.hyperliquidBody'),
    },
    {
      id: 'tempo',
      kicker: 'Tempo',
      title: h('markets.tempoTitle'),
      body: h('markets.tempoBody'),
    },
    {
      id: 'curve',
      kicker: 'Curve Finance',
      title: h('markets.curveTitle'),
      body: h('markets.curveBody'),
    },
  ];

  const security = [
    { title: h('security.selfCustodyTitle'), body: h('security.selfCustodyBody') },
    { title: h('security.managedTitle'), body: h('security.managedBody') },
    { title: h('security.policiesTitle'), body: h('security.policiesBody') },
  ];

  const faq = [
    {
      q: h('faq.coverageQuestion'),
      a: h('faq.coverageAnswer', {
        platformChains: productStats.platformChains,
        routerCount: productStats.routerCount,
        agentApiChains: productStats.agentApiChains,
      }),
    },
    {
      q: h('faq.venuesQuestion', { routerCount: productStats.routerCount }),
      a: h('faq.venuesAnswer'),
    },
    { q: h('faq.authorityQuestion'), a: h('faq.authorityAnswer') },
    { q: h('faq.interfacesQuestion'), a: h('faq.interfacesAnswer') },
  ];

  return (
    <>
      {/* The hero poster is the largest contentful paint. Preloading it here
          (Next hoists this into <head>) starts the fetch with the document
          rather than after React hydrates and mounts the atmosphere layer. */}
      <link rel="preload" as="image" href="/media/ocean-poster.webp" type="image/webp" />
      <StructuredData />
      <div className="hd sw sw-dark">
        <SummerNav />

        <main id="main-content">
          <div className="home-stage">
          <OceanAtmosphere
            labels={{
              soundOn: h('atmosphere.soundOn'),
              soundOff: h('atmosphere.soundOff'),
              videoLabel: h('atmosphere.videoLabel'),
            }}
          />
          <section className="home-hero" aria-labelledby="home-hero-title">
            <div className="home-hero__copy">
              <p className="home-eyebrow">{h('hero.eyebrow')}</p>
              <h1 id="home-hero-title">{h('hero.h1')}</h1>
              <p className="home-hero__lead">{h('hero.lead')}</p>

              <div className="home-actions">
                <a className="hd__btn" href={TERMINAL_URL}>{h('hero.ctaTerminal')}</a>
                <a className="hd__btn hd__btn--ghost" href="/docs">
                  {h('hero.ctaApi')}
                </a>
              </div>
              <a
                className="home-hero__telegram"
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {h('hero.ctaTelegram')} <span aria-hidden="true">→</span>
              </a>
            </div>

            <div className="home-hero__product">
              <p className="home-product-label">
                <span>{h('hero.ticketLabel')}</span>
                <span>{h('hero.ticketStatus')}</span>
              </p>
              <LiveQuote variant="dark" />
              <p className="home-product-note">{h('hero.ticketNote')}</p>
            </div>
          </section>
          </div>

          <section className="home-proofbar" aria-label={h('evidence.ariaLabel')}>
            <div className="home-proofbar__intro">
              <dl className="home-proofbar__stats">
                <div>
                  <dt>{h('evidence.platformChains')}</dt>
                  <dd>{productStats.platformChains}</dd>
                </div>
                <div>
                  <dt>{h('evidence.routingVenues')}</dt>
                  <dd>{productStats.routerCount}</dd>
                </div>
                <div>
                  <dt>{h('evidence.agentApiChains')}</dt>
                  <dd>{productStats.agentApiChains}</dd>
                </div>
              </dl>
              <small>{h('evidence.routeNote')}</small>
            </div>
            <div className="home-proofbar__links">
              {proofLinks.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                  <b aria-hidden="true">{item.external ? '↗' : '→'}</b>
                </a>
              ))}
            </div>
          </section>

          {/* Use-case grid: 01–08, what you can DO. Its own numbering track,
              separate from the capability deep-dives below — tempo runs the
              same two-track pattern (use cases, then how it's built). */}
          <section id="use-cases" className="home-section" aria-labelledby="usecases-title">
            <Reveal>
              <div className="home-section__head">
                <h2 id="usecases-title">{h('useCases.title')}</h2>
                <p className="home-section__head-lead">{h('useCases.lead')}</p>
              </div>

              <div className="home-usecases" role="list" aria-label={h('useCases.ariaLabel')}>
                {useCases.map((item) => (
                  <a key={item.number} className="home-usecase" href={item.href} role="listitem">
                    <span className="home-usecase__number">{item.number}</span>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                    <b aria-hidden="true">→</b>
                  </a>
                ))}
              </div>
            </Reveal>
          </section>

          {/* Capability deep-dives: 01–07, what's UNDER the hood. */}
          <section id="engine" className="home-section home-section--execution" aria-labelledby="execution-title">
            <Reveal>
              <div className="home-section__head home-section__head--split">
                <div>
                  <h2 id="execution-title">{h('execution.title')}</h2>
                </div>
                <p>{h('execution.lead')}</p>
              </div>

              <ol className="home-steps">
                {executionSteps.map((step) => (
                  <li key={step.number}>
                    <span className="home-step__number">{step.number}</span>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </li>
                ))}
              </ol>

              <div className="home-execution-extra">
                {executionFacts.map((fact) => (
                  <article key={fact.title}>
                    <strong>{fact.title}</strong>
                    <p>{fact.body}</p>
                  </article>
                ))}
              </div>

              <ProofShot
                src="/proof/spot-desk.png"
                width={3160}
                height={940}
                alt={h('execution.screenshotAlt')}
                caption={h('execution.screenshotCaption')}
                mobileHint={h('proof.mobileHint')}
              />
            </Reveal>
          </section>

          <section id="routing" className="home-section" aria-labelledby="markets-title">
            <Reveal>
              {/* The right column is a real rendered element (order-book ridge),
                  not a floating explainer — the sanctioned use of a split head. */}
              <div className="home-section__head home-section__head--figure">
                <div>
                  <h2 id="markets-title">{h('markets.title')}</h2>
                  <p className="home-section__head-lead">{h('markets.lead')}</p>
                </div>
                <div className="home-glfigure" aria-hidden="true">
                  <DepthSurfaceGL />
                </div>
              </div>

              <div className="home-capabilities">
                {capabilities.map((capability) => (
                  <article key={capability.id} id={capability.id}>
                    <p>{capability.kicker}</p>
                    <h3>{capability.title}</h3>
                    <span>{capability.body}</span>
                  </article>
                ))}
              </div>

              <ProofShot
                src="/proof/perps-desk.png"
                width={3160}
                height={720}
                alt={h('markets.screenshotAlt')}
                caption={h('markets.screenshotCaption')}
                mobileHint={h('proof.mobileHint')}
              />
            </Reveal>
          </section>

          <section id="research" className="home-section" aria-labelledby="research-title">
            <Reveal>
              <div className="home-section__head home-section__head--split">
                <div>
                  <h2 id="research-title">{h('research.title')}</h2>
                </div>
                <p>{h('research.lead')}</p>
              </div>
              <div className="home-execution-extra">
                {researchFacts.map((fact) => (
                  <article key={fact.title}>
                    <strong>{fact.title}</strong>
                    <p>{fact.body}</p>
                  </article>
                ))}
              </div>
              <div className="home-actions">
                <a className="hd__btn hd__btn--ghost" href="/research">{h('research.ctaResearch')}</a>
                <a className="hd__btn hd__btn--ghost" href="/signals">{h('research.ctaSignals')}</a>
              </div>
            </Reveal>
          </section>

          <section id="portfolio" className="home-section" aria-labelledby="portfolio-title">
            <Reveal>
              <div className="home-section__head home-section__head--split">
                <div>
                  <h2 id="portfolio-title">{h('portfolio.title')}</h2>
                </div>
                <p>{h('portfolio.lead')}</p>
              </div>
              <div className="home-execution-extra">
                {portfolioFacts.map((fact) => (
                  <article key={fact.title}>
                    <strong>{fact.title}</strong>
                    <p>{fact.body}</p>
                  </article>
                ))}
              </div>
              <div className="home-actions">
                <a className="hd__btn hd__btn--ghost" href={TERMINAL_URL}>{h('portfolio.cta')}</a>
              </div>
            </Reveal>
          </section>

          <section id="security" className="home-section home-section--security" aria-labelledby="security-title">
            <Reveal>
              <div className="home-security">
                <div className="home-security__intro">
                  <p className="home-eyebrow">{h('security.eyebrow')}</p>
                  <h2 id="security-title">{h('security.title')}</h2>
                  <p>{h('security.lead')}</p>
                  <a className="hd__btn hd__btn--ghost" href="/security">{h('security.cta')}</a>
                </div>

                <div className="home-security__facts">
                  {security.map((item) => (
                    <article key={item.title}>
                      <h3>{item.title}</h3>
                      <p>{item.body}</p>
                    </article>
                  ))}
                  <aside>
                    <strong>{h('security.boundaryTitle')}</strong>
                    <p>{h('security.boundaryBody')}</p>
                  </aside>
                </div>
              </div>
            </Reveal>
          </section>

          <section id="terminal" className="home-section" aria-labelledby="interfaces-title">
            <Reveal>
              {/* Right column is the MCP tool constellation — exactly
                  stats.mcpToolCount nodes from the registry the server ships. */}
              <div className="home-section__head home-section__head--figure">
                <div>
                  <h2 id="interfaces-title">{h('interfaces.title')}</h2>
                  <p className="home-section__head-lead">{h('interfaces.lead')}</p>
                </div>
                <div className="home-glfigure home-glfigure--tall" aria-hidden="true">
                  <ToolConstellationGL
                    toolCount={productStats.mcpToolCount}
                    names={productStats.mcpTools}
                  />
                </div>
              </div>

              <div
                className="home-interface-register"
                role="group"
                aria-label={h('interfaces.ariaLabel')}
              >
                <a href={TERMINAL_URL}>
                  <span>01</span><strong>{h('interfaces.terminal')}</strong><small>{h('interfaces.terminalMeta')}</small><b aria-hidden="true">→</b>
                </a>
                <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                  <span>02</span><strong>Telegram</strong><small>{h('interfaces.telegramMeta')}</small><b aria-hidden="true">↗</b>
                </a>
                <a id="agents" href="/docs">
                  <span>03</span><strong>{h('interfaces.programmatic')}</strong><small>{h('interfaces.programmaticMeta')}</small><b aria-hidden="true">→</b>
                </a>
              </div>
              <p className="home-interface-note">{h('interfaces.boundary')}</p>

              <p className="home-surfaces-label">{h('interfaces.surfacesLabel')}</p>
              <ul className="home-surfaces">
                {surfaces.map((surface) =>
                  surface.href ? (
                    <li key={surface.label}>
                      <a href={surface.href} target="_blank" rel="noopener noreferrer">{surface.label}</a>
                    </li>
                  ) : (
                    <li key={surface.label}>{surface.label}</li>
                  )
                )}
              </ul>
            </Reveal>
          </section>

          <section id="government" className="home-section" aria-labelledby="government-title">
            <Reveal>
              <div className="home-section__head home-section__head--split">
                <div>
                  <h2 id="government-title">{h('government.title')}</h2>
                </div>
                <p>{h('government.lead')}</p>
              </div>
              <div className="home-execution-extra">
                {governmentFacts.map((fact) => (
                  <article key={fact.title}>
                    <strong>{fact.title}</strong>
                    <p>{fact.body}</p>
                  </article>
                ))}
              </div>
              <div className="home-actions">
                <a className="hd__btn hd__btn--ghost" href="/government">{h('government.cta')}</a>
              </div>
            </Reveal>
          </section>

          <section className="home-section home-section--finish" aria-labelledby="faq-title">
            <Reveal>
              <div className="home-faq">
                <div className="home-section__head">
                  <h2 id="faq-title">{h('faq.title')}</h2>
                </div>
                <FaqAccordion items={faq} />
              </div>

              <div className="home-close">
                <p className="home-eyebrow">{h('close.eyebrow')}</p>
                <h2>{h('close.title')}</h2>
                <p>{h('close.lead')}</p>
                <div className="home-actions">
                  <a className="hd__btn" href={TERMINAL_URL}>{h('hero.ctaTerminal')}</a>
                  <a className="hd__btn hd__btn--ghost" href="/docs">{h('hero.ctaApi')}</a>
                </div>
                <a
                  className="home-close__telegram"
                  href={TELEGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {h('close.telegram')} <span aria-hidden="true">→</span>
                </a>
              </div>
            </Reveal>
          </section>
        </main>

        <SummerFooter />
      </div>
    </>
  );
}

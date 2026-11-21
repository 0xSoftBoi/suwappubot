import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import StructuredData from '@/components/StructuredData';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import LiveQuote from '@/components/LiveQuote';
import OceanAtmosphere from '@/components/OceanAtmosphere';
import ProofShot from '@/components/ProofShot';
import {
  Reveal, CountUp, SpotlightCard, V3Section, SectionHead, Backdrop, MiniViz, RouteMap, PipelineFlow,
  VenueRank, ChainRing, SparkCard, ToolOrbit, BoundaryRings, ProductFrame,
  type MiniKind, ProblemStrip } from '@/components/v3';
import FaqAccordion from '@/components/FaqAccordion';
import productStats from '@/data/stats.generated.json';
import { GITHUB_URL, TELEGRAM_URL, TERMINAL_URL, MINI_APP_URL } from '@/lib/links';
import './hero-d/hero-d.css';
import './site.css';
import './home-v3.css';

export const metadata: Metadata = {
  title: 'Suwappu | The full-stack cross-chain trading platform',
  description:
    'Suwappu is the full-stack cross-chain trading platform: execution, routing, research, ' +
    `and portfolio management across ${productStats.platformChains} chains, from one venue.`,
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
  const useKinds: MiniKind[] = ['swap', 'bridge', 'perps', 'copy', 'automate', 'predict', 'agent', 'compete'];
  const useSpans = ['v3-span-2', '', '', '', '', 'v3-span-2', 'v3-span-2', 'v3-span-2'];
  const capKinds: MiniKind[] = ['route', 'book', 'peg', 'curve'];
  // Real routing venues (stats.routers) for the rank diagram, in a fixed order.
  const rankVenues = ['Jupiter', 'Li.Fi', 'CoW', '1inch', 'Across', 'KyberSwap', 'OKX'].filter((v) =>
    productStats.routers.includes(v)
  );
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

        <a href="/agent-terminal" className="home-announce">
          <span className="home-announce__tag">{h('announce.tag')}</span>
          <span className="home-announce__copy">{h('announce.copy')}</span>
          <span className="home-announce__arrow" aria-hidden="true">
            →
          </span>
        </a>

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
                  <a className="hd__btn hd__btn--ghost" href="/start">
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
            </section>

            {/* The hero's visual is the real trading desk (a capture of the
                shipped product), now framed, lit and given depth. The live
                quote widget stays down in the engine section: it renders an
                honest "unavailable" state and must not be the first thing seen. */}
            <div className="hv3-heroshot">
              <ProductFrame
                src="/proof/spot-desk.png"
                width={3160}
                height={940}
                alt={h('execution.screenshotAlt')}
                title="ETH/USDC"
                flow={executionSteps.map((s) => s.title)}
                aside={<RouteMap />}
              />
            </div>
          </div>

          {/* Evidence: real numbers from stats.generated.json, counted up. */}
          <section className="hv3-proof" aria-label={h('evidence.ariaLabel')}>
            <Reveal className="hv3-proof__inner v3-glass">
              <div className="hv3-proof__stats">
                <dl>
                  <div>
                    <dd><CountUp value={productStats.platformChains} /></dd>
                    <dt>{h('evidence.platformChains')}</dt>
                  </div>
                  <div>
                    <dd><CountUp value={productStats.routerCount} /></dd>
                    <dt>{h('evidence.routingVenues')}</dt>
                  </div>
                  <div>
                    <dd><CountUp value={productStats.agentApiChains} /></dd>
                    <dt>{h('evidence.agentApiChains')}</dt>
                  </div>
                </dl>
                <small>{h('evidence.routeNote')}</small>
              </div>
              <div className="hv3-proof__links">
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
            </Reveal>
          </section>

          {/* 01 Use cases: bento with a pictogram per card. */}
          <V3Section id="use-cases" labelledBy="usecases-title" backdrop={<Backdrop kind="glow" className="hv3-bd-top" />}>
            <Reveal>
              <SectionHead id="usecases-title" title={h('useCases.title')} lead={h('useCases.lead')} />
            </Reveal>
            <Reveal stagger className="v3-bento hv3-usecases">
              {useCases.map((item, i) => (
                <SpotlightCard
                  key={item.number}
                  className={useSpans[i]}
                  href={item.href}
                  index={item.number}
                  title={item.title}
                  arrow="→"
                  visual={<MiniViz kind={useKinds[i]} />}
                >
                  {item.body}
                </SpotlightCard>
              ))}
            </Reveal>
          </V3Section>

          {/* 02 Engine: the animated intent -> authorize flow. */}
          <V3Section id="engine" labelledBy="execution-title" variant="bleed" backdrop={<><Backdrop kind="mesh" /><Backdrop kind="grain" /></>}>
            <Reveal>
              <SectionHead id="execution-title" title={h('execution.title')} lead={h('execution.lead')} />
            </Reveal>
            <Reveal className="hv3-flowwrap">
              <PipelineFlow steps={executionSteps} />
            </Reveal>
            <div className="hv3-engine">
              <Reveal stagger className="hv3-engine__facts">
                {executionFacts.map((fact) => (
                  <article key={fact.title} className="v3-glass">
                    <h3>{fact.title}</h3>
                    <p>{fact.body}</p>
                  </article>
                ))}
              </Reveal>
              {/* The live execution ticket: this section is literally about how
                  an intent becomes an inspectable execution. */}
              <Reveal className="hv3-ticket v3-glass" delay={120}>
                <p className="home-product-label">
                  <span>{h('hero.ticketLabel')}</span>
                  <span>{h('hero.ticketStatus')}</span>
                </p>
                <LiveQuote variant="dark" />
                <p className="home-product-note">{h('hero.ticketNote')}</p>
              </Reveal>
            </div>
          </V3Section>

          {/* 03 Routing: full-bleed stage (venue rank + route map), then the
              four capability cards, then the real perps capture. */}
          <V3Section id="routing" labelledBy="markets-title" variant="bleed" backdrop={<Backdrop kind="grid" />}>
            <Reveal>
              <SectionHead id="markets-title" title={h('markets.title')} lead={h('markets.lead')} />
            </Reveal>
            <Reveal className="hv3-stage v3-glass" delay={80}>
              <div className="hv3-stage__rank">
                <VenueRank venues={rankVenues} caption={h('rankCaption')} />
              </div>
              <div className="hv3-stage__map">
                <RouteMap />
              </div>
            </Reveal>

            <Reveal stagger className="v3-bento hv3-caps">
              {capabilities.map((capability, i) => (
                <SpotlightCard
                  key={capability.id}
                  id={capability.id}
                  className="v3-span-2 v3-tile--row"
                  index={capability.kicker}
                  title={capability.title}
                  visual={<MiniViz kind={capKinds[i]} />}
                >
                  {capability.body}
                </SpotlightCard>
              ))}
            </Reveal>

            <Reveal className="hv3-proofshot">
              <ProofShot
                src="/proof/perps-desk.png"
                width={3160}
                height={720}
                alt={h('markets.screenshotAlt')}
                caption={h('markets.screenshotCaption')}
                mobileHint={h('proof.mobileHint')}
              />
            </Reveal>
          </V3Section>

          {/* 04 Research: split, signal traces on the right. */}
          <V3Section id="research" labelledBy="research-title">
            <div className="v3-split v3-split--wide-visual">
              <Reveal>
                <SectionHead id="research-title" title={h('research.title')} lead={h('research.lead')} />
                <div className="home-actions">
                  <a className="hd__btn hd__btn--ghost" href="/research">{h('research.ctaResearch')}</a>
                  <a className="hd__btn hd__btn--ghost" href="/signals">{h('research.ctaSignals')}</a>
                </div>
              </Reveal>
              <Reveal stagger className="hv3-sparks">
                {researchFacts.map((fact, i) => (
                  <SparkCard key={fact.title} title={fact.title} body={fact.body} kind={(['ticks', 'line', 'bars'] as const)[i]} seed={i * 2 + 1} tag={h('schematic')} />
                ))}
              </Reveal>
            </div>
          </V3Section>

          {/* 05 Portfolio: a cream interlude, ring composition. */}
          <V3Section id="portfolio" labelledBy="portfolio-title" tone="light" variant="bleed" backdrop={<><Backdrop kind="mesh" /><Backdrop kind="grain" /></>}>
            <div className="v3-split v3-split--reverse">
              <Reveal>
                <SectionHead id="portfolio-title" title={h('portfolio.title')} lead={h('portfolio.lead')} />
                <ul className="hv3-facts">
                  {portfolioFacts.map((fact) => (
                    <li key={fact.title}>
                      <strong>{fact.title}</strong>
                      <p>{fact.body}</p>
                    </li>
                  ))}
                </ul>
                <div className="home-actions">
                  <a className="hd__btn" href={TERMINAL_URL}>{h('portfolio.cta')}</a>
                </div>
              </Reveal>
              <Reveal delay={100}>
                <ChainRing>
                  <span className="hv3-ring-num"><CountUp value={productStats.platformChains} /></span>
                  <span className="hv3-ring-label">{h('evidence.platformChains')}</span>
                </ChainRing>
              </Reveal>
            </div>
          </V3Section>

          {/* 06 Security: authority rings behind the intro. */}
          <V3Section id="security" labelledBy="security-title" backdrop={<Backdrop kind="glow" className="hv3-bd-bottom" />}>
            <Reveal className="hv3-security v3-glass">
              <div className="hv3-security__intro">
                <BoundaryRings />
                <p className="v3-kicker">{h('security.eyebrow')}</p>
                <h2 id="security-title" className="v3-head__title">{h('security.title')}</h2>
                <p className="v3-head__lead">{h('security.lead')}</p>
                <a className="hd__btn hd__btn--ghost" href="/security">{h('security.cta')}</a>
              </div>
              <div className="hv3-security__facts">
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
            </Reveal>
          </V3Section>

          {/* 07 Interfaces: the MCP tool orbit (exactly mcpToolCount nodes). */}
          <V3Section id="terminal" labelledBy="interfaces-title" variant="bleed" backdrop={<Backdrop kind="mesh" />}>
            <div className="v3-split v3-split--reverse">
              <Reveal>
                <SectionHead id="interfaces-title" title={h('interfaces.title')} lead={h('interfaces.lead')} />
                <div className="hv3-register" role="group" aria-label={h('interfaces.ariaLabel')}>
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
                <p className="hv3-note">{h('interfaces.boundary')}</p>
                <p className="hv3-surfaces-label">{h('interfaces.surfacesLabel')}</p>
                <ul className="hv3-surfaces">
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
              <Reveal delay={100}>
                <ToolOrbit count={productStats.mcpToolCount}>
                  <span className="hv3-orbit-num"><CountUp value={productStats.mcpToolCount} /></span>
                  <span className="hv3-orbit-label">MCP</span>
                </ToolOrbit>
              </Reveal>
            </div>
          </V3Section>

          {/* 08 Government: quiet band. */}
          <V3Section id="government" labelledBy="government-title" variant="band" backdrop={<Backdrop kind="grid" />}>
            <Reveal>
              <SectionHead id="government-title" align="center" title={h('government.title')} lead={h('government.lead')} />
            </Reveal>
            <Reveal stagger className="hv3-quiet">
              {governmentFacts.map((fact, i) => (
                <article key={fact.title}>
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  <h3>{fact.title}</h3>
                  <p>{fact.body}</p>
                </article>
              ))}
            </Reveal>
            <Reveal className="home-actions hv3-center">
              <a className="hd__btn hd__btn--ghost" href="/government">{h('government.cta')}</a>
            </Reveal>
          </V3Section>

          {/* 09 FAQ + close. */}
          <V3Section labelledBy="faq-title" className="hv3-finish">
            <Reveal className="home-faq">
              <div className="home-section__head">
                <h2 id="faq-title" className="v3-head__title">{h('faq.title')}</h2>
              </div>
              <FaqAccordion items={faq} />
            </Reveal>
          </V3Section>

          <div className="v3-wrap"><ProblemStrip surface="home" slugs={["cross-chain-swap-api", "telegram-trading-bot-cross-chain", "let-ai-agent-swap-tokens", "swap-usdc-base-to-solana"]} /></div>
      <section className="hv3-close v3-tone-dark" aria-label={h('close.title')}>
            <Backdrop kind="mesh" />
            <Backdrop kind="grain" />
            <Reveal className="hv3-close__inner">
              <p className="v3-kicker">{h('close.eyebrow')}</p>
              <h2 className="v3-head__title">{h('close.title')}</h2>
              <p className="v3-head__lead">{h('close.lead')}</p>
              <div className="home-actions hv3-center">
                <a className="hd__btn" href={TERMINAL_URL}>{h('hero.ctaTerminal')}</a>
                <a className="hd__btn hd__btn--ghost" href="/start">{h('hero.ctaApi')}</a>
              </div>
              <a className="home-close__telegram" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                {h('close.telegram')} <span aria-hidden="true">→</span>
              </a>
            </Reveal>
          </section>
        </main>

        <SummerFooter />
      </div>
    </>
  );
}

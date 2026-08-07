import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import StructuredData from '@/components/StructuredData';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import LiveQuote from '@/components/LiveQuote';
import ProofShot from '@/components/ProofShot';
import Reveal from '@/components/Reveal';
import FaqAccordion from '@/components/FaqAccordion';
import productStats from '@/data/stats.generated.json';
import { GITHUB_URL, TELEGRAM_URL, TERMINAL_URL } from '@/lib/links';
import './hero-d/hero-d.css';
import './site.css';

export const metadata: Metadata = {
  title: 'Suwappu | The execution layer between intent and markets',
  description:
    `Execution infrastructure with ${productStats.platformChains} platform chains, ` +
    `${productStats.routerCount} integrated routing venues, and route-specific availability ` +
    'through trading and programmatic interfaces.',
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
      <StructuredData />
      <div className="hd sw sw-dark">
        <SummerNav />

        <main id="main-content">
          <section className="home-hero" aria-labelledby="home-hero-title">
            <div className="home-hero__copy">
              <p className="home-eyebrow">{h('hero.eyebrow')}</p>
              <h1 id="home-hero-title">{h('hero.h1')}</h1>
              <p className="home-hero__lead">{h('hero.lead')}</p>

              <div className="home-actions">
                <a className="hd__btn" href={TERMINAL_URL}>{h('hero.ctaTerminal')}</a>
                <a className="hd__btn hd__btn--ghost" href="/docs/api-reference/overview">
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

          <section className="home-proofbar" aria-label={h('evidence.ariaLabel')}>
            <div className="home-proofbar__intro">
              <strong>{productStats.platformChains}</strong> {h('evidence.platformChains')}
              <span aria-hidden="true">·</span>
              <strong>{productStats.routerCount}</strong> {h('evidence.routingVenues')}
              <span aria-hidden="true">·</span>
              <strong>{productStats.agentApiChains}</strong> {h('evidence.agentApiChains')}
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

          <section id="terminal" className="home-section" aria-labelledby="interfaces-title">
            <Reveal>
              <div className="home-section__head home-section__head--split">
                <div>
                  <p className="home-eyebrow">{h('interfaces.eyebrow')}</p>
                  <h2 id="interfaces-title">{h('interfaces.title')}</h2>
                </div>
                <p>{h('interfaces.lead')}</p>
              </div>

              <div className="home-interface-register" aria-label={h('interfaces.ariaLabel')}>
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
            </Reveal>
          </section>

          <section id="engine" className="home-section home-section--execution" aria-labelledby="execution-title">
            <Reveal>
              <div className="home-section__head home-section__head--split">
                <div>
                  <p className="home-eyebrow">{h('execution.eyebrow')}</p>
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

          <section className="home-section" aria-labelledby="markets-title">
            <Reveal>
              <div className="home-section__head">
                <p className="home-eyebrow">{h('markets.eyebrow')}</p>
                <h2 id="markets-title">{h('markets.title')}</h2>
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

          <section className="home-section home-section--security" aria-labelledby="security-title">
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

          <section className="home-section home-section--finish" aria-labelledby="faq-title">
            <Reveal>
              <div className="home-faq">
                <div className="home-section__head">
                  <p className="home-eyebrow">{h('faq.eyebrow')}</p>
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

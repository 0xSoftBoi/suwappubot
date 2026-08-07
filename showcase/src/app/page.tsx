import type { Metadata } from 'next';
import StructuredData from '@/components/StructuredData';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import LiveQuote from '@/components/LiveQuote';
import ProofShot from '@/components/ProofShot';
import Reveal from '@/components/Reveal';
import FaqAccordion from '@/components/FaqAccordion';
import { getTranslations } from 'next-intl/server';
import productStats from '@/data/stats.generated.json';
import { GITHUB_URL, TELEGRAM_URL, TERMINAL_URL } from '@/lib/links';
import './hero-d/hero-d.css';
import './site.css';

export const metadata: Metadata = {
  title: 'Suwappu | Cross-chain execution for traders and builders',
  description:
    'One execution engine for traders and builders through Terminal, Telegram, REST, MCP, and SDKs. ' +
    productStats.platformChains +
    ' supported platform chains and ' +
    productStats.routerCount +
    ' integrated routing venues, with route-specific availability.',
};

export const revalidate = 60;

const PROOF_LINKS = [
  {
    label: 'Service status',
    meta: 'Live health',
    href: '/status',
    external: false,
  },
  {
    label: 'OpenAPI',
    meta: 'Machine-readable schema',
    href: 'https://api.suwappu.bot/v1/agent/openapi',
    external: true,
  },
  {
    label: 'GitHub',
    meta: 'Source',
    href: GITHUB_URL,
    external: true,
  },
  {
    label: 'Changelog',
    meta: 'What shipped',
    href: '/changelog',
    external: false,
  },
];

const EXECUTION_STEPS = [
  {
    number: '01',
    title: 'Quote',
    body: 'Request a quote for the route. Eligible routing venues depend on the chain and pair.',
  },
  {
    number: '02',
    title: 'Simulate',
    body: 'Inspect the proposed path and transaction before confirmation, so slippage and fill problems surface before execution.',
  },
  {
    number: '03',
    title: 'Sign / execute',
    body: 'Self-custody flows keep signing with you. Managed-wallet flows execute server-side under the controls attached to that key.',
  },
];

const CAPABILITIES = [
  {
    id: 'cross-chain',
    kicker: 'Cross-chain',
    title: 'Spot routing',
    body: 'Route swaps across supported networks through venues that are compatible with that specific path.',
  },
  {
    id: 'hyperliquid',
    kicker: 'HyperLiquid',
    title: 'Perpetuals + spot',
    body: 'Trade perpetuals and spot through the Suwappu Terminal and Telegram surfaces.',
  },
  {
    id: 'tempo',
    kicker: 'Tempo',
    title: 'Gas sponsorship',
    body: 'Transaction fees can be sponsored on Tempo. When sponsorship is unavailable, the swap can use the standard gas path.',
  },
];

const SECURITY = [
  {
    title: 'Self-custody',
    body: 'You sign swaps yourself by default. Builders can use unsigned-transaction flows so an agent does not hand Suwappu a private key.',
  },
  {
    title: 'Managed signing',
    body: 'Managed-wallet keys are protected with KMS-backed envelope encryption or hardware-backed signing through Turnkey, and are not stored in plaintext.',
  },
  {
    title: 'Server-side policies',
    body: 'Per-key spend limits, chain and pair allowlists, withdrawal allowlists, and TOTP controls are enforced server-side.',
  },
];

const FAQ = [
  {
    q: 'What does the platform actually cover?',
    a:
      'The generated platform inventory currently lists ' +
      productStats.platformChains +
      ' supported chains and ' +
      productStats.routerCount +
      ' integrated routing venues. Routing is chain-gated, so each request only uses venues that support its route. The agent API currently exposes ' +
      productStats.agentApiChains +
      ' chains.',
  },
  {
    q: 'Do all ' + productStats.routerCount + ' venues compete for every quote?',
    a:
      'No. Venue support varies by chain and route. Suwappu evaluates the compatible subset for the request; the quote response exposes the selected route rather than inventing a leaderboard of unavailable venues.',
  },
  {
    q: 'Who holds the signing key?',
    a:
      'You sign by default. Builders can use self-custody unsigned-transaction flows, or a managed-wallet path with protected server-side signing. Managed keys are not stored in plaintext.',
  },
  {
    q: 'How does software integrate?',
    a:
      'Use the REST API, the remote MCP server, or the TypeScript and Python SDKs. They connect to the same execution layer used by Suwappu product surfaces, with server-side policy controls available for agent keys.',
  },
];

export default async function Home() {
  const t = await getTranslations('hero');
  return (
    <>
      <StructuredData />
      <main id="main-content" className="hd sw sw-dark">
        <SummerNav />

        <section className="home-hero" aria-labelledby="home-hero-title">
          <div className="home-hero__copy">
            <p className="home-eyebrow">{t('eyebrow')}</p>
            <h1 id="home-hero-title">{t('h1')}</h1>
            <p className="home-hero__lead">{t('lead')}</p>

            <div className="home-actions">
              <a className="hd__btn" href={TERMINAL_URL}>{t('cta_terminal')}</a>
              <a className="hd__btn hd__btn--ghost" href="/docs/api-reference/overview">
                {t('cta_api')}
              </a>
            </div>
            <a
              className="home-hero__telegram"
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('cta_telegram')} <span aria-hidden="true">→</span>
            </a>
          </div>

          <div className="home-hero__product">
            <p className="home-product-label">
              <span>Real quote endpoint</span>
              <span>Live when available</span>
            </p>
            <LiveQuote variant="dark" />
            <p className="home-product-note">
              If live access is unavailable, this panel labels its checked-in production
              capture instead of presenting it as live.
            </p>
          </div>
        </section>

        <section className="home-proofbar" aria-label="Checkable product evidence">
          <div className="home-proofbar__intro">
            <strong>{productStats.platformChains}</strong> platform chains
            <span aria-hidden="true">·</span>
            <strong>{productStats.routerCount}</strong> integrated routing venues
            <span aria-hidden="true">·</span>
            <strong>{productStats.agentApiChains}</strong> agent API chains
            <small>Route availability is chain-gated.</small>
          </div>
          <div className="home-proofbar__links">
            {PROOF_LINKS.map((item) => (
              <a
                key={item.label}
                href={item.href}
                {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              >
                <span>{item.label}</span>
                <small>{item.meta}</small>
                <b aria-hidden="true">↗</b>
              </a>
            ))}
          </div>
        </section>

        <section id="terminal" className="home-section" aria-labelledby="surfaces-title">
          <Reveal>
            <div className="home-section__head">
              <p className="home-eyebrow">One engine, two ways to use it</p>
              <h2 id="surfaces-title">The trading surface changes. The execution layer does not.</h2>
            </div>

            <div className="home-audiences">
              <article className="home-audience home-audience--human">
                <p className="home-audience__label">For traders</p>
                <h3>Terminal + Telegram</h3>
                <p>
                  Use a full trading desk when you want context, or move from quote to action
                  inside chat when speed matters.
                </p>
                <div className="home-inline-links">
                  <a href={TERMINAL_URL}>Open Terminal <span aria-hidden="true">→</span></a>
                  <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
                    Telegram bot <span aria-hidden="true">→</span>
                  </a>
                </div>
              </article>

              <article id="agents" className="home-audience home-audience--builder">
                <p className="home-audience__label">For builders</p>
                <h3>REST + MCP + SDKs</h3>
                <p>
                  Quote, execute, and inspect positions from software. Pick HTTP, a remote MCP
                  server, or typed TypeScript and Python clients.
                </p>
                <div className="home-interface-pills" aria-label="Developer interfaces">
                  <span>REST API</span>
                  <span>MCP</span>
                  <span>TypeScript</span>
                  <span>Python</span>
                </div>
                <a className="home-card-link" href="/docs">
                  Read developer docs <span aria-hidden="true">→</span>
                </a>
              </article>
            </div>
          </Reveal>
        </section>

        <section id="engine" className="home-section home-section--execution" aria-labelledby="execution-title">
          <Reveal>
            <div className="home-section__head home-section__head--split">
              <div>
                <p className="home-eyebrow">Execution path</p>
                <h2 id="execution-title">From intent to a transaction you can inspect.</h2>
              </div>
              <p>
                The routing universe is broad. Each individual trade stays concrete: quote a
                supported path, simulate it, then sign or execute under the chosen custody model.
              </p>
            </div>

            <ol className="home-steps">
              {EXECUTION_STEPS.map((step) => (
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
              alt="The Suwappu Terminal showing an ETH/USDC chart, order book, and swap ticket."
              caption="Suwappu Terminal · live product capture · 31 Jul 2026"
            />
          </Reveal>
        </section>

        <section className="home-section" aria-labelledby="capabilities-title">
          <Reveal>
            <div className="home-section__head">
              <p className="home-eyebrow">Execution, not just a swap widget</p>
              <h2 id="capabilities-title">Use the same product across different trading jobs.</h2>
            </div>

            <div className="home-capabilities">
              {CAPABILITIES.map((capability) => (
                <article
                  key={capability.title}
                  id={capability.id}
                >
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
              alt="The Suwappu perps desk showing markets, live market data, and an order ticket."
              caption="HyperLiquid perps inside Suwappu · live product capture · 31 Jul 2026"
            />
          </Reveal>
        </section>

        <section className="home-section home-section--security" aria-labelledby="security-title">
          <Reveal>
            <div className="home-security">
              <div className="home-security__intro">
                <p className="home-eyebrow">Custody + controls</p>
                <h2 id="security-title">The engine moves money. The rails stay explicit.</h2>
                <p>
                  Choose self-custody or managed signing, then constrain what an automated key
                  is allowed to do.
                </p>
                <a className="hd__btn hd__btn--ghost" href="/security">Read security details</a>
              </div>

              <div className="home-security__facts">
                {SECURITY.map((item) => (
                  <article key={item.title}>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </article>
                ))}
                <aside>
                  <strong>Audit status</strong>
                  <p>
                    Wallet and key-management paths have had independent red-team review, with
                    findings tracked and remediated. SOC 2 and public third-party protocol audits
                    are not yet complete.
                  </p>
                </aside>
              </div>
            </div>
          </Reveal>
        </section>

        <section className="home-section home-section--finish" aria-labelledby="faq-title">
          <Reveal>
            <div className="home-faq">
              <div className="home-section__head">
                <p className="home-eyebrow">Before you connect</p>
                <h2 id="faq-title">The practical questions, answered plainly.</h2>
              </div>
              <FaqAccordion items={FAQ} />
            </div>

            <div className="home-close">
              <p className="home-eyebrow">Pick your surface</p>
              <h2>Trade it yourself. Or build it into your product.</h2>
              <p>Both start on the same execution engine.</p>
              <div className="home-actions">
                <a className="hd__btn" href={TERMINAL_URL}>Open Terminal</a>
                <a className="hd__btn hd__btn--ghost" href="/docs">Build with API</a>
              </div>
              <a
                className="home-close__telegram"
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Or trade in Telegram <span aria-hidden="true">→</span>
              </a>
            </div>
          </Reveal>
        </section>

        <SummerFooter />
      </main>
    </>
  );
}

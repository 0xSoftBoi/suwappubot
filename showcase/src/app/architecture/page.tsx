import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import stats from '@/data/stats.generated.json';
import { GITHUB_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Architecture & execution boundaries | Suwappu',
  description:
    'How Suwappu separates intent, routing, simulation, authorization and settlement across human, API, MCP and A2A interfaces.',
  alternates: { canonical: '/architecture' },
};

const pipeline = [
  {
    label: 'Intent',
    title: 'Normalize the request',
    body: 'Turn a human or machine request into explicit chain, asset, amount and execution constraints.',
  },
  {
    label: 'Route',
    title: 'Query eligible venues',
    body: `${stats.routerCount} providers are integrated platform-wide. The eligible set changes by chain and asset; a route only compares venues that can actually serve it.`,
  },
  {
    label: 'Simulate',
    title: 'Check before signing',
    body: 'Validate the transaction path and surface execution failure before authority is committed where the route supports simulation.',
  },
  {
    label: 'Authorize',
    title: 'Apply the custody boundary',
    body: 'Return an unsigned transaction for external signing, or apply managed-wallet policy before server-side authorization.',
  },
  {
    label: 'Settle',
    title: 'Track the outcome',
    body: 'Broadcast through the selected path, then expose status and signed webhook events so callers can reconcile state.',
  },
] as const;

const surfaces = [
  {
    label: 'Terminal / Telegram',
    title: 'Human-operated execution',
    body: 'Interactive surfaces collect the trade intent and confirmation while the routing engine handles the execution path underneath.',
  },
  {
    label: 'REST / SDK',
    title: 'Explicit programmable authority',
    body: 'The full Agent API supports quote and execution flows. Callers can use managed wallets or keep custody external and request transactions to sign themselves.',
  },
  {
    label: 'MCP / A2A',
    title: 'Capability follows the protocol boundary',
    body: 'MCP exposes discoverable tools; the historical swap tool prepares unsigned self-custody transactions. A2A is an intent/quote task layer and does not silently inherit REST execution authority.',
  },
] as const;

const boundaries = [
  {
    label: 'Keys',
    title: 'Signing is separable from routing.',
    body: 'Self-custody keeps private-key material outside Suwappu. Managed wallets use server-side signing with policy controls rather than exposing keys to the calling agent.',
  },
  {
    label: 'Policy',
    title: 'A valid quote is not authorization.',
    body: 'Spend limits, allowed chains/pairs, withdrawal controls and account authentication can constrain what managed execution is allowed to sign.',
  },
  {
    label: 'Provider',
    title: 'A route is provider-specific.',
    body: 'Liquidity, bridging and settlement providers remain distinct dependencies. The selected path should be visible rather than flattened into a claim that every venue handled the order.',
  },
  {
    label: 'State',
    title: 'Completion is reconciled, not assumed.',
    body: 'Execution status and webhook events give the caller an observable state transition after broadcast, including asynchronous cross-chain flows.',
  },
] as const;

export default function ArchitecturePage() {
  return (
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <SummerNav />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero">
          <p className="summer-kicker">Architecture / Execution model</p>
          <h1>One execution plane. Explicit authority.</h1>
          <p className="mkt-hero__lead">
            Suwappu separates discovering a route from permission to move funds. That boundary is
            what lets the same engine serve an operator, a trading terminal and an autonomous agent
            without pretending they should all have the same authority.
          </p>
        </header>

        <section className="institutional-metrics" aria-label="Architecture scope">
          <div className="institutional-metric">
            <strong>{stats.platformChains}</strong>
            <span>platform chains · product surface</span>
          </div>
          <div className="institutional-metric">
            <strong>{stats.agentApiChains}</strong>
            <span>agent API chains · programmable</span>
          </div>
          <div className="institutional-metric">
            <strong>{stats.routerCount}</strong>
            <span>routing providers · availability varies</span>
          </div>
          <div className="institutional-metric">
            <strong>2</strong>
            <span>custody modes · external or managed</span>
          </div>
        </section>

        <section className="institutional-section" aria-labelledby="pipeline-title">
          <div className="institutional-section__label">
            <span>Execution pipeline</span>
            <span>Intent → route → simulate → authorize → settle</span>
          </div>
          <div className="institutional-section__intro institutional-section__intro--stack">
            <h2 id="pipeline-title">Make every boundary inspectable.</h2>
            <p>
              The architecture is deliberately staged. A quote can be useful without granting
              signing power; an authorized transaction can be tracked without conflating broadcast
              with final settlement.
            </p>
          </div>
          <div className="institutional-register">
            {pipeline.map((step, index) => (
              <article className="institutional-row" key={step.label}>
                <span className="institutional-row__number">{String(index + 1).padStart(2, '0')}</span>
                <span className="institutional-row__label">{step.label}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="institutional-section" aria-labelledby="surfaces-title">
          <div className="institutional-section__label">
            <span>Interface authority</span>
            <span>Same engine does not mean same permissions</span>
          </div>
          <div className="institutional-section__intro institutional-section__intro--stack">
            <h2 id="surfaces-title">Protocol semantics stay intact.</h2>
            <p>
              Enterprise systems fail when an integration quietly gains authority that its parent
              protocol never promised. Each Suwappu surface is described by what it can actually do.
            </p>
          </div>
          <div className="institutional-grid">
            {surfaces.map((surface) => (
              <article className="institutional-panel" key={surface.label}>
                <span>{surface.label}</span>
                <h3>{surface.title}</h3>
                <p>{surface.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="institutional-darkband" aria-labelledby="boundaries-title">
          <div className="institutional-darkband__head institutional-darkband__head--stack">
            <h2 id="boundaries-title">Four boundaries worth threat-modeling.</h2>
            <p>
              The most important architecture decisions are not decorative boxes in a diagram. They
              are where authority, external dependency and state change hands.
            </p>
          </div>
          <div className="institutional-register">
            {boundaries.map((boundary, index) => (
              <article className="institutional-row" key={boundary.label}>
                <span className="institutional-row__number">{String(index + 1).padStart(2, '0')}</span>
                <span className="institutional-row__label">{boundary.label}</span>
                <h3>{boundary.title}</h3>
                <p>{boundary.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="institutional-section" aria-labelledby="contracts-title">
          <div className="institutional-section__label">
            <span>Contracts &amp; evidence</span>
            <span>Start from machine-readable truth</span>
          </div>
          <div className="institutional-section__intro institutional-section__intro--stack">
            <h2 id="contracts-title">Integrate from the contract, not the brochure.</h2>
            <p>
              Current schemas, supported-chain responses and source are better integration inputs
              than screenshots. Use the live API artifacts as the authority when a marketing page
              and a deploy ever disagree.
            </p>
          </div>
          <div className="institutional-grid">
            <article className="institutional-panel">
              <span>OpenAPI</span>
              <h3>Machine-readable endpoint contract.</h3>
              <p>Inspect request and response schemas directly from the deployed Agent API.</p>
              <div className="institutional-actions">
                <a className="institutional-link" href="https://api.suwappu.bot/v1/agent/openapi" target="_blank" rel="noopener noreferrer">Open spec ↗</a>
              </div>
            </article>
            <article className="institutional-panel">
              <span>Documentation</span>
              <h3>Authority and integration guides.</h3>
              <p>Quick starts, authentication, protocol notes and endpoint documentation live on one public surface.</p>
              <div className="institutional-actions">
                <a className="institutional-link" href="/docs">Read docs →</a>
              </div>
            </article>
            <article className="institutional-panel">
              <span>Source</span>
              <h3>Implementation remains inspectable.</h3>
              <p>Review the public repository, issues and changes alongside the deployed documentation.</p>
              <div className="institutional-actions">
                <a className="institutional-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
              </div>
            </article>
          </div>
        </section>

        <section className="mkt-cta" aria-labelledby="architecture-close">
          <p className="summer-kicker">Next step</p>
          <h2 id="architecture-close">Threat-model the real integration.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href="/docs/quick-start/overview">
              Build from the docs
            </a>
            <a className="summer-button summer-button--secondary" href="/security">
              Review security
            </a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}

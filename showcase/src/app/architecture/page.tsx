import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import stats from '@/data/stats.generated.json';
import { GITHUB_URL } from '@/lib/links';
import { Reveal, V3Section, SectionHead, Backdrop, ExecutionPlane } from '@/components/v3';
import '../content-v3.css';

export const metadata: Metadata = {
  title: 'Architecture & execution boundaries',
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
    <div className="summer-page docs-shell institutional-page v3-tone-light cv3-page">
      <SummerNav />
      <main id="main-content">
        <div className="cv3-hero cv3-hero--solo">
          <Backdrop kind="mesh" />
          <Backdrop kind="grid" />
          <div className="v3-wrap cv3-hero__grid">
            <header>
              <p className="v3-kicker">Architecture / Execution model</p>
              <h1>One execution plane. <em>Explicit</em> authority.</h1>
              <p className="cv3-lead">
                Suwappu separates discovering a route from permission to move funds. That boundary is
                what lets the same engine serve an operator, a trading terminal and an autonomous agent
                without pretending they should all have the same authority.
              </p>
            </header>
          </div>
        </div>

        <div className="v3-wrap">
          <Reveal>
            <section className="cv3-stats" aria-label="Architecture scope">
              <div className="cv3-stat"><strong className="cv3-stat__v">{stats.platformChains}</strong><span className="cv3-stat__l">platform chains · product surface</span></div>
              <div className="cv3-stat"><strong className="cv3-stat__v">{stats.agentApiChains}</strong><span className="cv3-stat__l">agent API chains · programmable</span></div>
              <div className="cv3-stat"><strong className="cv3-stat__v">{stats.routerCount}</strong><span className="cv3-stat__l">routing providers · availability varies</span></div>
              <div className="cv3-stat"><strong className="cv3-stat__v">2</strong><span className="cv3-stat__l">custody modes · external or managed</span></div>
            </section>
          </Reveal>
        </div>

        <V3Section tone="light" className="cv3-sec" labelledBy="pipeline-title">
          <SectionHead kicker="Intent → route → simulate → authorize → settle" title="Make every boundary inspectable." id="pipeline-title"
            lead="The architecture is deliberately staged. A quote can be useful without granting signing power; an authorized transaction can be tracked without conflating broadcast with final settlement." />
          <Reveal className="cv3-stage">
            <ExecutionPlane
              surfaces={surfaces.map((x) => x.label)}
              stages={pipeline.map((x) => x.label)}
              custody={['External signing', 'Managed policy']}
              provider="Providers"
            />
          </Reveal>
          <Reveal className="cv3-rows">
            {pipeline.map((step, index) => (
              <div className="cv3-row" key={step.label}>
                <i>{String(index + 1).padStart(2, '0')}</i>
                <strong>{step.label} · {step.title}</strong>
                <span>{step.body}</span>
              </div>
            ))}
          </Reveal>
        </V3Section>

        <V3Section tone="light" className="cv3-sec" labelledBy="surfaces-title" backdrop={<Backdrop kind="glow" />}>
          <SectionHead kicker="Same engine does not mean same permissions" title="Protocol semantics stay intact." id="surfaces-title"
            lead="Enterprise systems fail when an integration quietly gains authority that its parent protocol never promised. Each Suwappu surface is described by what it can actually do." />
          <Reveal stagger className="cv3-num-grid cv3-num-grid--3">
            {surfaces.map((surface) => (
              <article className="cv3-num" key={surface.label}>
                <span className="cv3-num__tag">{surface.label}</span>
                <h3>{surface.title}</h3>
                <p>{surface.body}</p>
              </article>
            ))}
          </Reveal>
        </V3Section>

        <V3Section tone="dark" className="cv3-sec" labelledBy="boundaries-title" backdrop={<><Backdrop kind="mesh-grain" /><Backdrop kind="grid" /></>}>
          <SectionHead kicker="Threat model" title="Four boundaries worth threat-modeling." id="boundaries-title"
            lead="The most important architecture decisions are not decorative boxes in a diagram. They are where authority, external dependency and state change hands." />
          <Reveal stagger className="cv3-num-grid cv3-num-grid--2 cv3-dark-grid">
            {boundaries.map((b, index) => (
              <article className="cv3-num" key={b.label}>
                <span className="cv3-num__n" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span className="cv3-num__tag">{b.label}</span>
                <h3>{b.title}</h3>
                <p>{b.body}</p>
              </article>
            ))}
          </Reveal>
        </V3Section>

        <V3Section tone="light" className="cv3-sec" labelledBy="contracts-title">
          <SectionHead kicker="Start from machine-readable truth" title="Integrate from the contract, not the brochure." id="contracts-title"
            lead="Current schemas, supported-chain responses and source are better integration inputs than screenshots. Use the live API artifacts as the authority when a marketing page and a deploy ever disagree." />
          <Reveal stagger className="cv3-num-grid cv3-num-grid--3">
            <article className="cv3-num">
              <span className="cv3-num__tag">OpenAPI</span>
              <h3>Machine-readable endpoint contract.</h3>
              <p>Inspect request and response schemas directly from the deployed Agent API.</p>
              <a className="cv3-num__link" href="https://api.suwappu.bot/v1/agent/openapi" target="_blank" rel="noopener noreferrer">Open spec ↗</a>
            </article>
            <article className="cv3-num">
              <span className="cv3-num__tag">Documentation</span>
              <h3>Authority and integration guides.</h3>
              <p>Quick starts, authentication, protocol notes and endpoint documentation live on one public surface.</p>
              <a className="cv3-num__link" href="/docs">Read docs →</a>
            </article>
            <article className="cv3-num">
              <span className="cv3-num__tag">Source</span>
              <h3>Implementation remains inspectable.</h3>
              <p>Review the public repository, issues and changes alongside the deployed documentation.</p>
              <a className="cv3-num__link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
            </article>
          </Reveal>
        </V3Section>

        <V3Section tone="light" className="cv3-sec cv3-pad-bottom" labelledBy="architecture-close">
          <div className="cv3-close v3-tone-dark">
            <Backdrop kind="mesh-grain" />
            <p className="v3-kicker">Next step</p>
            <h2 id="architecture-close">Threat-model the real integration.</h2>
            <div className="cv3-actions">
              <a className="summer-button summer-button--primary" href="/docs/quick-start/overview">Build from the docs</a>
              <a className="summer-button summer-button--secondary" href="/security">Review security</a>
            </div>
          </div>
        </V3Section>
      </main>
      <SummerFooter />
    </div>
  );
}

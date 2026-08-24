import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import stats from '@/data/stats.generated.json';
import { ENTERPRISE_CONTACT_PATH, GITHUB_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Enterprise execution infrastructure | Suwappu',
  description:
    `Evaluate Suwappu for trading, treasury and agent systems: ${stats.platformChains} platform chains, ` +
    `${stats.routerCount} integrated routing venues, explicit custody boundaries, policy controls, live status and public implementation evidence.`,
  alternates: { canonical: '/enterprise' },
};

const criteria = [
  {
    label: 'Execution quality',
    title: 'Inspect the route before you authorize it.',
    body:
      `${stats.routerCount} routing venues are integrated across the platform, with availability gated by chain and asset. ` +
      'Quotes expose the selected route; Suwappu does not imply that every venue competes for every order.',
  },
  {
    label: 'Authority',
    title: 'Choose where signing authority lives.',
    body:
      'Bring your own keys and receive unsigned transactions, or use managed wallets with TEE-backed signing. Spending policies, chain/pair restrictions, 2FA and withdrawal allowlists constrain managed authority.',
  },
  {
    label: 'Integration',
    title: 'One execution plane, multiple interfaces.',
    body:
      `REST, typed SDKs, MCP and A2A sit over the same execution system. The Agent API currently exposes ${stats.agentApiChains} chains; the broader bot and terminal surface covers ${stats.platformChains}.`,
  },
  {
    label: 'Operations',
    title: 'Evidence is a product surface.',
    body:
      'Live status, a public changelog, machine-readable OpenAPI, source code and research methodology give engineering and risk teams a path to verify what is actually deployed.',
  },
  {
    label: 'Commercial',
    title: 'Start self-serve; scope enterprise deliberately.',
    body:
      'Self-serve pricing is public. Enterprise engagements add dedicated rate limits and priority support; commercial terms and any service commitments are scoped with the team rather than implied on the website.',
  },
] as const;

const controls = [
  {
    label: '01 · Intent',
    title: 'Request is explicit',
    body: 'Chain, asset, amount and execution intent enter as structured inputs rather than an opaque discretionary mandate.',
  },
  {
    label: '02 · Route',
    title: 'Venues are evaluated',
    body: 'Eligible providers are queried for the requested market. Availability is route-specific and the winning path is inspectable.',
  },
  {
    label: '03 · Simulate',
    title: 'Failure is checked early',
    body: 'Execution checks and transaction simulation sit before authorization so bad fills or invalid paths can fail before signing.',
  },
  {
    label: '04 · Authorize',
    title: 'Policy gates signing',
    body: 'Self-custody keeps signing outside Suwappu. Managed execution is constrained by the account and key policies you configure.',
  },
] as const;

export default function EnterprisePage() {
  return (
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <SummerNav />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero">
          <p className="summer-kicker">Enterprise / Evaluation</p>
          <h1>Execution infrastructure you can explain.</h1>
          <p className="mkt-hero__lead">
            For teams that need more than a fast quote. Evaluate routing, signing authority,
            controls, operational evidence and integration boundaries before production traffic
            moves through Suwappu.
          </p>
        </header>

        <section className="institutional-metrics" aria-label="Platform facts">
          <div className="institutional-metric">
            <strong>{stats.platformChains}</strong>
            <span>platform chains · bot + terminal</span>
          </div>
          <div className="institutional-metric">
            <strong>{stats.routerCount}</strong>
            <span>integrated routing venues · chain-gated</span>
          </div>
          <div className="institutional-metric">
            <strong>{stats.agentApiChains}</strong>
            <span>agent API chains · live contract</span>
          </div>
          <div className="institutional-metric">
            <strong>Open</strong>
            <span>status · source · OpenAPI · research</span>
          </div>
        </section>

        <section className="institutional-section" aria-labelledby="evaluation-title">
          <div className="institutional-section__label">
            <span>Enterprise evaluation</span>
            <span>Five questions procurement, engineering and risk should ask</span>
          </div>
          <div className="institutional-section__intro">
            <h2 id="evaluation-title">Proof before promises.</h2>
            <p>
              Infrastructure buyers should be able to separate a capability claim from the
              evidence behind it. These are the same boundaries we expect a serious counterparty
              to test during diligence.
            </p>
          </div>
          <div className="institutional-register">
            {criteria.map((criterion, index) => (
              <article className="institutional-row" key={criterion.label}>
                <span className="institutional-row__number">{String(index + 1).padStart(2, '0')}</span>
                <span className="institutional-row__label">{criterion.label}</span>
                <h3>{criterion.title}</h3>
                <p>{criterion.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="institutional-darkband" aria-labelledby="control-plane-title">
          <div className="institutional-darkband__head">
            <h2 id="control-plane-title">A control plane, not a black box.</h2>
            <p>
              Routing, simulation and authorization are separate steps. That separation makes it
              possible to give an agent or operator useful execution power without giving it
              undefined authority over funds.
            </p>
          </div>
          <div className="institutional-register">
            {controls.map((control) => (
              <article className="institutional-row" key={control.label}>
                <span className="institutional-row__number">{control.label.slice(0, 2)}</span>
                <span className="institutional-row__label">{control.label.slice(5)}</span>
                <h3>{control.title}</h3>
                <p>{control.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="institutional-section" aria-labelledby="evidence-title">
          <div className="institutional-section__label">
            <span>Evidence room</span>
            <span>No diligence gate required</span>
          </div>
          <div className="institutional-section__intro">
            <h2 id="evidence-title">Verify the public surface first.</h2>
            <p>
              The fastest enterprise diligence starts with artifacts you can inspect without a
              sales call. Private architecture and control review can follow where needed.
            </p>
          </div>
          <div className="institutional-grid">
            <article className="institutional-panel">
              <span>Security / Trust</span>
              <h3>Controls and certification status.</h3>
              <p>
                Read the custody model, managed-wallet controls, data protection and the
                certifications we explicitly do not claim yet.
              </p>
              <div className="institutional-actions">
                <a className="institutional-link" href="/security">Security posture →</a>
              </div>
            </article>
            <article className="institutional-panel">
              <span>Operations / Evidence</span>
              <h3>Status, changes and implementation.</h3>
              <p>
                Check live service health, trace what shipped, inspect source and read the API
                contract before committing engineering time.
              </p>
              <div className="institutional-actions">
                <a className="institutional-link" href="/status">Status →</a>
                <a className="institutional-link" href="/changelog">Changelog →</a>
                <a className="institutional-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a>
              </div>
            </article>
            <article className="institutional-panel">
              <span>Architecture / Research</span>
              <h3>Understand the system and the assumptions.</h3>
              <p>
                The architecture page maps authority boundaries; Suwappu Research publishes the
                methodology and limitations behind financial-infrastructure analysis.
              </p>
              <div className="institutional-actions">
                <a className="institutional-link" href="/architecture">Architecture →</a>
                <a className="institutional-link" href="/research">Research →</a>
              </div>
            </article>
          </div>
        </section>

        <section className="mkt-cta" aria-labelledby="enterprise-close">
          <p className="summer-kicker">Production evaluation</p>
          <h2 id="enterprise-close">Bring the diligence checklist.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href={ENTERPRISE_CONTACT_PATH}>
              Talk to the team
            </a>
            <a className="summer-button summer-button--secondary" href="/docs/api-reference/overview">
              Read the API contract
            </a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}

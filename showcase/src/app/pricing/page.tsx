import type { Metadata } from 'next';
import { Fragment } from 'react';
import stats from '@/data/stats.generated.json';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import FaqAccordion from '@/components/FaqAccordion';
import { TELEGRAM_URL, ENTERPRISE_CONTACT_PATH } from '@/lib/links';
import DemoCallCta from '@/components/DemoCallCta';
import UpgradeCta from '@/components/UpgradeCta';
import FeeCalculator from '@/components/FeeCalculator';
import styles from './pricing.module.css';

export const metadata: Metadata = {
  title: 'Pricing | Suwappu',
  description:
    'Account trading plans for Suwappu, plus separate Agent API credit, rate-limit, and route-fee pricing for developers.',
};

type Tier = {
  name: string;
  price: string;
  cadence: string;
  fee: string;
  blurb: string;
  cta: string;
  href?: string;
  highlight: boolean;
  badge?: string;
  features: string[];
};

const tiers: Tier[] = [
  {
    name: 'Free',
    price: '$0',
    cadence: '',
    fee: '1.0%',
    blurb: `1.0% account trading swap fee on ${stats.platformChains} chains. No card, no seat count, no trial clock.`,
    cta: 'Start free',
    highlight: false,
    features: [
      `Best-price routing across ${stats.routerCount} providers`,
      'HyperLiquid perps & funding',
      'Gasless first swaps on Tempo',
      'Agent API, SDK & MCP access: 30 req/min',
      '1× loyalty points: redeem for fee credits',
    ],
  },
  {
    name: 'Pro',
    price: '$9.99',
    cadence: '/mo',
    fee: '0.5%',
    blurb: '', // derived from the fee ladder: see ladderBlurb()
    cta: 'Upgrade to Pro',
    highlight: false,
    features: [
      'Everything in Free',
      '0.5% account trading swap fee: half of Free',
      '500 API requests/min',
      'Copy trading & DCA',
      '1.1× loyalty points on every trade',
    ],
  },
  {
    name: 'Premium',
    price: '$29.99',
    cadence: '/mo',
    fee: '0.3%',
    blurb: '', // derived from the fee ladder: see ladderBlurb()
    cta: 'Go Premium',
    highlight: true,
    badge: 'Recommended',
    features: [
      'Everything in Pro',
      '0.3% account trading swap fee: 70% below Free',
      '2,000 Agent API requests/min',
      'Advanced alerts & analytics',
      '1.25× loyalty points on every trade',
    ],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: '',
    fee: '0.1%',
    blurb: '0.1% account trading swap fee, org accounts with RBAC, and 10,000 Agent API requests/min.',
    cta: 'Talk to sales',
    href: ENTERPRISE_CONTACT_PATH,
    highlight: false,
    badge: 'Industry-First',
    features: [
      'Everything in Premium',
      '0.1% account trading swap fee (vs 1% industry standard)',
      'Multi-user org accounts with RBAC (Owner / Admin / Member / Viewer)',
      'Up to 10 seats per org (configurable)',
      'Programmatic API keys with scoped permissions',
      'Agent key: 10,000 API requests/min',
      `${stats.platformChains}-chain execution (competitors offer 1–2)`,
      'KMS envelope encryption: institutional-grade custody',
      'Dedicated support + SLA: first in category',
      'Usage dashboard: API calls, rate-limit monitoring',
      'Custom RPC / dedicated node: contact for pricing',
      'White-label available: contact for pricing',
      '1.5× loyalty points on every trade',
    ],
  },
];

const money = (t: Tier) => Number(t.price.replace(/[^0-9.]/g, ''));
const feePct = (t: Tier) => Number(t.fee.replace('%', ''));

/**
 * Monthly volume at which `upper` becomes cheaper than `lower`: the point
 * where the extra subscription is repaid by the lower swap fee. Derived from
 * the same fee ladder the cards and the calculator render, so a price change
 * can never leave a stale number in the copy. Rounded to the nearest $100 so
 * the sentence reads like a threshold, not a float.
 */
function breakEvenVolume(upper: Tier, lower: Tier): number {
  const feeGap = (feePct(lower) - feePct(upper)) / 100;
  if (feeGap <= 0) return 0;
  return Math.round((money(upper) - money(lower)) / feeGap / 100) * 100;
}

const usdShort = (n: number) => `$${n.toLocaleString('en-US')}`;

/** Blurb for a paid tier, stated against the tier directly below it. */
function ladderBlurb(upper: Tier, lower: Tier): string {
  return `${upper.fee} swap fee. Costs less than ${lower.name} once you trade about ${usdShort(
    breakEvenVolume(upper, lower)
  )} a month.`;
}

const selfServe = tiers
  .filter((t) => t.name !== 'Enterprise')
  .map((t, i, all) => (i === 0 ? t : { ...t, blurb: ladderBlurb(t, all[i - 1]) }));
const enterprise = tiers.find((t) => t.name === 'Enterprise') as Tier;
/** Index into a comparison row's `values` array for the recommended column. */
const featuredIndex = tiers.findIndex((t) => t.highlight);

const enterpriseStats: { value: string; label: string }[] = [
  { value: '0.1%', label: 'Swap fee: a tenth of the 1% category standard' },
  { value: '10,000', label: 'Agent API requests per minute on the Enterprise tier' },
  { value: '10', label: 'Seats per org with RBAC roles (configurable)' },
];

const comparison: { category: string; rows: { label: string; values: string[] }[] }[] = [
  {
    category: 'Trading',
    rows: [
      { label: 'Swap fee', values: ['1.0%', '0.5%', '0.3%', '0.1%'] },
      { label: `Cross-chain routing (${stats.routerCount} providers)`, values: ['✓', '✓', '✓', '✓'] },
      { label: 'Limit orders & DCA', values: ['✓', '✓', '✓', '✓'] },
      { label: 'Copy trading', values: ['-', '✓', '✓', '✓'] },
    ],
  },
  {
    category: 'HyperLiquid',
    rows: [
      { label: 'Perps, funding, staking, vaults', values: ['✓', '✓', '✓', '✓'] },
      { label: 'Leverage up to 20x', values: ['✓', '✓', '✓', '✓'] },
    ],
  },
  {
    category: 'Agents & API',
    rows: [
      { label: 'REST API, SDK & MCP server', values: ['✓', '✓', '✓', '✓'] },
      { label: 'Agent key rate limit', values: ['30 req/min', '500 req/min', '2,000 req/min', '10,000 req/min'] },
      { label: 'Managed wallets & policy guardrails', values: ['✓', '✓', '✓', '✓'] },
    ],
  },
  {
    category: 'Team & Org (Enterprise only)',
    rows: [
      { label: 'Multi-user org accounts', values: ['-', '-', '-', '✓'] },
      { label: 'RBAC roles (Owner / Admin / Member / Viewer)', values: ['-', '-', '-', '✓'] },
      { label: 'Programmatic API keys with scoped access', values: ['-', '-', '-', '✓'] },
      { label: 'Usage dashboard & rate-limit monitoring', values: ['-', '-', '-', '✓'] },
      { label: 'Custom RPC / dedicated node', values: ['-', '-', '-', 'Contact'] },
      { label: 'White-label', values: ['-', '-', '-', 'Contact'] },
    ],
  },
  {
    category: 'Rewards',
    rows: [
      { label: 'Loyalty points earn rate', values: ['1×', '1.1×', '1.25×', '1.5×'] },
      { label: 'Redeem points for fee credits & subscription', values: ['✓', '✓', '✓', '✓'] },
      { label: 'Season points → SUWP', values: ['✓', '✓', '✓', '✓'] },
    ],
  },
  {
    category: 'Security & Support',
    rows: [
      { label: 'KMS-backed key management', values: ['✓', '✓', '✓', '✓'] },
      { label: 'Spending limits, 2FA, withdrawal allowlist', values: ['✓', '✓', '✓', '✓'] },
      { label: 'Support', values: ['Community', 'Community', 'Email', 'Dedicated + SLA'] },
    ],
  },
];

const faqs = [
  {
    q: 'How does the swap fee work?',
    a: 'For account trading in the consumer product, the plan fee runs from 1.0% on Free down to 0.1% on Enterprise. The Agent API uses a separate route/configuration fee model; its current EVM/Solana defaults are not derived from the account plan. Developer integrations should read the live quote instead of applying this account fee ladder.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Subscriptions are month-to-month and you keep your tier benefits until the period ends, after which you drop back to Free.',
  },
  {
    q: 'Do you take custody of my funds?',
    a: 'You can bring your own keys via the agent API for full self-custody, or use a managed wallet where keys are encrypted with KMS envelope encryption and signed server-side. See the Security page for details.',
  },
  {
    q: 'Does my trading pay for my membership?',
    a: 'Effectively, yes. Every swap, perp, prediction-market and P2P trade earns loyalty points, and higher tiers earn faster: 1.1× on Pro, 1.25× on Premium, 1.5× on Enterprise. Redeem points for fee credits, gas rebates, or to cover your next month of subscription. Your activity also accrues season points that convert to SUWP.',
  },
  {
    q: 'Can I earn a lower fee just by trading?',
    a: 'Yes: your VIP status is the better of your plan and your trading. Rack up cross-product volume in a season (swaps, perps, prediction markets, P2P all count toward one status) and you auto-unlock a lower swap fee and a faster points multiplier, even on Free. Check /vip in the bot to see your status and the next threshold.',
  },
  {
    q: 'What does the Enterprise tier include that competitors do not?',
    a: 'Suwappu Enterprise is the only offering in the DeFi bot space with multi-user org accounts, RBAC roles, scoped programmatic API keys, a per-org usage dashboard, a dedicated SLA, and white-label options. BullX, Photon, Banana Gun, Maestro, Trojan, and Axiom have no enterprise tier at all. On top of that, Enterprise users get 0.1% swap fees (versus the 1% industry standard), multi-chain execution, and KMS envelope encryption for institutional-grade custody.',
  },
  {
    q: 'How do referrals work?',
    a: 'Refer a friend with /ref and earn 30% of the trading fees they generate: paid out automatically, on every chain, for as long as they trade.',
  },
  {
    q: "What's a credit, for the Agent API?",
    a: 'Credits are the Agent API’s prepaid unit: 1 credit ≈ $0.001. Metered reads such as quotes, simulation, prices, and portfolio cost 1 credit; chain/token discovery is free; transaction preparation and managed execution cost 5. Top up with USDC on Base when needed.',
  },
  {
    q: 'x402 pay-per-call vs a subscription, which should my agent use?',
    a: 'x402 is the zero-setup path: pay per request over HTTP 402 with no signup and no API key, ideal for one-off or low-volume calls. A Pro/Premium/Enterprise window is worth considering when the higher rate limit and unmetered calls beat pay-per-call costs. Agent-surface swap fees are route/configuration-specific, so evaluate them from the live quote rather than assuming a tier discount.',
  },
  {
    q: 'What are the Agent API rate limits?',
    a: 'The current per-agent limits are Free 30 req/min, Agent 100, Pro 500, Premium 2,000, and Enterprise 10,000. Clients should still honor the live X-RateLimit and Retry-After headers instead of hardcoding delays.',
  },
];

// ── Agent API pricing (MONEY-PATH: mirrors api-ts credit/tier config) ──
const creditCosts: { action: string; credits: string; usd: string }[] = [
  { action: 'Metered reads: quote, simulate, prices, portfolio', credits: '1 credit', usd: '≈ $0.001' },
  { action: 'Discovery: chains, tokens', credits: '0 credits', usd: '$0' },
  { action: 'Transaction prep / managed execution', credits: '5 credits', usd: '≈ $0.005' },
];

const agentTiers: { tier: string; rateLimit: string; swapFee: string }[] = [
  { tier: 'Free', rateLimit: '30 req/min', swapFee: 'Route-configured*' },
  { tier: 'Agent (assigned)', rateLimit: '100 req/min', swapFee: 'Route-configured*' },
  { tier: 'Pro: $9.99 / 30 days', rateLimit: '500 req/min', swapFee: 'Route-configured*' },
  { tier: 'Premium: $29.99 / 30 days', rateLimit: '2,000 req/min', swapFee: 'Route-configured*' },
  { tier: 'Enterprise: $99.99 / 30 days', rateLimit: '10,000 req/min', swapFee: 'Route-configured*' },
];

const agentPaymentModes = [
  {
    title: 'x402 pay-per-call',
    body: 'Pay per request over HTTP 402: no signup, no API key, no subscription. Fund a wallet and call the endpoint; you’re charged for exactly what you use.',
  },
  {
    title: 'Prepaid credits',
    body: '1 credit ≈ $0.001. Reads cost 1 credit, swaps cost 5 credits. Top up your balance with USDC on Base whenever it runs low.',
  },
  {
    title: 'Subscription tiers',
    body: 'Agent API Pro, Premium, and Enterprise windows are activated through the crypto subscription endpoint: 30-day prepaid, stackable, higher-rate-limit, and unmetered while active. Stripe is a separate human/web checkout flow and does not currently promote an Agent API key’s subscription tier.',
  },
];

/** Comparison cells are either a glyph or a literal value: render accordingly
 *  so screen readers hear "Included"/"Not included" instead of a bare symbol. */
function CompareValue({ value }: { value: string }) {
  if (value === '✓') {
    return (
      <>
        <span className={styles.yes} aria-hidden="true">
          ✓
        </span>
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === '-') {
    return (
      <>
        <span className={styles.no} aria-hidden="true">
          -
        </span>
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className={styles.val}>{value}</span>;
}

export default function PricingPage() {
  return (
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <SummerNav />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Pricing</p>
          <h1>One subscription. A lower fee on every swap.</h1>
          <p className="mkt-hero__lead">
            Every plan carries the same engine: {stats.platformChains} chains, {stats.routerCount}{' '}
            quote providers, HyperLiquid perps, and the agent API. The tier only changes your swap
            fee: 1.0% on Free down to 0.1% on Enterprise.
          </p>
          <p className="mkt-hero__clerk">
            Free to start, no card. Month to month: cancel and you keep the tier until the period
            ends.
          </p>
        </header>

        <section className={styles.plans} aria-label="Self-serve plans">
          {selfServe.map((t) => (
            <article
              className={`${styles.card}${t.highlight ? ` ${styles.cardFeatured} sw-shine` : ''}`}
              key={t.name}
            >
              {t.badge && <span className={styles.badge}>{t.badge}</span>}
              <h2 className={styles.name}>{t.name}</h2>
              <p className={styles.price}>
                {t.price}
                {t.cadence && <span className={styles.cadence}>{t.cadence}</span>}
              </p>
              <p className={styles.fee}>
                <b className={styles.feeValue}>{t.fee}</b> account trading swap fee
              </p>
              <p className={styles.blurb}>{t.blurb}</p>
              {t.name === 'Pro' || t.name === 'Premium' ? (
                <>
                  <UpgradeCta
                    tier={t.name === 'Pro' ? 'pro' : 'premium'}
                    className={`summer-button ${
                      t.highlight ? 'summer-button--primary' : 'summer-button--secondary'
                    } pricing-card__cta`}
                  >
                    {t.cta}
                  </UpgradeCta>
                  <a
                    className={styles.noteLink}
                    href={TELEGRAM_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Or upgrade in Telegram →
                  </a>
                </>
              ) : (
                <a
                  className="summer-button summer-button--secondary pricing-card__cta"
                  href={TELEGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.cta}
                </a>
              )}
              <ul className={styles.features}>
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        {/* Enterprise sits below the ladder, not inside it: a quote-only plan
            standing next to three published prices makes every price look
            negotiable, and the buyer is a different person on a different
            timeline. One CTA: a call. */}
        <section
          className={`${styles.enterprise} sw-card-dark sw-grain sw-grain--dark`}
          aria-labelledby="enterprise-band"
        >
          <div className={styles.enterpriseGrid}>
            <div>
              <p className="sw-kicker">Enterprise</p>
              <h2 className={styles.enterpriseTitle} id="enterprise-band">
                Priced per desk, not per seat.
              </h2>
              <p className={styles.enterpriseBody}>
                BullX, Photon, Banana Gun, Maestro, Trojan, and Axiom ship no enterprise tier at all
               : no org accounts, no scoped API keys, no SLA. Enterprise is built for trading
                desks, agent fleets, and institutions that need all three.
              </p>
              <div className={styles.enterpriseStats}>
                {enterpriseStats.map((s) => (
                  <div className={styles.enterpriseStat} key={s.value}>
                    <span className={styles.enterpriseStatValue}>{s.value}</span>
                    <span className={styles.enterpriseStatLabel}>{s.label}</span>
                  </div>
                ))}
              </div>
              <div className={styles.enterpriseActions}>
                <DemoCallCta
                  source="pricing_enterprise_card"
                  className="summer-button summer-button--primary"
                >
                  Talk to sales
                </DemoCallCta>
                <p className={styles.enterpriseNote}>
                  30 minutes, no deck. Or <a href={ENTERPRISE_CONTACT_PATH}>send us a note</a> -
                  we reply within one business day.
                </p>
              </div>
            </div>
            <ul className={styles.enterpriseFeatures}>
              {enterprise.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* Sits between the plans and the feature matrix: the reader has just seen
            the prices and is asking "which one is actually right for me?". Answer
            it before sending them into a comparison table. Fees are derived from the
            same `tiers` array the cards render, so the ladder has one source. */}
        <div className={styles.calcWrap}>
          <FeeCalculator
            tiers={tiers.map((t) => ({
              name: t.name,
              monthly: t.price === 'Custom' ? null : money(t),
              feePct: feePct(t),
            }))}
          />
        </div>

        <section className={styles.compare} aria-labelledby="compare-plans">
          <p className="sw-kicker">Every line, side by side</p>
          <h2 className={styles.compareTitle} id="compare-plans">
            Compare plans
          </h2>
          <p className={styles.compareLead}>
            For account trading, what moves is the plan swap fee, the rate limit, and the org
            controls. Agent API route fees are a separate model shown below.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className="sr-only">
                Feature comparison across the Free, Pro, Premium, and Enterprise plans.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {tiers.map((t, i) => (
                    <th
                      key={t.name}
                      scope="col"
                      className={i === featuredIndex ? styles.colUs : undefined}
                    >
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((group) => (
                  <Fragment key={group.category}>
                    <tr className={styles.catRow}>
                      <th scope="colgroup" colSpan={tiers.length + 1}>
                        {group.category}
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className={styles.rowHead}>
                          {row.label}
                        </th>
                        {row.values.map((v, i) => (
                          <td
                            key={i}
                            className={`${styles.cell}${i === featuredIndex ? ` ${styles.cellUs}` : ''}`}
                          >
                            <CompareValue value={v} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.tableNote}>
            Swap fee is charged on the traded amount. Network gas and third-party liquidity costs
            are separate on every tier.
          </p>
        </section>

        <section className="compare" id="agent-api" aria-label="Agent API pricing">
          <p className="summer-kicker">Agent API</p>
          <h2 className="compare__title">Three ways for an agent to pay.</h2>
          <p className="mkt-hero__lead" style={{ margin: '0 0 1.5rem', textAlign: 'left' }}>
            No human sign-up required. Register at{' '}
            <code>POST /v1/agent/register</code> and start on pay-per-call, or add credits or a
            subscription when your agent needs a higher rate limit.
          </p>

          <div className="security-grid">
            {agentPaymentModes.map((p) => (
              <article className="security-card" key={p.title}>
                <h2>{p.title}</h2>
                <p>{p.body}</p>
              </article>
            ))}
          </div>

          <h3 className="compare__title" style={{ marginTop: '2.25rem', fontSize: '1.15rem' }}>
            Credit costs
          </h3>
          <div className="compare__scroll" role="region" aria-label="Credit costs table" tabIndex={0}>
            <table className="compare-table">
              <caption className="sr-only">Prepaid credit cost per Agent API call type.</caption>
              <thead>
                <tr>
                  <th scope="col" className="compare-table__rowhead">Call type</th>
                  <th scope="col" className="compare-table__colhead">Credits</th>
                  <th scope="col" className="compare-table__colhead">≈ USD</th>
                </tr>
              </thead>
              <tbody>
                {creditCosts.map((row) => (
                  <tr key={row.action}>
                    <th scope="row" className="compare-table__rowhead">{row.action}</th>
                    <td className="compare-cell">{row.credits}</td>
                    <td className="compare-cell">{row.usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="compare__title" style={{ marginTop: '2.25rem', fontSize: '1.15rem' }}>
            Agent API rate limits &amp; route-fee behavior
          </h3>
          <div className="compare__scroll" role="region" aria-label="Agent API tier table" tabIndex={0}>
            <table className="compare-table">
              <caption className="sr-only">Agent API rate limits and route-configured swap fees.</caption>
              <thead>
                <tr>
                  <th scope="col" className="compare-table__rowhead">Tier</th>
                  <th scope="col" className="compare-table__colhead">Rate limit</th>
                  <th scope="col" className="compare-table__colhead">Swap fee</th>
                </tr>
              </thead>
              <tbody>
                {agentTiers.map((row) => (
                  <tr key={row.tier}>
                    <th scope="row" className="compare-table__rowhead">{row.tier}</th>
                    <td className="compare-cell">{row.rateLimit}</td>
                    <td className="compare-cell">{row.swapFee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="compare__note">
            * This table is specifically for the Agent API, not the account-trading fee ladder
            above. Agent-surface swap fees are not derived from the subscription tier. Current
            source defaults are 0.8% on EVM routes and 0.3% on Solana routes; deployment
            configuration can change them, so use the live quote as the economic source of truth.
            Agent API subscription windows are 30-day prepaid, stackable crypto purchases through
            the agent billing endpoint. Stripe checkout applies to human account plans and does not
            currently set an Agent API key&apos;s subscription tier. Full endpoint list at{' '}
            <a href="https://api.suwappu.bot/v1/agent/openapi" target="_blank" rel="noopener noreferrer">
              the OpenAPI spec
            </a>{' '}
            or the <a href="/agents">Agents page</a>.
          </p>
        </section>

        <section className="mkt-faq" aria-label="Frequently asked questions">
          <h2 className="mkt-h2">Pricing FAQ</h2>
          <FaqAccordion items={faqs} />
        </section>

        <section className="mkt-cta">
          <h2>Start with Free. Upgrade when it pays for itself.</h2>
          <div className="summer-actions summer-cta__actions">
            <a className="summer-button summer-button--primary" href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">
              Open Telegram Bot
            </a>
            <a className="summer-button summer-button--secondary" href="/docs">Read the docs</a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}

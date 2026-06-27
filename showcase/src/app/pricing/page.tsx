import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL, ENTERPRISE_CONTACT_PATH } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Pricing — Suwappu',
  description:
    'Simple subscription tiers that lower your swap fee — Free, Pro, Premium, and Enterprise. No seat counts, no hidden fees. Refer a friend and earn 30% of their trading fees.',
};

const tiers: {
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
}[] = [
  {
    name: 'Free',
    price: '$0',
    cadence: '',
    fee: '1.0%',
    blurb: 'Everything you need to start swapping across 40+ chains.',
    cta: 'Start free',
    highlight: false,
    features: ['Best-price routing across 9 aggregators', 'HyperLiquid perps & funding', 'Gasless first swaps on Tempo', 'Agent API, SDK & MCP access', '1× loyalty points — redeem for fee credits'],
  },
  {
    name: 'Pro',
    price: '$9.99',
    cadence: '/mo',
    fee: '0.5%',
    blurb: 'Half the swap fee for active traders.',
    cta: 'Upgrade to Pro',
    highlight: false,
    features: ['Everything in Free', '0.5% swap fee', 'Priority routing', 'Copy trading & DCA', '1.1× loyalty points on every trade'],
  },
  {
    name: 'Premium',
    price: '$29.99',
    cadence: '/mo',
    fee: '0.3%',
    blurb: 'The best rate for serious volume.',
    cta: 'Go Premium',
    highlight: true,
    badge: 'Most popular',
    features: ['Everything in Pro', '0.3% swap fee', 'Higher rate limits', 'Advanced alerts & analytics', '1.25× loyalty points on every trade'],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: '',
    fee: '0.1%',
    blurb: 'The only DeFi trading platform built for teams and institutions.',
    cta: 'Contact Sales',
    href: ENTERPRISE_CONTACT_PATH,
    highlight: false,
    badge: 'Industry-First',
    features: [
      'Everything in Premium',
      '0.1% swap fee (vs 1% industry standard)',
      'Multi-user org accounts with RBAC (Owner / Admin / Member / Viewer)',
      'Up to 10 seats per org (configurable)',
      'Programmatic API keys with scoped permissions',
      'Per-org rate limits — 1,000 API calls/min default',
      '7-chain execution (competitors offer 1–2)',
      'KMS envelope encryption — institutional-grade custody',
      'Dedicated support + SLA — first in category',
      'Usage dashboard: API calls, rate-limit monitoring',
      'Custom RPC / dedicated node — contact for pricing',
      'White-label available — contact for pricing',
      '1.5× loyalty points on every trade',
    ],
  },
];

const comparison: { category: string; rows: { label: string; values: string[] }[] }[] = [
  {
    category: 'Trading',
    rows: [
      { label: 'Swap fee', values: ['1.0%', '0.5%', '0.3%', '0.1%'] },
      { label: 'Cross-chain routing (9 aggregators)', values: ['✓', '✓', '✓', '✓'] },
      { label: 'Limit orders & DCA', values: ['✓', '✓', '✓', '✓'] },
      { label: 'Copy trading', values: ['—', '✓', '✓', '✓'] },
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
      { label: 'Rate limits', values: ['Standard', 'Standard', 'Higher', '1,000 req/min+'] },
      { label: 'Managed wallets & policy guardrails', values: ['✓', '✓', '✓', '✓'] },
    ],
  },
  {
    category: 'Team & Org (Enterprise only)',
    rows: [
      { label: 'Multi-user org accounts', values: ['—', '—', '—', '✓'] },
      { label: 'RBAC roles (Owner / Admin / Member / Viewer)', values: ['—', '—', '—', '✓'] },
      { label: 'Programmatic API keys with scoped access', values: ['—', '—', '—', '✓'] },
      { label: 'Usage dashboard & rate-limit monitoring', values: ['—', '—', '—', '✓'] },
      { label: 'Custom RPC / dedicated node', values: ['—', '—', '—', 'Contact'] },
      { label: 'White-label', values: ['—', '—', '—', 'Contact'] },
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
    a: 'A small percentage is applied to each swap, set by your subscription tier — 1.0% on Free down to 0.1% on Enterprise. There are no per-seat charges; one subscription covers your whole account.',
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
    a: 'Effectively, yes. Every swap, perp, prediction-market and P2P trade earns loyalty points, and higher tiers earn faster — 1.1× on Pro, 1.25× on Premium, 1.5× on Enterprise. Redeem points for fee credits, gas rebates, or to cover your next month of subscription. Your activity also accrues season points that convert to SUWP.',
  },
  {
    q: 'Can I earn a lower fee just by trading?',
    a: 'Yes — your VIP status is the better of your plan and your trading. Rack up cross-product volume in a season (swaps, perps, prediction markets, P2P all count toward one status) and you auto-unlock a lower swap fee and a faster points multiplier, even on Free. Check /vip in the bot to see your status and the next threshold.',
  },
  {
    q: 'What does the Enterprise tier include that competitors do not?',
    a: 'Suwappu Enterprise is the only offering in the DeFi bot space with multi-user org accounts, RBAC roles, scoped programmatic API keys, a per-org usage dashboard, a dedicated SLA, and white-label options. BullX, Photon, Banana Gun, Maestro, Trojan, and Axiom have no enterprise tier at all. On top of that, Enterprise users get 0.1% swap fees (versus the 1% industry standard), 7-chain execution, and KMS envelope encryption for institutional-grade custody.',
  },
  {
    q: 'How do referrals work?',
    a: 'Refer a friend with /ref and earn 30% of the trading fees they generate — paid out automatically, on every chain, for as long as they trade.',
  },
];

export default function PricingPage() {
  return (
    <main id="main-content" className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Pricing</p>
          <h1>One subscription. A lower fee on every swap.</h1>
          <p className="mkt-hero__lead">
            No seat counts, no hidden fees. Pick a tier to drop your swap fee — everything
            else is included on every plan.
          </p>
        </header>

        <section className="pricing-grid" aria-label="Plans">
          {tiers.map((t) => {
            const ctaHref = t.href ?? TELEGRAM_URL;
            const isInternal = ctaHref.startsWith('/');
            return (
            <article className={`pricing-card${t.highlight ? ' pricing-card--featured' : ''}`} key={t.name}>
              {t.badge && <span className="pricing-card__badge">{t.badge}</span>}
              <h2>{t.name}</h2>
              <p className="pricing-card__price">
                {t.price}
                <span>{t.cadence}</span>
              </p>
              <p className="pricing-card__fee">
                <b>{t.fee}</b> swap fee
              </p>
              <p className="pricing-card__blurb">{t.blurb}</p>
              <a
                className={`summer-button ${t.highlight ? 'summer-button--primary' : 'summer-button--secondary'} pricing-card__cta`}
                href={ctaHref}
                {...(isInternal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              >
                {t.cta}
              </a>
              <ul className="pricing-card__features">
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </article>
            );
          })}
        </section>

        <section className="mkt-callout mkt-callout--enterprise" aria-label="Enterprise differentiator">
          <p className="mkt-callout__eyebrow">Industry-First</p>
          <p className="mkt-callout__body">
            BullX, Photon, Banana Gun, Maestro, Trojan, and Axiom offer zero enterprise tier — no team
            accounts, no API keys, no SLA. Suwappu is the only DeFi trading platform purpose-built for
            trading desks, agent fleets, and institutions.
          </p>
          <a className="summer-button summer-button--secondary" href={ENTERPRISE_CONTACT_PATH}>
            Talk to Sales
          </a>
        </section>

        <section className="pricing-compare" aria-label="Plan comparison">
          <h2 className="mkt-h2">Compare plans</h2>
          <div className="pricing-table">
            <div className="pricing-table__row pricing-table__row--head">
              <span>Features</span>
              <span>Free</span>
              <span>Pro</span>
              <span>Premium</span>
              <span>Enterprise</span>
            </div>
            {comparison.map((group) => (
              <div className="pricing-table__group" key={group.category}>
                <div className="pricing-table__cat">{group.category}</div>
                {group.rows.map((row) => (
                  <div className="pricing-table__row" key={row.label}>
                    <span>{row.label}</span>
                    {row.values.map((v, i) => (
                      <span key={i} className="pricing-table__val">{v}</span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="mkt-faq" aria-label="Frequently asked questions">
          <h2 className="mkt-h2">Pricing FAQ</h2>
          <div className="mkt-faq__list">
            {faqs.map((f) => (
              <div className="mkt-faq__item" key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </div>
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

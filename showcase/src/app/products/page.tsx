import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { GITHUB_URL, TELEGRAM_URL, TERMINAL_URL, MINI_APP_URL } from '@/lib/links';
import styles from './products.module.css';

export const metadata: Metadata = {
  title: 'Products',
  description:
    'Every Suwappu surface in one place: terminal, Telegram bot, agent API and MCP, signal intelligence, research, and account tooling.',
  alternates: { canonical: '/products' },
};

const groups = [
  {
    eyebrow: 'Trade',
    title: 'Use Suwappu',
    items: [
      { title: 'Terminal', desc: 'Swap, route, and trade from the full Suwappu trading interface.', href: TERMINAL_URL, external: true, badge: 'Live' },
      { title: 'Telegram Bot', desc: 'Trade and manage activity directly from Telegram.', href: TELEGRAM_URL, external: true, badge: 'Live' },
      { title: 'Mini App', desc: 'Mobile-first Suwappu trading inside supported messaging surfaces.', href: MINI_APP_URL, external: true, badge: 'Live' },
      { title: 'Cross-chain swaps', desc: 'Route assets across supported chains through Suwappu execution infrastructure.', href: '/#engine', badge: 'Live' },
      { title: 'Perpetuals', desc: 'Access perpetual markets through the Suwappu terminal.', href: '/#hyperliquid', badge: 'Live' },
      { title: 'Predictions & market surfaces', desc: 'Explore additional market interfaces exposed through the terminal.', href: TERMINAL_URL, external: true, badge: 'Live' },
      { title: 'Curve Pools', desc: 'Every pool on every chain Curve deploys to, sortable by TVL, 24h volume, or base APR, live in the Curve venue tab. Powered by the Curve Prices API and our fork of flet-curve.', href: TERMINAL_URL, external: true, badge: 'New' },
    ],
  },
  {
    eyebrow: 'Intelligence',
    title: 'Understand what is happening',
    items: [
      { title: 'Signal Intelligence', desc: 'Explainable Pump/PumpSwap on-chain signals, wallet behavior, and transaction evidence.', href: '/dashboard/signals', badge: 'New' },
      { title: 'Research', desc: 'Institutional-grade writing and market structure research from Suwappu.', href: '/research', badge: 'Live' },
      { title: 'Status', desc: 'See the health and availability of Suwappu services.', href: '/status', badge: 'Live' },
      { title: 'Changelog', desc: 'Track what shipped, changed, and improved across Suwappu.', href: '/changelog', badge: 'Live' },
    ],
  },
  {
    eyebrow: 'Build',
    title: 'Build on Suwappu',
    items: [
      { title: 'Agent API', desc: 'Programmatic execution primitives for agents and applications.', href: '/agents', badge: 'Live' },
      { title: 'Agent Desk', desc: 'WebMCP tools for the agent driving your browser — a mandate, not your keys.', href: '/agent-terminal', badge: 'Live' },
      { title: 'MCP', desc: 'Connect AI clients to Suwappu through the Model Context Protocol.', href: '/docs/quick-start/mcp-clients', badge: 'Live' },
      { title: 'SDK examples', desc: 'Reference integrations and examples for developers.', href: '/docs/quick-start/sdk-examples', badge: 'Live' },
      { title: 'API reference', desc: 'Explore endpoints, schemas, and request/response contracts.', href: '/docs/api-reference/overview', badge: 'Live' },
      { title: 'Architecture', desc: 'Understand the system design and execution boundaries.', href: '/architecture', badge: 'Live' },
      { title: 'GitHub', desc: 'Inspect the open source code and follow development directly.', href: GITHUB_URL, external: true, badge: 'Open source' },
    ],
  },
  {
    eyebrow: 'Company',
    title: 'Evaluate Suwappu',
    items: [
      { title: 'Enterprise', desc: 'Controls, security, and workflows for teams and institutions.', href: '/enterprise', badge: 'Live' },
      { title: 'Solutions', desc: 'See how Suwappu fits different execution and automation workflows.', href: '/solutions', badge: 'Live' },
      { title: 'Security', desc: 'Review custody boundaries, policies, and security posture.', href: '/security', badge: 'Live' },
      { title: 'Compare', desc: 'Understand how Suwappu differs from alternative execution stacks.', href: '/compare', badge: 'Live' },
      { title: 'Dashboard', desc: 'Manage your account, usage, API access, billing, and intelligence tools.', href: '/dashboard', badge: 'Account' },
    ],
  },
];

export default function ProductsPage() {
  return (
    <div className={`sw sw-dark ${styles.page}`}>
      <SummerNav />
      <main id="main-content" className="summer-shell">
        <header className={styles.hero}>
          <p className={styles.kicker}>Everything Suwappu ships</p>
          <h1>One place to discover the entire Suwappu stack.</h1>
          <p className={styles.lead}>
            Trade, inspect market intelligence, build with APIs and agents, read research,
            and manage your account without hunting for hidden routes.
          </p>
        </header>

        {groups.map((group) => (
          <section key={group.title} className={styles.group} aria-labelledby={`group-${group.eyebrow}`}>
            <div className={styles.groupHead}>
              <p className={styles.groupEyebrow}>{group.eyebrow}</p>
              <h2 id={`group-${group.eyebrow}`} className={styles.groupTitle}>{group.title}</h2>
            </div>
            <div className={styles.grid}>
              {group.items.map((item) => (
                <a
                  key={item.title}
                  href={item.href}
                  className={styles.tile}
                  {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  <span className={styles.tileHead}>
                    <strong className={styles.tileTitle}>{item.title}</strong>
                    <span
                      className={`${styles.badge}${
                        item.badge === 'New' ? ` ${styles.badgeNew}` : ''
                      }${item.badge === 'Account' ? ` ${styles.badgeAccount}` : ''}`}
                    >
                      {item.badge}
                    </span>
                  </span>
                  <p className={styles.tileDesc}>{item.desc}</p>
                  <span className={styles.tileCta}>
                    Open {item.external ? '↗' : '→'}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </main>
      <SummerFooter />
    </div>
  );
}

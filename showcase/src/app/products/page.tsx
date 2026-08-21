import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { GITHUB_URL, TELEGRAM_URL, TERMINAL_URL, MINI_APP_URL } from '@/lib/links';

export const metadata: Metadata = {
  title: 'Products | Suwappu',
  description: 'Explore every Suwappu product, market, developer surface, and research tool in one place.',
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
    <div className="sw sw-dark" style={{ minHeight: '100vh', background: '#090b0f', color: '#f5f7fa' }}>
      <SummerNav />
      <main style={{ maxWidth: 1240, margin: '0 auto', padding: '96px 24px 120px' }}>
        <header style={{ maxWidth: 840, marginBottom: 64 }}>
          <p style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 12, color: '#9ba3af', marginBottom: 14 }}>Everything Suwappu ships</p>
          <h1 style={{ fontSize: 'clamp(42px,7vw,82px)', lineHeight: .98, letterSpacing: '-.055em', margin: 0 }}>One place to discover the entire Suwappu stack.</h1>
          <p style={{ fontSize: 20, lineHeight: 1.6, color: '#aeb6c2', maxWidth: 760, marginTop: 26 }}>Trade, inspect market intelligence, build with APIs and agents, read research, and manage your account without hunting for hidden routes.</p>
        </header>

        {groups.map((group) => (
          <section key={group.title} style={{ marginTop: 72 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, .8fr) minmax(0, 2.2fr)', gap: 28, alignItems: 'start' }}>
              <div>
                <p style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontSize: 11, color: '#737d8c', margin: '4px 0 10px' }}>{group.eyebrow}</p>
                <h2 style={{ fontSize: 28, letterSpacing: '-.035em', margin: 0 }}>{group.title}</h2>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 12 }}>
                {group.items.map((item) => (
                  <a key={item.title} href={item.href} {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} style={{ color: 'inherit', textDecoration: 'none', border: '1px solid #222834', borderRadius: 16, padding: 22, background: '#0f1218', minHeight: 160, display: 'flex', flexDirection: 'column', transition: 'border-color .18s ease, transform .18s ease' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
                      <strong style={{ fontSize: 18, letterSpacing: '-.02em' }}>{item.title}</strong>
                      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: item.badge === 'New' ? '#9fe8b5' : '#7f8997', border: '1px solid #2a313d', borderRadius: 999, padding: '5px 8px' }}>{item.badge}</span>
                    </div>
                    <p style={{ color: '#929ba8', lineHeight: 1.55, margin: '16px 0 20px', fontSize: 14 }}>{item.desc}</p>
                    <span style={{ marginTop: 'auto', fontSize: 13, color: '#d8dde5' }}>Open {item.external ? '↗' : '→'}</span>
                  </a>
                ))}
              </div>
            </div>
          </section>
        ))}
      </main>
      <SummerFooter />
    </div>
  );
}

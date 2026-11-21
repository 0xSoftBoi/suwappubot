import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { GITHUB_URL, TELEGRAM_URL, TERMINAL_URL, MINI_APP_URL } from '@/lib/links';
import {
  Reveal, SpotlightCard, V3Section, SectionHead, Backdrop, MiniViz, RouteMap, ToolOrbit, Sparkline,
  type MiniKind, ProblemStrip } from '@/components/v3';
import productStats from '@/data/stats.generated.json';
import '../product-v3.css';

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
      { title: 'Cross-chain swaps', desc: 'Route assets across supported chains through Suwappu execution infrastructure.', href: '/solve/cross-chain-swap-without-a-bridge', badge: 'Live' },
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

type Item = (typeof groups)[number]['items'][number];

const badgeCls = (b: string) =>
  `pv3-badge${b === 'New' ? ' pv3-badge--new' : b === 'Live' ? ' pv3-badge--live' : ''}`;

const ext = (item: Item) => ('external' in item && item.external ? { external: true } : {});

const tradeViz: MiniKind[] = ['book', 'swap', 'agent', 'route', 'perps', 'predict', 'curve'];
const tradeSpan = ['v3-span-2 pv3-tile--lead', '', '', '', '', '', ''];

function Card({ item, visual, className = '', i }: { item: Item; visual?: React.ReactNode; className?: string; i: number }) {
  return (
    <SpotlightCard
      href={item.href}
      {...ext(item)}
      className={className}
      index={String(i + 1).padStart(2, '0')}
      arrow={'external' in item && item.external ? '↗' : '→'}
      visual={visual}
      title={<>{item.title}<span className={badgeCls(item.badge)}>{item.badge}</span></>}
    >
      {item.desc}
    </SpotlightCard>
  );
}

export default function ProductsPage() {
  const [trade, intel, build, company] = groups;
  return (
    <div className="sw sw-dark pv3-page">
      <SummerNav />
      <main id="main-content">
        <div className="pv3-hero">
          <Backdrop kind="mesh-grain" />
          <Backdrop kind="grid" />
          <div className="v3-wrap pv3-hero__grid">
            <header>
              <p className="v3-kicker">Everything Suwappu ships</p>
              <h1>One place to discover the entire Suwappu stack.</h1>
              <p className="pv3-lead">
                Trade, inspect market intelligence, build with APIs and agents, read research,
                and manage your account without hunting for hidden routes.
              </p>
            </header>
            <Reveal className="pv3-hero__art" delay={120}><RouteMap /></Reveal>
          </div>
        </div>

        <V3Section tone="dark" className="pv3-sec" labelledBy="group-Trade">
          <SectionHead kicker={trade.eyebrow} title={trade.title} id="group-Trade" />
          <Reveal stagger className="v3-bento">
            {trade.items.map((item, i) => (
              <Card key={item.title} item={item} i={i} className={tradeSpan[i]} visual={<MiniViz kind={tradeViz[i]} />} />
            ))}
          </Reveal>
        </V3Section>

        <V3Section tone="dark" className="pv3-sec" labelledBy="group-Intelligence" backdrop={<Backdrop kind="glow" />}>
          <SectionHead kicker={intel.eyebrow} title={intel.title} id="group-Intelligence" />
          <Reveal stagger className="pv3-bento3">
            {intel.items.map((item, i) => (
              <Card
                key={item.title}
                item={item}
                i={i}
                className={i === 0 || i === 3 ? 'pv3-span-2' : ''}
                visual={<Sparkline kind={(['line', 'bars', 'bars', 'ticks'] as const)[i]} seed={i * 2 + 3} />}
              />
            ))}
          </Reveal>
        </V3Section>

        <V3Section tone="dark" className="pv3-sec" labelledBy="group-Build" backdrop={<Backdrop kind="mesh" />}>
          <div className="v3-split v3-split--wide-visual">
            <Reveal>
              <ToolOrbit count={productStats.mcpToolCount}><span className="v3-kicker">MCP</span></ToolOrbit>
            </Reveal>
            <div>
              <SectionHead kicker={build.eyebrow} title={build.title} id="group-Build" />
              <Reveal className="pv3-rows v3-glass" style={{ marginTop: '1.6rem' }}>
                {build.items.map((item, i) => (
                  <a
                    key={item.title}
                    href={item.href}
                    className="pv3-row"
                    {...('external' in item && item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <span className="pv3-row__i">{String(i + 1).padStart(2, '0')}</span>
                    <strong>{item.title}<span className={badgeCls(item.badge)}>{item.badge}</span></strong>
                    <span className="pv3-row__go" aria-hidden="true">{'external' in item && item.external ? '↗' : '→'}</span>
                    <span className="pv3-row__d">{item.desc}</span>
                  </a>
                ))}
              </Reveal>
            </div>
          </div>
        </V3Section>

        <V3Section tone="light" className="pv3-sec" labelledBy="group-Company" backdrop={<Backdrop kind="grain" />}>
          <SectionHead kicker={company.eyebrow} title={company.title} id="group-Company" />
          <Reveal stagger className="pv3-auto">
            {company.items.map((item, i) => <Card key={item.title} item={item} i={i} />)}
          </Reveal>
        </V3Section>
      <div className="summer-shell"><ProblemStrip surface="products" slugs={["telegram-trading-bot-cross-chain", "mcp-server-for-crypto-swaps", "treasury-swaps-api-for-desks"]} /></div>
      </main>
      <SummerFooter />
    </div>
  );
}

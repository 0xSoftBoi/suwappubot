import type { Metadata } from 'next';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { GITHUB_URL, TERMINAL_URL } from '@/lib/links';
import { Reveal, V3Section, Backdrop, RouteMap, ProblemStrip, ProductVisual } from '@/components/v3';
import { PRODUCTS, CATEGORY_ORDER } from '@/data/products';
import ProductsCatalogue from '@/components/products/ProductsCatalogue';
import '../product-v3.css';
import './product-deep.css';

export const metadata: Metadata = {
  title: 'Products',
  description:
    'Every Suwappu product in one catalogue: terminal, Telegram bot, routing, orders, copy trading, perps, the Agent API, MCP, managed wallets, spend policies and more. Each with the facts and limits.',
  alternates: { canonical: 'https://suwappu.bot/products' },
};

const MORE_LINKS: [string, string][] = [
  ['Agent stack', '/agents'], ['Arbiter', '/arbiter'], ['Autopilot', '/autopilot'], ['Passport', '/passport'],
  ['Agent Desk (browser)', '/agent-terminal'], ['Pricing', '/pricing'], ['Problems and answers', '/solve'],
  ['Signals', '/signals'], ['Research', '/research'], ['Status', '/status'], ['Enterprise', '/enterprise'],
  ['Security', '/security'], ['Compare', '/compare'],
];

export default function ProductsPage() {
  const items = PRODUCTS.map(({ slug, name, headline, category, audience, status }) => ({ slug, name, headline, category, audience, status }));
  const arts = Object.fromEntries(PRODUCTS.map((p) => [p.slug, <ProductVisual key={p.slug} visual={p.visual} mini />]));
  return (
    <div className="sw sw-dark pv3-page">
      <SummerNav />
      <main id="main-content">
        <div className="pv3-hero">
          <Backdrop kind="mesh-grain" />
          <Backdrop kind="grid" />
          <div className="v3-wrap pv3-hero__grid">
            <header>
              <h1>One place to discover the entire Suwappu stack.</h1>
              <p className="pv3-lead">
                Trade, automate, build and control, each product with its facts and its limits.
              </p>
              <div className="summer-actions">
                <a className="summer-button summer-button--primary" href={TERMINAL_URL} target="_blank" rel="noopener noreferrer">Launch Terminal</a>
                <a className="summer-button summer-button--secondary" href="/agents">For agents</a>
              </div>
            </header>
            <Reveal className="pv3-hero__art" delay={120}><RouteMap /></Reveal>
          </div>
        </div>

        <V3Section tone="dark" className="pv3-sec" backdrop={<Backdrop kind="glow" />}>
          <ProductsCatalogue categories={[...CATEGORY_ORDER]} items={items} arts={arts} />
        </V3Section>

        <V3Section tone="dark" className="pv3-sec" labelledBy="also">
          <h2 id="also" className="pdx-h2">Also on suwappu.bot</h2>
          <ul className="pdx-links">
            {MORE_LINKS.map(([label, href]) => <li key={href}><a href={href}>{label}</a></li>)}
            <li><a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub ↗</a></li>
          </ul>
        </V3Section>
        <div className="summer-shell"><ProblemStrip surface="products" slugs={["telegram-trading-bot-cross-chain", "mcp-server-for-crypto-swaps", "treasury-swaps-api-for-desks"]} /></div>
      </main>
      <SummerFooter />
    </div>
  );
}

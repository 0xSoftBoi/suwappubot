'use client';

import { useState } from 'react';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';

// Tab definitions — each has an id, label, filename for the code bar, and snippet.
const TABS = [
  {
    id: 'claude',
    label: 'Claude Desktop',
    file: 'claude_desktop_config.json',
    caption: "Then ask Claude: 'What's my ETH balance?' or 'Swap 100 USDC to ETH on Base'",
    code: `{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": { "X-API-Key": "YOUR_KEY" }
    }
  }
}`,
  },
  {
    id: 'node',
    label: 'Node.js',
    file: 'swap.ts',
    caption: null,
    code: `import { Suwappu } from "@suwappu/sdk";
const client = new Suwappu({ apiKey: process.env.SUWAPPU_KEY });

const quote = await client.getQuote({
  from: "USDC", to: "ETH",
  chain: "base", amount: "100"
});
const tx = await client.swap(quote);
console.log("Swapped!", tx.hash);`,
  },
  {
    id: 'python',
    label: 'Python',
    file: 'swap.py',
    caption: null,
    code: `from suwappu import Suwappu
client = Suwappu(api_key=os.environ["SUWAPPU_KEY"])

quote = client.get_quote(
  from_token="USDC", to_token="ETH",
  chain="base", amount="100"
)
tx = client.swap(quote)
print(f"Swapped! {tx['hash']}")`,
  },
] as const;

const CAPABILITIES = [
  { title: 'Swap tokens', body: 'Best-price cross-chain swaps across 9 aggregators.' },
  { title: 'Check balances', body: 'Portfolio and token balances across all connected wallets.' },
  { title: 'Trade perps', body: 'HyperLiquid perpetuals up to 20x, long or short.' },
  { title: 'Predict markets', body: 'Polymarket positions — buy, sell, monitor outcomes.' },
  { title: 'Earn yield', body: 'Morpho and Aave lending vaults with live APR.' },
  { title: '40+ chains', body: 'Base, Ethereum, Arbitrum, Solana, Optimism, Polygon, BSC and more.' },
];

export default function AgentsPage() {
  const [active, setActive] = useState<(typeof TABS)[number]['id']>('claude');
  const tab = TABS.find((t) => t.id === active)!;

  return (
    <main id="main-content" className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        {/* ── HERO ── */}
        <header className="mkt-hero mkt-hero--center agents-hero">
          <p className="summer-kicker">Developer quickstart</p>
          <h1>Build trading agents on Suwappu.</h1>
          <p className="mkt-hero__lead">
            The fastest path to cross-chain swap execution for AI agents.
          </p>
        </header>

        {/* ── TAB QUICKSTART ── */}
        <section className="agents-qs" aria-label="Quickstart">
          <div className="agents-tabs" role="tablist" aria-label="Language">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={active === t.id}
                aria-controls={`agents-panel-${t.id}`}
                id={`agents-tab-${t.id}`}
                className={`agents-tab${active === t.id ? ' agents-tab--active' : ''}`}
                onClick={() => setActive(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div
            id={`agents-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`agents-tab-${tab.id}`}
            className="agents-panel"
          >
            <div className="summer-code agents-code">
              <div className="summer-code__bar">
                <span />
                <span />
                <span />
                <b>{tab.file}</b>
              </div>
              <pre>
                <code>{tab.code}</code>
              </pre>
            </div>
            {tab.caption && <p className="agents-caption">{tab.caption}</p>}
          </div>
        </section>

        {/* ── CAPABILITIES GRID ── */}
        <section className="agents-caps" aria-label="Capabilities">
          <h2 className="mkt-h2">What your agent can do.</h2>
          <div className="agents-caps__grid">
            {CAPABILITIES.map((cap) => (
              <article className="agents-cap" key={cap.title}>
                <h3>{cap.title}</h3>
                <p>{cap.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <div className="agents-cta">
          <a
            className="summer-button summer-button--primary"
            href="https://app.suwappu.bot/enterprise"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get an API key
          </a>
        </div>
      </div>
      <SummerFooter />
    </main>
  );
}

import type { Metadata } from 'next';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';

export const metadata: Metadata = {
  title: 'Changelog — Suwappu',
  description: 'What shipped, and when. New chains, features, and improvements to the Suwappu bot, terminal, and agent API.',
};

type Entry = { date: string; tag: 'Launch' | 'Feature' | 'Protocol' | 'Platform' | 'Docs'; title: string; points: string[] };

const entries: Entry[] = [
  {
    date: '2026-07-02',
    tag: 'Protocol',
    title: 'Discovery & protocol hygiene',
    points: [
      'MCP server now negotiates `protocolVersion` on `initialize` (`2024-11-05`, `2025-03-26`, `2025-06-18`) instead of assuming one.',
      'New `/.well-known/ai-catalog.json` (ARD v0.9 draft) for machine discovery, mounted next to the agent card.',
      'Agent card now declares the `a2a-x402` payment extension in `capabilities.extensions`.',
      '`POST /v1/agent/swap/simulate` + `simulate_swap` MCP tool — a zero-funds-move dry run with balance, allowance, gas, revert, and slippage checks.',
    ],
  },
  {
    date: '2026-07-02',
    tag: 'Feature',
    title: 'Agent-native landing, CLI & Skills',
    points: [
      'New Dune-style `/agents` landing page: capability grid, REST/MCP/A2A/SDK comparison matrix, and an agent-API FAQ.',
      'Agent-native CLI (`suwappu` command) — every command supports `-o json` with structured `{success, error}` envelopes for scripting.',
      'Installable Agent Skills package (agentskills.io spec) for one-line onboarding into MCP-compatible agent hosts.',
      'Agent API pricing (credits, subscriptions, x402) broken out on `/pricing`.',
    ],
  },
  {
    date: '2026-06-18',
    tag: 'Docs',
    title: 'Agent-native documentation',
    points: [
      'Every docs page is now available as clean Markdown — append `.md` or send `Accept: text/markdown`.',
      'Published `llms.txt` + `llms-full.txt` indexes, advertised in response headers.',
      'OpenAPI 3.1 spec enriched with examples and error responses; cURL/TypeScript/Python tabs across the API reference.',
    ],
  },
  {
    date: '2026-06-12',
    tag: 'Protocol',
    title: 'Gasless swaps on Tempo',
    points: [
      'New users get their first swaps sponsored via Tempo fee-payer (type 0x76) transactions — about $0.001 on TIP-20 stablecoins.',
      'Graceful fallback to a normal user-paid swap when sponsorship is unavailable.',
      'Suwappu Micropayments (pathUSD) endpoints for pay-per-call on Tempo.',
    ],
  },
  {
    date: '2026-05-22',
    tag: 'Feature',
    title: 'HyperLiquid, first-class',
    points: [
      'Perps up to 20x with take-profit, stop-loss, and live PnL.',
      'One-click cross-chain funding to HyperCore via Across and HyperUnit.',
      'HYPE staking, vaults, TWAP orders, and spot trading — all from the bot.',
    ],
  },
  {
    date: '2026-04-30',
    tag: 'Platform',
    title: '40+ chains and an agent credibility kit',
    points: [
      'Best-price routing expanded to 40+ networks, including Starknet, TRON, Tempo, and Bitcoin L2s.',
      'MCP server and A2A agent card published for agent discovery.',
    ],
  },
  {
    date: '2026-03-15',
    tag: 'Launch',
    title: 'Agent API v1',
    points: [
      'Public launch of the REST agent API: register, quote, swap, status, portfolio, and managed wallets.',
      'KMS-backed server-side signing, or bring your own keys for full self-custody.',
    ],
  },
];

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

// Minimal inline markdown for `code` spans in the points.
function withCode(s: string) {
  const parts = s.split(/(`[^`]+`)/g);
  return parts.map((p, i) =>
    p.startsWith('`') && p.endsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>,
  );
}

export default function ChangelogPage() {
  return (
    <main id="main-content" className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero">
          <p className="summer-kicker">Changelog</p>
          <h1>What shipped, and when.</h1>
          <p className="mkt-hero__lead">
            New chains, features, and improvements across the bot, terminal, and agent API.
            We ship continuously — here&apos;s the trail.
          </p>
        </header>

        <div className="changelog">
          {entries.map((e) => (
            <article className="changelog-entry" key={e.date}>
              <div className="changelog-entry__rail">
                <time>{fmtDate(e.date)}</time>
                <span className={`changelog-tag changelog-tag--${e.tag.toLowerCase()}`}>{e.tag}</span>
              </div>
              <div className="changelog-entry__body">
                <h2>{e.title}</h2>
                <ul>
                  {e.points.map((p, i) => (
                    <li key={i}>{withCode(p)}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
      <SummerFooter />
    </main>
  );
}

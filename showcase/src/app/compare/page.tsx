import type { Metadata } from 'next';
import { Fragment } from 'react';
import Navigation from '@/components/Navigation';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';

const TERMINAL_URL = 'https://terminal.suwappu.bot';

export const metadata: Metadata = {
  title: 'Compare — Suwappu vs Telegram bots, terminals & cross-chain infra',
  description:
    'How Suwappu compares to Telegram trading bots, trading terminals, and cross-chain infrastructure. Cross-chain spot, HyperLiquid perps, and gasless swaps — unified in one bot, terminal, and SDK.',
};

// Column order: capability label, then one column per competitor category.
const COLUMNS: { key: string; label: string; sub: string; highlight?: boolean }[] = [
  { key: 'suwappu', label: 'Suwappu', sub: 'Bot · Terminal · SDK', highlight: true },
  { key: 'bots', label: 'Telegram bots', sub: 'Trojan · Maestro · BonkBot' },
  { key: 'terminals', label: 'Trading terminals', sub: 'Axiom · Photon · GMGN' },
  { key: 'infra', label: 'Cross-chain infra', sub: 'LI.FI · 0x · 1inch' },
];

type Cell = 'yes' | 'partial' | 'no';

const GROUPS: {
  category: string;
  rows: { label: string; cells: Record<string, Cell> }[];
}[] = [
  {
    category: 'Execution',
    rows: [
      {
        label: 'Cross-chain spot swaps (40+ chains)',
        cells: { suwappu: 'yes', bots: 'partial', terminals: 'partial', infra: 'yes' },
      },
      {
        label: 'Best-price routing across 9 aggregators',
        cells: { suwappu: 'yes', bots: 'partial', terminals: 'partial', infra: 'yes' },
      },
      {
        label: 'HyperLiquid perps in-app',
        cells: { suwappu: 'yes', bots: 'no', terminals: 'partial', infra: 'no' },
      },
      {
        label: 'Gasless / sponsored-gas swaps',
        cells: { suwappu: 'yes', bots: 'no', terminals: 'no', infra: 'partial' },
      },
    ],
  },
  {
    category: 'Access surfaces',
    rows: [
      {
        label: 'Telegram-native trading',
        cells: { suwappu: 'yes', bots: 'yes', terminals: 'no', infra: 'no' },
      },
      {
        label: 'Web trading terminal',
        cells: { suwappu: 'yes', bots: 'no', terminals: 'yes', infra: 'no' },
      },
      {
        label: 'Programmatic API + TypeScript SDK',
        cells: { suwappu: 'yes', bots: 'no', terminals: 'no', infra: 'yes' },
      },
      {
        label: 'Hosted MCP server for AI agents',
        cells: { suwappu: 'yes', bots: 'no', terminals: 'no', infra: 'partial' },
      },
    ],
  },
  {
    category: 'Trading tools',
    rows: [
      {
        label: 'Launch sniping & price alerts',
        cells: { suwappu: 'yes', bots: 'yes', terminals: 'yes', infra: 'no' },
      },
      {
        label: 'Copy trading',
        cells: { suwappu: 'yes', bots: 'yes', terminals: 'partial', infra: 'no' },
      },
      {
        label: 'Limit orders & DCA',
        cells: { suwappu: 'yes', bots: 'yes', terminals: 'yes', infra: 'partial' },
      },
    ],
  },
  {
    category: 'Custody & safety',
    rows: [
      {
        label: 'KMS-grade envelope key custody',
        cells: { suwappu: 'yes', bots: 'partial', terminals: 'partial', infra: 'no' },
      },
      {
        label: 'Bring-your-own-keys option',
        cells: { suwappu: 'yes', bots: 'no', terminals: 'partial', infra: 'yes' },
      },
      {
        label: 'Per-key policy guardrails for agents',
        cells: { suwappu: 'yes', bots: 'no', terminals: 'no', infra: 'partial' },
      },
    ],
  },
];

const CELL_GLYPH: Record<Cell, string> = { yes: '✓', partial: '~', no: '–' };
const CELL_WORD: Record<Cell, string> = { yes: 'Yes', partial: 'Partial', no: 'No' };
const CELL_CLASS: Record<Cell, string> = {
  yes: 'text-[var(--accent)]',
  partial: 'text-[var(--ink-1)]',
  no: 'text-[var(--ink-1)]/50',
};

// ── Agent infrastructure comparison — a distinct competitive set from the
// trading-bot matrix above: platforms that specifically target AI agents
// rather than human traders. Kept conservative per editorial policy: mark
// 'unclear' (not 'no') wherever a capability isn't confirmed in public docs,
// rather than asserting an unverifiable gap.
const AGENT_COLUMNS: { key: string; label: string; sub: string; highlight?: boolean }[] = [
  { key: 'suwappu', label: 'Suwappu', sub: 'API · MCP · A2A', highlight: true },
  { key: 'dune', label: 'Dune Agents', sub: 'Analytics for agents' },
  { key: 'agentkit', label: 'Coinbase AgentKit', sub: 'Wallet + action framework' },
  { key: 'bankr', label: 'Bankr', sub: 'Social trading agent' },
  { key: 'onefi', label: '1inch / LI.FI MCP', sub: 'Swap routing MCP' },
];

type AgentCell = 'yes' | 'partial' | 'no' | 'unclear';

const AGENT_GROUPS: { category: string; rows: { label: string; cells: Record<string, AgentCell> }[] }[] = [
  {
    category: 'Execution',
    rows: [
      {
        label: 'Cross-chain swaps',
        cells: { suwappu: 'yes', dune: 'no', agentkit: 'partial', bankr: 'partial', onefi: 'yes' },
      },
      {
        label: 'Managed wallets & spend policies',
        cells: { suwappu: 'yes', dune: 'no', agentkit: 'partial', bankr: 'unclear', onefi: 'no' },
      },
      {
        label: 'Perpetual futures',
        cells: { suwappu: 'yes', dune: 'no', agentkit: 'no', bankr: 'no', onefi: 'no' },
      },
      {
        label: 'Prediction markets',
        cells: { suwappu: 'yes', dune: 'no', agentkit: 'no', bankr: 'no', onefi: 'no' },
      },
      {
        label: 'Lending markets',
        cells: { suwappu: 'yes', dune: 'no', agentkit: 'unclear', bankr: 'no', onefi: 'no' },
      },
    ],
  },
  {
    category: 'Agent protocols',
    rows: [
      {
        label: 'MCP server',
        cells: { suwappu: 'yes', dune: 'unclear', agentkit: 'yes', bankr: 'unclear', onefi: 'yes' },
      },
      {
        label: 'A2A protocol',
        cells: { suwappu: 'yes', dune: 'unclear', agentkit: 'unclear', bankr: 'unclear', onefi: 'unclear' },
      },
      {
        label: 'x402 pay-per-call',
        cells: { suwappu: 'yes', dune: 'unclear', agentkit: 'partial', bankr: 'unclear', onefi: 'unclear' },
      },
      {
        label: 'Self-serve registration (no signup)',
        cells: { suwappu: 'yes', dune: 'no', agentkit: 'no', bankr: 'unclear', onefi: 'no' },
      },
      {
        label: 'TypeScript / Python SDKs',
        cells: { suwappu: 'yes', dune: 'yes', agentkit: 'yes', bankr: 'unclear', onefi: 'yes' },
      },
    ],
  },
];

const AGENT_CELL_GLYPH: Record<AgentCell, string> = { yes: '✓', partial: '~', no: '–', unclear: '?' };
const AGENT_CELL_WORD: Record<AgentCell, string> = {
  yes: 'Yes',
  partial: 'Partial',
  no: 'Not offered',
  unclear: 'Not publicly confirmed',
};
const AGENT_CELL_CLASS: Record<AgentCell, string> = {
  yes: 'text-[var(--accent)]',
  partial: 'text-[var(--ink-1)]',
  no: 'text-[var(--ink-1)]/50',
  unclear: 'text-[var(--ink-1)]/70',
};

const HIGHLIGHTS = [
  {
    eyebrow: 'The unclaimed triad',
    title: 'One product for all three',
    body:
      'Telegram bots own quick mobile trades. Terminals own dense charts. Cross-chain infra owns routing. No competitor unifies cross-chain spot, HyperLiquid perps, and gasless swaps in a single product — Suwappu does, across the bot, the terminal, and the SDK.',
  },
  {
    eyebrow: 'Built for agents',
    title: 'A real developer surface',
    body:
      'Bots and terminals are end-user apps with no public API. Cross-chain infra has APIs but no perps and no consumer onramp. Suwappu ships a REST API, a TypeScript SDK, and a hosted MCP server with per-key guardrails — so an agent can quote, swap, and settle inside the limits you set.',
  },
  {
    eyebrow: 'Custody you can reason about',
    title: 'KMS-grade, not "AES-encrypted keys"',
    body:
      'Most bots describe custody as little more than "encrypted keys." Suwappu uses KMS envelope encryption with policy guardrails, and supports bring-your-own-keys for teams that want full control.',
  },
];

function Legend({ items }: { items: { glyph: string; label: string; className?: string }[] }) {
  return (
    <p className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--ink-1)]">
      {items.map((it) => (
        <span key={it.label}>
          <span className={it.className} aria-hidden="true">{it.glyph}</span> {it.label}
        </span>
      ))}
    </p>
  );
}

export default function ComparePage() {
  return (
    <main id="main-content" className="min-h-screen bg-[var(--canvas-0)] text-[var(--ink-0)]">
      <Navigation />
      <div className="mx-auto max-w-7xl px-6 pb-24">
        {/* ── HERO ── */}
        <header className="mx-auto max-w-2xl pt-16 pb-12 text-center md:pt-24">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">Compare</p>
          <h1 className="mt-3 text-4xl font-medium tracking-tight md:text-5xl">
            One product where the others pick a lane.
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-[var(--ink-1)]">
            Telegram bots, trading terminals, and cross-chain infrastructure each do one part well.
            Suwappu is the only one that unifies cross-chain spot, HyperLiquid perps, and gasless
            swaps — in a bot, a terminal, and an SDK.
          </p>
        </header>

        {/* ── CAPABILITY MATRIX ── */}
        <section aria-labelledby="compare-matrix">
          <h2 id="compare-matrix" className="text-2xl font-medium tracking-tight">
            Capability comparison
          </h2>
          <div className="mt-6 overflow-x-auto rounded-card border border-white/10" role="region" aria-label="Capability comparison table" tabIndex={0}>
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">
                Capabilities of Suwappu compared with Telegram trading bots, trading terminals, and
                cross-chain infrastructure providers.
              </caption>
              <thead>
                <tr className="border-b border-white/10 bg-[var(--canvas-2)]">
                  <th scope="col" className="px-4 py-3 text-left font-medium text-[var(--ink-1)]">Capability</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={`px-4 py-3 text-left font-medium ${c.highlight ? 'text-[var(--accent)]' : ''}`}
                    >
                      <span className="block">{c.label}</span>
                      <span className="block font-mono text-xs font-normal text-[var(--ink-1)]">{c.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((group) => (
                  <Fragment key={group.category}>
                    <tr className="bg-[var(--canvas-1)]">
                      <th scope="colgroup" colSpan={COLUMNS.length + 1} className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--ink-1)]">
                        {group.category}
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label} className="border-b border-white/5 last:border-0">
                        <th scope="row" className="px-4 py-3 text-left font-normal text-[var(--ink-1)]">
                          {row.label}
                        </th>
                        {COLUMNS.map((c) => {
                          const v = row.cells[c.key];
                          return (
                            <td
                              key={c.key}
                              className={`px-4 py-3 text-center ${CELL_CLASS[v]}${c.highlight ? ' bg-[var(--accent)]/5' : ''}`}
                            >
                              <span aria-hidden="true">{CELL_GLYPH[v]}</span>
                              <span className="sr-only">{CELL_WORD[v]}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Legend
            items={[
              { glyph: '✓', label: 'Available', className: 'text-[var(--accent)]' },
              { glyph: '~', label: 'Partial / varies by product' },
              { glyph: '–', label: 'Not offered' },
            ]}
          />
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[var(--ink-1)]">
            Comparison reflects each category&apos;s publicly documented capabilities as of June 2026.
            Named products are examples of their category, not exhaustive. Product features change
            frequently — verify current capabilities on each provider&apos;s own site.
          </p>
        </section>

        {/* ── WHY IT MATTERS ── */}
        <section className="mt-20 grid grid-cols-1 gap-4 md:grid-cols-3">
          {HIGHLIGHTS.map((h) => (
            <div key={h.title} className="rounded-card border border-white/10 bg-[var(--canvas-2)] p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">{h.eyebrow}</p>
              <h3 className="mt-2 text-lg font-medium">{h.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-1)]">{h.body}</p>
            </div>
          ))}
        </section>

        {/* ── AGENT INFRASTRUCTURE COMPARISON — a second, distinct competitive set ── */}
        <section className="mt-20" aria-labelledby="agent-compare-matrix">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">For builders</p>
          <h2 id="agent-compare-matrix" className="mt-2 text-2xl font-medium tracking-tight">
            Agent infrastructure comparison
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-1)]">
            Analytics platforms, wallet frameworks, and single-purpose swap MCPs each cover part of
            what an onchain agent needs. Suwappu is the only one that pairs execution — swaps,
            perps, predictions, lending — with managed wallets, MCP, A2A, and x402 in one API.
          </p>
          <div className="mt-6 overflow-x-auto rounded-card border border-white/10" role="region" aria-label="Agent infrastructure comparison table" tabIndex={0}>
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <caption className="sr-only">
                Capabilities of Suwappu compared with Dune Agents, Coinbase AgentKit, Bankr, and
                1inch/LI.FI MCP offerings.
              </caption>
              <thead>
                <tr className="border-b border-white/10 bg-[var(--canvas-2)]">
                  <th scope="col" className="px-4 py-3 text-left font-medium text-[var(--ink-1)]">Capability</th>
                  {AGENT_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={`px-4 py-3 text-left font-medium ${c.highlight ? 'text-[var(--accent)]' : ''}`}
                    >
                      <span className="block">{c.label}</span>
                      <span className="block font-mono text-xs font-normal text-[var(--ink-1)]">{c.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AGENT_GROUPS.map((group) => (
                  <Fragment key={group.category}>
                    <tr className="bg-[var(--canvas-1)]">
                      <th scope="colgroup" colSpan={AGENT_COLUMNS.length + 1} className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--ink-1)]">
                        {group.category}
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label} className="border-b border-white/5 last:border-0">
                        <th scope="row" className="px-4 py-3 text-left font-normal text-[var(--ink-1)]">
                          {row.label}
                        </th>
                        {AGENT_COLUMNS.map((c) => {
                          const v = row.cells[c.key];
                          return (
                            <td
                              key={c.key}
                              className={`px-4 py-3 text-center ${AGENT_CELL_CLASS[v]}${c.highlight ? ' bg-[var(--accent)]/5' : ''}`}
                            >
                              <span aria-hidden="true">{AGENT_CELL_GLYPH[v]}</span>
                              <span className="sr-only">{AGENT_CELL_WORD[v]}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Legend
            items={[
              { glyph: '✓', label: 'Available', className: 'text-[var(--accent)]' },
              { glyph: '~', label: 'Partial / varies' },
              { glyph: '–', label: 'Not offered' },
              { glyph: '?', label: 'Not publicly confirmed' },
            ]}
          />
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-[var(--ink-1)]">
            Dune Agents is an analytics layer for AI agents (read-only market and onchain data, no
            execution) and has announced it is sunsetting its real-time Sim API on August 1, 2026.
            Coinbase AgentKit is a self-hosted wallet and action-provider framework, not a hosted
            execution API. Reflects each provider&apos;s publicly documented capabilities; cells
            marked &ldquo;not publicly confirmed&rdquo; are conservative placeholders, not claims of
            absence — verify current capabilities on each provider&apos;s own site.
          </p>
        </section>

        {/* ── CTA ── */}
        <section className="mt-20 flex flex-col items-center gap-6 rounded-panel border border-white/10 bg-[var(--canvas-1)] px-6 py-14 text-center">
          <h2 className="max-w-lg text-2xl font-medium tracking-tight md:text-3xl">See it for yourself.</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-control bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-[#1a1108] transition-colors hover:bg-[var(--accent-hover)] active:scale-[0.98]"
            >
              Open Telegram Bot
            </a>
            <a
              href={TERMINAL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-control border border-white/10 px-5 py-2.5 text-sm font-medium text-[var(--ink-0)] transition-colors hover:bg-white/5"
            >
              Open the terminal
            </a>
            <a
              href="/docs"
              className="rounded-control border border-white/10 px-5 py-2.5 text-sm font-medium text-[var(--ink-0)] transition-colors hover:bg-white/5"
            >
              Read the docs
            </a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}

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

export default function ComparePage() {
  return (
    <main id="main-content" className="summer-page docs-shell">
      <Navigation />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Compare</p>
          <h1>One product where the others pick a lane.</h1>
          <p className="mkt-hero__lead">
            Telegram bots, trading terminals, and cross-chain infrastructure each do one part well.
            Suwappu is the only one that unifies cross-chain spot, HyperLiquid perps, and gasless
            swaps — in a bot, a terminal, and an SDK.
          </p>
        </header>

        <section className="compare" aria-labelledby="compare-matrix">
          <h2 id="compare-matrix" className="compare__title">
            Capability comparison
          </h2>
          <div className="compare__scroll" role="region" aria-label="Capability comparison table" tabIndex={0}>
            <table className="compare-table">
              <caption className="sr-only">
                Capabilities of Suwappu compared with Telegram trading bots, trading terminals, and
                cross-chain infrastructure providers.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="compare-table__rowhead">
                    Capability
                  </th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={`compare-table__colhead${c.highlight ? ' compare-table__colhead--us' : ''}`}
                    >
                      <span className="compare-table__colname">{c.label}</span>
                      <span className="compare-table__colsub">{c.sub}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((group) => (
                  <Fragment key={group.category}>
                    <tr className="compare-table__cat">
                      <th scope="colgroup" colSpan={COLUMNS.length + 1}>
                        {group.category}
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className="compare-table__rowhead">
                          {row.label}
                        </th>
                        {COLUMNS.map((c) => {
                          const v = row.cells[c.key];
                          return (
                            <td
                              key={c.key}
                              className={`compare-cell compare-cell--${v}${c.highlight ? ' compare-cell--us' : ''}`}
                            >
                              <span className="compare-cell__glyph" aria-hidden="true">
                                {CELL_GLYPH[v]}
                              </span>
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
          <p className="compare__legend">
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--yes" aria-hidden="true">✓</span> Available
            </span>
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--partial" aria-hidden="true">~</span> Partial / varies by product
            </span>
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--no" aria-hidden="true">–</span> Not offered
            </span>
          </p>
          <p className="compare__note">
            Comparison reflects each category&apos;s publicly documented capabilities as of June 2026.
            Named products are examples of their category, not exhaustive. Product features change
            frequently — verify current capabilities on each provider&apos;s own site.
          </p>
        </section>

        <section className="compare-why">
          {HIGHLIGHTS.map((h) => (
            <div className="compare-why__card" key={h.title}>
              <p className="summer-kicker">{h.eyebrow}</p>
              <h3>{h.title}</h3>
              <p>{h.body}</p>
            </div>
          ))}
        </section>

        <section className="mkt-cta">
          <h2>See it for yourself.</h2>
          <div className="summer-actions summer-cta__actions">
            <a
              className="summer-button summer-button--primary"
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Telegram Bot
            </a>
            <a className="summer-button summer-button--secondary" href={TERMINAL_URL} target="_blank" rel="noopener noreferrer">
              Open the terminal
            </a>
            <a className="summer-button summer-button--secondary" href="/docs">
              Read the docs
            </a>
          </div>
        </section>
      </div>
      <SummerFooter />
    </main>
  );
}

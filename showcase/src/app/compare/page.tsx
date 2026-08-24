import type { Metadata } from 'next';
import stats from '@/data/stats.generated.json';
import { Fragment } from 'react';
import SummerNav from '@/components/SummerNav';
import SummerFooter from '@/components/SummerFooter';
import { TELEGRAM_URL } from '@/lib/links';
import styles from './compare.module.css';

const TERMINAL_URL = 'https://terminal.suwappu.bot';

export const metadata: Metadata = {
  title: 'Compare | Suwappu vs Telegram bots, terminals & cross-chain infra',
  description:
    'How Suwappu compares to Telegram trading bots, trading terminals, and cross-chain infrastructure. Cross-chain spot, HyperLiquid perps, and gasless swaps: unified in one bot, terminal, and SDK.',
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
        label: `Cross-chain spot swaps (${stats.platformChains} chains)`,
        cells: { suwappu: 'yes', bots: 'partial', terminals: 'partial', infra: 'yes' },
      },
      {
        label: `Best-price routing across ${stats.routerCount} providers`,
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

// ── Agent infrastructure comparison: a distinct competitive set from the
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

const HIGHLIGHTS = [
  {
    eyebrow: 'The unclaimed triad',
    title: 'One product for all three',
    body:
      'Telegram bots own quick mobile trades. Terminals own dense charts. Cross-chain infra owns routing. No competitor unifies cross-chain spot, HyperLiquid perps, and gasless swaps in a single product: Suwappu does, across the bot, the terminal, and the SDK.',
  },
  {
    eyebrow: 'Built for agents',
    title: 'A real developer surface',
    body:
      'Bots and terminals are end-user apps with no public API. Cross-chain infra has APIs but no perps and no consumer onramp. Suwappu ships a REST API, a TypeScript SDK, and a hosted MCP server with per-key guardrails, so an agent can quote, swap, and settle inside the limits you set.',
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
    <main id="main-content" className="summer-page docs-shell institutional-page">
      <SummerNav />
      <div className="summer-shell mkt-page">
        <header className="mkt-hero mkt-hero--center">
          <p className="summer-kicker">Compare</p>
          <h1>One product where the others pick a lane.</h1>
          <p className="mkt-hero__lead">
            Telegram bots, trading terminals, and cross-chain infrastructure each do one part well.
            Suwappu is the only one that unifies cross-chain spot, HyperLiquid perps, and gasless
            swaps: in a bot, a terminal, and an SDK.
          </p>
        </header>

        <section className={`compare ${styles.matrix}`} aria-labelledby="compare-matrix">
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
            frequently: verify current capabilities on each provider&apos;s own site.
          </p>
        </section>

        {/* The first card is the argument; the other two are evidence. Giving
            all three equal weight was what made this section read as filler. */}
        <section className={styles.why} aria-label="Why Suwappu">
          {HIGHLIGHTS.map((h, i) => (
            <div
              className={`${styles.whyCard}${i === 0 ? ` ${styles.whyLead}` : ''}`}
              key={h.title}
            >
              <p className="sw-kicker">{h.eyebrow}</p>
              <h3>{h.title}</h3>
              <p>{h.body}</p>
            </div>
          ))}
        </section>

        {/* ── AGENT INFRASTRUCTURE COMPARISON: a second, distinct competitive set ── */}
        <section className={`compare ${styles.matrix}`} aria-labelledby="agent-compare-matrix">
          <p className="summer-kicker">For builders</p>
          <h2 id="agent-compare-matrix" className="compare__title">
            Agent infrastructure comparison
          </h2>
          <p className="mkt-hero__lead" style={{ margin: '0 0 1.5rem', textAlign: 'left' }}>
            Analytics platforms, wallet frameworks, and single-purpose swap MCPs each cover part
            of what an onchain agent needs. Suwappu is the only one that pairs execution: swaps,
            perps, predictions, lending, with managed wallets, MCP, A2A, and x402 in one API.
          </p>
          <div className="compare__scroll" role="region" aria-label="Agent infrastructure comparison table" tabIndex={0}>
            <table className="compare-table">
              <caption className="sr-only">
                Capabilities of Suwappu compared with Dune Agents, Coinbase AgentKit, Bankr, and
                1inch/LI.FI MCP offerings.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="compare-table__rowhead">
                    Capability
                  </th>
                  {AGENT_COLUMNS.map((c) => (
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
                {AGENT_GROUPS.map((group) => (
                  <Fragment key={group.category}>
                    <tr className="compare-table__cat">
                      <th scope="colgroup" colSpan={AGENT_COLUMNS.length + 1}>
                        {group.category}
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className="compare-table__rowhead">
                          {row.label}
                        </th>
                        {AGENT_COLUMNS.map((c) => {
                          const v = row.cells[c.key];
                          return (
                            <td
                              key={c.key}
                              className={`compare-cell compare-cell--${v}${c.highlight ? ' compare-cell--us' : ''}`}
                            >
                              <span className="compare-cell__glyph" aria-hidden="true">
                                {AGENT_CELL_GLYPH[v]}
                              </span>
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
          <p className="compare__legend">
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--yes" aria-hidden="true">✓</span> Available
            </span>
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--partial" aria-hidden="true">~</span> Partial / varies
            </span>
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--no" aria-hidden="true">–</span> Not offered
            </span>
            <span className="compare-legend__item">
              <span className="compare-cell__glyph compare-cell--unclear" aria-hidden="true">?</span> Not publicly confirmed
            </span>
          </p>
          <p className="compare__note">
            Dune Agents is an analytics layer for AI agents (read-only market and onchain data,
            no execution) and has announced it is sunsetting its real-time Sim API on August 1,
            2026. Coinbase AgentKit is a self-hosted wallet and action-provider framework, not a
            hosted execution API. Reflects each provider&apos;s publicly documented capabilities;
            cells marked &ldquo;not publicly confirmed&rdquo; are conservative placeholders, not
            claims of absence: verify current capabilities on each provider&apos;s own site.
          </p>
        </section>

        {/* Closing band shares the dark register of the pricing enterprise band,
            so the two commercial pages end on the same note. */}
        <section
          className={`${styles.ctaBand} sw-card-dark sw-grain sw-grain--dark`}
          aria-labelledby="compare-cta"
        >
          <p className="sw-kicker">See it for yourself</p>
          <h2 className={styles.ctaTitle} id="compare-cta">
            A matrix is an argument. A fill is proof.
          </h2>
          <p className={styles.ctaBody}>
            Quote a swap in the bot, open the terminal, or read the API reference: every column in
            the table above is something you can check in the next five minutes.
          </p>
          <div className={styles.ctaActions}>
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

'use client';

import type { ComponentType } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  BracketsCurly,
  FileText,
  Lightning,
  PlugsConnected,
  Terminal,
  type IconProps,
} from '@phosphor-icons/react';
import stats from '@/data/stats.generated.json';
import DocsAccordion from '../../components/docs/DocsAccordion';
import DocsNav from '../../components/docs/DocsNav';
import docsData from '../../data/docs.json';
import styles from './DocsOverview.module.css';

type Entry = {
  icon: ComponentType<IconProps>;
  href: string;
  title: string;
  desc: string;
  external?: boolean;
};

const entries: Entry[] = [
  {
    icon: Lightning,
    href: '/docs/quick-start/overview',
    title: 'Quick Start',
    desc: 'Register an agent and make your first cross-chain swap',
  },
  {
    icon: PlugsConnected,
    href: '/docs/protocols/mcp',
    title: 'MCP Server',
    desc: 'Connect Claude, Cursor, or any MCP client',
  },
  {
    icon: Terminal,
    href: '#api-reference',
    title: 'API Reference',
    desc: 'Quotes, swaps, perps, predictions, lending',
  },
];

// Machine-readable resources: the discovery surface agents (not humans) use
// to learn the API without a human reading these docs first.
const resources: Entry[] = [
  {
    icon: FileText,
    href: '/llms.txt',
    title: 'llms.txt',
    desc: 'Plain-text API summary for LLMs to ingest directly',
  },
  {
    icon: BracketsCurly,
    href: 'https://api.suwappu.bot/v1/agent/openapi',
    title: 'OpenAPI spec',
    desc: 'Full schema. Import into Postman, Insomnia, or an SDK generator',
    external: true,
  },
  {
    icon: PlugsConnected,
    href: 'https://api.suwappu.bot/.well-known/agent.json',
    title: 'Agent Card',
    desc: 'A2A-spec capability manifest, no auth required to fetch',
    external: true,
  },
];

function EntryLink({ entry }: { entry: Entry }) {
  const Icon = entry.icon;
  return (
    <a
      href={entry.href}
      className="docs-quicklink"
      {...(entry.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <span className="docs-quicklink__icon" aria-hidden="true">
        <Icon size={18} weight="regular" />
      </span>
      <div>
        <strong>{entry.title}</strong>
        <span>{entry.desc}</span>
      </div>
    </a>
  );
}

export default function DocsOverview() {
  // Only show sections that actually have pages: never render an empty "0 pages" group.
  const sections = docsData.sections.filter((s) => s.pages.length > 0);
  const reduce = useReducedMotion();

  // Entry reveal only. It orders the reader top-down on first paint; nothing
  // here loops or reacts to scroll.
  const reveal = (delay: number) =>
    reduce
      ? { initial: false as const }
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <div className="summer-page docs-shell institutional-page">
      <div className="docs-page">
        <aside className={`docs-page__sidebar ${styles.sidebar}`}>
          <DocsNav sections={sections} />
        </aside>

        <main className="docs-page__main">
          <motion.div {...reveal(0)}>
            <p className="section__label">Documentation</p>
            <h1 className="section__heading">Suwappu API</h1>
            <p className="section__body" style={{ marginBottom: '2.5rem' }}>
              The cross-chain DeFi API built for AI agents. Register an agent, get
              best-price quotes, simulate and execute swaps, research HyperLiquid perps,
              and inspect DeFi markets across {stats.platformChains} chains: through one
              REST API, a TypeScript SDK, and an MCP server.
            </p>

            <div className="docs-quicklinks">
              {entries.map((e) => (
                <EntryLink key={e.title} entry={e} />
              ))}
            </div>
          </motion.div>

          {/* ── MCP CLIENT SETUP CALLOUT ── */}
          <motion.div {...reveal(0.06)}>
            <section className="mkt-callout mkt-callout--info" aria-label="MCP client setup">
              <p className="mkt-callout__eyebrow">MCP</p>
              <p className="mkt-callout__body">
                Using Claude Desktop, Claude Code, Cursor, or Windsurf? Point it at{' '}
                <code>https://api.suwappu.bot/mcp</code> with an{' '}
                <code>Authorization: Bearer</code> header. Your client then discovers every tool
                automatically: quotes, swaps, portfolio, perps, predictions, and lending.
              </p>
              <a className="summer-button summer-button--secondary" href="/docs/protocols/mcp">
                MCP client setup
              </a>
            </section>
          </motion.div>

          {/* ── MACHINE-READABLE RESOURCES: the discovery surface for agents ── */}
          <motion.div {...reveal(0.12)}>
            <h2 className={styles.sectionTitle}>Machine-readable resources</h2>
            <p className={styles.sectionLede}>
              Point an agent at any of these to learn the API without reading these docs first.
            </p>
            <div className="docs-quicklinks">
              {resources.map((r) => (
                <EntryLink key={r.title} entry={r} />
              ))}
            </div>
          </motion.div>

          {/* ── FULL INDEX: the sidebar tree expanded, so the whole doc set is
              scannable on mobile where the sidebar is hidden. ── */}
          <motion.div {...reveal(0.18)}>
            <h2 className={styles.sectionTitle}>Full index</h2>
            <DocsAccordion sections={sections} />
          </motion.div>
        </main>
      </div>
    </div>
  );
}

'use client';

import { motion } from 'framer-motion';
import stats from '@/data/stats.generated.json';
import DocsAccordion from '../../components/docs/DocsAccordion';
import DocsNav from '../../components/docs/DocsNav';
import docsData from '../../data/docs.json';

const quicklinks = [
  {
    n: '01',
    href: '/docs/quick-start/overview',
    title: 'Quick Start',
    desc: 'Register an agent and make your first cross-chain swap',
  },
  {
    n: '02',
    href: '/docs/protocols/mcp',
    title: 'MCP Server',
    desc: 'Connect Claude, Cursor, or any MCP client',
  },
  {
    n: '03',
    href: '#api-reference',
    title: 'API Reference',
    desc: 'Quotes, swaps, perps, predictions, lending',
  },
];

// Machine-readable resources — the discovery surface agents (not humans) use
// to learn the API without a human reading these docs first.
const resources = [
  {
    n: 'TXT',
    href: '/llms.txt',
    title: 'llms.txt',
    desc: 'Plain-text API summary for LLMs to ingest directly',
  },
  {
    n: 'API',
    href: 'https://api.suwappu.bot/v1/agent/openapi',
    title: 'OpenAPI spec',
    desc: 'Full schema — import into Postman, Insomnia, or an SDK generator',
  },
  {
    n: 'JSON',
    href: 'https://api.suwappu.bot/.well-known/agent.json',
    title: 'Agent Card',
    desc: 'A2A-spec capability manifest, no auth required to fetch',
  },
];

export default function DocsOverview() {
  // Only show sections that actually have pages — never render an empty "0 pages" group.
  const sections = docsData.sections.filter((s) => s.pages.length > 0);

  return (
    <div className="summer-page docs-shell">
      <div className="docs-page">
        <aside className="docs-page__sidebar">
          <DocsNav sections={sections} />
        </aside>

        <main className="docs-page__main">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <p className="section__label">Documentation</p>
            <h1 className="section__heading">Suwappu API</h1>
            <p className="section__body" style={{ marginBottom: '2.5rem' }}>
              The cross-chain DeFi API built for AI agents. Register an agent, get
              best-price quotes, and execute swaps, perps, and gasless trades across
              {stats.platformChains} chains — through one REST API, a TypeScript SDK, and an MCP server.
            </p>

            <div className="docs-quicklinks">
              {quicklinks.map((q) => (
                <a key={q.title} href={q.href} className="docs-quicklink">
                  <span className="docs-quicklink__icon">{q.n}</span>
                  <div>
                    <strong>{q.title}</strong>
                    <span>{q.desc}</span>
                  </div>
                </a>
              ))}
            </div>
          </motion.div>

          {/* ── SECTION CARDS — mirrors the gitbook tree so the whole doc set is
              scannable without opening the accordion below. ── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <p className="summer-kicker" style={{ marginBottom: '0.75rem' }}>Browse by section</p>
            <div className="agents-caps__grid" style={{ marginBottom: '2.5rem' }}>
              {sections.map((s) => (
                <a className="agents-cap" href={`/docs#${s.id}`} key={s.id} style={{ display: 'block' }}>
                  <h3>{s.title}</h3>
                  <p>
                    {s.pages.length} {s.pages.length === 1 ? 'page' : 'pages'} — including{' '}
                    {s.pages
                      .slice(0, 2)
                      .map((p) => p.title)
                      .join(', ')}
                  </p>
                </a>
              ))}
            </div>
          </motion.div>

          {/* ── MCP CLIENT SETUP CALLOUT ── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <section className="mkt-callout mkt-callout--info" aria-label="MCP client setup">
              <p className="mkt-callout__eyebrow">MCP</p>
              <p className="mkt-callout__body">
                Using Claude Desktop, Claude Code, Cursor, or Windsurf? Point it at{' '}
                <code>https://api.suwappu.bot/mcp</code> with an{' '}
                <code>Authorization: Bearer</code> header and your client discovers every tool —
                quotes, swaps, portfolio, perps, predictions, lending — automatically.
              </p>
              <a className="summer-button summer-button--secondary" href="/docs/protocols/mcp">
                MCP client setup
              </a>
            </section>
          </motion.div>

          {/* ── MACHINE-READABLE RESOURCES — the discovery surface for agents ── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.14, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <p className="summer-kicker" style={{ marginTop: '2.5rem', marginBottom: '0.75rem' }}>
              Machine-readable resources
            </p>
            <div className="docs-quicklinks">
              {resources.map((r) => {
                const external = r.href.startsWith('http');
                return (
                  <a
                    key={r.title}
                    href={r.href}
                    className="docs-quicklink"
                    {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    <span className="docs-quicklink__icon">{r.n}</span>
                    <div>
                      <strong>{r.title}</strong>
                      <span>{r.desc}</span>
                    </div>
                  </a>
                );
              })}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <DocsAccordion sections={sections} />
          </motion.div>
        </main>
      </div>
    </div>
  );
}

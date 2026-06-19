'use client';

import { motion } from 'framer-motion';
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
              40+ chains — through one REST API, a TypeScript SDK, and an MCP server.
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

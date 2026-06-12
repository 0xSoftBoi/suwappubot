'use client';

import { motion } from 'framer-motion';
import DocsAccordion from '../../components/docs/DocsAccordion';
import DocsNav from '../../components/docs/DocsNav';
import docsData from '../../data/docs.json';

export default function DocsOverview() {
  return (
    <div className="docs-page">
      <aside className="docs-page__sidebar">
        <DocsNav sections={docsData.sections} />
      </aside>

      <main className="docs-page__main">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <p className="section__label">Documentation</p>
          <h1 className="section__heading">Suwappu API Docs</h1>
          <p className="section__body" style={{ marginBottom: '3rem' }}>
            Everything you need to build with Suwappu. Register an agent, get quotes, and execute
            cross-chain swaps across 15 blockchains (12 EVM + Solana + TRON + Starknet).
          </p>

          {/* Quick links */}
          <div className="docs-quicklinks">
            <a href="/docs/protocols/mcp" className="docs-quicklink">
              <span className="docs-quicklink__icon">QS</span>
              <div>
                <strong>MCP Quick Start</strong>
                <span>Connect Claude or any AI agent in minutes</span>
              </div>
            </a>
            <a href="/docs/api-reference/perps" className="docs-quicklink">
              <span className="docs-quicklink__icon">EP</span>
              <div>
                <strong>API Reference</strong>
                <span>Perpetual futures, predictions, lending endpoints</span>
              </div>
            </a>
            <a href="/docs/guides/perps-trading" className="docs-quicklink">
              <span className="docs-quicklink__icon">GD</span>
              <div>
                <strong>Perps Trading Guide</strong>
                <span>Open leveraged positions via HyperLiquid</span>
              </div>
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.25, 0.4, 0.25, 1] }}
        >
          <DocsAccordion sections={docsData.sections} />
        </motion.div>
      </main>
    </div>
  );
}

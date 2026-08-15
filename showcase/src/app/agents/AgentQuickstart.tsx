'use client';

import { useState } from 'react';
import styles from './agents.module.css';

// Tab definitions for "add your key": same shape as the old /agents tab
// widget, kept for the visual pattern (agents-tabs / agents-panel / agents-code).
const TABS = [
  {
    id: 'mcp',
    label: 'MCP (Claude, Cursor)',
    file: 'claude_desktop_config.json',
    caption: "Then ask your client: 'What's my ETH balance?' or 'Quote 100 USDC to ETH on Base'. MCP transaction preparation is unsigned and never broadcasts.",
    code: `{
  "mcpServers": {
    "suwappu": {
      "url": "https://api.suwappu.bot/mcp",
      "headers": { "Authorization": "Bearer suwappu_sk_YOUR_KEY" }
    }
  }
}`,
  },
  {
    id: 'node',
    label: 'Node / TypeScript',
    file: 'agent.ts',
    caption: 'Targets @suwappu/sdk 0.6.x. Check npm view @suwappu/sdk version; use REST if the registry is behind.',
    code: `import { Suwappu } from "@suwappu/sdk";
const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

const quote = await client.getQuote({
  from: "USDC", to: "ETH",
  chain: "base", amount: "100",
});
console.log(quote.id, quote.toAmount, quote.amountOutMin);

// Managed execution is a separate, explicit opt-in:
// const swap = await client.executeManagedSwap(quote);`,
  },
  {
    id: 'python',
    label: 'Python',
    file: 'agent.py',
    caption: 'Targets the Python SDK 0.3.x source contract. If PyPI has not published it yet, use the REST/OpenAPI examples.',
    code: `import asyncio
from suwappu import create_client

async def main():
    async with create_client() as client:
        quote = await client.get_quote(
            "USDC", "ETH", 100, chain="base",
        )
        print(quote.quote_id, quote.amount_out, quote.amount_out_min)

asyncio.run(main())`,
  },
] as const;

export default function AgentQuickstart() {
  const [active, setActive] = useState<(typeof TABS)[number]['id']>('mcp');
  const tab = TABS.find((t) => t.id === active)!;

  return (
    <section className="agents-qs" aria-label="Add your key">
      <div className="agents-tabs" role="tablist" aria-label="Integration surface">
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
        <div className={`${styles.codeDark} sw-card-dark`}>
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
        </div>
        {tab.caption && <p className="agents-caption">{tab.caption}</p>}
      </div>
    </section>
  );
}

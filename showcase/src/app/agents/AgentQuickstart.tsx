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
    caption: "Then ask your client: 'What's my ETH balance?' or 'Swap 100 USDC to ETH on Base'",
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
    caption: null,
    code: `import { Suwappu } from "@suwappu/sdk";
const client = new Suwappu({ apiKey: process.env.SUWAPPU_KEY });

const quote = await client.quote({
  from_token: "USDC", to_token: "ETH",
  chain: "base", amount: "100",
});
const swap = await client.executeSwap({ quote_id: quote.quote_id });
console.log(swap.status, swap.tx_hash);`,
  },
  {
    id: 'python',
    label: 'Python',
    file: 'agent.py',
    caption: null,
    code: `import asyncio
from suwappu import Suwappu

async def main():
    client = Suwappu(api_key="suwappu_sk_YOUR_KEY")
    quote = await client.quote(
        from_token="USDC", to_token="ETH", chain="base", amount="100",
    )
    swap = await client.execute_swap(quote_id=quote["quote_id"])
    print(swap["status"], swap["tx_hash"])

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

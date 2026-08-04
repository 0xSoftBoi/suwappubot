'use client';

import { useState } from 'react';

// Tab definitions for "add your key" — same shape as before, restyled onto
// the Phase 1 dark system with Tailwind utilities.
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
    <section aria-label="Add your key">
      <div className="flex flex-wrap gap-1 rounded-control border border-white/10 bg-[var(--canvas-1)] p-1" role="tablist" aria-label="Integration surface">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            aria-controls={`agents-panel-${t.id}`}
            id={`agents-tab-${t.id}`}
            className={`rounded-control px-3 py-1.5 text-xs font-medium transition-colors ${
              active === t.id
                ? 'bg-[var(--accent)] text-[#1a1108]'
                : 'text-[var(--ink-1)] hover:text-[var(--ink-0)]'
            }`}
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
        className="mt-3"
      >
        <div className="overflow-hidden rounded-card border border-white/10 bg-[var(--canvas-2)]">
          <div className="flex items-center gap-1.5 border-b border-white/10 bg-[var(--canvas-1)] px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <b className="ml-2 font-mono text-xs font-normal text-[var(--ink-1)]">{tab.file}</b>
          </div>
          <pre className="overflow-x-auto p-4">
            <code className="font-mono text-xs leading-relaxed text-[var(--ink-0)]">{tab.code}</code>
          </pre>
        </div>
        {tab.caption && <p className="mt-2 text-xs text-[var(--ink-1)]">{tab.caption}</p>}
      </div>
    </section>
  );
}

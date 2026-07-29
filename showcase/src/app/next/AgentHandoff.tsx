'use client';

import { useState } from 'react';
import styles from './next.module.css';

/**
 * AgentHandoff — the "copy and paste everything into Claude or Codex" block.
 *
 * The primary action is COPY EVERYTHING: one click puts a complete, self-
 * contained onboarding brief on the clipboard, so a user can paste it into
 * Claude Code / Codex / Cursor and let the agent wire itself up. The tabs
 * below are the narrow path for people who already know which client they
 * are configuring.
 */

const MCP_URL = 'https://api.suwappu.bot/mcp';

/** The paste-anywhere brief. Deliberately plain text — no fences, so it
 *  survives being dropped into any chat box. */
const EVERYTHING = `You are setting up Suwappu, a cross-chain trading API built for AI agents.
Do this for me end to end.

1. READ THE DOCS FIRST
   Fetch https://suwappu.bot/llms.txt for the map of the whole API.
   Fetch https://suwappu.bot/llms-full.txt if you need the complete text.
   OpenAPI 3.1 spec: https://api.suwappu.bot/v1/agent/openapi
   Every docs page is also available as Markdown by appending .md to its URL.

2. GET A KEY
   POST https://api.suwappu.bot/v1/agent/register with {"name":"<my-agent>"}
   No auth required. The response contains an API key (suwappu_sk_...) shown
   exactly once — save it to my environment as SUWAPPU_API_KEY, never inline
   it into a file that gets committed.

3. WIRE UP THE MCP SERVER
   Suwappu is a remote MCP server at ${MCP_URL} (JSON-RPC 2.0 over
   Streamable HTTP). There is nothing to install locally.

   If I am in Claude Code, run:
     claude mcp add --transport http suwappu ${MCP_URL} \\
       --header "Authorization: Bearer $SUWAPPU_API_KEY"

   If I am in Codex, add to ~/.codex/config.toml:
     [mcp_servers.suwappu]
     url = "${MCP_URL}"
     bearer_token_env_var = "SUWAPPU_API_KEY"

   If I am in Cursor or Claude Desktop, add to the mcpServers block:
     { "suwappu": { "url": "${MCP_URL}",
       "headers": { "Authorization": "Bearer <my key>" } } }

4. WHAT YOU CAN DO ONCE CONNECTED
   Best-price spot swaps across 40+ chains — nine routers are raced per quote
   (LiFi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across, CCTP, ParaSwap).
   HyperLiquid perps: markets, quotes, positions, funding.
   Prediction markets, lending markets, live prices and portfolio reads.

5. RULES THAT MATTER
   Never hardcode chains or token symbols — call GET /chains and
   GET /tokens?chain=... for the authoritative lists.
   Swap flow: POST /quote returns a quote_id valid ~60s, then POST
   /swap/execute (managed wallet, server-signed) or POST /swap (returns an
   unsigned tx for me to sign myself), then GET /swap/status/:swapId.
   Errors come back as a JSON envelope with an error code. On HTTP 429, back
   off and retry. HTTP 402 means pay-per-call (x402) is available without a
   subscription.
   Ask me before executing anything that moves real funds.

When you are done, confirm the MCP server is connected and show me my
portfolio.`;

const TABS = [
  {
    id: 'claude',
    label: 'Claude Code',
    file: 'terminal',
    code: `claude mcp add --transport http suwappu ${MCP_URL} \\
  --header "Authorization: Bearer $SUWAPPU_API_KEY"`,
    note: 'One line. Restart not required — run /mcp to confirm it connected.',
  },
  {
    id: 'codex',
    label: 'Codex',
    file: '~/.codex/config.toml',
    code: `[mcp_servers.suwappu]
url = "${MCP_URL}"
bearer_token_env_var = "SUWAPPU_API_KEY"
startup_timeout_sec = 30`,
    note: 'Or run codex mcp add and paste the URL when prompted.',
  },
  {
    id: 'json',
    label: 'Cursor · Claude Desktop',
    file: 'mcp.json',
    code: `{
  "mcpServers": {
    "suwappu": {
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer suwappu_sk_YOUR_KEY"
      }
    }
  }
}`,
    note: 'Same block works in any client that speaks MCP Streamable HTTP.',
  },
  {
    id: 'sdk',
    label: 'SDK',
    file: 'agent.ts',
    code: `import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

const quote = await client.quote({
  from_token: "USDC", to_token: "ETH",
  chain: "base", amount: "100",
});
const swap = await client.executeSwap({ quote_id: quote.quote_id });`,
    note: 'Python: pip install suwappu — same call shape, async.',
  },
] as const;

type TabId = (typeof TABS)[number]['id'];

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return { copied, copy };
}

export function AgentHandoff() {
  const [active, setActive] = useState<TabId>('claude');
  const { copied, copy } = useCopy();
  const tab = TABS.find((t) => t.id === active)!;

  return (
    <div className={styles.handoff}>
      {/* Primary action — paste the whole brief into any agent. */}
      <div className={styles.handoffHero}>
        <div className={styles.handoffHeroText}>
          <span className={styles.handoffKicker}>THE FAST WAY</span>
          <p className={styles.handoffLede}>
            Copy the whole brief and paste it into Claude Code, Codex, or any agent.
            It reads the docs, registers a key, and wires up the MCP server itself.
          </p>
        </div>
        <button
          type="button"
          className={styles.handoffCopyAll}
          onClick={() => copy(EVERYTHING, 'all')}
          aria-label="Copy the full agent setup brief to the clipboard"
        >
          {copied === 'all' ? '✓ copied — now paste it' : 'Copy everything'}
        </button>
      </div>

      <details className={styles.handoffPreview}>
        <summary className={styles.handoffSummary}>Preview what gets copied</summary>
        <pre className={styles.handoffPre}>{EVERYTHING}</pre>
      </details>

      {/* Secondary — per-client config for people who know what they want. */}
      <div className={styles.handoffTabs} role="tablist" aria-label="MCP client setup">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`handoff-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`handoff-panel-${t.id}`}
            className={`${styles.handoffTab}${active === t.id ? ` ${styles.handoffTabActive}` : ''}`}
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        id={`handoff-panel-${tab.id}`}
        role="tabpanel"
        aria-labelledby={`handoff-tab-${tab.id}`}
        className={styles.handoffPanel}
      >
        <div className={styles.handoffPanelBar}>
          <span className={styles.handoffFile}>{tab.file}</span>
          <button
            type="button"
            className={styles.handoffCopy}
            onClick={() => copy(tab.code, tab.id)}
            aria-label={`Copy the ${tab.label} configuration`}
          >
            {copied === tab.id ? 'copied ✓' : 'copy'}
          </button>
        </div>
        <pre className={styles.handoffCode}>{tab.code}</pre>
        <p className={styles.handoffNote}>{tab.note}</p>
      </div>
    </div>
  );
}

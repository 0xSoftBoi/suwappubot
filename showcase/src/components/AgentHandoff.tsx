'use client';

import { useState } from 'react';
import productStats from '@/data/stats.generated.json';

/**
 * AgentHandoff: the copy-and-paste-into-your-agent block.
 *
 * Replaces the two static MCP config snippets that used to sit in the agents
 * and build sections. The hosted endpoint is the canonical/current MCP path;
 * package registries may lag the repository bridge, and auth is Bearer rather
 * than the old `X-API-Key` form.
 *
 * The primary action copies a complete setup brief so a user can paste it into
 * Claude Code, Codex, or any agent and have it wire itself up. The tabs are the
 * narrow path for people who already know which client they are configuring.
 */

const MCP_URL = 'https://api.suwappu.bot/mcp';

/**
 * Plain text, no code fences, so it survives being pasted into any chat box.
 * Counts interpolate from stats.generated.json: this text ends up inside other
 * people's agents, so a hand-typed number that silently rots is worse here than
 * anywhere else on the site.
 */
const BRIEF = `You are setting up Suwappu, a cross-chain trading API built for AI agents.
Do this for me end to end.

1. READ THE DOCS FIRST
   Fetch https://suwappu.bot/llms.txt for the map of the whole API.
   Fetch https://suwappu.bot/llms-full.txt if you need the complete text.
   OpenAPI 3.1 spec: https://api.suwappu.bot/v1/agent/openapi
   Every docs page is also available as Markdown by appending .md to its URL.

2. GET A KEY
   POST https://api.suwappu.bot/v1/agent/register with {"name":"<my-agent>"}
   No auth required. The response contains an API key (suwappu_sk_...) shown
   exactly once. Save it to my environment as SUWAPPU_API_KEY. Never write it
   into a file that gets committed.

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
   Best-price spot swaps across ${productStats.platformChains} chains. ${productStats.routerCount} routing providers are integrated
   (Li.Fi, CoW, OKX, 1inch, KyberSwap, Jupiter, Across, Wormhole, CCTP and
   more); providers are chain-gated, so each swap races the subset that
   supports its route.
   HyperLiquid perps research: markets, indicative quotes, and position reads
   (the Agent API does not open/close perps). Prediction markets, lending
   markets, live prices, portfolio reads, and managed-swap history.

5. RULES THAT MATTER
   Never hardcode chains or token symbols. Call GET /chains and
   GET /tokens?chain=... for the authoritative lists.
   Swap flow: POST /quote returns a quote_id valid about 60s; preview it with
   POST /swap/simulate before any live action. POST /swap/execute is the
   managed-wallet server-signed path and creates a record for GET
   /swap/status/:swapId. POST /swap only returns an unsigned self-custody tx;
   after I sign/broadcast it, reconcile that transaction on-chain instead.
   Give every intended managed execution a durable Idempotency-Key and reuse
   it after an outcome-unknown timeout/network/5xx while reconciling first.
   MCP execute_swap is also unsigned self-custody preparation despite its
   historical name; it never signs or broadcasts and creates no managed swap.
   A2A returns quote/price/discovery artifacts and never executes trades.
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
    note: 'Run /mcp afterwards to confirm it connected.',
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
    label: 'Cursor, Claude Desktop',
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
    note: 'Works in any client that speaks MCP Streamable HTTP.',
  },
  {
    id: 'sdk',
    label: 'SDK',
    file: 'agent.ts',
    code: `import { Suwappu } from "@suwappu/sdk";

const client = new Suwappu({ apiKey: process.env.SUWAPPU_API_KEY });

const quote = await client.getQuote({
  from: "USDC", to: "ETH",
  chain: "base", amount: "100",
});
console.log(quote.id, quote.toAmount);
// Managed execution is an explicit opt-in:
// await client.executeManagedSwap(quote);`,
    note: 'SDK source contract: @suwappu/sdk 0.6.x. Check npm view before installing; REST/OpenAPI is canonical if the registry lags.',
  },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function AgentHandoff() {
  const [active, setActive] = useState<TabId>('claude');
  const [copied, setCopied] = useState<string | null>(null);
  const tab = TABS.find((t) => t.id === active)!;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      /* clipboard unavailable, nothing useful to show */
    }
  };

  return (
    <div className="sw-handoff">
      <div className="sw-handoff__lead">
        <div className="sw-handoff__copy">
          <h3>Hand it to your agent.</h3>
          <p>
            Copy the brief and paste it into Claude Code or Codex. It reads the docs,
            registers a key, and connects the MCP server for you.
          </p>
        </div>
        <button
          type="button"
          className="sw-handoff__primary"
          onClick={() => copy(BRIEF, 'brief')}
        >
          {copied === 'brief' ? 'Copied. Now paste it.' : 'Copy the brief'}
        </button>
      </div>

      <details className="sw-handoff__preview">
        <summary>Preview what gets copied</summary>
        <pre>{BRIEF}</pre>
      </details>

      <div className="sw-handoff__tabs" role="tablist" aria-label="MCP client setup">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`handoff-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`handoff-panel-${t.id}`}
            className={`sw-handoff__tab${active === t.id ? ' sw-handoff__tab--active' : ''}`}
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
        className="summer-code sw-handoff__panel"
      >
        <div className="summer-code__bar">
          <span />
          <span />
          <span />
          <b>{tab.file}</b>
          <button
            type="button"
            className="sw-handoff__mini"
            onClick={() => copy(tab.code, tab.id)}
            aria-label={`Copy the ${tab.label} configuration`}
          >
            {copied === tab.id ? 'copied' : 'copy'}
          </button>
        </div>
        <pre>
          <code>{tab.code}</code>
        </pre>
        <p className="sw-handoff__note">{tab.note}</p>
      </div>
    </div>
  );
}

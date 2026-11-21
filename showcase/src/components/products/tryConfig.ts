/** slug -> which live widgets the "Try it" section mounts. Copy lives here, not in products.json. */
export type WidgetId = 'console' | 'mcp' | 'policy' | 'billing' | 'terminal' | 'command' | 'fees' | 'demo' | 'keyonly' | 'perps_live' | 'predict_live' | 'autopilot_live' | 'prices_live';
export type TryConfig = { title: string; blurb: string; widgets: WidgetId[] };

export const TRY: Record<string, TryConfig> = {
  'agent-api': { title: 'Run a real quote', blurb: 'Create a free key in one click and call the production API from this page. Every response below is live, with the exact request in curl, TypeScript and Python.', widgets: ['console'] },
  'swap-routing': { title: 'See the route for your swap', blurb: 'Quote any pair against the live router, then open the same swap in the Terminal.', widgets: ['prices_live', 'console', 'terminal'] },
  'sdks': { title: 'Call it before you install anything', blurb: 'Run a real quote with your own key, then copy the request as curl, TypeScript or Python.', widgets: ['console'] },
  'managed-wallets': { title: 'Dry-run a swap for a wallet', blurb: 'Quote, then simulate for a wallet address. A dry run never signs or sends.', widgets: ['console'] },
  'mcp-server': { title: 'Browse the live MCP tools', blurb: 'The tool list below is read from the production MCP endpoint right now. Then generate the config for your client.', widgets: ['mcp'] },
  'spend-policies': { title: 'Build a spend policy', blurb: 'Set limits and an allowlist, get the exact request for the policy route, and read the policy your wallet has today.', widgets: ['policy'] },
  'billing-credits': { title: 'Your balance, and what a workload costs', blurb: 'Live balance and metering for your key, plus a calculator built from the costs this page states.', widgets: ['billing'] },
  'approvals-audit': { title: 'Run the audit and approvals reads', blurb: 'Use the Run buttons in the endpoint table below. They call the live API with your key and show the real response, including the real refusal if your key lacks a scope.', widgets: ['keyonly'] },
  'organisations': { title: 'Run the organisation reads', blurb: 'Use the Run buttons in the endpoint table below. If a route needs an organisation your key does not belong to, you see the real response.', widgets: ['keyonly'] },
  'terminal': { title: 'Build a swap and open it in the Terminal', blurb: 'Pick a chain, token, side and amount. The link prefills the Terminal swap screen; nothing executes until you confirm there.', widgets: ['terminal'] },
  'predictions': { title: 'Open a market swap in the Terminal', blurb: 'Fund the trade: build the swap here and open it prefilled in the Terminal.', widgets: ['predict_live', 'terminal'] },
  'perps': { title: 'Build a command, or a funding swap', blurb: 'Assemble the exact bot command, or prefill a funding swap in the Terminal.', widgets: ['perps_live', 'command', 'terminal'] },
  'telegram-bot': { title: 'Build a bot command', blurb: 'Fill the fields, copy the exact command, and send it to the bot.', widgets: ['command'] },
  'orders': { title: 'Build an order command', blurb: 'Fill the fields, copy the exact command, and send it to the bot.', widgets: ['command'] },
  'alerts': { title: 'Build an alert command', blurb: 'Fill the fields, copy the exact command, and send it to the bot.', widgets: ['prices_live', 'command'] },
  'copy-trading': { title: 'Build a copy-trading command', blurb: 'Fill the fields, copy the exact command, and send it to the bot.', widgets: ['command'] },
  'sniping': { title: 'Build a sniper command', blurb: 'Fill the fields, copy the exact command, and send it to the bot.', widgets: ['command'] },
  'wallets-custody': { title: 'Estimate your fees', blurb: 'Trade size and plan in, fee out, using the fees stated on this page.', widgets: ['fees'] },
  'autopilot': { title: 'Watch it work', blurb: 'The paper-trading desk runs in the open. Open the live page to see decisions and positions.', widgets: ['autopilot_live', 'demo'] },
  'arbiter': { title: 'Run a checked run', blurb: 'Open the live arbiter page and run a checked trade run.', widgets: ['demo'] },
  'agent-desk': { title: 'Open the preview', blurb: 'The agent desk preview is live. Open it to see a proposal dossier.', widgets: ['demo'] },
};

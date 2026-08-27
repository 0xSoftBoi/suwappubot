/**
 * WebMCP tool surface for the Suwappu Agent Desk.
 *
 * The Desk registers site tools with the W3C Web Model Context API so that an
 * agent inside the browser (ChatGPT desktop's built-in browser, or Chrome with
 * WebMCP enabled) can research and *propose* onchain trades on this page —
 * while every state change that costs the human money stays behind an explicit,
 * human-clicked approval in the page UI.
 *
 * Two rules shape this file:
 *   1. Read tools answer instantly and are marked `readOnlyHint`.
 *   2. Nothing an agent can call signs, sends, or spends. `propose_swap` and
 *      `propose_price_alert` create a pending card that only a human can
 *      approve, and the signing handoff tool is *registered dynamically* only
 *      once such an approval exists.
 *
 * Spec: https://github.com/webmachinelearning/webmcp (document.modelContext).
 */

export interface ToolContent {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  execute: (
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown> | unknown;
}

export interface ModelContextLike {
  registerTool: (
    tool: ToolDescriptor,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
}

/**
 * The getter moved from `navigator` to `document` in the May 2026 spec draft
 * and `navigator.modelContext` is deprecated in Chromium 150, so feature-detect
 * both and prefer the document one.
 */
export function getModelContext(): ModelContextLike | null {
  if (typeof document === 'undefined') return null;
  const fromDocument = (document as unknown as { modelContext?: ModelContextLike })
    .modelContext;
  const fromNavigator =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as { modelContext?: ModelContextLike }).modelContext;
  const ctx = fromDocument ?? fromNavigator ?? null;
  return ctx && typeof ctx.registerTool === 'function' ? ctx : null;
}

/** Every tool answers with a text block holding compact JSON. */
function ok(payload: unknown): ToolContent {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(message: string): ToolContent {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

/**
 * What the React page must provide. Each method both answers the agent and
 * moves the visible UI, so the human always sees what the agent just did.
 */
export interface DeskController {
  listChains(signal?: AbortSignal): Promise<unknown>;
  findToken(args: { query: string; chain: string }, signal?: AbortSignal): Promise<unknown>;
  getPrices(args: { symbols: string[] }, signal?: AbortSignal): Promise<unknown>;
  previewSwap(
    args: {
      fromChain: string;
      toChain: string;
      fromToken: string;
      toToken: string;
      amount: string;
      slippagePercent?: number;
      order?: string;
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
  compareRoutes(
    args: {
      fromChain: string;
      toChain: string;
      fromToken: string;
      toToken: string;
      amount: string;
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
  readDesk(): unknown;
  proposeSwap(args: {
    fromChain: string;
    toChain: string;
    fromToken: string;
    toToken: string;
    amount: string;
    slippagePercent?: number;
    order?: string;
    rationale: string;
  }): Promise<unknown>;
  proposePriceAlert(args: {
    symbol: string;
    direction: string;
    targetPrice: number;
    rationale: string;
  }): Promise<unknown>;
  checkApproval(
    args: { proposalId: string; waitSeconds?: number },
    signal?: AbortSignal,
  ): Promise<unknown>;
  openSigningHandoff(args: { proposalId: string }): Promise<unknown>;
  onToolCall(name: string, args: Record<string, unknown>): void;
  onToolResult(name: string, summary: string, isError: boolean): void;
}

const CHAIN_KEYS =
  'A chain key such as ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, linea or solana. Call list_chains first if unsure.';

function summarize(payload: unknown): string {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

/**
 * Registers the Desk's tools. Returns a disposer; aborting the controller
 * unregisters every tool, per the spec's `{ signal }` registration option.
 */
export async function registerDeskTools(
  ctx: ModelContextLike,
  ctrl: DeskController,
): Promise<{ toolNames: string[]; dispose: () => void }> {
  const controller = new AbortController();

  /** Wraps a handler so the page logs the call, and errors never escape raw. */
  const wrap =
    (name: string, handler: ToolDescriptor['execute']): ToolDescriptor['execute'] =>
    async (args, options) => {
      ctrl.onToolCall(name, args ?? {});
      try {
        const result = await handler(args ?? {}, options);
        ctrl.onToolResult(name, summarize(result), false);
        return ok(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctrl.onToolResult(name, message, true);
        return fail(message);
      }
    };

  const tools: ToolDescriptor[] = [
    {
      name: 'list_chains',
      description:
        'List every blockchain Suwappu can route a swap across, with chain id and chain key. Call this before quoting if you are unsure which key to use.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: wrap('list_chains', (_a, o) => ctrl.listChains(o?.signal)),
    },
    {
      name: 'find_token',
      description:
        'Resolve a token symbol, name or contract address on one chain into its canonical address and decimals. Use this to disambiguate before quoting — many chains have several tokens with the same ticker.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symbol, name, or 0x contract address.' },
          chain: { type: 'string', description: CHAIN_KEYS },
        },
        required: ['query', 'chain'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('find_token', (a, o) =>
        ctrl.findToken(
          { query: String(a.query ?? ''), chain: String(a.chain ?? '') },
          o?.signal,
        ),
      ),
    },
    {
      name: 'get_prices',
      description:
        'Get current USD spot prices for a list of major token symbols (e.g. ETH, USDC, WBTC, SOL).',
      inputSchema: {
        type: 'object',
        properties: {
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Token symbols, e.g. ["ETH","USDC"].',
          },
        },
        required: ['symbols'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('get_prices', (a, o) =>
        ctrl.getPrices(
          { symbols: Array.isArray(a.symbols) ? a.symbols.map(String) : [] },
          o?.signal,
        ),
      ),
    },
    {
      name: 'preview_swap',
      description:
        'Price a same-chain or cross-chain swap and show it on the page. Returns the amount out, minimum received, price impact, bridge fee, gas estimate, expected duration and the route used. Indicative only: this never creates a transaction.',
      inputSchema: {
        type: 'object',
        properties: {
          fromChain: { type: 'string', description: CHAIN_KEYS },
          toChain: { type: 'string', description: 'Destination chain key. Same as fromChain for a same-chain swap.' },
          fromToken: { type: 'string', description: 'Symbol or contract address of the token being sold.' },
          toToken: { type: 'string', description: 'Symbol or contract address of the token being bought.' },
          amount: {
            type: 'string',
            description: 'Human-readable amount of fromToken to sell, e.g. "0.5".',
          },
          slippagePercent: {
            type: 'number',
            description: 'Max slippage in percent, e.g. 0.5 for 0.5%. Defaults to the desk setting.',
          },
          order: {
            type: 'string',
            enum: ['RECOMMENDED', 'FASTEST', 'CHEAPEST', 'SAFEST'],
            description: 'Route preference. Defaults to RECOMMENDED.',
          },
        },
        required: ['fromChain', 'toChain', 'fromToken', 'toToken', 'amount'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('preview_swap', (a, o) =>
        ctrl.previewSwap(
          {
            fromChain: String(a.fromChain ?? ''),
            toChain: String(a.toChain ?? ''),
            fromToken: String(a.fromToken ?? ''),
            toToken: String(a.toToken ?? ''),
            amount: String(a.amount ?? ''),
            slippagePercent:
              typeof a.slippagePercent === 'number' ? a.slippagePercent : undefined,
            order: a.order ? String(a.order) : undefined,
          },
          o?.signal,
        ),
      ),
    },
    {
      name: 'compare_routes',
      description:
        'Price the same swap four ways — RECOMMENDED, FASTEST, CHEAPEST and SAFEST — and render the comparison on the page so the human can see the trade-off between output, cost and settlement time before deciding.',
      inputSchema: {
        type: 'object',
        properties: {
          fromChain: { type: 'string', description: CHAIN_KEYS },
          toChain: { type: 'string', description: 'Destination chain key.' },
          fromToken: { type: 'string', description: 'Token being sold.' },
          toToken: { type: 'string', description: 'Token being bought.' },
          amount: { type: 'string', description: 'Human-readable amount of fromToken.' },
        },
        required: ['fromChain', 'toChain', 'fromToken', 'toToken', 'amount'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('compare_routes', (a, o) =>
        ctrl.compareRoutes(
          {
            fromChain: String(a.fromChain ?? ''),
            toChain: String(a.toChain ?? ''),
            fromToken: String(a.fromToken ?? ''),
            toToken: String(a.toToken ?? ''),
            amount: String(a.amount ?? ''),
          },
          o?.signal,
        ),
      ),
    },
    {
      name: 'read_desk',
      description:
        'Read what is currently on the desk: the ticket the human is looking at, the latest quote, every proposal and its approval state, and the recent activity log. Call this to re-orient after the human has clicked something.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: wrap('read_desk', () => ctrl.readDesk()),
    },
    {
      name: 'propose_swap',
      description:
        'Propose a swap to the human. This does NOT execute anything: it places a signed-off-by-nobody proposal card on the page with your rationale, and the human must click Approve or Reject. Returns a proposalId. Poll it with check_approval, and only after approval will the signing handoff become available.',
      inputSchema: {
        type: 'object',
        properties: {
          fromChain: { type: 'string', description: CHAIN_KEYS },
          toChain: { type: 'string', description: 'Destination chain key.' },
          fromToken: { type: 'string', description: 'Token being sold.' },
          toToken: { type: 'string', description: 'Token being bought.' },
          amount: { type: 'string', description: 'Human-readable amount of fromToken.' },
          slippagePercent: { type: 'number', description: 'Max slippage in percent.' },
          order: {
            type: 'string',
            enum: ['RECOMMENDED', 'FASTEST', 'CHEAPEST', 'SAFEST'],
            description: 'Route preference.',
          },
          rationale: {
            type: 'string',
            description:
              'One or two sentences the human will read explaining why you are proposing this trade. Required — a proposal with no reasoning is rejected.',
          },
        },
        required: ['fromChain', 'toChain', 'fromToken', 'toToken', 'amount', 'rationale'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: wrap('propose_swap', (a) =>
        ctrl.proposeSwap({
          fromChain: String(a.fromChain ?? ''),
          toChain: String(a.toChain ?? ''),
          fromToken: String(a.fromToken ?? ''),
          toToken: String(a.toToken ?? ''),
          amount: String(a.amount ?? ''),
          slippagePercent:
            typeof a.slippagePercent === 'number' ? a.slippagePercent : undefined,
          order: a.order ? String(a.order) : undefined,
          rationale: String(a.rationale ?? ''),
        }),
      ),
    },
    {
      name: 'propose_price_alert',
      description:
        'Propose a price alert for the human to approve. On approval the desk hands off a one-click link that arms the alert in the Suwappu bot. Does not create anything by itself.',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Token symbol to watch, e.g. ETH.' },
          direction: {
            type: 'string',
            enum: ['above', 'below'],
            description: 'Fire when price goes above or below the target.',
          },
          targetPrice: { type: 'number', description: 'Target price in USD.' },
          rationale: {
            type: 'string',
            description: 'Why this alert is worth setting. Shown to the human.',
          },
        },
        required: ['symbol', 'direction', 'targetPrice', 'rationale'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: wrap('propose_price_alert', (a) =>
        ctrl.proposePriceAlert({
          symbol: String(a.symbol ?? ''),
          direction: String(a.direction ?? ''),
          targetPrice: Number(a.targetPrice),
          rationale: String(a.rationale ?? ''),
        }),
      ),
    },
    {
      name: 'check_approval',
      description:
        'Check whether the human has approved or rejected a proposal. Set waitSeconds to block until they decide (up to 120s) instead of polling — the desk resolves the moment they click, and returns any note they typed.',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'The id returned by a propose_* tool.' },
          waitSeconds: {
            type: 'number',
            description:
              'How long to wait for the human, in seconds. 0 returns immediately. Max 120.',
          },
        },
        required: ['proposalId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('check_approval', (a, o) =>
        ctrl.checkApproval(
          {
            proposalId: String(a.proposalId ?? ''),
            waitSeconds: typeof a.waitSeconds === 'number' ? a.waitSeconds : 0,
          },
          o?.signal,
        ),
      ),
    },
  ];

  for (const tool of tools) {
    await ctx.registerTool(tool, { signal: controller.signal });
  }

  return {
    toolNames: tools.map((t) => t.name),
    dispose: () => controller.abort(),
  };
}

/**
 * The signing handoff is registered only while at least one proposal is
 * approved and unspent, so an agent can never reach for it speculatively — the
 * tool literally does not exist in the page's tool list until a human clicks
 * Approve. Returns a disposer used when the last approval is consumed.
 */
export async function registerHandoffTool(
  ctx: ModelContextLike,
  ctrl: DeskController,
): Promise<() => void> {
  const controller = new AbortController();
  await ctx.registerTool(
    {
      name: 'open_signing_handoff',
      description:
        'Open the signing handoff for a proposal the human already approved. Suwappu is non-custodial here: this hands the approved trade to the human\'s own wallet surface to sign. Only available while an approved, unspent proposal exists.',
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: {
            type: 'string',
            description: 'The id of an approved proposal.',
          },
        },
        required: ['proposalId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: async (args) => {
        const name = 'open_signing_handoff';
        ctrl.onToolCall(name, args ?? {});
        try {
          const result = await ctrl.openSigningHandoff({
            proposalId: String((args ?? {}).proposalId ?? ''),
          });
          ctrl.onToolResult(name, summarize(result), false);
          return ok(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctrl.onToolResult(name, message, true);
          return fail(message);
        }
      },
    },
    { signal: controller.signal },
  );
  return () => controller.abort();
}

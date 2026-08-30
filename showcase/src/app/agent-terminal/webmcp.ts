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
  readMandate(): unknown;
  navigateDesk(args: { section: string }): unknown;
  amendMandate(args: {
    rationale: string;
    perTradeUsdCap?: number;
    dailyUsdCap?: number;
    allowedChains?: string[];
    allowedBuyTokens?: string[];
    maxPriceImpactPercent?: number;
    maxSlippagePercent?: number;
  }): Promise<unknown>;
  compileMandateToPolicy(args: { download?: boolean }): Promise<unknown>;
  checkMandate(
    args: {
      fromChain: string;
      toChain: string;
      fromToken: string;
      toToken: string;
      amount: string;
      slippagePercent?: number;
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
  proposePlan(args: {
    rationale: string;
    steps: Array<Record<string, unknown>>;
  }): Promise<unknown>;
  requestOverride(args: { proposalId: string; argument: string }): Promise<unknown>;
  exportReceipt(args: { download?: boolean }): unknown;
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
        'Price a same-chain or cross-chain swap and show it on the page. Returns the amount out, minimum received, price impact, bridge fee, gas estimate, expected duration, the route used, and the mandate verdict for this exact trade. Use this directly when the human asks what something is worth — it already tells you whether the trade fits their rules, so there is no need to read the mandate first. Indicative only: this never creates a transaction.',
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
        'Price the same swap four ways — RECOMMENDED, FASTEST, CHEAPEST and SAFEST — and render the comparison on the page so the human can see the trade-off between output, cost and settlement time before deciding. Use this directly when the human asks to compare routes or what speed costs them; no other call is needed first.',
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
        'Propose a swap to the human. This does NOT execute anything: it places a proposal card on the page with your rationale, and the human must click Approve or Reject. The mandate verdict is attached to the proposal automatically — one that breaks the rules lands in red with Approve locked, and arguing for it takes request_override. check_mandate is only for sizing a trade silently beforehand; when the human asks you to propose, propose. Returns a proposalId; poll it with check_approval.',
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
        'Propose a price alert for the human to approve. It fetches the current spot price itself and shows it beside the target — you do not need to call get_prices first. On approval the desk hands off a one-click link that arms the alert in the Suwappu bot. Does not create anything by itself.',
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
      name: 'navigate_desk',
      description:
        "Move the human's view to a part of the desk and learn what lives there and which tools act on it. Use this to orient yourself before working, and to put the human's eyes on what you are about to talk about — pointing at the approvals queue before you explain a proposal beats describing it blind.",
      inputSchema: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['mandate', 'ticket', 'approvals', 'activity', 'how-it-works', 'tools'],
            description:
              'mandate = the human\'s standing envelope and today\'s budget. ticket = the shared trade form and live quote. approvals = proposals waiting on a human decision. activity = the log of what you have done. how-it-works = the explainer. tools = the full tool catalogue.',
          },
        },
        required: ['section'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('navigate_desk', (a) =>
        ctrl.navigateDesk({ section: String(a.section ?? '') }),
      ),
    },
    {
      name: 'amend_mandate',
      description:
        "Propose a change to the human's standing mandate itself — a different cap, another chain, one more token on the allow-list. This is how the envelope actually evolves: the human sees a before/after diff with every loosened rule flagged, and on approval the mandate CHANGES on the page and persists. The result echoes the current value of every rule you touch, so you do not need to call read_mandate first. Use it when the mandate is repeatedly getting in the way of trades the human clearly wants, and say what evidence made you ask. Do not use it to widen your own room without a reason you would defend out loud.",
      inputSchema: {
        type: 'object',
        properties: {
          rationale: {
            type: 'string',
            description:
              'Why the envelope should change, in the human\'s terms. Cite what happened — proposals that hit a cap, a chain they keep asking for.',
          },
          perTradeUsdCap: { type: 'number', description: 'New per-trade cap in USD.' },
          dailyUsdCap: { type: 'number', description: 'New daily cap in USD.' },
          allowedChains: {
            type: 'array',
            items: { type: 'string' },
            description: 'Replacement chain allow-list. An empty array means any chain.',
          },
          allowedBuyTokens: {
            type: 'array',
            items: { type: 'string' },
            description: 'Replacement token allow-list. An empty array means any token.',
          },
          maxPriceImpactPercent: { type: 'number', description: 'New price-impact ceiling.' },
          maxSlippagePercent: { type: 'number', description: 'New slippage ceiling.' },
        },
        required: ['rationale'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: wrap('amend_mandate', (a) =>
        ctrl.amendMandate({
          rationale: String(a.rationale ?? ''),
          ...(typeof a.perTradeUsdCap === 'number' ? { perTradeUsdCap: a.perTradeUsdCap } : {}),
          ...(typeof a.dailyUsdCap === 'number' ? { dailyUsdCap: a.dailyUsdCap } : {}),
          ...(Array.isArray(a.allowedChains)
            ? { allowedChains: a.allowedChains.map(String) }
            : {}),
          ...(Array.isArray(a.allowedBuyTokens)
            ? { allowedBuyTokens: a.allowedBuyTokens.map(String) }
            : {}),
          ...(typeof a.maxPriceImpactPercent === 'number'
            ? { maxPriceImpactPercent: a.maxPriceImpactPercent }
            : {}),
          ...(typeof a.maxSlippagePercent === 'number'
            ? { maxSlippagePercent: a.maxSlippagePercent }
            : {}),
        }),
      ),
    },
    {
      name: 'compile_mandate_to_policy',
      description:
        "Compile the negotiated mandate into Suwappu wallet spending-policy payloads — the request bodies POST /v1/agent/wallet/policy accepts to create real Turnkey policies that gate managed execution. This turns the envelope from something this page honours into something a server enforces. Returns the payloads plus honest notes about what did and did not survive compilation. Pass download:true to hand the human the file.",
      inputSchema: {
        type: 'object',
        properties: {
          download: {
            type: 'boolean',
            description: 'Also save the compiled policy bundle to the human\'s machine.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('compile_mandate_to_policy', (a) =>
        ctrl.compileMandateToPolicy({ download: a.download === true }),
      ),
    },
    {
      name: 'read_mandate',
      description:
        'Read the human\'s standing mandate: per-trade and daily USD caps, allowed chains, allowed tokens to buy, ceilings on price impact and slippage, and how much of today\'s budget is already spoken for. Call it when the human asks what they have authorised, or when you are about to argue for changing a rule. You do NOT need it before quoting — preview_swap, compare_routes and check_mandate each attach the mandate verdict to their own result.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: wrap('read_mandate', () => ctrl.readMandate()),
    },
    {
      name: 'check_mandate',
      description:
        'Dry-run a trade against the mandate before you propose it. Prices the trade, then returns whether it is inside the envelope and, if not, exactly which rules it breaks with the limit and the actual value. Cheap, silent, and does not put anything in front of the human — use it to iterate on size, chain or token until the trade fits.',
      inputSchema: {
        type: 'object',
        properties: {
          fromChain: { type: 'string', description: CHAIN_KEYS },
          toChain: { type: 'string', description: 'Destination chain key.' },
          fromToken: { type: 'string', description: 'Token being sold.' },
          toToken: { type: 'string', description: 'Token being bought.' },
          amount: { type: 'string', description: 'Human-readable amount of fromToken.' },
          slippagePercent: { type: 'number', description: 'Max slippage in percent.' },
        },
        required: ['fromChain', 'toChain', 'fromToken', 'toToken', 'amount'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('check_mandate', (a, o) =>
        ctrl.checkMandate(
          {
            fromChain: String(a.fromChain ?? ''),
            toChain: String(a.toChain ?? ''),
            fromToken: String(a.fromToken ?? ''),
            toToken: String(a.toToken ?? ''),
            amount: String(a.amount ?? ''),
            slippagePercent:
              typeof a.slippagePercent === 'number' ? a.slippagePercent : undefined,
          },
          o?.signal,
        ),
      ),
    },
    {
      name: 'propose_plan',
      description:
        'Propose a SEQUENCE of steps as one reviewable unit — for example bridge, then buy, then set an alert. The human approves the plan once instead of clicking through every leg. Each step is priced and checked against the mandate individually, and the card shows the combined notional. Prefer this over several propose_swap calls whenever the steps only make sense together.',
      inputSchema: {
        type: 'object',
        properties: {
          rationale: {
            type: 'string',
            description: 'Why this sequence, as a whole. The human reads this.',
          },
          steps: {
            type: 'array',
            maxItems: 5,
            description: 'Between 1 and 5 steps, executed in order.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['swap', 'alert'] },
                fromChain: { type: 'string', description: 'swap: source chain key.' },
                toChain: { type: 'string', description: 'swap: destination chain key.' },
                fromToken: { type: 'string', description: 'swap: token sold.' },
                toToken: { type: 'string', description: 'swap: token bought.' },
                amount: { type: 'string', description: 'swap: amount of fromToken.' },
                slippagePercent: { type: 'number', description: 'swap: max slippage percent.' },
                symbol: { type: 'string', description: 'alert: token symbol to watch.' },
                direction: { type: 'string', enum: ['above', 'below'], description: 'alert: side.' },
                targetPrice: { type: 'number', description: 'alert: USD target.' },
                note: { type: 'string', description: 'One line on what this step is for.' },
              },
              required: ['kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['rationale', 'steps'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: wrap('propose_plan', (a) =>
        ctrl.proposePlan({
          rationale: String(a.rationale ?? ''),
          steps: Array.isArray(a.steps) ? (a.steps as Array<Record<string, unknown>>) : [],
        }),
      ),
    },
    {
      name: 'export_receipt',
      description:
        'Return the full session receipt: every tool you called, every proposal with its rationale and mandate verdict, every human decision and note, and every signing handoff. Pass download:true to also hand the human a file. This is the audit trail for what you did and why.',
      inputSchema: {
        type: 'object',
        properties: {
          download: {
            type: 'boolean',
            description: 'Also save a copy to the human\'s machine. Defaults to false.',
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: wrap('export_receipt', (a) =>
        ctrl.exportReceipt({ download: a.download === true }),
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

/**
 * Registered only while a proposal is blocked by the mandate. This is the
 * negotiation channel: the agent cannot quietly route around the human's
 * envelope, but it can *argue* with it, once, in the open, and the human sees
 * that argument as its own card rather than as another Approve button.
 */
export async function registerOverrideTool(
  ctx: ModelContextLike,
  ctrl: DeskController,
): Promise<() => void> {
  const controller = new AbortController();
  await ctx.registerTool(
    {
      name: 'request_override',
      description:
        "Ask the human to grant a one-time exception for a proposal your mandate check blocked. Say plainly which rule you want bent and why this trade is worth bending it for. They see your argument beside the rule you broke and can allow it once or deny it. Do not call this reflexively — an override you cannot justify costs you the next one. Only exists while a blocked proposal is on the desk.",
      inputSchema: {
        type: 'object',
        properties: {
          proposalId: { type: 'string', description: 'The blocked proposal.' },
          argument: {
            type: 'string',
            description:
              'Your case, in one or two sentences. Name the rule and why this trade justifies the exception.',
          },
        },
        required: ['proposalId', 'argument'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
      execute: async (args) => {
        const name = 'request_override';
        ctrl.onToolCall(name, args ?? {});
        try {
          const result = await ctrl.requestOverride({
            proposalId: String((args ?? {}).proposalId ?? ''),
            argument: String((args ?? {}).argument ?? ''),
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

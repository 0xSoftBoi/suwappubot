/**
 * MCP tool catalogue — pure data, no service imports.
 *
 * Kept separate from mcp.ts (which pulls in the whole Effect service graph and
 * a DB connection) so tooling can import the catalogue cheaply. This is what
 * lets scripts/check-mcp-schemas.ts verify the published schemas without
 * booting the app.
 */
import { z } from 'zod'
import { mcpInputSchema, toOutputJsonSchema } from '../lib/zodJsonSchema'
import {
	McpGetPortfolioSchema,
	McpGetPricesSchema,
	McpGetSwapHistorySchema,
	McpGetSwapStatusSchema,
	McpLendMarketSchema,
	McpLendMarketsSchema,
	McpListWalletPoliciesSchema,
	McpPerpsPositionsSchema,
	McpPredictMarketIdSchema,
	McpPredictMarketsSchema,
	McpPredictTradesSchema,
	PerpsQuoteSchema,
	QuoteRequestSchema,
	SimulateSwapSchema,
} from './validators'

// ---------------------------------------------------------------
// Tool definitions (MCP tool schema)
// ---------------------------------------------------------------
//
// Tools whose arguments are validated by a Zod schema in validators.ts derive
// their `inputSchema` from that schema via `mcpInputSchema()`, so the catalogue
// we publish to agents cannot claim a field is less constrained than the
// server actually enforces. Before this, `get_quote` advertised `slippage` as
// an unbounded number while the route rejected anything over 0.5, and
// `perps_quote` advertised unbounded `leverage` against a cap of 20 — an agent
// had no way to know until it ate a 400.
//
// Descriptions stay hand-written here (they are agent-facing prose, and per
// Anthropic's tool-design guidance the highest-leverage text in the catalogue);
// only types and constraints are derived. `overrides` re-state constraints that
// live in a `.refine()`, which `z.toJSONSchema` silently drops.
//
// Tools NOT in this map still carry hand-written schemas — see
// scripts/check-mcp-schemas.ts, which reports them as unmapped coverage.

const GET_QUOTE_INPUT = mcpInputSchema(QuoteRequestSchema, {
	from_token: 'Source token symbol (e.g. ETH, SOL, USDC)',
	to_token: 'Destination token symbol',
	amount: 'Amount of from_token in human units, not base units/wei (e.g. "0.5" ETH)',
	chain: 'Chain key for same-chain swaps, from list_chains (e.g. ethereum, base, arbitrum, solana). Defaults to ethereum.',
	from_chain: 'Source chain key for cross-chain swaps (e.g. base). Overrides chain.',
	to_chain: 'Destination chain key for cross-chain swaps (e.g. arbitrum). Optional.',
	wallet_address: 'Wallet address to get executable transaction data (optional)',
	slippage: 'Slippage tolerance as a decimal fraction, not percent or bps (0.03 = 3%, 0.005 = 0.5%). Max 0.5. Default 0.03.',
}, {
	properties: {
		// tokenAmountSchema .refine() dropped by z.toJSONSchema.
		amount: { description: 'Amount to swap in human units (e.g. "0.5"). Positive decimal string, max 1,000,000 units.' },
		// evmAddressSchema .refine() (zero-address ban) dropped.
		wallet_address: { description: 'Wallet address to get executable transaction data (optional). Must be a valid non-zero address.' },
	},
})

const SIMULATE_SWAP_INPUT = mcpInputSchema(SimulateSwapSchema, {
	quote_id: 'Quote ID from get_quote, valid ~60s (optional — if omitted, from_token/to_token/amount are required)',
	from_token: 'Source token symbol (e.g. ETH, SOL, USDC)',
	to_token: 'Destination token symbol',
	amount: 'Amount of from_token in human units, not base units/wei (e.g. "0.5" ETH)',
	chain: 'Chain key for same-chain swaps, from list_chains (e.g. ethereum, base, arbitrum, solana). Defaults to ethereum.',
	from_chain: 'Source chain key for cross-chain swaps (e.g. base). Overrides chain.',
	to_chain: 'Destination chain key for cross-chain swaps (e.g. arbitrum). Optional.',
	wallet_address: 'Wallet address to run balance/allowance/gas/eth_call checks against. Strongly recommended — without it those checks are skipped.',
	slippage: 'Slippage tolerance as a decimal fraction, not percent or bps (0.03 = 3%, 0.005 = 0.5%). Max 0.5. Default 0.03.',
}, {
	// Top-level .refine() dropped — re-state the either/or requirement.
	description: 'Provide either quote_id, or from_token + to_token + amount.',
	properties: {
		amount: { description: 'Amount to swap in human units (e.g. "0.5"). Positive decimal string, max 1,000,000 units.' },
	},
})

const PERPS_QUOTE_INPUT = mcpInputSchema(PerpsQuoteSchema, {
	market:
		'Perp market name (e.g. "ETH-USD", "BTC-USD") as returned by perps_markets',
	side: 'Position direction',
	size: 'Position size in the base asset',
	leverage:
		'Leverage multiplier (e.g. 10). Use the market maxLeverage returned by perps_markets; current Suwappu ceiling is 20.',
})

const GET_PORTFOLIO_INPUT = mcpInputSchema(McpGetPortfolioSchema, {
	"wallet_address": "Wallet address (0x... for EVM, base58 for Solana)",
	"chain": "Filter to specific chain (optional)",
})

const GET_PRICES_INPUT = mcpInputSchema(McpGetPricesSchema, {
	"symbols": "Comma-separated token symbols (e.g. \"ETH,SOL,USDC\"). Between 1 and 20 symbols.",
})

const PERPS_POSITIONS_INPUT = mcpInputSchema(McpPerpsPositionsSchema, {
	"address": "Wallet address to inspect. Must be your managed wallet.",
})

const LEND_MARKETS_INPUT = mcpInputSchema(McpLendMarketsSchema, {
	"chain_id": "Positive EVM chain ID (default 8453 = Base)",
})

const LEND_MARKET_INPUT = mcpInputSchema(McpLendMarketSchema, {
	"market_id": "Morpho market unique ID (from lend_markets results)",
	"chain_id": "Positive EVM chain ID (default 8453 = Base)",
})

const PREDICT_MARKETS_INPUT = mcpInputSchema(McpPredictMarketsSchema, {
	"query": "Search query or category tag (e.g. \"bitcoin\", \"crypto\", \"politics\")",
	"limit": "Max results (default 10). Values above 50 are clamped to 50.",
})

const PREDICT_MARKET_INPUT = mcpInputSchema(McpPredictMarketIdSchema, {
	"market_id": "Market ID (the `id` field from predict_markets; not `conditionId`)",
})

const PREDICT_BOOK_INPUT = mcpInputSchema(McpPredictMarketIdSchema, {
	"market_id": "Market ID (the `id` field from predict_markets; not `conditionId`)",
})

const PREDICT_PRICE_INPUT = mcpInputSchema(McpPredictMarketIdSchema, {
	"market_id": "Market ID (the `id` field from predict_markets; not `conditionId`)",
})

const PREDICT_TRADES_INPUT = mcpInputSchema(McpPredictTradesSchema, {
	"market_id": "Market ID (the `id` field from predict_markets; not `conditionId`)",
	"limit": "Max trades to return (default 20). Values above 100 are clamped to 100.",
})

const GET_SWAP_STATUS_INPUT = mcpInputSchema(McpGetSwapStatusSchema, {
	"swap_id": "Managed swap ID returned by POST /v1/agent/swap/execute (not a quote_id)",
})

const GET_SWAP_HISTORY_INPUT = mcpInputSchema(McpGetSwapHistorySchema, {
	"status": "Filter by swap status: pending, completed or failed. Optional.",
	"limit": "Max results (default 20). Values above 100 are clamped to 100.",
	"offset": "Pagination offset (default 0)",
})

const LIST_WALLET_POLICIES_INPUT = mcpInputSchema(McpListWalletPoliciesSchema, {
	"wallet_address": "Wallet address (optional — defaults to the authenticated agent's managed wallet).",
})

// ---------------------------------------------------------------
// Suwappu Bank tools (bank_*)
// ---------------------------------------------------------------
//
// Each tool is a thin, declarative binding to ONE `/v1/agent/bank` route. The
// handler in mcp.ts dispatches the call IN-PROCESS through the same Hono app
// (`bankAgentRoutes`) with the caller's own credentials, so owner resolution
// (agent id from the API key), zod validation, idempotency, policy/mandate/limit
// checks and BankError -> code mapping are exactly the HTTP route's — there is no
// second, less-guarded path. Arguments are snake_case (MCP convention here) and
// are mapped to the route's camelCase body; nested objects keep the API's
// camelCase field names. Money is minor-unit integer strings.

export interface BankToolSpec {
	name: string
	title: string
	description: string
	method: 'GET' | 'POST'
	/** Route path under /v1/agent/bank; `{x}` is replaced by the `x` argument. */
	path: string
	/** Arguments consumed by the path template. */
	pathParams?: string[]
	/** Arguments sent as query string (GET). Everything else is the JSON body. */
	query?: string[]
	/** Money-moving: `idempotency_key` is REQUIRED and sent as body field + Idempotency-Key header. */
	keyed?: boolean
	/** The route has no server-side idempotency key; mcp.ts dedupes by (agent, key, args) in-process. */
	localDedupe?: boolean
	readOnly: boolean
	properties: Record<string, unknown>
	required: string[]
}

const IDEM_PROP = {
	type: 'string',
	pattern: '^[A-Za-z0-9_.:-]{8,128}$',
	description: 'REQUIRED. Unique intent key, 8-128 chars of A-Za-z0-9_.:- . Retrying the same call with the SAME key never double-spends; reusing a key with different terms is rejected. On LOCK_BUSY (retryable) retry with the same key.',
}
const MINOR_PROP = { type: 'string', pattern: '^[1-9][0-9]{0,77}$', description: 'Amount in minor units (integer string, e.g. "1500000" = 1.50 USDC).' }
const HUMAN_PROP = { type: 'string', pattern: '^\\d+(\\.\\d+)?$', description: 'Amount as a human decimal string (e.g. "1.5"). Provide exactly one of amount_minor or amount.' }
const ACCT = (d: string) => ({ type: 'string', description: d })

export const BANK_TOOL_SPECS: BankToolSpec[] = [
	{ name: 'bank_list_accounts', title: 'List Bank Accounts', method: 'GET', path: '/accounts', readOnly: true, properties: {}, required: [],
		description: "List this agent's Suwappu Bank accounts with ledger balances (balance_minor in minor units, plus human balance). Read-only." },
	{ name: 'bank_open_account', title: 'Open Bank Account', method: 'POST', path: '/accounts', readOnly: false,
		description: 'Open a bank account for an asset on a chain (e.g. USDC on base). Does not move funds. kind: checking (default), savings, credit or treasury.',
		properties: {
			kind: { type: 'string', enum: ['checking', 'savings', 'credit', 'treasury'], description: 'Account kind. Default checking.' },
			asset: { type: 'string', description: 'Asset symbol, e.g. USDC.' },
			chain: { type: 'string', description: 'Chain key, e.g. base.' },
			label: { type: 'string', description: 'Optional label (max 80 chars).' },
			segment_profile: { type: 'string', description: 'Optional segment profile.' },
		}, required: ['asset', 'chain'] },
	{ name: 'bank_get_statement', title: 'Get Account Statement', method: 'GET', path: '/accounts/{account_id}/statement', pathParams: ['account_id'], query: ['limit', 'cursor'], readOnly: true,
		description: 'Paged ledger statement for one account. Use next_cursor from the result as cursor for the next page. Read-only.',
		properties: { account_id: ACCT('Bank account id.'), limit: { type: 'integer', description: 'Page size.' }, cursor: { type: 'string', description: 'Cursor from a previous page.' } }, required: ['account_id'] },
	{ name: 'bank_transfer', title: 'Bank Transfer', method: 'POST', path: '/transfers', keyed: true, readOnly: false,
		description: 'MONEY-MOVING. Transfer from one of your bank accounts to another account (to_account_id) or an external on-chain address (to_external). Subject to policy, mandate and limit checks; may fail with POLICY_BLOCKED / LIMIT_EXCEEDED / INSUFFICIENT_FUNDS. Provide exactly one of amount_minor or amount, and exactly one of to_account_id or to_external. Confirm with the user before calling.',
		properties: {
			idempotency_key: IDEM_PROP, from_account_id: ACCT('Source bank account id.'), to_account_id: ACCT('Destination bank account id.'),
			to_external: { type: 'object', properties: { address: { type: 'string', description: 'Destination address (20-128 chars).' } }, required: ['address'], description: 'External on-chain destination.' },
			amount_minor: MINOR_PROP, amount: HUMAN_PROP, memo: { type: 'string', description: 'Optional memo (max 280).' },
		}, required: ['idempotency_key', 'from_account_id'] },
	{ name: 'bank_get_transfer', title: 'Get Bank Transfer', method: 'GET', path: '/transfers/{transfer_id}', pathParams: ['transfer_id'], readOnly: true,
		description: 'Fetch a transfer and its status (pending, submitted, confirmed, failed, reversed). Read-only.',
		properties: { transfer_id: ACCT('Transfer id.') }, required: ['transfer_id'] },
	{ name: 'bank_fx_quote', title: 'Bank FX Quote', method: 'POST', path: '/fx/quote', readOnly: true,
		description: 'Quote a conversion between two of your bank accounts (different assets). Moves nothing. Provide exactly one of amount_minor or amount.',
		properties: { from_account_id: ACCT('Source account id.'), to_account_id: ACCT('Destination account id.'), amount_minor: MINOR_PROP, amount: HUMAN_PROP,
			slippage: { type: 'number', minimum: 0.0001, maximum: 0.05, description: 'Slippage fraction (0.01 = 1%).' }, require_direct: { type: 'boolean', description: 'Only direct routes.' } },
		required: ['from_account_id', 'to_account_id'] },
	{ name: 'bank_fx_execute', title: 'Bank FX Execute', method: 'POST', path: '/fx/execute', keyed: true, readOnly: false,
		description: 'MONEY-MOVING. Execute a conversion between two of your bank accounts. Provide exactly one of amount_minor or amount; min_to_minor protects against slippage. Confirm with the user before calling.',
		properties: { idempotency_key: IDEM_PROP, from_account_id: ACCT('Source account id.'), to_account_id: ACCT('Destination account id.'), amount_minor: MINOR_PROP, amount: HUMAN_PROP,
			slippage: { type: 'number', minimum: 0.0001, maximum: 0.05, description: 'Slippage fraction.' }, require_direct: { type: 'boolean', description: 'Only direct routes.' }, min_to_minor: MINOR_PROP },
		required: ['idempotency_key', 'from_account_id', 'to_account_id'] },
	{ name: 'bank_earn_vaults', title: 'List Earn Vaults', method: 'GET', path: '/earn/vaults', query: ['asset', 'chain'], readOnly: true,
		description: 'List yield vaults available for an asset on a chain. Read-only.',
		properties: { asset: ACCT('Asset symbol, e.g. USDC.'), chain: ACCT('Chain key, e.g. base.') }, required: ['asset', 'chain'] },
	{ name: 'bank_earn_deposit', title: 'Earn Deposit', method: 'POST', path: '/earn/deposit', keyed: true, readOnly: false,
		description: 'MONEY-MOVING. Deposit from a bank account into a yield vault (EVM address). Provide exactly one of amount_minor or amount. Confirm with the user before calling.',
		properties: { idempotency_key: IDEM_PROP, account_id: ACCT('Bank account id to deposit from.'), vault: ACCT('Vault EVM address (0x + 40 hex) from bank_earn_vaults.'), amount_minor: MINOR_PROP, amount: HUMAN_PROP },
		required: ['idempotency_key', 'account_id', 'vault'] },
	{ name: 'bank_earn_withdraw', title: 'Earn Withdraw', method: 'POST', path: '/earn/withdraw', keyed: true, readOnly: false,
		description: 'MONEY-MOVING. Withdraw from a yield vault back to the bank account. Provide exactly one of amount_minor, amount or all=true. Confirm with the user before calling.',
		properties: { idempotency_key: IDEM_PROP, account_id: ACCT('Bank account id.'), vault: ACCT('Vault EVM address.'), amount_minor: MINOR_PROP, amount: HUMAN_PROP, all: { type: 'boolean', description: 'Withdraw the whole position.' } },
		required: ['idempotency_key', 'account_id', 'vault'] },
	{ name: 'bank_credit_lines', title: 'List Credit Lines', method: 'GET', path: '/credit/lines', readOnly: true,
		description: "List this agent's credit lines (collateralised borrowing) with health. Read-only.", properties: {}, required: [] },
	{ name: 'bank_credit_draw', title: 'Credit Draw', method: 'POST', path: '/credit/draw', keyed: true, readOnly: false,
		description: 'MONEY-MOVING (creates debt). Borrow against a credit line. Provide exactly one of amount_minor, amount or all=true. Confirm with the user before calling.',
		properties: { idempotency_key: IDEM_PROP, line_id: ACCT('Credit line id from bank_credit_lines.'), amount_minor: MINOR_PROP, amount: HUMAN_PROP, all: { type: 'boolean', description: 'Draw the maximum available.' } },
		required: ['idempotency_key', 'line_id'] },
	{ name: 'bank_credit_repay', title: 'Credit Repay', method: 'POST', path: '/credit/repay', keyed: true, readOnly: false,
		description: 'MONEY-MOVING. Repay debt on a credit line. Provide exactly one of amount_minor, amount or all=true. Confirm with the user before calling.',
		properties: { idempotency_key: IDEM_PROP, line_id: ACCT('Credit line id.'), amount_minor: MINOR_PROP, amount: HUMAN_PROP, all: { type: 'boolean', description: 'Repay the full debt.' } },
		required: ['idempotency_key', 'line_id'] },
	{ name: 'bank_create_invoice', title: 'Create Invoice', method: 'POST', path: '/payments/invoices', keyed: true, readOnly: false,
		description: 'Create an invoice payable into one of your accounts (payee_account_id). Give amount_minor or line_items (camelCase: description, quantity, unitAmountMinor). publish=true makes it payable immediately. Moves no funds itself.',
		properties: { idempotency_key: IDEM_PROP, payee_account_id: ACCT('Your account that receives payment.'), amount_minor: MINOR_PROP,
			line_items: { type: 'array', maxItems: 100, items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'integer', minimum: 1 }, unitAmountMinor: { type: 'string' } }, required: ['description', 'quantity', 'unitAmountMinor'] }, description: 'Invoice lines.' },
			due_at: { type: 'string', description: 'ISO date.' }, memo: { type: 'string', description: 'Max 280 chars.' }, publish: { type: 'boolean', description: 'Publish immediately.' } },
		required: ['idempotency_key', 'payee_account_id'] },
	{ name: 'bank_pay_invoice', title: 'Pay Invoice', method: 'POST', path: '/payments/invoices/pay', keyed: true, readOnly: false,
		description: 'MONEY-MOVING. Pay an invoice from one of your accounts, by invoice_id or slug. Confirm with the user before calling.',
		properties: { idempotency_key: IDEM_PROP, invoice_id: ACCT('Invoice id (or use slug).'), slug: ACCT('Invoice slug (8-32 chars).'), from_account_id: ACCT('Paying account id.'), amount_minor: MINOR_PROP },
		required: ['idempotency_key', 'from_account_id'] },
	{ name: 'bank_remit_send', title: 'Send Remittance', method: 'POST', path: '/remittance/send', keyed: true, readOnly: false,
		description: 'MONEY-MOVING. Send money to a recipient. recipient (camelCase fields) is one of {kind:"user",telegramId|username}, {kind:"address",address}, {kind:"claim",label?} (returns a claim link), {kind:"payout",rail,externalAccountId}. Provide exactly one of amount_minor or amount. Confirm with the user before calling.',
		properties: { idempotency_key: IDEM_PROP, from_account_id: ACCT('Source account id.'), amount_minor: MINOR_PROP, amount: HUMAN_PROP, memo: { type: 'string', description: 'Max 280.' }, auto_earn: { type: 'boolean', description: 'Park the received funds in earn.' },
			recipient: { type: 'object', description: 'Recipient (see description).', properties: { kind: { type: 'string', enum: ['user', 'address', 'claim', 'payout'] } }, required: ['kind'], additionalProperties: true } },
		required: ['idempotency_key', 'from_account_id', 'recipient'] },
	{ name: 'bank_agent_pay', title: 'Agent Pay (x402)', method: 'POST', path: '/agents/pay', keyed: true, readOnly: false,
		description: 'MONEY-MOVING. Pay for an x402 pay-per-call HTTP resource within the agent mandate (per-call max, daily cap, allowed hosts/payees/assets enforced server-side). Returns the resource response and the payment receipt. Confirm with the user before calling.',
		properties: { idempotency_key: IDEM_PROP, mandate_id: ACCT('Mandate id from your agent account.'), url: ACCT('Resource URL (max 2048).'), method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'Default GET.' },
			body: { type: 'string', description: 'Request body (max 100000).' }, headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra request headers.' } },
		required: ['idempotency_key', 'mandate_id', 'url'] },
	{ name: 'bank_agent_register_resource', title: 'Register Paid Resource', method: 'POST', path: '/agents/resources', readOnly: false,
		description: 'Register an upstream URL as an x402 paywalled resource you sell per call; revenue is credited to account_id. Moves no funds.',
		properties: { account_id: ACCT('Account that receives revenue.'), title: ACCT('Title (max 120).'), description: ACCT('Optional description (max 2000).'), upstream_url: ACCT('Upstream URL to proxy.'), price_minor: MINOR_PROP, slug: ACCT('Optional slug (max 40).') },
		required: ['account_id', 'title', 'upstream_url', 'price_minor'] },
	{ name: 'bank_fee_model', title: 'Chain Fee Model', method: 'POST', path: '/chains/fee-model', readOnly: true,
		description: 'Compare payment fees for an asset across chains. Read-only. Provide amount_minor or amount.',
		properties: { asset: ACCT('Asset symbol.'), amount_minor: MINOR_PROP, amount: HUMAN_PROP, chains: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12, description: 'Chain keys to compare.' } },
		required: ['asset', 'chains'] },
	{ name: 'bank_ops_alerts', title: 'Bank Ops Alerts', method: 'GET', path: '/ops/alerts', readOnly: true,
		description: "Stuck or failed transfers/operations for this agent (read-only; never auto-resolves money).", properties: {}, required: [] },
]

const BANK_TOOLS = BANK_TOOL_SPECS.map((t) => ({
	name: t.name,
	description: t.description,
	inputSchema: { type: 'object', properties: t.properties, required: t.required, additionalProperties: false },
}))

const BANK_ANNOTATIONS: Record<string, { title: string; readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean }> = Object.fromEntries(
	BANK_TOOL_SPECS.map((t) => [
		t.name,
		t.readOnly
			? { title: t.title, readOnlyHint: true, idempotentHint: true, openWorldHint: false }
			: t.keyed && /MONEY-MOVING/.test(t.description)
				? { title: t.title, readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
				: { title: t.title, readOnlyHint: false, destructiveHint: false, idempotentHint: !!t.keyed, openWorldHint: false },
	]),
)

const TOOLS = [
	{
		name: 'get_quote',
		description: "Get a priced swap quote and a quote_id, moving no funds. Use first in the flow get_quote -> simulate_swap -> execute_swap; for token prices only, use get_prices instead. Same-chain or cross-chain (EVM via Li.Fi, Solana via Jupiter). Pass wallet_address to get a quote that execute_swap can turn into a transaction. The quote_id is valid for about 60 seconds and is only redeemable by the authenticated agent that requested it; anonymous callers (no API key) get a quote without an executable quote_id. Same-chain results include sign_url: show it to the user so they can review and confirm the trade in the Suwappu terminal (it only pre-fills the form; nothing executes until the user confirms). Amounts are human units, slippage is a decimal fraction (0.03 = 3%, max 0.5).",
		inputSchema: GET_QUOTE_INPUT,
	},
	{
		name: 'get_portfolio',
		description: "Read token balances and USD portfolio value for one wallet address across supported chains. Read-only, no side effects. Use to check holdings before swapping; for prices alone use get_prices, for past swaps use get_swap_history. wallet_address is 0x... for EVM or base58 for Solana; chain optionally narrows the result.",
		inputSchema: GET_PORTFOLIO_INPUT,
	},
	{
		name: 'get_prices',
		description: "Read current USD prices with 24h change for up to 20 token symbols. Read-only. Use for quick price checks; use get_quote when you need an executable swap price with fees and slippage. Supported: ETH, SOL, BNB, USDC, USDT, BTC, DAI, WBTC, ARB, OP, AVAX, MATIC, WETH, BONK, JUP, RAY. Pass symbols comma-separated, e.g. \"ETH,SOL\".",
		inputSchema: GET_PRICES_INPUT,
	},
	{
		name: 'list_chains',
		description: "List every blockchain network Suwappu can quote swaps on, with id, key, name and native token. Read-only, free, no API key. Call this to find valid chain keys (e.g. base, arbitrum, solana) for get_quote, list_tokens and get_portfolio. Takes no arguments.",
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'list_tokens',
		description: "List tokens on a chain, optionally filtered by symbol. Read-only, free, no API key. Solana returns symbol, address and decimals; a known EVM chain returns chain info plus a pointer to GET /v1/agent/tokens for the full list; no chain returns the available chain names. Use list_chains for chain keys, get_tempo_tokens for Tempo.",
		inputSchema: {
			type: 'object',
			properties: {
				chain: { type: 'string', description: 'Chain key from list_chains (e.g. "base", "solana"). If omitted, returns available chain names.' },
				search: { type: 'string', description: 'Filter tokens by symbol substring (optional)' },
			},
		},
	},
	{
		name: 'execute_swap',
		description: "Build an UNSIGNED swap transaction from a quote_id; it never signs or broadcasts, so you must sign and submit it yourself. Call after get_quote (and ideally simulate_swap), within about 60 seconds. The quote must have been made with the same wallet_address. The org spend policy is evaluated first and may block the request or require approval, returned as an error. Does not create a managed swap record.",
		inputSchema: {
			type: 'object',
			properties: {
				quote_id: { type: 'string', description: 'Quote ID from get_quote, valid about 60 seconds and owned by this agent. The quote must have been made with the same wallet_address.' },
				wallet_address: { type: 'string', description: 'Address that will sign and send the transaction (0x... EVM or base58 Solana); must match the wallet_address used in get_quote' },
				idempotency_key: { type: 'string', description: 'Optional intent key echoed back with the unsigned transaction so the caller can carry it into its submission workflow. MCP preparation itself does not submit or dedupe an on-chain transaction.' },
			},
			required: ['quote_id', 'wallet_address'],
		},
	},
	{
		name: 'simulate_swap',
		description: "Dry-run a swap with zero funds moved: returns expected output, price impact and safety checks (balance, ERC-20 allowance, gas, eth_call revert, slippage sanity). Use after get_quote and before execute_swap. Pass quote_id, or from_token + to_token + amount. Always pass wallet_address, otherwise balance/allowance/gas checks are skipped. Never signs or broadcasts.",
		inputSchema: SIMULATE_SWAP_INPUT,
	},
	{
		name: 'get_tempo_tokens',
		description: "List TIP-20 tokens on Tempo mainnet (chain ID 4217) with address, decimals and TIP-20 metadata. Read-only, free, no API key. Tempo uses USD-denominated TIP-20 stablecoins with 6 decimals; pathUSD is listed on mainnet. Use list_tokens for other chains.",
		inputSchema: {
			type: 'object',
			properties: {
				search: { type: 'string', description: 'Filter tokens by symbol substring (optional)' },
			},
		},
	},
	{
		name: 'browse_mpp_directory',
		description: "Browse the third-party MPP (Machine Payments Protocol, directory.mpp.dev) directory of paid services and their payment requirements. Read-only, free, no API key. Unrelated to Suwappu swaps and to Suwappu's own pathUSD micropayment auth. Optionally filter by category (e.g. defi, ai, data).",
		inputSchema: {
			type: 'object',
			properties: {
				category: { type: 'string', description: 'Filter by category (e.g. "defi", "ai", "data"). Optional.' },
				limit: { type: 'number', description: 'Max results to return (default 20, max 100)' },
			},
		},
	},
	{
		name: 'predict_markets',
		description: "Search active Polymarket prediction markets by keyword or category tag, returning live prices, volumes and CLOB token IDs. Read-only. Start here to find a market, then use the returned id with predict_market, predict_price, predict_book or predict_trades. Does not place bets.",
		inputSchema: PREDICT_MARKETS_INPUT,
	},
	{
		name: 'predict_market',
		description: "Get detail for one Polymarket market, including live CLOB midpoint price per outcome. Read-only. market_id is the id field from predict_markets (not conditionId). For only prices use predict_price; for depth use predict_book.",
		inputSchema: PREDICT_MARKET_INPUT,
	},
	{
		name: 'perps_markets',
		description: "List Hyperliquid perpetual futures markets with mark price, funding rate, max leverage and size decimals. Read-only. Use to find valid market names (e.g. ETH-USD) and max leverage before perps_quote.",
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'perps_quote',
		description: "Quote a Hyperliquid perp position without opening it: entry price, required margin, liquidation price, funding rate and fees. Requires authentication. Read-only estimate, no order placed. Get market names and max leverage from perps_markets; side is the direction, size is in the base asset, leverage is a multiplier (max 20).",
		inputSchema: PERPS_QUOTE_INPUT,
	},
	{
		name: 'perps_positions',
		description: "List open Hyperliquid perp positions for a wallet, with size, entry price, unrealized PnL and liquidation price. Read-only. address must be your own managed EVM wallet (0x...). For available markets use perps_markets.",
		inputSchema: PERPS_POSITIONS_INPUT,
	},
	{
		name: 'lend_markets',
		description:
			"List Morpho lending markets on one EVM chain with APY, utilization, USD supply/borrow/liquidity, listing status and warnings. Read-only; does not lend or borrow. chain_id is the numeric EVM chain ID (default 8453 = Base). Use lend_market for one market's detail.",
		inputSchema: LEND_MARKETS_INPUT,
	},
	{
		name: 'lend_market',
		description:
			"Get read-only detail for one Morpho lending market, including USD liquidity, listing status, warnings, oracle and IRM. Use market_id from lend_markets and the same chain_id (default 8453 = Base). Does not lend or borrow.",
		inputSchema: LEND_MARKET_INPUT,
	},
	{
		name: 'get_swap_status',
		description: "Check status (pending, completed, failed), tx hash and amounts of a managed swap created via POST /v1/agent/swap/execute. Read-only. Not for MCP execute_swap, which only builds an unsigned transaction and creates no managed swap record. For many swaps use get_swap_history.",
		inputSchema: GET_SWAP_STATUS_INPUT,
	},
	{
		name: 'get_swap_history',
		description: "List the authenticated agent's managed swaps, newest first, optionally filtered by status, with pagination (limit max 100, offset). Read-only. Swaps prepared by MCP execute_swap are self-custody and not listed. For one swap use get_swap_status.",
		inputSchema: GET_SWAP_HISTORY_INPUT,
	},
	{
		name: 'predict_book',
		description: "Get the live CLOB order book (bids and asks) for every outcome of a Polymarket market. Read-only. market_id is the id from predict_markets. For just the midpoint use predict_price.",
		inputSchema: PREDICT_BOOK_INPUT,
	},
	{
		name: 'predict_price',
		description: "Get live CLOB midpoint prices for every outcome of a Polymarket market. Read-only and lightweight. market_id is the id from predict_markets. For depth use predict_book; for full metadata use predict_market.",
		inputSchema: PREDICT_PRICE_INPUT,
	},
	{
		name: 'predict_trades',
		description: "Get recent trades across all outcomes of a Polymarket market (limit default 20, max 100). Read-only. market_id is the id from predict_markets. For current prices use predict_price.",
		inputSchema: PREDICT_TRADES_INPUT,
	},
	{
		name: 'list_wallet_policies',
		description: "List the policies on the agent's managed wallet. Read-only. spending_limit entries are enforced by the API on managed swap execution only, as a per-transaction cap on NATIVE token value (wei) (not prediction orders); they do not cap ERC-20 amounts, are not time-window limits, and the agent key can delete them. whitelist entries are recorded only (enforced: false). Always reports the authenticated agent's own managed wallet; errors if none exists.",
		inputSchema: LIST_WALLET_POLICIES_INPUT,
	},
	{
		name: 'near_resolve_asset',
		description:
			"Resolve a NEAR Intents asset (symbol, defuse asset id or NEAR contract id) to exactly one asset with its defuse_asset_id and decimals. Read-only, free. Symbols are not unique across chains (USDC exists on ~17): if ambiguous it returns every candidate instead of guessing, so pass chain or the exact id. Use before OutLayer /intents/swap or withdraw.",
		inputSchema: {
			type: 'object',
			properties: {
				token: { type: 'string', description: 'Symbol (e.g. "USDC"), defuse asset id (nep141:…), or NEAR contract id.' },
				chain: { type: 'string', description: 'Disambiguating chain (near, ethereum, base, arbitrum, solana, …). Optional.' },
			},
			required: ['token'],
			additionalProperties: false,
		},
	},
	{
		name: 'near_convert_amount',
		description:
			"Convert between human and atomic (smallest-unit) amounts for a NEAR Intents asset, e.g. wNEAR has 24 decimals, USDC/USDT 6. Read-only, free, pure calculation. Give exactly one of human or atomic. OutLayer endpoints take atomic integer strings. Resolve ambiguous symbols with near_resolve_asset first.",
		inputSchema: {
			type: 'object',
			properties: {
				token: { type: 'string', description: 'Symbol, defuse asset id, or contract id.' },
				chain: { type: 'string', description: 'Disambiguating chain. Optional.' },
				human: { type: 'string', description: 'Decimal amount, e.g. "1.5".' },
				atomic: { type: 'string', description: 'Atomic integer amount, e.g. "1500000000000000000000000".' },
			},
			required: ['token'],
			additionalProperties: false,
		},
	},
	...BANK_TOOLS,
]

// ---------------------------------------------------------------
// Tool annotations (MCP behavioural hints, spec 2025-03-26)
//
// Hints only — clients MUST NOT make security decisions from them.
// readOnlyHint:   tool does not mutate server/chain state
// destructiveHint: tool may perform irreversible updates (only meaningful when not read-only)
// idempotentHint:  repeated identical calls have no additional effect
// openWorldHint:   tool talks to external systems (chains, DEX aggregators, oracles)
// ---------------------------------------------------------------

type ToolAnnotations = {
	title: string
	readOnlyHint: boolean
	destructiveHint?: boolean
	idempotentHint?: boolean
	openWorldHint: boolean
}

const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
	...BANK_ANNOTATIONS,
	get_quote: { title: 'Get Swap Quote', readOnlyHint: true, idempotentHint: false, openWorldHint: true },
	get_portfolio: { title: 'Get Portfolio', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	get_prices: { title: 'Get Token Prices', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	list_chains: { title: 'List Supported Chains', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	list_tokens: { title: 'List Tokens', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	// Builds an UNSIGNED transaction — it never broadcasts, so it is not destructive
	// on its own. The user signs and submits. Not read-only because it consumes a
	// one-time cached quote.
	execute_swap: { title: 'Prepare Swap Transaction', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	// Never signs or broadcasts — strictly reads (quote + on-chain balance/allowance/eth_call).
	simulate_swap: { title: 'Simulate Swap (Dry Run)', readOnlyHint: true, idempotentHint: false, openWorldHint: true },
	get_tempo_tokens: { title: 'Get Tempo (TIP-20) Tokens', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	browse_mpp_directory: { title: 'Browse MPP Service Directory', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	predict_markets: { title: 'Search Prediction Markets', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	predict_market: { title: 'Prediction Market Detail', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	perps_markets: { title: 'List Perp Markets', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	perps_quote: { title: 'Quote Perp Position', readOnlyHint: true, idempotentHint: false, openWorldHint: true },
	perps_positions: { title: 'List Perp Positions', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	lend_markets: { title: 'List Lending Markets', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	lend_market: { title: 'Lending Market Detail', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	get_swap_status: { title: 'Get Swap Status', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	get_swap_history: { title: 'Get Swap History', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	predict_book: { title: 'Prediction Market Order Book', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	predict_price: { title: 'Prediction Market Prices', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	predict_trades: { title: 'Prediction Market Trades', readOnlyHint: true, idempotentHint: true, openWorldHint: true },
	list_wallet_policies: { title: 'List Wallet Policies', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	near_resolve_asset: { title: 'Resolve NEAR Intents Asset', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
	near_convert_amount: { title: 'Convert NEAR Asset Amount', readOnlyHint: true, idempotentHint: true, openWorldHint: false },
}


// ---------------------------------------------------------------
// Output schemas (MCP `outputSchema` + `structuredContent`)
// ---------------------------------------------------------------
//
// A tool that declares an outputSchema MUST return conforming
// structuredContent, so a guessed schema is worse than none — an agent would
// start seeing validation failures on results that were previously fine.
// Every schema below was written against output captured from the live
// endpoint or read directly out of the handler, and stays permissive
// (`.loose()`) so adding a field is not a breaking change.
//
// Tools NOT covered yet are deliberate, not forgotten:
//   list_tokens   returns three different shapes depending on arguments
//                 (Solana -> tokens[], known EVM chain -> a `note` pointing at
//                 REST with no tokens at all, no chain -> available_chains).
//                 It needs the handler fixed before a schema means anything.
//   browse_mpp_directory  its upstream host is currently unreachable.
//   everything else       needs its real shape captured first.

const ChainEntrySchema = z
	.object({
		// Numeric for EVM chains, the string 'solana' for Solana.
		id: z.union([z.number(), z.string()]),
		key: z.string(),
		name: z.string(),
		native_token: z.string(),
		type: z.string(),
	})
	.loose()

export const ListChainsOutputSchema = z.object({ chains: z.array(ChainEntrySchema) }).loose()

export const GetPricesOutputSchema = z
	.object({
		// symbol -> price entry, keyed by the UPPERCASED symbol.
		prices: z.record(
			z.string(),
			z.object({ usd: z.number(), change_24h: z.number().nullable() }).loose(),
		),
	})
	.loose()

export const GetTempoTokensOutputSchema = z
	.object({
		chain: z.string(),
		chain_id: z.number(),
		native_token: z.string(),
		tokens: z.array(
			z.object({ symbol: z.string(), name: z.string(), address: z.string(), decimals: z.number() }).loose(),
		),
	})
	.loose()

/** tool name -> outputSchema, applied to TOOLS below. */
const TOOL_OUTPUT_SCHEMAS: Record<string, unknown> = {
	list_chains: toOutputJsonSchema(ListChainsOutputSchema),
	get_prices: toOutputJsonSchema(GetPricesOutputSchema),
	get_tempo_tokens: toOutputJsonSchema(GetTempoTokensOutputSchema),
}

/** Tools that declare an outputSchema, so the caller knows to attach structuredContent. */
export const TOOLS_WITH_OUTPUT_SCHEMA = new Set(Object.keys(TOOL_OUTPUT_SCHEMAS))

const TOOLS_WITH_ANNOTATIONS = TOOLS.map((t) => ({
	...t,
	...(TOOL_ANNOTATIONS[t.name] ? { annotations: TOOL_ANNOTATIONS[t.name] } : {}),
	...(TOOL_OUTPUT_SCHEMAS[t.name] ? { outputSchema: TOOL_OUTPUT_SCHEMAS[t.name] } : {}),
}))

export { TOOLS, TOOL_ANNOTATIONS, TOOLS_WITH_ANNOTATIONS }

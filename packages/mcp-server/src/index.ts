#!/usr/bin/env node
/**
 * Suwappu MCP Server
 *
 * A Model Context Protocol server that exposes Suwappu's cross-chain DEX
 * capabilities to AI agents (Claude Desktop, Cursor, Windsurf, etc.)
 *
 * Runs as a stdio transport server using @modelcontextprotocol/sdk.
 *
 * Configuration:
 *   SUWAPPU_API_KEY  - Your Suwappu agent API key (required)
 *   SUWAPPU_API_URL  - API base URL (default: https://api.suwappu.bot)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getAuthConfig } from './auth.js'
import { SuwappuClient } from './client.js'

// ---------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------

const auth = getAuthConfig()
const client = new SuwappuClient({ apiUrl: auth.apiUrl, apiKey: auth.apiKey })

const server = new McpServer({
	name: 'suwappu',
	version: '0.5.0',
})

// ---------------------------------------------------------------
// Helper: format tool result
// ---------------------------------------------------------------

function ok(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
	const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
	return { content: [{ type: 'text', text }] }
}

function err(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
	return { content: [{ type: 'text', text: message }], isError: true }
}

async function callTool(fn: () => Promise<unknown>): Promise<{
	content: Array<{ type: 'text'; text: string }>
	isError?: boolean
}> {
	try {
		const result = await fn()
		return ok(result)
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e)
		return err(message)
	}
}

// ---------------------------------------------------------------
// Register tools
// ---------------------------------------------------------------

// 1. get_token_price
server.tool(
	'get_token_price',
	'Get the current price of a token in USD with 24h price change. Supports major tokens: ETH, SOL, BNB, USDC, USDT, BTC, DAI, WBTC, ARB, OP, AVAX, MATIC, WETH, BONK, JUP, RAY. You can query multiple tokens by comma-separating them.',
	{
		symbol: z.string().describe('Token symbol or comma-separated symbols (e.g. "ETH" or "ETH,SOL,BTC"). Max 20.'),
	},
	async (args) => callTool(() => client.getTokenPrice({ symbol: args.symbol })),
)

// 2. get_portfolio
server.tool(
	'get_portfolio',
	'Get token balances and total portfolio value for a wallet address across all supported chains. Supports EVM wallets (0x...) and Solana wallets (base58). Returns each token balance with USD value.',
	{
		wallet_address: z.string().describe('Wallet address (0x... for EVM chains, base58 for Solana)'),
		chain: z.string().optional().describe('Filter to a specific chain (e.g. "ethereum", "base", "solana"). If omitted, returns all chains.'),
	},
	async (args) =>
		callTool(() =>
			client.getPortfolio({
				wallet_address: args.wallet_address,
				chain: args.chain,
			}),
		),
)

// 3. swap_tokens
server.tool(
	'swap_tokens',
	'Execute a token swap. Gets a quote and returns an unsigned transaction for the user to sign. Supports EVM chains (Ethereum, Base, Arbitrum, Polygon, BSC, Optimism, Avalanche) via Li.Fi and Solana via Jupiter. Cross-chain swaps supported on EVM. IMPORTANT: Always show the user the quote details and ask for confirmation before executing.',
	{
		from_token: z.string().describe('Source token symbol (e.g. "ETH", "SOL", "USDC")'),
		to_token: z.string().describe('Destination token symbol (e.g. "USDC", "ETH")'),
		amount: z.string().describe('Amount to swap in human-readable units (e.g. "0.5", "100")'),
		chain: z.string().optional().describe('Chain for the swap (e.g. "ethereum", "base", "solana"). Defaults to "ethereum".'),
		from_chain: z.string().optional().describe('Source chain for cross-chain swaps (optional, overrides chain)'),
		to_chain: z.string().optional().describe('Destination chain for cross-chain swaps (optional, overrides chain)'),
		wallet_address: z.string().optional().describe('Wallet address for executable transaction data. Required for actual execution.'),
		slippage: z.number().optional().describe('Slippage tolerance as decimal (0.03 = 3%). Defaults to 0.03 (3%).'),
	},
	async (args) => {
		// Single API call — include wallet_address if provided
		const quoteResult = await callTool(() =>
			client.getSwapQuote({
				from_token: args.from_token,
				to_token: args.to_token,
				amount: args.amount,
				chain: args.chain,
				from_chain: args.from_chain,
				to_chain: args.to_chain,
				wallet_address: args.wallet_address,
				slippage: args.slippage,
			}),
		)

		if (quoteResult.isError) return quoteResult

		let quoteData: Record<string, unknown>
		try {
			quoteData = JSON.parse(quoteResult.content[0].text)
		} catch {
			return err('Failed to parse swap quote response')
		}

		if (!args.wallet_address) {
			return ok({
				...quoteData,
				note: 'Provide wallet_address to get an executable transaction. Always confirm with the user before executing.',
			})
		}

		return ok({
			...quoteData,
			action: 'CONFIRM_REQUIRED',
			message: `Swap ${args.amount} ${args.from_token} -> ${args.to_token}. The user must sign the transaction with their wallet to execute.`,
		})
	},
)

// 4. get_swap_quote
server.tool(
	'get_swap_quote',
	'Get a swap quote without executing. Returns estimated output amount, exchange rate, gas costs, and route. Use this to show the user what they would get before committing to a swap. Supports same-chain and cross-chain swaps across EVM chains and Solana.',
	{
		from_token: z.string().describe('Source token symbol (e.g. "ETH", "SOL", "USDC")'),
		to_token: z.string().describe('Destination token symbol'),
		amount: z.string().describe('Amount to swap in human-readable units (e.g. "0.5")'),
		chain: z.string().optional().describe('Chain name (ethereum, base, arbitrum, polygon, bsc, optimism, avalanche, solana). Defaults to "ethereum".'),
		from_chain: z.string().optional().describe('Source chain for cross-chain quotes (optional)'),
		to_chain: z.string().optional().describe('Destination chain for cross-chain quotes (optional)'),
		slippage: z.number().optional().describe('Slippage tolerance as decimal (0.03 = 3%). Defaults to 0.03.'),
	},
	async (args) =>
		callTool(() =>
			client.getSwapQuote({
				from_token: args.from_token,
				to_token: args.to_token,
				amount: args.amount,
				chain: args.chain,
				from_chain: args.from_chain,
				to_chain: args.to_chain,
				slippage: args.slippage,
			}),
		),
)

// 5. set_price_alert (stub — no create endpoint exists in the API)
server.tool(
	'set_price_alert',
	'Price alert creation is not yet available via the MCP server. Alerts must be configured through the Suwappu Telegram bot (/a command) or webapp. Use get_alerts to list existing webhook events.',
	{
		token: z.string().describe('Token symbol (e.g. "ETH", "SOL", "BTC")'),
		target_price: z.number().describe('Target price in USD'),
		direction: z.enum(['above', 'below']).describe('"above" or "below"'),
	},
	async () =>
		ok({
			supported: false,
			message:
				'Price alert creation is not available via the agent API. Use the Suwappu Telegram bot (/a command) or webapp to set price alerts. You can use get_alerts to list existing webhook events.',
		}),
)

// 6. get_alerts
server.tool(
	'get_alerts',
	'List all active price alerts for the current agent. Shows token, target price, direction, and status.',
	{},
	async () => callTool(() => client.getAlerts()),
)

// 7. get_trade_history
server.tool(
	'get_trade_history',
	'Get recent swap/trade history for the current agent. Shows executed swaps with tokens, amounts, chains, and timestamps.',
	{
		limit: z.number().optional().describe('Maximum number of trades to return (default: 20, max: 100)'),
		offset: z.number().optional().describe('Offset for pagination (default: 0)'),
	},
	async (args) =>
		callTool(() =>
			client.getTradeHistory({
				limit: args.limit,
				offset: args.offset,
			}),
		),
)

// 8. search_tokens
server.tool(
	'search_tokens',
	'Search for tokens by name or symbol across supported chains. Returns matching tokens with their addresses, decimals, and which chain they are on. Useful for finding token addresses or checking if a token is supported.',
	{
		query: z.string().describe('Search query — token name or symbol (e.g. "USDC", "uniswap", "bonk")'),
		chain: z.string().optional().describe('Filter to a specific chain (e.g. "base", "solana"). If omitted, searches all chains.'),
	},
	async (args) =>
		callTool(() =>
			client.searchTokens({
				query: args.query,
				chain: args.chain,
			}),
		),
)

// 9. get_token_safety
server.tool(
	'get_token_safety',
	'Look up token information by contract address, including name, symbol, and chain. Searches the Suwappu token list for a matching token.',
	{
		token_address: z.string().describe('Token contract address to analyze'),
		chain: z.string().optional().describe('Chain the token is on (e.g. "ethereum", "base", "solana"). Defaults to "ethereum".'),
	},
	async (args) =>
		callTool(() =>
			client.getTokenSafety({
				token_address: args.token_address,
				chain: args.chain,
			}),
		),
)

// 10. get_trending_tokens
server.tool(
	'get_trending_tokens',
	'Get current prices and 24h price changes for top tokens (ETH, SOL, BNB, BTC, ARB, OP, AVAX, MATIC, BONK, JUP, RAY, WETH, USDC, USDT). Returns a fixed list of major tokens — filtering by chain or limiting results is not supported.',
	{},
	async () => callTool(() => client.getTrendingTokens()),
)

// 11. list_chains
server.tool(
	'list_chains',
	'List all supported blockchain networks with their names, chain IDs, and native tokens. Use this to discover which chains are available for swaps and portfolio queries.',
	{},
	async () => callTool(() => client.listChains()),
)

// ---------------------------------------------------------------
// Start server
// ---------------------------------------------------------------

async function main() {
	const transport = new StdioServerTransport()
	await server.connect(transport)
	console.error('Suwappu MCP server started (stdio)')
}

main().catch((error) => {
	console.error('Fatal error:', error)
	process.exit(1)
})

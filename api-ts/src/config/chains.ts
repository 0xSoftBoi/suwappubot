// Shared chain configuration for RPC endpoints, broadcasting, and explorers

const alchemyKey = process.env.ALCHEMY_API_KEY || ''

export const RPC_ENDPOINTS: Record<string, string> = {
	ethereum: process.env.ETH_RPC_URL || (alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://eth.llamarpc.com'),
	arbitrum: process.env.ARBITRUM_RPC_URL || (alchemyKey ? `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://arbitrum.llamarpc.com'),
	optimism: process.env.OPTIMISM_RPC_URL || (alchemyKey ? `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://optimism.llamarpc.com'),
	polygon: process.env.POLYGON_RPC_URL || (alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://polygon.llamarpc.com'),
	base: process.env.BASE_RPC_URL || (alchemyKey ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : 'https://base.llamarpc.com'),
	bsc: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com',
	solana: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
	tempo: process.env.TEMPO_RPC_URL || 'https://tempo-mainnet.drpc.org',
	plasma: process.env.PLASMA_RPC_URL || 'https://rpc.plasma.to/',
	// Robinhood Chain — Arbitrum Orbit L2 (chain 4663), native gas ETH.
	robinhood: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
	// Read-only: Starknet signing/broadcast is owned by the Python bot backend
	starknet: process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build',
	// GOAT Network — plain EVM chain (chain id 2345), native token is BTC
	goat: process.env.GOAT_RPC_URL || 'https://rpc.goat.network',
}

export const NATIVE_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
	ethereum: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	polygon: { symbol: 'MATIC', name: 'Polygon', decimals: 18 },
	arbitrum: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	optimism: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	base: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	bsc: { symbol: 'BNB', name: 'BNB Chain', decimals: 18 },
	solana: { symbol: 'SOL', name: 'Solana', decimals: 9 },
	tempo: { symbol: 'USD', name: 'USD Stablecoin', decimals: 6 },
	plasma: { symbol: 'XPL', name: 'Plasma', decimals: 18 },
	robinhood: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	starknet: { symbol: 'STRK', name: 'Starknet', decimals: 18 },
	// GOAT native BTC is ETH-style: 18 decimals at the EVM level (not 8 like UTXO BTC)
	goat: { symbol: 'BTC', name: 'Bitcoin', decimals: 18 },
}

// Starknet fee/native token contract address (STRK ERC-20 on Starknet mainnet)
export const STARKNET_NATIVE_TOKEN_ADDRESS =
	'0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

// Starknet explorer (Starknet uses string chain IDs like SN_MAIN, which don't fit
// the numeric CHAIN_ID_TO_KEY / EXPLORER_URLS maps — kept separate on purpose)
export const STARKNET_EXPLORER_URL = 'https://voyager.online'

// Starknet is read-only in the TS stack: never sign or broadcast Starknet
// transactions here — the Python bot backend owns Starknet signing.
export function isStarknet(chain: string): boolean {
	// Defensive: callers may pass untyped JSON (null/undefined/number) at runtime
	if (typeof chain !== 'string') return false
	const n = chain.toLowerCase().trim()
	return n === 'starknet' || n === 'strk' || n === 'sn_main'
}

export const CHAIN_ID_TO_KEY: Record<number, string> = {
	1: 'ethereum',
	10: 'optimism',
	56: 'bsc',
	137: 'polygon',
	8453: 'base',
	42161: 'arbitrum',
	43114: 'avalanche',
	4217: 'tempo',
	9745: 'plasma',
	2345: 'goat',
	4663: 'robinhood',
}

const EXPLORER_URLS: Record<number, string> = {
	1: 'https://etherscan.io',
	10: 'https://optimistic.etherscan.io',
	56: 'https://bscscan.com',
	137: 'https://polygonscan.com',
	8453: 'https://basescan.org',
	42161: 'https://arbiscan.io',
	43114: 'https://snowscan.xyz',
	4217: 'https://explore.tempo.xyz',
	9745: 'https://plasmascan.to',
	2345: 'https://explorer.goat.network',
	4663: 'https://robinhoodchain.blockscout.com',
}

export function getRpcUrl(chainId: number): string | null {
	const chainKey = CHAIN_ID_TO_KEY[chainId]
	return chainKey ? RPC_ENDPOINTS[chainKey] || null : null
}

export function getExplorerUrl(chainId: number, txHash: string): string {
	const base = EXPLORER_URLS[chainId] || 'https://etherscan.io'
	return `${base}/tx/${txHash}`
}

export async function broadcastEvmTransaction(chainId: number, signedTx: string): Promise<string> {
	const rpcUrl = getRpcUrl(chainId)
	if (!rpcUrl) throw new Error(`No RPC endpoint configured for chain ${chainId}`)

	const response = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			jsonrpc: '2.0',
			method: 'eth_sendRawTransaction',
			params: [signedTx],
			id: 1,
		}),
		signal: AbortSignal.timeout(15000),
	})

	const data = (await response.json()) as { result?: string; error?: { message: string; code: number } }
	if (data.error) throw new Error(`RPC broadcast error: ${data.error.message} (code ${data.error.code})`)
	if (!data.result) throw new Error('No transaction hash returned from RPC')
	return data.result
}

export async function getTransactionReceipt(chainId: number, txHash: string): Promise<{ status: string } | null> {
	const rpcUrl = getRpcUrl(chainId)
	if (!rpcUrl) return null

	try {
		const response = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				method: 'eth_getTransactionReceipt',
				params: [txHash],
				id: 1,
			}),
			signal: AbortSignal.timeout(10000),
		})

		const data = (await response.json()) as { result?: { status: string } | null }
		if (!data.result) return null
		return { status: data.result.status === '0x1' ? 'completed' : 'failed' }
	} catch {
		return null
	}
}

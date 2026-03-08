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
}

export const NATIVE_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
	ethereum: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	polygon: { symbol: 'MATIC', name: 'Polygon', decimals: 18 },
	arbitrum: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	optimism: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	base: { symbol: 'ETH', name: 'Ethereum', decimals: 18 },
	bsc: { symbol: 'BNB', name: 'BNB Chain', decimals: 18 },
	solana: { symbol: 'SOL', name: 'Solana', decimals: 9 },
}

export const CHAIN_ID_TO_KEY: Record<number, string> = {
	1: 'ethereum',
	10: 'optimism',
	56: 'bsc',
	137: 'polygon',
	8453: 'base',
	42161: 'arbitrum',
	43114: 'avalanche',
}

const EXPLORER_URLS: Record<number, string> = {
	1: 'https://etherscan.io',
	10: 'https://optimistic.etherscan.io',
	56: 'https://bscscan.com',
	137: 'https://polygonscan.com',
	8453: 'https://basescan.org',
	42161: 'https://arbiscan.io',
	43114: 'https://snowscan.xyz',
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

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
	// Read-only: Starknet signing/broadcast is owned by the Python bot backend
	starknet: process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build',
	// GOAT Network — plain EVM chain (chain id 2345), native token is BTC
	goat: process.env.GOAT_RPC_URL || 'https://rpc.goat.network',

	// Remaining EVM chains — first endpoint of each mirrors the corresponding
	// `*_rpc_url` default in bot/config/settings.py so the two stacks agree.
	'base-sepolia': process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
	avalanche: process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
	fantom: process.env.FANTOM_RPC_URL || 'https://rpcapi.fantom.network',
	linea: process.env.LINEA_RPC_URL || 'https://rpc.linea.build',
	mantle: process.env.MANTLE_RPC_URL || 'https://rpc.mantle.xyz',
	gnosis: process.env.GNOSIS_RPC_URL || 'https://rpc.gnosischain.com',
	scroll: process.env.SCROLL_RPC_URL || 'https://rpc.scroll.io',
	rootstock: process.env.ROOTSTOCK_RPC_URL || 'https://public-node.rsk.co',
	citrea: process.env.CITREA_RPC_URL || 'https://rpc.mainnet.citrea.xyz',
	sonic: process.env.SONIC_RPC_URL || 'https://rpc.soniclabs.com',
	opbnb: process.env.OPBNB_RPC_URL || 'https://opbnb-mainnet-rpc.bnbchain.org',
	fraxtal: process.env.FRAXTAL_RPC_URL || 'https://rpc.frax.com',
	zksync: process.env.ZKSYNC_RPC_URL || 'https://mainnet.era.zksync.io',
	worldchain: process.env.WORLDCHAIN_RPC_URL || 'https://worldchain-mainnet.g.alchemy.com/public',
	flow: process.env.FLOW_RPC_URL || 'https://mainnet.evm.nodes.onflow.org',
	hyperevm: process.env.HYPEREVM_RPC_URL || 'https://rpc.hyperliquid.xyz/evm',
	lisk: process.env.LISK_RPC_URL || 'https://rpc.api.lisk.com',
	sei: process.env.SEI_RPC_URL || 'https://evm-rpc.sei-apis.com',
	soneium: process.env.SONEIUM_RPC_URL || 'https://rpc.soneium.org',
	swellchain: process.env.SWELLCHAIN_RPC_URL || 'https://swell-mainnet.alt.technology',
	abstract: process.env.ABSTRACT_RPC_URL || 'https://api.mainnet.abs.xyz',
	kaia: process.env.KAIA_RPC_URL || 'https://public-en.node.kaia.io',
	apechain: process.env.APECHAIN_RPC_URL || 'https://rpc.apechain.com/http',
	mode: process.env.MODE_RPC_URL || 'https://mainnet.mode.network',
	hemi: process.env.HEMI_RPC_URL || 'https://rpc.hemi.network/rpc',
	bob: process.env.BOB_RPC_URL || 'https://rpc.gobob.xyz',
	berachain: process.env.BERACHAIN_RPC_URL || 'https://rpc.berachain.com',
	taiko: process.env.TAIKO_RPC_URL || 'https://rpc.mainnet.taiko.xyz',
	unichain: process.env.UNICHAIN_RPC_URL || 'https://mainnet.unichain.org',
	flare: process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
	// Added alongside aurora/blast/ink in bot/config/chains.py (parallel change)
	aurora: process.env.AURORA_RPC_URL || 'https://mainnet.aurora.dev',
	blast: process.env.BLAST_RPC_URL || 'https://rpc.blast.io',
	ink: process.env.INK_RPC_URL || 'https://rpc-gel.inkonchain.com',
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
	starknet: { symbol: 'STRK', name: 'Starknet', decimals: 18 },
	// GOAT native BTC is ETH-style: 18 decimals at the EVM level (not 8 like UTXO BTC)
	goat: { symbol: 'BTC', name: 'Bitcoin', decimals: 18 },

	// Remaining chain keys — symbol/decimals mirror bot/config/chains.py CHAINS
	tron: { symbol: 'TRX', name: 'TRON', decimals: 6 },
	'base-sepolia': { symbol: 'ETH', name: 'Ethereum (Base Sepolia testnet)', decimals: 18 },
	avalanche: { symbol: 'AVAX', name: 'Avalanche', decimals: 18 },
	fantom: { symbol: 'FTM', name: 'Fantom', decimals: 18 },
	linea: { symbol: 'ETH', name: 'Ethereum (Linea)', decimals: 18 },
	mantle: { symbol: 'MNT', name: 'Mantle', decimals: 18 },
	gnosis: { symbol: 'xDAI', name: 'Gnosis', decimals: 18 },
	scroll: { symbol: 'ETH', name: 'Ethereum (Scroll)', decimals: 18 },
	rootstock: { symbol: 'RBTC', name: 'Rootstock', decimals: 18 },
	citrea: { symbol: 'cBTC', name: 'Citrea', decimals: 18 },
	sonic: { symbol: 'S', name: 'Sonic', decimals: 18 },
	opbnb: { symbol: 'BNB', name: 'opBNB', decimals: 18 },
	fraxtal: { symbol: 'FRAX', name: 'Fraxtal', decimals: 18 },
	zksync: { symbol: 'ETH', name: 'Ethereum (zkSync Era)', decimals: 18 },
	worldchain: { symbol: 'ETH', name: 'Ethereum (World Chain)', decimals: 18 },
	flow: { symbol: 'FLOW', name: 'Flow', decimals: 18 },
	hyperevm: { symbol: 'HYPE', name: 'Hyperliquid', decimals: 18 },
	lisk: { symbol: 'ETH', name: 'Ethereum (Lisk)', decimals: 18 },
	sei: { symbol: 'SEI', name: 'Sei', decimals: 18 },
	soneium: { symbol: 'ETH', name: 'Ethereum (Soneium)', decimals: 18 },
	swellchain: { symbol: 'ETH', name: 'Ethereum (Swellchain)', decimals: 18 },
	abstract: { symbol: 'ETH', name: 'Ethereum (Abstract)', decimals: 18 },
	kaia: { symbol: 'KAIA', name: 'Kaia', decimals: 18 },
	apechain: { symbol: 'APE', name: 'ApeCoin', decimals: 18 },
	mode: { symbol: 'ETH', name: 'Ethereum (Mode)', decimals: 18 },
	hemi: { symbol: 'ETH', name: 'Ethereum (Hemi)', decimals: 18 },
	bob: { symbol: 'ETH', name: 'Ethereum (BOB)', decimals: 18 },
	berachain: { symbol: 'BERA', name: 'Berachain', decimals: 18 },
	taiko: { symbol: 'ETH', name: 'Ethereum (Taiko)', decimals: 18 },
	unichain: { symbol: 'ETH', name: 'Ethereum (Unichain)', decimals: 18 },
	flare: { symbol: 'FLR', name: 'Flare', decimals: 18 },
	// Added alongside aurora/blast/ink in bot/config/chains.py (parallel change)
	aurora: { symbol: 'ETH', name: 'Ethereum (Aurora)', decimals: 18 },
	blast: { symbol: 'ETH', name: 'Ethereum (Blast)', decimals: 18 },
	ink: { symbol: 'ETH', name: 'Ethereum (Ink)', decimals: 18 },
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

// Numeric EVM chain ids only — solana/tron use string ids and starknet uses
// 'SN_MAIN', none of which fit this map (see isStarknet() above).
export const CHAIN_ID_TO_KEY: Record<number, string> = {
	1: 'ethereum',
	10: 'optimism',
	14: 'flare',
	30: 'rootstock',
	56: 'bsc',
	100: 'gnosis',
	130: 'unichain',
	137: 'polygon',
	146: 'sonic',
	204: 'opbnb',
	250: 'fantom',
	252: 'fraxtal',
	324: 'zksync',
	480: 'worldchain',
	747: 'flow',
	999: 'hyperevm',
	1135: 'lisk',
	1329: 'sei',
	1868: 'soneium',
	1923: 'swellchain',
	2345: 'goat',
	2741: 'abstract',
	4114: 'citrea',
	4217: 'tempo',
	5000: 'mantle',
	8217: 'kaia',
	8453: 'base',
	9745: 'plasma',
	33139: 'apechain',
	34443: 'mode',
	42161: 'arbitrum',
	43111: 'hemi',
	43114: 'avalanche',
	57073: 'ink',
	59144: 'linea',
	60808: 'bob',
	80094: 'berachain',
	81457: 'blast',
	84532: 'base-sepolia',
	167000: 'taiko',
	534352: 'scroll',
	1313161554: 'aurora',
}

const EXPLORER_URLS: Record<number, string> = {
	1: 'https://etherscan.io',
	10: 'https://optimistic.etherscan.io',
	14: 'https://flarescan.com',
	30: 'https://rootstock.blockscout.com',
	56: 'https://bscscan.com',
	100: 'https://gnosisscan.io',
	130: 'https://uniscan.xyz',
	137: 'https://polygonscan.com',
	146: 'https://sonicscan.org',
	204: 'https://opbnb.bscscan.com',
	250: 'https://ftmscan.com',
	252: 'https://fraxscan.com',
	324: 'https://explorer.zksync.io',
	480: 'https://worldscan.org',
	747: 'https://evm.flowscan.io',
	999: 'https://explorer.hyperliquid.xyz',
	1135: 'https://blockscout.lisk.com',
	1329: 'https://seitrace.com',
	1868: 'https://soneium.blockscout.com',
	1923: 'https://explorer.swellnetwork.io',
	2345: 'https://explorer.goat.network',
	2741: 'https://abscan.org',
	4114: 'https://explorer.mainnet.citrea.xyz',
	4217: 'https://explore.tempo.xyz',
	5000: 'https://mantlescan.xyz',
	8217: 'https://kaiascan.io',
	8453: 'https://basescan.org',
	9745: 'https://plasmascan.to',
	33139: 'https://apescan.io',
	34443: 'https://modescan.io',
	42161: 'https://arbiscan.io',
	43111: 'https://explorer.hemi.xyz',
	43114: 'https://snowtrace.io',
	57073: 'https://explorer.inkonchain.com',
	59144: 'https://lineascan.build',
	60808: 'https://explorer.gobob.xyz',
	80094: 'https://berascan.com',
	81457: 'https://blastscan.io',
	84532: 'https://sepolia.basescan.org',
	167000: 'https://taikoscan.io',
	534352: 'https://scrollscan.com',
	// Added alongside aurora/blast/ink in bot/config/chains.py (parallel change)
	1313161554: 'https://explorer.aurora.dev',
}

export function getRpcUrl(chainId: number): string | null {
	const chainKey = CHAIN_ID_TO_KEY[chainId]
	return chainKey ? RPC_ENDPOINTS[chainKey] || null : null
}

// Returns null for an unrecognized chain id rather than silently pointing at
// Ethereum's explorer — a wrong-chain tx link is worse than no link. Callers
// must handle the null case and omit the link rather than guess.
export function getExplorerUrl(chainId: number, txHash: string): string | null {
	const base = EXPLORER_URLS[chainId]
	if (!base) return null
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

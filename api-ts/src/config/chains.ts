// Shared chain configuration for RPC endpoints, broadcasting, and explorers
//
// RPC_ENDPOINT_LISTS is the single source of truth for RPC URLs. Every chain has
// an ordered list: an env override (comma-separated, e.g. LISK_RPC_URL="a,b")
// wins outright; otherwise Alchemy (if ALCHEMY_API_KEY is set and the chain is
// supported) goes first, followed by public defaults. Defaults were probed live
// (eth_chainId + eth_blockNumber + eth_call) — do not re-add dead hosts:
// llamarpc (525), blockpi, meowrpc, 1rpc.io, fantom-rpc.publicnode.com,
// *.gateway.tenderly.co for worldchain, developer-access-mainnet.base.org,
// rpc.api.lisk.com, swell-mainnet.alt.technology, rpc.starknet.lava.build.
//
// Consumers: use rpcFetch()/getRpcUrls() (raw JSON-RPC) or getEvmTransport()
// (viem) so a dead/rate-limited endpoint fails over automatically.

import { fallback, http, keccak256, type Hex, type Transport } from 'viem'
import { logger } from '../lib/logger'

const alchemyKey = process.env.ALCHEMY_API_KEY || ''

/** Per-request timeout for each endpoint attempt (ms). */
export const RPC_TIMEOUT_MS = 8000

function parseList(raw: string | undefined): string[] {
	return (raw ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
}

function endpoints(envVar: string, defaults: string[], alchemyHost?: string): string[] {
	const fromEnv = parseList(process.env[envVar])
	if (fromEnv.length > 0) return fromEnv
	const list = alchemyKey && alchemyHost ? [`https://${alchemyHost}.g.alchemy.com/v2/${alchemyKey}`, ...defaults] : [...defaults]
	return Array.from(new Set(list))
}

export const RPC_ENDPOINT_LISTS: Record<string, string[]> = {
	ethereum: endpoints('ETH_RPC_URL', ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org', 'https://rpc.mevblocker.io'], 'eth-mainnet'),
	arbitrum: endpoints('ARBITRUM_RPC_URL', ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc', 'https://arbitrum.drpc.org'], 'arb-mainnet'),
	optimism: endpoints('OPTIMISM_RPC_URL', ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io', 'https://optimism.drpc.org'], 'opt-mainnet'),
	polygon: endpoints('POLYGON_RPC_URL', ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://polygon.gateway.tenderly.co'], 'polygon-mainnet'),
	base: endpoints('BASE_RPC_URL', ['https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base.gateway.tenderly.co'], 'base-mainnet'),
	bsc: endpoints('BSC_RPC_URL', ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc.drpc.org']),
	solana: endpoints('SOLANA_RPC_URL', ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']),
	tempo: endpoints('TEMPO_RPC_URL', ['https://tempo-mainnet.drpc.org', 'https://rpc.tempo.xyz']),
	plasma: endpoints('PLASMA_RPC_URL', ['https://rpc.plasma.to', 'https://plasma.gateway.tenderly.co']),
	// Robinhood Chain — Arbitrum Orbit L2 (chain 4663), native gas ETH. Alchemy
	// support confirmed live (alchemy.com/rpc/robinhood, 2026-08-04) — preferred
	// over the public RPC given the chain's 2-validator set (Offchain Labs +
	// Alchemy). Only one public endpoint is known-good.
	robinhood: endpoints('ROBINHOOD_RPC_URL', ['https://rpc.mainnet.chain.robinhood.com'], 'robinhood-mainnet'),
	// Read-only: Starknet signing/broadcast is owned by the Python bot backend
	starknet: endpoints('STARKNET_RPC_URL', ['https://starknet-rpc.publicnode.com', 'https://starknet.drpc.org']),
	// GOAT Network — plain EVM chain (chain id 2345), native token is BTC
	goat: endpoints('GOAT_RPC_URL', ['https://rpc.goat.network']),

	// Remaining EVM chains
	'base-sepolia': endpoints('BASE_SEPOLIA_RPC_URL', ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com', 'https://base-sepolia.drpc.org']),
	avalanche: endpoints('AVALANCHE_RPC_URL', ['https://api.avax.network/ext/bc/C/rpc', 'https://avalanche-c-chain-rpc.publicnode.com', 'https://avalanche.drpc.org']),
	fantom: endpoints('FANTOM_RPC_URL', ['https://rpcapi.fantom.network', 'https://fantom.drpc.org', 'https://rpc.fantom.network']),
	linea: endpoints('LINEA_RPC_URL', ['https://rpc.linea.build', 'https://linea-rpc.publicnode.com', 'https://linea.drpc.org']),
	mantle: endpoints('MANTLE_RPC_URL', ['https://rpc.mantle.xyz', 'https://mantle-rpc.publicnode.com', 'https://mantle.drpc.org']),
	gnosis: endpoints('GNOSIS_RPC_URL', ['https://rpc.gnosischain.com', 'https://gnosis-rpc.publicnode.com', 'https://gnosis.drpc.org']),
	scroll: endpoints('SCROLL_RPC_URL', ['https://rpc.scroll.io', 'https://scroll-rpc.publicnode.com', 'https://scroll.drpc.org']),
	rootstock: endpoints('ROOTSTOCK_RPC_URL', ['https://public-node.rsk.co', 'https://rootstock.drpc.org']),
	citrea: endpoints('CITREA_RPC_URL', ['https://rpc.mainnet.citrea.xyz']),
	sonic: endpoints('SONIC_RPC_URL', ['https://rpc.soniclabs.com', 'https://sonic-rpc.publicnode.com', 'https://sonic.drpc.org']),
	opbnb: endpoints('OPBNB_RPC_URL', ['https://opbnb-mainnet-rpc.bnbchain.org', 'https://opbnb-rpc.publicnode.com', 'https://opbnb.drpc.org']),
	fraxtal: endpoints('FRAXTAL_RPC_URL', ['https://rpc.frax.com', 'https://fraxtal-rpc.publicnode.com', 'https://fraxtal.drpc.org']),
	zksync: endpoints('ZKSYNC_RPC_URL', ['https://mainnet.era.zksync.io', 'https://zksync.drpc.org']),
	worldchain: endpoints('WORLDCHAIN_RPC_URL', ['https://worldchain-mainnet.g.alchemy.com/public', 'https://worldchain.drpc.org', 'https://480.rpc.thirdweb.com']),
	flow: endpoints('FLOW_RPC_URL', ['https://mainnet.evm.nodes.onflow.org']),
	hyperevm: endpoints('HYPEREVM_RPC_URL', ['https://rpc.hyperliquid.xyz/evm', 'https://hyperliquid.drpc.org', 'https://hyperliquid-json-rpc.stakely.io']),
	lisk: endpoints('LISK_RPC_URL', ['https://lisk.gateway.tenderly.co']),
	sei: endpoints('SEI_RPC_URL', ['https://evm-rpc.sei-apis.com', 'https://sei-evm-rpc.publicnode.com', 'https://sei.drpc.org']),
	soneium: endpoints('SONEIUM_RPC_URL', ['https://rpc.soneium.org', 'https://soneium.drpc.org']),
	swellchain: endpoints('SWELLCHAIN_RPC_URL', ['https://swell.drpc.org']),
	abstract: endpoints('ABSTRACT_RPC_URL', ['https://api.mainnet.abs.xyz', 'https://abstract.drpc.org']),
	kaia: endpoints('KAIA_RPC_URL', ['https://public-en.node.kaia.io', 'https://kaia.drpc.org']),
	apechain: endpoints('APECHAIN_RPC_URL', ['https://rpc.apechain.com/http', 'https://apechain.drpc.org']),
	mode: endpoints('MODE_RPC_URL', ['https://mainnet.mode.network', 'https://mode.drpc.org']),
	hemi: endpoints('HEMI_RPC_URL', ['https://rpc.hemi.network/rpc', 'https://hemi.drpc.org']),
	bob: endpoints('BOB_RPC_URL', ['https://rpc.gobob.xyz', 'https://bob.drpc.org']),
	berachain: endpoints('BERACHAIN_RPC_URL', ['https://rpc.berachain.com', 'https://berachain-rpc.publicnode.com', 'https://berachain.drpc.org']),
	taiko: endpoints('TAIKO_RPC_URL', ['https://rpc.mainnet.taiko.xyz', 'https://taiko-rpc.publicnode.com', 'https://taiko.drpc.org']),
	unichain: endpoints('UNICHAIN_RPC_URL', ['https://mainnet.unichain.org', 'https://unichain-rpc.publicnode.com', 'https://unichain.drpc.org']),
	flare: endpoints('FLARE_RPC_URL', ['https://flare-api.flare.network/ext/C/rpc', 'https://flare.drpc.org']),
	// Added alongside aurora/blast/ink in bot/config/chains.py (parallel change)
	aurora: endpoints('AURORA_RPC_URL', ['https://mainnet.aurora.dev', 'https://aurora.drpc.org']),
	// rpc.blast.io could not be reached from the probe container and no public
	// alternative answered — set BLAST_RPC_URL (comma-separated) to add more.
	blast: endpoints('BLAST_RPC_URL', ['https://rpc.blast.io']),
	ink: endpoints('INK_RPC_URL', ['https://rpc-gel.inkonchain.com', 'https://ink.drpc.org', 'https://rpc-qnd.inkonchain.com']),
}

/** Primary (first) endpoint per chain. Kept for callers that need a single URL;
 *  prefer RPC_ENDPOINT_LISTS / rpcFetch / getEvmTransport for failover. */
export const RPC_ENDPOINTS: Record<string, string> = Object.fromEntries(
	Object.entries(RPC_ENDPOINT_LISTS).map(([k, v]) => [k, v[0] as string]),
)

// JSON-RPC error codes that mean "this endpoint can't serve it" (rate limit,
// method unsupported, internal) rather than "your request is invalid".
const FAILOVER_RPC_CODES = new Set([-32005, -32601, -32603, -32046, -32097, 429])

function terse(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e)
	return m.split('\n')[0]!.slice(0, 120)
}

/**
 * Drop-in `fetch` for JSON-RPC POSTs against an ordered endpoint list. Tries each
 * URL with a per-attempt timeout; fails over on network errors, timeouts, non-2xx
 * HTTP, non-JSON bodies and endpoint-capacity JSON-RPC errors. Request-level
 * JSON-RPC errors (reverts, nonce too low, ...) are returned as-is, not retried.
 * Logs one short line per failover (no stack).
 */
export async function rpcFetch(
	urls: string[],
	init: RequestInit,
	timeoutMs: number = RPC_TIMEOUT_MS,
): Promise<Response> {
	if (urls.length === 0) throw new Error('No RPC endpoints configured')
	let lastErr: unknown
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i]!
		const last = i === urls.length - 1
		try {
			const res = await fetch(url, { ...init, method: init.method ?? 'POST', headers: init.headers ?? { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			let code: number | undefined
			try {
				const body = (await res.clone().json()) as { error?: { code?: number } }
				code = body?.error?.code
			} catch {
				throw new Error('non-JSON response')
			}
			if (code !== undefined && FAILOVER_RPC_CODES.has(code)) throw new Error(`rpc error ${code}`)
			return res
		} catch (e) {
			lastErr = e
			if (!last) logger.warn(`[rpc] ${new URL(url).host} failed (${terse(e)}), failing over`)
		}
	}
	throw new Error(`All ${urls.length} RPC endpoint(s) failed: ${terse(lastErr)}`)
}

/** Ordered RPC URL list for an EVM chain id (empty if unknown). */
export function getRpcUrls(chainId: number): string[] {
	const key = CHAIN_ID_TO_KEY[chainId]
	return key ? RPC_ENDPOINT_LISTS[key] ?? [] : []
}

/** viem transport with failover across the chain's endpoints (single endpoint -> plain http). */
export function getEvmTransport(chainId: number): Transport {
	const urls = getRpcUrls(chainId)
	if (urls.length === 0) throw new Error(`No RPC endpoint configured for chain ${chainId}`)
	const mk = (u: string) => http(u, { timeout: RPC_TIMEOUT_MS, retryCount: 0 })
	return urls.length === 1 ? http(urls[0]!, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }) : fallback(urls.map(mk), { rank: false, retryCount: 1 })
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
	4663: 'robinhood',
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
	4663: 'https://robinhoodchain.blockscout.com',
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

const ALREADY_KNOWN_RE = /already known|known transaction|alreadyknown|already imported/i
const NONCE_CONFLICT_RE = /nonce too low|replacement transaction underpriced|already (been )?(mined|executed)/i
/** Per-endpoint timeout for eth_sendRawTransaction (reads use RPC_TIMEOUT_MS). */
export const BROADCAST_TIMEOUT_MS = 15000

async function rpcOnce(url: string, method: string, params: unknown[], timeoutMs: number) {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		signal: AbortSignal.timeout(timeoutMs),
	})
	if (!res.ok) throw new Error(`HTTP ${res.status}`)
	try {
		return (await res.json()) as { result?: unknown; error?: { message: string; code: number } }
	} catch {
		throw new Error('non-JSON response')
	}
}

/**
 * Broadcast a signed tx with failover, safe against "first endpoint accepted it
 * but we saw a timeout/error" (which would otherwise surface as a failure and
 * invite a retry -> double execution). Returns the tx hash and the URL that
 * accepted/knows the tx (callers should read the next nonce from that URL).
 *  - "already known" on any attempt => success, hash = keccak256(signedTx)
 *  - "nonce too low"/"underpriced" after a prior failed attempt => look the tx up
 *    by hash across endpoints; found => success, else the original error surfaces
 */
export async function broadcastRawTx(
	urls: string[],
	signedTx: string,
): Promise<{ hash: string; url: string }> {
	if (urls.length === 0) throw new Error('No RPC endpoints configured')
	const localHash = keccak256(signedTx as Hex)
	let lastErr: Error = new Error('broadcast failed')
	let attempts = 0
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i]!
		attempts++
		try {
			const data = await rpcOnce(url, 'eth_sendRawTransaction', [signedTx], BROADCAST_TIMEOUT_MS)
			if (data.error) {
				const { message, code } = data.error
				if (ALREADY_KNOWN_RE.test(message)) return { hash: localHash, url }
				if (NONCE_CONFLICT_RE.test(message) && attempts > 1) {
					const found = await findTxUrl(urls, localHash)
					if (found) return { hash: localHash, url: found }
					throw new Error(`RPC broadcast error: ${message} (code ${code})`)
				}
				if (FAILOVER_RPC_CODES.has(code)) throw new Error(`rpc error ${code}: ${message}`)
				// Request-level rejection (revert, funds, nonce on first attempt): don't retry
				throw Object.assign(new Error(`RPC broadcast error: ${message} (code ${code})`), { final: true })
			}
			if (typeof data.result !== 'string' || !data.result) throw new Error('No transaction hash returned from RPC')
			return { hash: data.result, url }
		} catch (e) {
			lastErr = e instanceof Error ? e : new Error(String(e))
			if ((lastErr as Error & { final?: boolean }).final || i === urls.length - 1) break
			logger.warn(`[rpc] broadcast via ${new URL(url).host} failed (${terse(e)}), failing over`)
		}
	}
	// Last resort: an earlier timed-out attempt may have landed.
	if (attempts > 1) {
		const found = await findTxUrl(urls, localHash)
		if (found) return { hash: localHash, url: found }
	}
	throw lastErr
}

async function findTxUrl(urls: string[], hash: string): Promise<string | null> {
	for (const url of urls) {
		for (const method of ['eth_getTransactionByHash', 'eth_getTransactionReceipt']) {
			try {
				const d = await rpcOnce(url, method, [hash], RPC_TIMEOUT_MS)
				if (d.result) return url
			} catch {
				/* try next */
			}
		}
	}
	return null
}

export async function broadcastEvmTransaction(chainId: number, signedTx: string): Promise<string> {
	const urls = getRpcUrls(chainId)
	if (urls.length === 0) throw new Error(`No RPC endpoint configured for chain ${chainId}`)
	return (await broadcastRawTx(urls, signedTx)).hash
}

export async function getTransactionReceipt(chainId: number, txHash: string): Promise<{ status: string } | null> {
	const urls = getRpcUrls(chainId)
	if (urls.length === 0) return null

	try {
		const response = await rpcFetch(
			urls,
			{
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'eth_getTransactionReceipt',
					params: [txHash],
					id: 1,
				}),
			},
			10000,
		)

		const data = (await response.json()) as { result?: { status: string } | null }
		if (!data.result) return null
		return { status: data.result.status === '0x1' ? 'completed' : 'failed' }
	} catch {
		return null
	}
}

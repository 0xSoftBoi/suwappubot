/**
 * OutLayer agent-custody client (read-only subset).
 *
 * Spec: https://skills.outlayer.ai/agent-custody/SKILL.md
 *
 * Design rules:
 *  - Hosts are a FIXED allowlist keyed by network (no caller-supplied URLs → no SSRF).
 *  - The caller's `wk_` key is passed through for one request and never stored or logged.
 *  - Only read/quote endpoints live here. Anything that moves funds (swap, transfer,
 *    withdraw) is deliberately NOT proxied: the agent calls OutLayer directly with its
 *    own key, so Suwappu is never in the custody or signing path.
 *  - NEAR Intents do not exist on testnet (no solvers) — quotes there are refused up front.
 */

export type NearNetwork = 'mainnet' | 'testnet'

export const OUTLAYER_HOSTS: Record<NearNetwork, string> = {
	mainnet: 'https://api.outlayer.ai',
	testnet: 'https://testnet-api.outlayer.ai',
}

export const OUTLAYER_SKILL_URL = 'https://skills.outlayer.ai/agent-custody/SKILL.md'

const WK_RE = /^wk_[0-9a-f]{64}$/

export class OutLayerError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body?: unknown,
	) {
		super(message)
		this.name = 'OutLayerError'
	}
}

export const isValidWalletKey = (k: string): boolean => WK_RE.test(k)

export function extractWalletKey(authHeader: string | undefined): string | null {
	if (!authHeader) return null
	const m = /^Bearer\s+(\S+)$/i.exec(authHeader)
	const key = m?.[1]
	return key && isValidWalletKey(key) ? key : null
}

async function call<T>(
	network: NearNetwork,
	path: string,
	opts: { key?: string; method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
	const headers: Record<string, string> = { Accept: 'application/json' }
	if (opts.key) headers.Authorization = `Bearer ${opts.key}`
	if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
	let res: Response
	try {
		res = await fetch(`${OUTLAYER_HOSTS[network]}${path}`, {
			method: opts.method ?? 'GET',
			headers,
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
			signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
		})
	} catch (e) {
		throw new OutLayerError(`OutLayer unreachable: ${e instanceof Error ? e.name : 'error'}`, 502)
	}
	const text = await res.text()
	let parsed: unknown = text
	try {
		parsed = text ? JSON.parse(text) : null
	} catch {
		/* non-JSON body: keep raw text */
	}
	if (!res.ok) throw new OutLayerError(`OutLayer ${res.status}`, res.status, parsed)
	return parsed as T
}

export interface OutLayerToken {
	symbol?: string
	defuse_asset_id?: string
	chains?: string[]
	decimals?: number
	[k: string]: unknown
}

export const getTokens = (network: NearNetwork, key: string) =>
	call<unknown>(network, '/wallet/v1/tokens', { key })

export const getAddress = (network: NearNetwork, key: string, chain: string) =>
	call<unknown>(network, `/wallet/v1/address?chain=${encodeURIComponent(chain)}`, { key })

export function getBalance(
	network: NearNetwork,
	key: string,
	q: { chain?: string; token?: string; source?: 'intents' },
) {
	const p = new URLSearchParams()
	if (q.chain) p.set('chain', q.chain)
	if (q.token) p.set('token', q.token)
	if (q.source) p.set('source', q.source)
	return call<unknown>(network, `/wallet/v1/balance?${p.toString()}`, { key })
}

export interface SwapQuoteInput {
	token_in: string
	token_out: string
	amount_in: string
}

export function swapQuote(network: NearNetwork, key: string, body: SwapQuoteInput) {
	if (network === 'testnet') {
		throw new OutLayerError('NEAR Intents have no solvers on testnet; quotes are mainnet-only', 503)
	}
	return call<unknown>(network, '/wallet/v1/intents/swap/quote', { key, method: 'POST', body })
}

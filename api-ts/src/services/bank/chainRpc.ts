/** Minimal JSON-RPC helper + chain endpoint resolution for M10/M12 (own file; chain.ts is not edited). */
import { RPC_ENDPOINTS } from '../../config/chains'
import { bankErr } from './errors'

export const TEMPO_RPC = process.env.TEMPO_RPC_URL_OFFICIAL || 'https://rpc.tempo.xyz'
export const TEMPO_CHAIN_ID = 4217

export const rpcUrlFor = (chain: string): string => {
	if (chain === 'tempo') return TEMPO_RPC
	const u = RPC_ENDPOINTS[chain]
	if (!u) throw bankErr('ASSET_UNSUPPORTED', `No RPC endpoint configured for chain ${chain}`)
	return u
}

export async function jsonRpc<T>(url: string, method: string, params: unknown[], timeoutMs = 15_000): Promise<T> {
	let res: Response
	try {
		res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			signal: AbortSignal.timeout(timeoutMs),
		})
	} catch (e) {
		throw bankErr('UPSTREAM', `RPC ${method} failed: ${String(e)}`)
	}
	if (!res.ok) throw bankErr('UPSTREAM', `RPC ${method} HTTP ${res.status}`)
	const j = (await res.json()) as { result?: T; error?: { message: string } }
	if (j.error) throw bankErr('UPSTREAM', `RPC ${method}: ${j.error.message}`)
	return j.result as T
}

/**
 * SSRF-guarded fetch that returns status + headers + body (routes/ssrfGuard.safeFetch only
 * returns the status). Re-uses the repo guard's vetting (assertUrlSafeForFetch) and pins the
 * socket to the vetted addresses so DNS rebinding cannot swap the target. No redirects are
 * followed: a 3xx is returned to the caller, which treats it as an error.
 */
import http from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import { assertUrlSafeForFetch, isPrivateIp } from '../../routes/ssrfGuard'
import { bankErr } from './errors'

export interface GuardedResponse {
	status: number
	headers: Record<string, string>
	body: string
}

export async function guardedFetch(
	url: string,
	init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number } = {},
): Promise<GuardedResponse> {
	let pinned: Awaited<ReturnType<typeof assertUrlSafeForFetch>>
	try {
		pinned = await assertUrlSafeForFetch(url)
	} catch (e) {
		throw bankErr('POLICY_BLOCKED', `URL rejected by SSRF guard: ${(e as Error).message}`)
	}
	if (pinned.length === 0 || pinned.some((p) => isPrivateIp(p.address))) throw bankErr('POLICY_BLOCKED', 'URL resolves to a private address')
	const u = new URL(url)
	const transport = u.protocol === 'https:' ? https : http
	const maxBytes = init.maxBytes ?? 2_000_000
	const lookup: LookupFunction = (_h, options, cb) => {
		const o = typeof options === 'object' && options !== null ? options : {}
		const first = pinned[0]!
		// biome-ignore lint/suspicious/noExplicitAny: node overloaded lookup callback
		if (o.all) (cb as any)(null, pinned.map((p) => ({ address: p.address, family: p.family })))
		else cb(null, first.address, first.family)
	}
	return await new Promise<GuardedResponse>((resolve, reject) => {
		const req = transport.request(
			url,
			{ method: init.method ?? 'GET', headers: init.headers, lookup, timeout: init.timeoutMs ?? 15_000 },
			(res) => {
				const chunks: Buffer[] = []
				let size = 0
				res.on('data', (d: Buffer) => {
					size += d.length
					if (size > maxBytes) {
						req.destroy(bankErr('UPSTREAM', 'Response too large'))
						return
					}
					chunks.push(d)
				})
				res.on('end', () => {
					const headers: Record<string, string> = {}
					for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
					resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString('utf8') })
				})
			},
		)
		req.on('timeout', () => req.destroy(bankErr('UPSTREAM', 'Request timed out')))
		req.on('error', (e) => reject(e instanceof Error && 'code' in e && (e as { code?: string }).code === 'VALIDATION' ? e : bankErr('UPSTREAM', `Fetch failed: ${String(e)}`)))
		if (init.body) req.write(init.body)
		req.end()
	})
}

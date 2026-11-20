/**
 * Post-deploy smoke test for the World ID passport path.
 *
 * Usage:
 *   bun run scripts/smoke-world-id.ts --base https://api.suwappu.bot
 *
 * Base URL resolution order: --base flag > SMOKE_BASE_URL env > https://api.suwappu.bot
 *
 * Steps:
 *   (a) GET /health                             — status ok
 *   (b) GET /hackathon/status                    — trustLayer true AND providers.worldId true
 *   (c) POST /hackathon/world-id/start           — 200, connectorURI starts with "https://", 0x signal
 *   (d) [if SMOKE_AGENT_API_KEY set]
 *       POST /v1/agent/link/code                 — success true, world_id.action === "suwappu-agent-link",
 *                                                   world_id.signal startsWith "agent-link:"
 *
 * Exits 1 on any FAIL.
 *
 * See docs/DECISIONS.md "Demo hardening 2026-09-26" — every prior World ID
 * bug was invisible to CI; this script hits the real deployed sandbox.
 */

function parseArgs(argv: string[]): { base: string } {
	const idx = argv.indexOf('--base')
	const flagBase = idx !== -1 ? argv[idx + 1] : undefined
	const base = flagBase || process.env['SMOKE_BASE_URL'] || 'https://api.suwappu.bot'
	return { base: base.replace(/\/+$/, '') }
}

function excerpt(v: unknown, max = 400): string {
	const s = typeof v === 'string' ? v : JSON.stringify(v)
	return s.length > max ? `${s.slice(0, max)}…` : s
}

let failed = false

function report(name: string, ok: boolean, body: unknown) {
	const status = ok ? 'PASS' : 'FAIL'
	console.log(`[${status}] ${name} — ${excerpt(body)}`)
	if (!ok) failed = true
}

async function main() {
	const { base } = parseArgs(process.argv.slice(2))
	console.log(`Smoke testing World ID passport path against: ${base}\n`)

	// (a) GET /health
	try {
		const res = await fetch(`${base}/health`)
		const body = await res.json().catch(() => null)
		const ok = res.ok && (body as Record<string, unknown> | null)?.['status'] === 'ok'
		report('(a) GET /health', ok, body)
	} catch (e) {
		report('(a) GET /health', false, String(e))
	}

	// (b) GET /hackathon/status
	try {
		const res = await fetch(`${base}/hackathon/status`)
		const body = (await res.json().catch(() => null)) as
			| { trustLayer?: boolean; providers?: { worldId?: boolean } }
			| null
		const ok = res.ok && body?.trustLayer === true && body?.providers?.worldId === true
		report('(b) GET /hackathon/status', ok, body)
	} catch (e) {
		report('(b) GET /hackathon/status', false, String(e))
	}

	// (c) POST /hackathon/world-id/start
	try {
		const res = await fetch(`${base}/hackathon/world-id/start`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				agentId: 'smoke',
				chain: 'base',
				fromToken: 'ETH',
				toToken: 'USDC',
				amountIn: '0.01',
				summary: 'smoke',
			}),
		})
		const body = (await res.json().catch(() => null)) as
			| { connectorURI?: string; signal?: string }
			| null
		const ok =
			res.status === 200 &&
			typeof body?.connectorURI === 'string' &&
			body.connectorURI.startsWith('https://') &&
			typeof body?.signal === 'string' &&
			body.signal.startsWith('0x')
		report('(c) POST /hackathon/world-id/start', ok, body)
	} catch (e) {
		report('(c) POST /hackathon/world-id/start', false, String(e))
	}

	// (d) POST /v1/agent/link/code (only if SMOKE_AGENT_API_KEY is set)
	const apiKey = process.env['SMOKE_AGENT_API_KEY']
	if (apiKey) {
		try {
			const res = await fetch(`${base}/v1/agent/link/code`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({}),
			})
			const body = (await res.json().catch(() => null)) as
				| { success?: boolean; world_id?: { action?: string; signal?: string } }
				| null
			const ok =
				res.ok &&
				body?.success === true &&
				body?.world_id?.action === 'suwappu-agent-link' &&
				typeof body?.world_id?.signal === 'string' &&
				body.world_id.signal.startsWith('agent-link:')
			report('(d) POST /v1/agent/link/code', ok, body)
		} catch (e) {
			report('(d) POST /v1/agent/link/code', false, String(e))
		}
	} else {
		console.log('[SKIP] (d) POST /v1/agent/link/code — SMOKE_AGENT_API_KEY not set')
	}

	// (e) POST /hackathon/passport/start — random wallet, expect a QR connectorURI
	const randomWallet = () =>
		'0x' + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
	try {
		const wallet = randomWallet()
		const res = await fetch(`${base}/hackathon/passport/start`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ wallet }),
		})
		const body = (await res.json().catch(() => null)) as { connectorURI?: string; signal?: string } | null
		const ok =
			res.status === 200 &&
			typeof body?.connectorURI === 'string' &&
			body.connectorURI.startsWith('https://') &&
			typeof body?.signal === 'string'
		report('(e) POST /hackathon/passport/start', ok, body)
	} catch (e) {
		report('(e) POST /hackathon/passport/start', false, String(e))
	}

	// (f) POST /hackathon/passport/swap — fresh unverified wallet, expect a
	// synchronous 'blocked' with reason SwapperNotVerified (simulate-only, no gas).
	try {
		const wallet = randomWallet()
		const res = await fetch(`${base}/hackathon/passport/swap`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ wallet }),
		})
		const body = (await res.json().catch(() => null)) as { status?: string; reason?: string } | null
		const ok = res.status === 200 && body?.status === 'blocked' && body?.reason === 'SwapperNotVerified'
		report('(f) POST /hackathon/passport/swap (unverified)', ok, body)
	} catch (e) {
		report('(f) POST /hackathon/passport/swap (unverified)', false, String(e))
	}

	console.log(failed ? '\nSMOKE: FAILED' : '\nSMOKE: ALL PASS')
	process.exit(failed ? 1 : 0)
}

main()

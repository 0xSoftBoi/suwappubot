import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import {
	createPythonProxyRoutes,
	createTerminalSwapProxyRoutes,
	createTerminalWebappProxyRoutes,
	isPythonProxyAllowed,
	isTerminalWebappProxyAllowed,
} from '../routes/pythonProxy'

const PYTHON_URL = 'http://python-api.railway.internal:8000'

function unsignedJwt(src: string): string {
	const encode = (value: object) =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: 123, src })}.signature`
}

const STRONG_HEADERS = {
	Authorization: `Bearer ${unsignedJwt('passkey')}`,
	Origin: 'https://terminal.suwappu.bot',
}

const WEAK_HEADERS = {
	Authorization: `Bearer ${unsignedJwt('weak')}`,
	Origin: 'https://terminal.suwappu.bot',
}

describe('Python Terminal compatibility gateway', () => {
	it('forwards auth requests while stripping browser-supplied internal credentials', async () => {
		let calls = 0
		const app = new Hono().route('/', createPythonProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				calls += 1
				expect(String(input)).toBe(`${PYTHON_URL}/auth/turnkey/verify?source=terminal`)
				expect(init?.method).toBe('POST')
				expect(init?.redirect).toBe('manual')
				const headers = new Headers(init?.headers)
				expect(headers.get('Origin')).toBe('https://terminal.suwappu.bot')
				expect(headers.get('Authorization')).toBe('Bearer browser-session')
				expect(headers.get('Cookie')).toBe('suwappu_auth=cookie-session')
				expect(headers.get('X-Internal-Key')).toBeNull()
				return Response.json({ token: 'session-token' })
			},
		}))

		const response = await app.request('/auth/turnkey/verify?source=terminal', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer browser-session',
				Cookie: 'suwappu_auth=cookie-session',
				Origin: 'https://terminal.suwappu.bot',
				'X-Internal-Key': 'must-not-be-forwarded',
			},
			body: '{}',
		})
		expect(response.status).toBe(200)
		expect(calls).toBe(1)
	})

	it('keeps the Python route allowlist explicit', () => {
		for (const [method, path] of [
			['GET', '/auth/me'],
			['GET', '/terminal/chart/ohlcv'],
			['GET', '/terminal/token/safety'],
			['GET', '/terminal/intel/devwatch/hits'],
			['GET', '/terminal/intel/base/0xabc'],
			['POST', '/terminal/intel/devwatch'],
			['DELETE', '/terminal/intel/devwatch/123'],
			['GET', '/terminal/wallet/summary'],
			['POST', '/terminal/wallet/withdraw'],
			['GET', '/terminal/perps/account'],
			['GET', '/terminal/perps/positions'],
			['GET', '/terminal/predict/positions'],
			['POST', '/webapp/bridge/build'],
			['GET', '/webapp/bridge/transfers/123'],
		] as const) {
			expect(isPythonProxyAllowed(method, path)).toBe(true)
		}

		for (const [method, path] of [
			['GET', '/terminal/wallet/withdraw'],
			['POST', '/terminal/wallet/admin-sweep'],
			['POST', '/terminal/predict/order'],
			['POST', '/terminal/predict/redeem'],
			['DELETE', '/terminal/intel/devwatch/not-a-number'],
		] as const) {
			expect(isPythonProxyAllowed(method, path)).toBe(false)
		}
	})

	it('requires strong trading provenance before forwarding withdrawal', async () => {
		let calls = 0
		const app = new Hono().route('/', createPythonProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				calls += 1
				expect(String(input)).toBe(`${PYTHON_URL}/terminal/wallet/withdraw`)
				const headers = new Headers(init?.headers)
				expect(headers.get('Authorization')).toBe(STRONG_HEADERS.Authorization)
				const raw = init?.body as ArrayBuffer
				const payload = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>
				expect(payload).toMatchObject({
					chain: 'ethereum',
					token: 'USDC',
					amount: 12.5,
					toAddress: '0x1111111111111111111111111111111111111111',
					idempotency_key: 'withdrawal-intent-1',
				})
				return Response.json({ ok: true, txHash: '0xabc', status: 'submitted' })
			},
		}))

		const weak = await app.request('/terminal/wallet/withdraw', {
			method: 'POST',
			headers: { ...WEAK_HEADERS, 'Content-Type': 'application/json' },
			body: '{}',
		})
		expect(weak.status).toBe(403)
		expect(calls).toBe(0)

		const cookieOnly = await app.request('/terminal/wallet/withdraw', {
			method: 'POST',
			headers: {
				Cookie: `suwappu_auth=${unsignedJwt('passkey')}`,
				Origin: 'https://terminal.suwappu.bot',
				'Content-Type': 'application/json',
			},
			body: '{}',
		})
		expect(cookieOnly.status).toBe(403)
		expect(calls).toBe(0)

		const strong = await app.request('/terminal/wallet/withdraw', {
			method: 'POST',
			headers: { ...STRONG_HEADERS, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				chain: 'ethereum',
				token: 'USDC',
				amount: 12.5,
				toAddress: '0x1111111111111111111111111111111111111111',
				idempotency_key: 'withdrawal-intent-1',
			}),
		})
		expect(strong.status).toBe(200)
		expect(calls).toBe(1)
	})

	it('keeps standalone /webapp compatibility precise', () => {
		for (const [method, path] of [
			['GET', '/webapp/referrals/stats'],
			['GET', '/webapp/copy-trading/top-traders'],
			['GET', '/webapp/copy-trading/following'],
			['GET', '/webapp/alerts'],
			['POST', '/webapp/alerts'],
			['GET', '/webapp/wallet-tracker/wallets'],
			['POST', '/webapp/wallet-tracker/wallets'],
			['GET', '/webapp/tweets/accounts'],
			['POST', '/webapp/tweets/accounts'],
			['GET', '/webapp/limit-orders'],
			['GET', '/webapp/me/limit-orders'],
			['DELETE', '/webapp/me/limit-orders/42'],
			['GET', '/webapp/me/portfolio'],
			['GET', '/webapp/dca/orders'],
			['POST', '/webapp/dca/orders/7/pause'],
			['POST', '/webapp/dca/orders/7/cancel'],
			['GET', '/webapp/discovery/new'],
			['GET', '/webapp/discovery/trending'],
			['POST', '/webapp/solana/rpc'],
			['GET', '/webapp/solana/tx-history'],
		] as const) {
			expect(isTerminalWebappProxyAllowed(method, path)).toBe(true)
		}

		for (const [method, path] of [
			['POST', '/webapp/copy-trading/follow/12'],
			['PUT', '/webapp/copy-trading/follow/12/settings'],
			['POST', '/webapp/limit-orders'],
			['POST', '/webapp/me/limit-orders'],
			['DELETE', '/webapp/me/limit-orders/not-a-number'],
			['POST', '/webapp/dca/orders'],
			['POST', '/webapp/dca/orders/not-a-number/pause'],
			['POST', '/webapp/admin/sweep'],
		] as const) {
			expect(isTerminalWebappProxyAllowed(method, path)).toBe(false)
		}
	})

	it('rewrites stale read aliases onto session-backed Python reads', async () => {
		const seen: string[] = []
		const app = new Hono().route('/', createTerminalWebappProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input) => {
				seen.push(new URL(String(input)).pathname)
				return Response.json({ ok: true })
			},
		}))

		for (const path of ['/webapp/me/portfolio', '/webapp/me/limit-orders']) {
			const response = await app.request(path)
			expect(response.status).toBe(200)
		}
		expect(seen).toEqual(['/webapp/portfolio', '/webapp/limit-orders'])
	})

	it('rewrites risk-reducing order controls for strong sessions only', async () => {
		const seen: string[] = []
		const app = new Hono().route('/', createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				seen.push(`${init?.method} ${new URL(String(input)).pathname}`)
				return Response.json({ success: true })
			},
		}))

		const weak = await app.request('/webapp/dca/orders/7/pause', {
			method: 'POST', headers: WEAK_HEADERS,
		})
		expect(weak.status).toBe(403)

		const cancelLimit = await app.request('/webapp/me/limit-orders/42', {
			method: 'DELETE', headers: STRONG_HEADERS,
		})
		const pauseDca = await app.request('/webapp/dca/orders/7/pause', {
			method: 'POST', headers: STRONG_HEADERS,
		})
		const cancelDca = await app.request('/webapp/dca/orders/7/cancel', {
			method: 'POST', headers: STRONG_HEADERS,
		})
		expect(cancelLimit.status).toBe(200)
		expect(pauseDca.status).toBe(200)
		expect(cancelDca.status).toBe(200)
		expect(seen).toEqual([
			'POST /webapp/limit-orders/42/cancel',
			'POST /webapp/dca/orders/7/pause',
			'POST /webapp/dca/orders/7/cancel',
		])
	})

	it('keeps quote/build POSTs usable before trading proof', async () => {
		const seen: string[] = []
		const app = new Hono().route('/', createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async (input, init) => {
				seen.push(`${init?.method} ${new URL(String(input)).pathname}`)
				return Response.json({ ok: true })
			},
		}))

		for (const path of ['/webapp/swap/quote', '/webapp/swap/build']) {
			const response = await app.request(path, { method: 'POST', body: '{}' })
			expect(response.status).toBe(200)
		}
		expect(seen).toEqual(['POST /webapp/swap/quote', 'POST /webapp/swap/build'])
	})

	it('leaves Telegram requests on native api-ts handlers', async () => {
		let pythonCalls = 0
		const app = new Hono()
		app.route('/', createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async () => {
				pythonCalls += 1
				return Response.json({ source: 'python' })
			},
		}))
		app.get('/webapp/alerts', (c) => c.json({ source: 'api-ts' }))

		const response = await app.request('/webapp/alerts', {
			headers: { 'X-Telegram-Init-Data': 'query_id=signed-telegram-data' },
		})
		expect(await response.json()).toEqual({ source: 'api-ts' })
		expect(pythonCalls).toBe(0)
	})

	it('falls through on unreviewed routes instead of widening Python access', async () => {
		let pythonCalls = 0
		const app = new Hono()
		app.route('/', createTerminalSwapProxyRoutes({
			baseUrl: PYTHON_URL,
			fetchImpl: async () => {
				pythonCalls += 1
				return Response.json({ source: 'python' })
			},
		}))
		app.post('/webapp/admin/sweep', (c) => c.json({ source: 'api-ts' }))

		const response = await app.request('/webapp/admin/sweep', { method: 'POST' })
		expect(await response.json()).toEqual({ source: 'api-ts' })
		expect(pythonCalls).toBe(0)
	})

	it('fails closed when the Python service URL is not configured', async () => {
		const app = new Hono().route('/', createPythonProxyRoutes({}))
		const response = await app.request('/auth/me')
		expect(response.status).toBe(503)
	})
})

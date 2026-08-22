import { Hono, type Context } from 'hono'

/**
 * Browser-facing routes that still live in the Python service.
 *
 * Keep this list deliberately explicit. api.suwappu.bot is the production
 * origin used by Terminal, so this gateway only bridges reviewed compatibility
 * routes that do not yet have an api-ts implementation. Money-changing routes
 * are opt-in exact paths below; a broad /terminal or /webapp prefix is never
 * enough to make a new Python endpoint browser-reachable.
 */
const AUTH_ROUTES = new Set([
	'POST /auth/turnkey/challenge',
	'POST /auth/turnkey/verify',
	'POST /auth/solana/challenge',
	'POST /auth/solana/verify',
	'GET /auth/me',
	'POST /auth/telegram',
	'POST /auth/telegram/widget',
	'POST /auth/refresh',
	'POST /auth/logout',
	'POST /auth/passkey/register/init',
	'POST /auth/passkey/register/complete',
	'POST /auth/passkey/authenticate/init',
	'POST /auth/passkey/authenticate/complete',
])

const TERMINAL_READ_ROUTES = new Set([
	'/terminal/chart/ohlcv',
	'/terminal/perps/candles',
	'/terminal/perps/context',
	'/terminal/perps/whales',
	'/terminal/predict/history',
	'/terminal/market/regime',
	'/terminal/signals',
	'/terminal/token/safety',
	'/terminal/discovery/final-stretch',
	'/terminal/orderbook',
	'/terminal/trades',
	'/terminal/intel/health',
	'/terminal/intel/devwatch',
	'/terminal/intel/devwatch/hits',
])

// Authenticated Terminal routes whose Python implementations are already the
// canonical trading/wallet services used by the bot. These handlers validate
// the end-user JWT/cookie themselves; the gateway only preserves the browser
// transport across the api-ts production origin.
const TERMINAL_SESSION_ROUTES = new Set([
	'GET /terminal/wallet/summary',
	'GET /terminal/perps/account',
	'POST /terminal/perps/connect',
	'GET /terminal/perps/positions',
	'POST /terminal/perps/execute',
	'POST /terminal/perps/close',
	'POST /terminal/perps/tpsl',
	'GET /terminal/perps/orders',
	'POST /terminal/perps/cancel',
])

// Cross-chain bridge execution is non-custodial: Python builds unsigned txs,
// the connected browser wallet signs/broadcasts, and /record starts tracking.
// Keep every method/path explicit so unrelated /webapp money routes stay shut.
const TERMINAL_BRIDGE_ROUTES = new Set([
	'POST /webapp/bridge/routes',
	'POST /webapp/bridge/build',
	'POST /webapp/bridge/record',
])

const OAUTH_ROUTE = /^\/auth\/oauth\/(google|twitter)\/(authorize|callback)$/
const TERMINAL_TOKEN_INTEL_ROUTE = /^\/terminal\/intel\/[^/]+\/[^/]+$/
const TERMINAL_BRIDGE_TRANSFER_ROUTE = /^\/webapp\/bridge\/transfers\/\d+$/
const TERMINAL_SWAP_POST_ROUTES = new Set([
	'/webapp/swap/quote',
	'/webapp/swap/build',
	'/webapp/swap/record',
	'/webapp/swap/submit-jito',
	'/webapp/swap/execute',
])

export function isPythonProxyAllowed(method: string, path: string): boolean {
	const normalizedMethod = method.toUpperCase()
	const methodPath = `${normalizedMethod} ${path}`
	if (AUTH_ROUTES.has(methodPath)) return true
	if (TERMINAL_SESSION_ROUTES.has(methodPath)) return true
	if (TERMINAL_BRIDGE_ROUTES.has(methodPath)) return true
	if (normalizedMethod === 'GET' && OAUTH_ROUTE.test(path)) return true
	if (normalizedMethod === 'GET' && TERMINAL_BRIDGE_TRANSFER_ROUTE.test(path)) return true
	return (
		normalizedMethod === 'GET' &&
		(TERMINAL_READ_ROUTES.has(path) || TERMINAL_TOKEN_INTEL_ROUTE.test(path))
	)
}

export function isTerminalSwapProxyAllowed(method: string, path: string): boolean {
	return method.toUpperCase() === 'POST' && TERMINAL_SWAP_POST_ROUTES.has(path)
}

const REQUEST_HOP_BY_HOP_HEADERS = [
	'connection',
	'content-length',
	'host',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
	// Ask the internal service for an uncompressed body. That avoids forwarding
	// a Content-Encoding that fetch may already have transparently decoded.
	'accept-encoding',
]

const RESPONSE_HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'content-length',
	'keep-alive',
	'proxy-authenticate',
	'proxy-authorization',
	'te',
	'trailer',
	'transfer-encoding',
	'upgrade',
])

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface PythonProxyConfig {
	baseUrl?: string | undefined
	fetchImpl?: FetchLike | undefined
}

function outboundHeaders(request: Request): Headers {
	const headers = new Headers(request.headers)
	for (const name of REQUEST_HOP_BY_HOP_HEADERS) headers.delete(name)

	// Never let a browser smuggle a service credential through this user-facing
	// proxy. Python authenticates these routes with the forwarded end-user
	// Authorization/Cookie headers, not X-Internal-Key.
	headers.delete('x-internal-key')
	return headers
}

function responseHeaders(upstream: Response): Headers {
	const headers = new Headers()
	upstream.headers.forEach((value, name) => {
		const normalized = name.toLowerCase()
		if (normalized === 'set-cookie') return
		if (normalized.startsWith('access-control-')) return
		if (RESPONSE_HOP_BY_HOP_HEADERS.has(normalized)) return
		headers.append(name, value)
	})

	// OAuth/session endpoints can set more than one cookie. getSetCookie() keeps
	// them as distinct header fields instead of comma-folding them (which is not
	// valid for Set-Cookie because Expires values themselves contain commas).
	const cookieHeaders = upstream.headers as Headers & { getSetCookie?: () => string[] }
	const getSetCookie = cookieHeaders.getSetCookie?.bind(cookieHeaders)
	const cookies = getSetCookie ? getSetCookie() : []
	if (cookies.length > 0) {
		for (const cookie of cookies) headers.append('Set-Cookie', cookie)
	} else {
		const cookie = upstream.headers.get('Set-Cookie')
		if (cookie) headers.append('Set-Cookie', cookie)
	}

	return headers
}

function buildTarget(baseUrl: string, requestUrl: string): URL {
	const base = new URL(baseUrl)
	const incoming = new URL(requestUrl)
	const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '')

	// Assign path/query onto the trusted base URL instead of resolving an
	// attacker-controlled URL string, so a leading // can never change the host.
	base.pathname = `${basePath}${incoming.pathname}`
	base.search = incoming.search
	base.hash = ''
	return base
}

async function proxyToPython(c: Context, config: PythonProxyConfig, fetchImpl: FetchLike) {
	if (!config.baseUrl) return c.json({ detail: 'Python API is not configured' }, 503)

	let target: URL
	try {
		target = buildTarget(config.baseUrl, c.req.url)
	} catch {
		return c.json({ detail: 'Python API is not configured' }, 503)
	}

	const method = c.req.method.toUpperCase()
	const body = method === 'GET' || method === 'HEAD' ? undefined : await c.req.raw.arrayBuffer()

	let upstream: Response
	try {
		upstream = await fetchImpl(target, {
			method,
			headers: outboundHeaders(c.req.raw),
			body,
			// OAuth authorize/callback responses must reach the browser unchanged.
			// Following redirects for any proxied request would also hide the real
			// upstream status and could turn a POST into an unintended GET.
			redirect: 'manual',
		})
	} catch {
		return c.json({ detail: 'Python API unavailable' }, 502)
	}

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders(upstream),
	})
}

/**
 * Create the narrow api-ts -> Python compatibility gateway used by Terminal.
 */
export function createPythonProxyRoutes(config: PythonProxyConfig) {
	const routes = new Hono()
	const fetchImpl = config.fetchImpl ?? fetch

	const proxy = async (c: Context) => {
		if (!isPythonProxyAllowed(c.req.method, c.req.path)) return c.notFound()
		return proxyToPython(c, config, fetchImpl)
	}

	// Prefix catch-alls plus the exact method/path allowlist above mean a newly
	// added Python money route is still 404 here until deliberately reviewed.
	routes.all('/auth/*', proxy)
	routes.all('/terminal/*', proxy)
	routes.all('/webapp/bridge/*', proxy)
	return routes
}

/**
 * MONEY-PATH: standalone Terminal uses POST-based Python swap routes, while the
 * Telegram Mini App owns the overlapping api-ts swap surface. Mount this router
 * before swapRoutes: a Telegram init-data header deliberately falls through;
 * only the five exact standalone Terminal POSTs are forwarded to Python.
 */
export function createTerminalSwapProxyRoutes(config: PythonProxyConfig) {
	const routes = new Hono()
	const fetchImpl = config.fetchImpl ?? fetch

	routes.all('/webapp/swap/*', async (c, next) => {
		const isTelegramRequest = c.req.raw.headers.has('X-Telegram-Init-Data')
		if (isTelegramRequest || !isTerminalSwapProxyAllowed(c.req.method, c.req.path)) {
			await next()
			return
		}

		return proxyToPython(c, config, fetchImpl)
	})

	return routes
}

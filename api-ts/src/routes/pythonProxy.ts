import { Hono, type Context } from 'hono'
import { logger } from '../lib/logger'
import { trustedControlDecision, trustedSpendDecision } from '../middleware/trustedSpend'

/**
 * Browser-facing routes that still live in the Python service.
 *
 * Keep this list deliberately explicit. api-ts is Terminal's backend gateway
 * (reached through the Terminal same-origin Railway proxy in production), so
 * this compatibility layer only bridges reviewed routes that do not yet have
 * an api-ts implementation. Money-changing routes are opt-in exact paths below;
 * a broad /terminal or /webapp prefix is never enough to make a new Python
 * endpoint browser-reachable.
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

const TERMINAL_COPY_READ_ROUTES = new Set([
	'/webapp/copy-trading/top-traders',
	'/webapp/copy-trading/feed',
])

const TERMINAL_SESSION_ROUTES = new Set([
	'GET /terminal/wallet/summary',
	'POST /terminal/wallet/withdraw',
	'GET /terminal/perps/account',
	'POST /terminal/perps/connect',
	'GET /terminal/perps/positions',
	'POST /terminal/perps/execute',
	'POST /terminal/perps/close',
	'POST /terminal/perps/tpsl',
	'GET /terminal/perps/orders',
	'POST /terminal/perps/cancel',
	'GET /terminal/predict/positions',
	'POST /terminal/intel/devwatch',
])

const TERMINAL_BRIDGE_ROUTES = new Set([
	'POST /webapp/bridge/routes',
	'POST /webapp/bridge/build',
	'POST /webapp/bridge/record',
])

const TERMINAL_WEBAPP_EXACT_ROUTES = new Set([
	'GET /webapp/referrals',
	'GET /webapp/referrals/stats',
	'GET /webapp/referrals/code',
	'GET /webapp/referrals/leaderboard',
	'GET /webapp/copy-trading/top-traders',
	'GET /webapp/copy-trading/feed',
	'GET /webapp/copy-trading/following',
	'GET /webapp/copy-trading/trades',
	'GET /webapp/alerts',
	'POST /webapp/alerts',
	'GET /webapp/wallet-tracker/wallets',
	'POST /webapp/wallet-tracker/wallets',
	'GET /webapp/wallet-tracker/activities',
	'GET /webapp/tweets/accounts',
	'POST /webapp/tweets/accounts',
	'GET /webapp/tweets/feed',
	'GET /webapp/limit-orders',
	'GET /webapp/me/limit-orders',
	'GET /webapp/me/portfolio',
	'GET /webapp/me/portfolio/history',
	'GET /webapp/dca/orders',
	'GET /webapp/discovery/new',
	'GET /webapp/discovery/trending',
	'POST /webapp/solana/rpc',
	'GET /webapp/solana/tx-history',
])

const OAUTH_ROUTE = /^\/auth\/oauth\/(google|twitter)\/(authorize|callback)$/
const TERMINAL_TOKEN_INTEL_ROUTE = /^\/terminal\/intel\/[^/]+\/[^/]+$/
const TERMINAL_DEVWATCH_DELETE_ROUTE = /^\/terminal\/intel\/devwatch\/\d+$/
const TERMINAL_BRIDGE_TRANSFER_ROUTE = /^\/webapp\/bridge\/transfers\/\d+$/
const TERMINAL_COPY_TRADER_ROUTE = /^\/webapp\/copy-trading\/traders\/\d+$/
const TERMINAL_ALERT_DELETE_ROUTE = /^\/webapp\/alerts\/\d+$/
const TERMINAL_WALLET_TRACKER_DELETE_ROUTE = /^\/webapp\/wallet-tracker\/wallets\/[^/]+$/
const TERMINAL_TWEET_DELETE_ROUTE = /^\/webapp\/tweets\/accounts\/[^/]+$/
const TERMINAL_LIMIT_ORDER_CANCEL_ROUTE = /^\/webapp\/me\/limit-orders\/(\d+)$/
const TERMINAL_DCA_CONTROL_ROUTE = /^\/webapp\/dca\/orders\/(\d+)\/(pause|cancel)$/
const TERMINAL_SWAP_POST_ROUTES = new Set([
	'/webapp/swap/quote',
	'/webapp/swap/build',
	'/webapp/swap/record',
	'/webapp/swap/submit-jito',
	'/webapp/swap/execute',
])

// These routes can directly authorize/sign/broadcast or mutate a live trading
// venue. Keep this set exact: ordinary account-state mutations (alerts, tracked
// wallets, tweet monitors, devwatch) rely on Python session auth but must NOT
// demand wallet-control proof.
const TRUSTED_SPEND_EXACT_ROUTES = new Set([
	'POST /terminal/wallet/withdraw',
	'POST /terminal/perps/connect',
	'POST /terminal/perps/execute',
	'POST /terminal/perps/close',
	'POST /terminal/perps/tpsl',
	'POST /terminal/perps/cancel',
	'POST /webapp/swap/submit-jito',
	'POST /webapp/swap/execute',
])

export function isPythonProxyAllowed(method: string, path: string): boolean {
	const normalizedMethod = method.toUpperCase()
	const methodPath = `${normalizedMethod} ${path}`
	if (AUTH_ROUTES.has(methodPath)) return true
	if (TERMINAL_SESSION_ROUTES.has(methodPath)) return true
	if (TERMINAL_BRIDGE_ROUTES.has(methodPath)) return true
	if (normalizedMethod === 'GET' && OAUTH_ROUTE.test(path)) return true
	if (normalizedMethod === 'GET' && TERMINAL_BRIDGE_TRANSFER_ROUTE.test(path)) return true
	if (normalizedMethod === 'DELETE' && TERMINAL_DEVWATCH_DELETE_ROUTE.test(path)) return true
	if (
		normalizedMethod === 'GET' &&
		(TERMINAL_COPY_READ_ROUTES.has(path) || TERMINAL_COPY_TRADER_ROUTE.test(path))
	) return true
	return (
		normalizedMethod === 'GET' &&
		(TERMINAL_READ_ROUTES.has(path) || TERMINAL_TOKEN_INTEL_ROUTE.test(path))
	)
}

export function isTerminalWebappProxyAllowed(method: string, path: string): boolean {
	const normalizedMethod = method.toUpperCase()
	const methodPath = `${normalizedMethod} ${path}`
	if (TERMINAL_WEBAPP_EXACT_ROUTES.has(methodPath)) return true
	if (normalizedMethod === 'GET' && TERMINAL_COPY_TRADER_ROUTE.test(path)) return true
	if (normalizedMethod === 'DELETE' && TERMINAL_ALERT_DELETE_ROUTE.test(path)) return true
	if (normalizedMethod === 'DELETE' && TERMINAL_WALLET_TRACKER_DELETE_ROUTE.test(path)) return true
	if (normalizedMethod === 'DELETE' && TERMINAL_TWEET_DELETE_ROUTE.test(path)) return true
	if (normalizedMethod === 'DELETE' && TERMINAL_LIMIT_ORDER_CANCEL_ROUTE.test(path)) return true
	if (normalizedMethod === 'POST' && TERMINAL_DCA_CONTROL_ROUTE.test(path)) return true
	return false
}

export function isTerminalSwapProxyAllowed(method: string, path: string): boolean {
	return method.toUpperCase() === 'POST' && TERMINAL_SWAP_POST_ROUTES.has(path)
}

type ProxyTarget = { path?: string; method?: string }

function terminalWebappTarget(path: string, method: string): ProxyTarget {
	if (path === '/webapp/me/portfolio') return { path: '/webapp/portfolio' }
	if (path === '/webapp/me/portfolio/history') return { path: '/webapp/portfolio/history' }
	if (path === '/webapp/me/limit-orders') return { path: '/webapp/limit-orders' }

	const cancelMatch = path.match(TERMINAL_LIMIT_ORDER_CANCEL_ROUTE)
	if (method.toUpperCase() === 'DELETE' && cancelMatch) {
		return { path: `/webapp/limit-orders/${cancelMatch[1]}/cancel`, method: 'POST' }
	}
	return {}
}

function requiresTrustedSpend(method: string, path: string): boolean {
	return TRUSTED_SPEND_EXACT_ROUTES.has(`${method.toUpperCase()} ${path}`)
}

function isRiskReducingControl(method: string, path: string): boolean {
	const normalizedMethod = method.toUpperCase()
	return (
		(normalizedMethod === 'DELETE' && TERMINAL_LIMIT_ORDER_CANCEL_ROUTE.test(path)) ||
		(normalizedMethod === 'POST' && TERMINAL_DCA_CONTROL_ROUTE.test(path))
	)
}

function rejectUntrustedMutation(c: Context): Response | null {
	if (requiresTrustedSpend(c.req.method, c.req.path)) {
		const decision = trustedSpendDecision(c.req.raw)
		if (decision.ok) return null
		logger.warn(
			{ event: 'trading_proof_denied', reason: decision.reason, method: c.req.method, path: c.req.path },
			'[Auth] Protected Terminal action denied before authentication',
		)
		return c.json(
			{
				error: 'Trading proof required',
				code: 'TRADING_PROOF_REQUIRED',
				message: 'Reconnect with a wallet, passkey, or Telegram before authorizing this action.',
			},
			403,
		)
	}

	if (isRiskReducingControl(c.req.method, c.req.path)) {
		const decision = trustedControlDecision(c.req.raw)
		if (decision.ok) return null
		logger.warn(
			{ event: 'control_auth_denied', reason: decision.reason, method: c.req.method, path: c.req.path },
			'[Auth] Terminal stop control denied before authentication',
		)
		return c.json(
			{
				error: 'Authenticated session required',
				code: 'CONTROL_AUTH_REQUIRED',
				message: 'Sign in to pause or cancel this order.',
			},
			403,
		)
	}

	return null
}

const REQUEST_HOP_BY_HOP_HEADERS = [
	'connection', 'content-length', 'host', 'keep-alive', 'proxy-authenticate',
	'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'accept-encoding',
]

const RESPONSE_HOP_BY_HOP_HEADERS = new Set([
	'connection', 'content-length', 'keep-alive', 'proxy-authenticate',
	'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface PythonProxyConfig {
	baseUrl?: string | undefined
	fetchImpl?: FetchLike | undefined
}

function outboundHeaders(request: Request): Headers {
	const headers = new Headers(request.headers)
	for (const name of REQUEST_HOP_BY_HOP_HEADERS) headers.delete(name)
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
	base.pathname = `${basePath}${incoming.pathname}`
	base.search = incoming.search
	base.hash = ''
	return base
}

function applyTargetPathOverride(target: URL, baseUrl: string, targetPath?: string): URL {
	if (!targetPath) return target
	const base = new URL(baseUrl)
	const basePath = base.pathname === '/' ? '' : base.pathname.replace(/\/$/, '')
	target.pathname = `${basePath}${targetPath}`
	return target
}

async function proxyToPython(
	c: Context,
	config: PythonProxyConfig,
	fetchImpl: FetchLike,
	targetOverride: ProxyTarget = {},
) {
	if (!config.baseUrl) return c.json({ detail: 'Python API is not configured' }, 503)

	let target: URL
	try {
		target = applyTargetPathOverride(buildTarget(config.baseUrl, c.req.url), config.baseUrl, targetOverride.path)
	} catch {
		return c.json({ detail: 'Python API is not configured' }, 503)
	}

	const incomingMethod = c.req.method.toUpperCase()
	const method = targetOverride.method?.toUpperCase() ?? incomingMethod
	const body = incomingMethod === 'GET' || incomingMethod === 'HEAD' ? undefined : await c.req.raw.arrayBuffer()

	let upstream: Response
	try {
		upstream = await fetchImpl(target, {
			method,
			headers: outboundHeaders(c.req.raw),
			body,
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

export function createTerminalWebappProxyRoutes(config: PythonProxyConfig) {
	const routes = new Hono()
	const fetchImpl = config.fetchImpl ?? fetch

	routes.all('/webapp/*', async (c, next) => {
		if (c.req.raw.headers.has('X-Telegram-Init-Data')) {
			await next()
			return
		}
		if (!isTerminalWebappProxyAllowed(c.req.method, c.req.path)) {
			await next()
			return
		}
		const rejected = rejectUntrustedMutation(c)
		if (rejected) return rejected
		return proxyToPython(c, config, fetchImpl, terminalWebappTarget(c.req.path, c.req.method))
	})
	return routes
}

export function createPythonProxyRoutes(config: PythonProxyConfig) {
	const routes = new Hono()
	const fetchImpl = config.fetchImpl ?? fetch

	const proxy = async (c: Context) => {
		if (!isPythonProxyAllowed(c.req.method, c.req.path)) return c.notFound()
		const rejected = rejectUntrustedMutation(c)
		if (rejected) return rejected
		return proxyToPython(c, config, fetchImpl)
	}

	routes.all('/auth/*', proxy)
	routes.all('/terminal/*', proxy)
	routes.all('/webapp/bridge/*', proxy)
	routes.all('/webapp/copy-trading/*', proxy)
	return routes
}

export function createTerminalSwapProxyRoutes(config: PythonProxyConfig) {
	const routes = new Hono()
	const fetchImpl = config.fetchImpl ?? fetch

	routes.all('/webapp/*', async (c, next) => {
		const isTelegramRequest = c.req.raw.headers.has('X-Telegram-Init-Data')
		const allowed =
			isTerminalSwapProxyAllowed(c.req.method, c.req.path) ||
			isTerminalWebappProxyAllowed(c.req.method, c.req.path)
		if (isTelegramRequest || !allowed) {
			await next()
			return
		}
		const rejected = rejectUntrustedMutation(c)
		if (rejected) return rejected
		return proxyToPython(c, config, fetchImpl, terminalWebappTarget(c.req.path, c.req.method))
	})
	return routes
}

import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

export function isCorsOriginAllowed(origin: string, allowedOrigins: string, isProduction: boolean): boolean {
	const origins = allowedOrigins.split(',').map((o) => o.trim())
	if (origins.includes(origin)) return true
	return !isProduction && /^http:\/\/localhost(:\d+)?$/.test(origin)
}

/**
 * ETHGlobal Tokyo 2026 demo: the showcase page at suwappu.bot/passport calls
 * /hackathon/* directly from the browser. Scoped to that path prefix only —
 * does not change CORS behavior for any other route.
 */
const HACKATHON_ORIGINS = ['https://suwappu.bot', 'https://www.suwappu.bot', 'http://localhost:3000']

export function createCorsMiddleware(allowedOrigins: string) {
	const isProduction = process.env.NODE_ENV === 'production'

	return cors({
		origin: (origin, c) => {
			if (!origin) return '*'
			if (isCorsOriginAllowed(origin, allowedOrigins, isProduction)) return origin
			if (c.req.path.startsWith('/hackathon/') && HACKATHON_ORIGINS.includes(origin)) return origin
			return null
		},
		// The webapp/terminal SPA calls with fetch(credentials:'include'), so the
		// browser requires Access-Control-Allow-Credentials: true or it blocks every
		// response. Safe here: the origin callback echoes a concrete origin (never '*')
		// for real cross-origin requests, which is what the credentialed-CORS spec needs.
		credentials: true,
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowHeaders: [
			'Content-Type',
			'Authorization',
			'X-Admin-Key',
			'X-Telegram-Init-Data',
			'X-Dev-User-Id',
			'MCP-Protocol-Version',
			'Mcp-Method',
			'Mcp-Name',
		],
		exposeHeaders: ['Content-Length'],
		maxAge: 86400,
	})
}

/** MCP Streamable HTTP requires an explicit 403 for an invalid Origin. */
export function createMcpOriginGuard(allowedOrigins: string): MiddlewareHandler {
	const isProduction = process.env.NODE_ENV === 'production'
	return async (c, next) => {
		const origin = c.req.header('Origin')
		if (origin && !isCorsOriginAllowed(origin, allowedOrigins, isProduction)) {
			return c.body(null, 403)
		}
		await next()
	}
}

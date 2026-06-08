import { cors } from 'hono/cors'

export function createCorsMiddleware(allowedOrigins: string) {
	const origins = allowedOrigins.split(',').map((o) => o.trim())
	const isProduction = process.env.NODE_ENV === 'production'

	return cors({
		origin: (origin) => {
			if (!origin) return '*'
			if (origins.includes(origin)) return origin
			// Only allow localhost origins in non-production environments
			if (!isProduction && origin.match(/^http:\/\/localhost(:\d+)?$/)) return origin
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
		],
		exposeHeaders: ['Content-Length'],
		maxAge: 86400,
	})
}

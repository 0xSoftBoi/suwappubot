import { cors } from 'hono/cors'

export function createCorsMiddleware(allowedOrigins: string) {
	const origins = allowedOrigins.split(',').map((o) => o.trim())

	return cors({
		origin: (origin) => {
			if (!origin) return '*'
			// Only origins on the explicit allowlist are permitted, in all
			// environments. Localhost origins used for development must be added
			// to ALLOWED_ORIGINS explicitly (e.g. http://localhost:3000) rather
			// than matched by a wildcard regex, which would let any localhost
			// port — including attacker-controlled local proxies — pass CORS.
			if (origins.includes(origin)) return origin
			return null
		},
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

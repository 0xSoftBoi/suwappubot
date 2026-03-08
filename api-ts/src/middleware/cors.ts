import { cors } from 'hono/cors'

export function createCorsMiddleware(allowedOrigins: string) {
	const origins = allowedOrigins.split(',').map((o) => o.trim())

	return cors({
		origin: (origin) => {
			if (!origin) return '*'
			if (origins.includes(origin)) return origin
			if (origin.match(/^http:\/\/localhost(:\d+)?$/)) return origin
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

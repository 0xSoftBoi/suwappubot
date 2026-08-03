import { type Context, type Next } from 'hono'
import { trace } from '@opentelemetry/api'

/**
 * Per-request tracing middleware. Creates one span per HTTP request with
 * route/method/status attributes only — never headers, query strings,
 * bodies, or the Authorization/Cookie/X-Admin-Key/X-Internal-Key values.
 *
 * IMPORTANT: this must only be registered (`app.use`) when OTEL_ENABLED is
 * 'true' — see app.ts. It is intentionally NOT a permanent no-op-when-idle
 * middleware, because even a no-op tracer/span allocation on every request
 * is unwanted overhead when the feature is off. Gating at registration time
 * means the disabled path never runs this code at all.
 */
export function otelRequestTracing() {
	const tracer = trace.getTracer('suwappu-api-ts-http')

	return async (c: Context, next: Next) => {
		const span = tracer.startSpan(`${c.req.method} ${c.req.path}`, {
			attributes: {
				'http.method': c.req.method,
			},
		})

		try {
			await next()
		} catch (err) {
			span.recordException(err instanceof Error ? err : new Error(String(err)))
			throw err
		} finally {
			// routePath (the matched pattern, e.g. "/v1/agent/wallets/:id") is only
			// reliably populated once routing has completed, so it's read here
			// rather than before next(). Falls back to the raw path if unmatched
			// (404s never reach a registered route pattern).
			span.setAttribute('http.route', c.req.routePath || c.req.path)
			span.setAttribute('http.status_code', c.res.status)
			span.end()
		}
	}
}

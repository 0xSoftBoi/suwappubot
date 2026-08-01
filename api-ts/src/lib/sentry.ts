import * as Sentry from '@sentry/node'
import { logger } from './logger'
import { redactSensitiveData } from './sentryRedact'

let initialized = false

/**
 * Initialize Sentry error tracking. Fully optional — a no-op when SENTRY_DSN
 * is unset (local dev, tests, CI). Never throws: any init failure is caught
 * and logged, never crashes the process or blocks startup.
 *
 * Security: this API touches wallets, swap execution, x402 billing, and JWTs.
 * `sendDefaultPii` is hard-disabled, request headers/bodies are stripped, and
 * `beforeSend` recursively redacts any sensitive key before the event leaves
 * the process. See src/lib/sentryRedact.ts.
 */
export function initSentry(dsn: string | undefined, env: string): void {
	if (!dsn) return
	if (initialized) return

	try {
		Sentry.init({
			dsn,
			environment: env,
			// Errors only — no perf tracing, keeps quota + overhead minimal.
			tracesSampleRate: 0,
			// Never send cookies, IPs, usernames, or other PII by default.
			sendDefaultPii: false,
			// SECURITY: @sentry/node enables LocalVariablesAsync by default, which
			// serializes in-scope variables into stack frames. In this codebase
			// those frames can hold decrypted private keys and KMS material under
			// arbitrary names (`pk`, `raw`, `buf`) that key-based redaction cannot
			// recognize. Drop it outright — no stack-local capture at all.
			// Console is dropped too: we log via pino, so console breadcrumbs add
			// little but could carry secrets someone printed while debugging.
			integrations: (defaults) =>
				defaults.filter(
					(i) => i.name !== 'LocalVariables' && i.name !== 'LocalVariablesAsync' && i.name !== 'Console',
				),
			beforeSend(event) {
				try {
					// Strip request data entirely — never send bodies, and drop
					// headers (Authorization/Cookie in particular) rather than
					// trying to allow-list them.
					if (event.request) {
						delete event.request.headers
						delete event.request.cookies
						delete event.request.data
						delete event.request.query_string
						// `url` in @sentry/node carries the FULL url including the
						// query string, so deleting query_string alone still left a
						// token-in-querystring secret in the payload.
						delete event.request.url
					}

					const redacted = redactSensitiveData(event)
					return redacted as typeof event
				} catch (err) {
					// If redaction itself throws, fail closed — drop the event
					// rather than risk leaking unredacted data.
					logger.error({ err }, '[sentry] beforeSend redaction failed, dropping event')
					return null
				}
			},
		})
		initialized = true
		logger.info('[sentry] initialized')
	} catch (err) {
		// Never let Sentry init failure take down the API.
		logger.error({ err }, '[sentry] init failed, continuing without error tracking')
	}
}

export function isSentryInitialized(): boolean {
	return initialized
}

/**
 * Capture an unexpected 5xx error. Callers should NOT use this for expected
 * 4xx errors (validation, auth, 402 billing challenges) — that would flood
 * the Sentry quota with noise that isn't actionable.
 */
export function captureServerError(err: unknown, extra?: Record<string, unknown>): void {
	if (!initialized) return
	try {
		Sentry.captureException(err, extra ? { extra: redactSensitiveData(extra) } : undefined)
	} catch {
		// Swallow — telemetry must never affect the request path.
	}
}

export { Sentry }

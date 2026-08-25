/**
 * Keep tenant bot tokens out of logs.
 *
 * This exists because of GHSA-chf7-jq6g-qrwv (CVE-2026-27003, CVSS 6.9,
 * CWE-522), an advisory filed against `openclaw` — a package in this very
 * repository — for exactly the mistake this code was making:
 *
 *   "Telegram bot tokens can appear in error messages and stack traces (for
 *    example, when request URLs include https://api.telegram.org/bot<token>/...).
 *    OpenClaw previously logged these strings without redaction."
 *
 * Every Bot API call embeds the credential in the URL path, so any transport
 * error whose message includes the request URL carries the token with it — into
 * logs, crash reports, CI output and support bundles.
 *
 * The stakes are higher for us than they were for openclaw. They leaked their
 * own token; we hold our *customers'*, and each one drives a bot a community
 * trusts. One unredacted stack trace in a support bundle is a multi-tenant
 * compromise, which is why this is applied at the boundary rather than left to
 * each call site to remember.
 *
 * `lib/sentryRedact.ts` already scrubs Telegram tokens, but only inside
 * Sentry's `beforeSend` — an ordinary `logger.error()` never reaches it. Its
 * pattern is also narrower than what we accept (`\d{8,10}:[...]{35}` vs our
 * validator's `\d{6,12}:[...]{30,}`), so tokens we happily store would slip
 * past it. This module is deliberately wider than both.
 */

/** Any BotFather-shaped credential, wider than our own validator accepts.
 *  Over-matching costs a redacted log line; under-matching costs a token. */
const BOT_TOKEN = /\b\d{5,16}:[A-Za-z0-9_-]{20,}/g

/** The api.telegram.org form, redacted to keep the method name diagnosable —
 *  knowing the failure was on `sendMessage` vs `setWebhook` matters, and the
 *  token is the only part that must go. */
const TELEGRAM_URL = /(https?:\/\/api\.telegram\.org)\/bot[^/\s"']+(\/[A-Za-z]+)?/gi

/**
 * Scrub token-shaped substrings out of arbitrary text.
 *
 * Safe on anything — errors, URLs, JSON bodies, stack traces. Callers should
 * assume every string they did not construct themselves may carry a credential.
 */
export function redactBotToken(input: unknown): string {
	const text =
		typeof input === 'string'
			? input
			: input instanceof Error
				? `${input.message}${input.stack ? `\n${input.stack}` : ''}`
				: String(input)

	return text
		.replace(TELEGRAM_URL, (_m, host: string, method: string | undefined) =>
			`${host}/bot[REDACTED]${method ?? ''}`,
		)
		.replace(BOT_TOKEN, '[REDACTED]')
}

/** Convenience for the common `catch (e)` shape: a scrubbed Error, ready to log
 *  or wrap, that cannot carry the credential forward. */
export function redactedError(e: unknown, prefix?: string): Error {
	const msg = redactBotToken(e)
	return new Error(prefix ? `${prefix}: ${msg}` : msg)
}

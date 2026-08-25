import { describe, expect, it } from 'bun:test'
import { redactBotToken, redactedError } from '../services/tenantBots/redact'

/**
 * Regression coverage for GHSA-chf7-jq6g-qrwv (CVE-2026-27003).
 *
 * The advisory was filed against `openclaw` — a package in this repository —
 * for logging Telegram request URLs without redaction. We shipped the same
 * pattern, and it is worse here: openclaw leaked its own token, we hold our
 * customers'. Each of these cases is a real string shape that a transport
 * error, a JSON body or a stack trace produces in the paths that call the Bot
 * API.
 *
 * The rule these tests encode: a token must never survive, and everything else
 * should, because a log line that says only "[REDACTED]" is a log line nobody
 * can debug.
 */

const TOKEN = '123456789:AAHfake-token_ABCDEFGHIJKLMNOPQRSTU'
const SHORT = '12345:ABCDEFGHIJKLMNOPQRSTU'
const LONG = '1234567890123456:AAH' + 'x'.repeat(60)

describe('the token never survives', () => {
	it('redacts it inside an api.telegram.org URL', () => {
		const out = redactBotToken(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`)
		expect(out).not.toContain(TOKEN)
		expect(out).toContain('[REDACTED]')
	})

	it('redacts a bare token with no URL around it', () => {
		expect(redactBotToken(`token is ${TOKEN}`)).not.toContain(TOKEN)
	})

	it('redacts tokens our own validator accepts but the Sentry pattern misses', () => {
		// lib/sentryRedact.ts matches \d{8,10}:[...]{35}. Our TOKEN_RE accepts
		// \d{6,12}:[...]{30,}, so these are tokens we would happily store and
		// that redactor would leak. Hence a wider pattern here.
		expect(redactBotToken(`oops ${SHORT}`)).not.toContain(SHORT)
		expect(redactBotToken(`oops ${LONG}`)).not.toContain(LONG)
	})

	it('redacts every occurrence, not just the first', () => {
		const out = redactBotToken(`${TOKEN} and again ${TOKEN}`)
		expect(out).not.toContain(TOKEN)
		expect(out.match(/\[REDACTED\]/g)?.length).toBe(2)
	})

	it('redacts inside a JSON body', () => {
		const out = redactBotToken(`{"url":"https://api.telegram.org/bot${TOKEN}/setWebhook"}`)
		expect(out).not.toContain(TOKEN)
	})

	it('redacts inside an Error message and its stack', () => {
		const e = new Error(`connect ECONNREFUSED https://api.telegram.org/bot${TOKEN}/getMe`)
		const out = redactBotToken(e)
		expect(out).not.toContain(TOKEN)
	})

	it('redacts through redactedError, which is what call sites use', () => {
		const wrapped = redactedError(
			new Error(`boom https://api.telegram.org/bot${TOKEN}/sendMessage`),
			'telegram',
		)
		expect(wrapped.message).not.toContain(TOKEN)
		expect(wrapped.message).toContain('telegram')
	})

	it('handles non-string inputs without throwing or leaking', () => {
		for (const v of [null, undefined, 42, { token: TOKEN }, [TOKEN]]) {
			const out = redactBotToken(v)
			expect(out).not.toContain(TOKEN)
		}
	})
})

describe('everything else survives, so the log stays debuggable', () => {
	it('keeps the API method name', () => {
		// Knowing the failure was on sendMessage rather than setWebhook is the
		// entire diagnostic value of the line.
		const out = redactBotToken(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
		expect(out).toContain('sendMessage')
		expect(out).toContain('api.telegram.org')
	})

	it('leaves ordinary text alone', () => {
		const msg = 'tenant bot b1: send failed with status 500'
		expect(redactBotToken(msg)).toBe(msg)
	})

	it('does not eat things that merely contain a colon', () => {
		for (const s of [
			'error: something went wrong',
			'2026-08-25T10:00:00Z',
			'chat_id: 12345',
			'ratio 1:2',
		]) {
			expect(redactBotToken(s)).toBe(s)
		}
	})

	it('leaves an EVM address intact', () => {
		const addr = '0x000000000000000000000000000000000000dEaD'
		expect(redactBotToken(`burn to ${addr}`)).toContain(addr)
	})

	it('keeps surrounding context around a redacted token', () => {
		const out = redactBotToken(`bot b1 failed: ${TOKEN} at 10:00`)
		expect(out).toContain('bot b1 failed')
		expect(out).toContain('at 10:00')
	})
})

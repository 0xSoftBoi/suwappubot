import { Effect } from 'effect'
import { Hono } from 'hono'
import { requireDb, webEvents } from '../db'
import { runEffectEither } from '../runtime'

/**
 * First-party marketing-site event ingest (POST /v1/web/event).
 *
 * Public and unauthenticated by nature — it is called from the marketing
 * site's browser code — so everything here is defensive:
 *  - mounted behind ipRateLimit in app.ts
 *  - tiny body cap, strict shape, allowlisted characters, length caps
 *  - stores no IP, user agent or user id (see db/schema/webEvents.ts)
 *  - always answers 204: analytics must never break or slow the page, and a
 *    uniform response gives a prober nothing to learn
 */
const webEventRoutes = new Hono()

const MAX_BODY_BYTES = 2048
const NAME_RE = /^[a-z][a-z0-9_]{1,47}$/
const SESSION_RE = /^[A-Za-z0-9_-]{8,40}$/
const HOST_RE = /^[a-z0-9.-]{1,120}$/

function cleanText(value: unknown, max: number): string | null {
	if (typeof value !== 'string') return null
	// Printable ASCII + common Latin only; no control chars, no markup.
	const trimmed = value.trim().replace(/[^\x20-\x7E -ɏ]/g, '').replace(/[<>]/g, '')
	return trimmed ? trimmed.slice(0, max) : null
}

function cleanPath(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('/')) return '/'
	// Path only: a query string can carry tokens or emails, so it is dropped.
	const path = value.split(/[?#]/)[0] ?? '/'
	return (cleanText(path, 200) ?? '/').replace(/\s/g, '')
}

function cleanHost(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const host = value.trim().toLowerCase().replace(/^www\./, '')
	return HOST_RE.test(host) ? host : null
}

function cleanProps(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	const out: Record<string, string | number | boolean> = {}
	for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, 8)) {
		if (!/^[a-z][a-z0-9_]{0,31}$/i.test(key)) continue
		if (typeof raw === 'number' && Number.isFinite(raw)) out[key] = raw
		else if (typeof raw === 'boolean') out[key] = raw
		else {
			const text = cleanText(raw, 80)
			if (text) out[key] = text
		}
	}
	return Object.keys(out).length ? JSON.stringify(out) : null
}

webEventRoutes.post('/event', async (c) => {
	const done = () => c.body(null, 204)

	const length = Number(c.req.header('content-length') ?? '0')
	if (!Number.isFinite(length) || length > MAX_BODY_BYTES) return done()

	let body: Record<string, unknown>
	try {
		const raw = await c.req.text()
		if (raw.length > MAX_BODY_BYTES) return done()
		const parsed: unknown = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return done()
		body = parsed as Record<string, unknown>
	} catch {
		return done()
	}

	const name = typeof body.name === 'string' ? body.name : ''
	const sessionId = typeof body.sid === 'string' ? body.sid : ''
	if (!NAME_RE.test(name) || !SESSION_RE.test(sessionId)) return done()

	const utm = (body.utm && typeof body.utm === 'object' ? body.utm : {}) as Record<string, unknown>
	const row = {
		name,
		path: cleanPath(body.path),
		sessionId,
		referrerHost: cleanHost(body.ref),
		utmSource: cleanText(utm.source, 80),
		utmMedium: cleanText(utm.medium, 80),
		utmCampaign: cleanText(utm.campaign, 80),
		propsJson: cleanProps(body.props),
	}

	// Best effort. A missing table (Python not yet booted on the new model) or
	// a DB blip is swallowed: the visitor's page must not notice.
	await runEffectEither(
		Effect.gen(function* () {
			const db = yield* requireDb
			yield* Effect.tryPromise({
				try: () => db.insert(webEvents).values(row),
				catch: (e) => new Error(`web event insert failed: ${e}`),
			})
		}),
	)

	return done()
})

export { webEventRoutes }

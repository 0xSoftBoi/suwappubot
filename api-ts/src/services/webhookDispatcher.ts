/**
 * `alerts-webhooks` node of the enterprise dashboard parity plan
 * (docs/plans/enterprise-dashboard.md) — HMAC-signed, SIEM-friendly outbound
 * webhook dispatch for org-configured `orgWebhooks` rows
 * (db/schema/webhooks.ts).
 *
 * MONEY-PATH-adjacent but not itself money-moving: this fans OUT
 * notifications about policy/allowlist/screening events (see
 * routes/enterprisePolicies.ts wiring), it never authorizes or executes
 * anything. Delivery failures must NEVER propagate to (or slow down) the
 * caller that triggered the event — every public entry point here swallows
 * its own errors and only logs.
 *
 * Signing: HMAC-SHA256 of the exact raw JSON body string (never a
 * re-serialization) keyed by the webhook's own `secret`, hex-encoded, sent
 * as `X-Suwappu-Signature`. A recipient must verify by HMAC'ing the raw
 * request body bytes they received, not by re-stringifying a parsed object.
 *
 * SSRF: the URL is validated at write time (routes/enterpriseWebhooks.ts)
 * AND re-validated here immediately before every send (`isSafeWebhookUrl`),
 * since a webhook can sit unused for a long time and DNS/network topology
 * can change between those two points in time (defense in depth, not a
 * substitute for the write-time check).
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { Effect, Either } from 'effect'
import { isIP } from 'node:net'
import { requireDb, orgWebhooks, type OrgWebhook } from '../db'
import { logger } from '../lib/logger'
import { runEffect } from '../runtime'

export const WEBHOOK_EVENT_TYPES = [
	'policy.approval_requested',
	'policy.approval_resolved',
	'policy.changed',
	'allowlist.changed',
	// Written by the Python compliance side (bot/services/compliance) — not
	// wired to any dispatch call site yet. Included in the vocabulary now so
	// the schema/route validation doesn't need to change when that follow-up
	// lands; see routes/enterprisePolicies.ts wiring notes.
	'screening.blocked',
	'screening.flagged',
] as const
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

/** Synthetic event type used only for the `/test` endpoint — never subscribed via eventTypes. */
export const TEST_EVENT_TYPE = 'webhook.test'

const DELIVERY_TIMEOUT_MS = 5_000

// ─── secret / masking helpers ───────────────────────────────────────────────

export function generateWebhookSecret(): string {
	return randomBytes(32).toString('hex')
}

/** First 8 hex chars + ellipsis — enough to eyeball-distinguish rows, never enough to forge a signature. */
export function maskSecret(secret: string): string {
	return `${secret.slice(0, 8)}…`
}

// ─── SSRF blocklist (store-time AND send-time) ──────────────────────────────
//
// Deliberately independent of routes/ssrfGuard.ts's `isPublicUrl`: this
// endpoint's requirements are narrower and stricter (https-only; a static
// hostname/IP blocklist good enough for admin-authored, audited webhook
// config is sufficient here — org admins are already trusted, ADMIN_ROLES,
// callers, same trust tier as policy config elsewhere in this file set).

const PRIVATE_IPV4_PREFIXES: Array<(a: number, b: number) => boolean> = [
	(a) => a === 0, // 0.0.0.0/8
	(a) => a === 127, // loopback
	(a) => a === 10, // 10.0.0.0/8
	(a, b) => a === 172 && b >= 16 && b <= 31, // 172.16.0.0/12
	(a, b) => a === 192 && b === 168, // 192.168.0.0/16
	(a, b) => a === 169 && b === 254, // 169.254.0.0/16 link-local (incl. cloud metadata)
]

function isPrivateIpv4(ip: string): boolean {
	const parts = ip.split('.').map(Number)
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
	const [a, b] = parts
	return PRIVATE_IPV4_PREFIXES.some((fn) => fn(a as number, b as number))
}

function isLoopbackIpv6(host: string): boolean {
	const h = host.toLowerCase()
	return h === '::1' || h === '::' || h.startsWith('::ffff:127.') || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')
}

/**
 * Store-time and send-time SSRF guard for a webhook URL. Rejects non-https
 * schemes, obvious private/loopback/link-local/internal hostnames, and
 * private-range IP literals. Not a full rebinding-proof pin (unlike
 * routes/ssrfGuard.ts's safeFetch) — deliberate, see block comment above.
 */
export function isSafeWebhookUrl(url: string): { ok: true } | { ok: false; error: string } {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return { ok: false, error: 'Invalid URL' }
	}
	if (parsed.protocol !== 'https:') {
		return { ok: false, error: 'Webhook url must use https' }
	}

	let host = parsed.hostname.toLowerCase()
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)

	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host === '0.0.0.0') {
		return { ok: false, error: 'Webhook url must not point to a local or internal host' }
	}

	const ipVersion = isIP(host)
	if (ipVersion === 4 && isPrivateIpv4(host)) {
		return { ok: false, error: 'Webhook url must not point to a private or loopback IP' }
	}
	if (ipVersion === 6 && isLoopbackIpv6(host)) {
		return { ok: false, error: 'Webhook url must not point to a private or loopback IP' }
	}
	if (ipVersion === 0) {
		// Numeric-host bypasses (decimal/hex/octal encodings of an IP) that
		// dodge the dotted-quad checks above — same class of bypass
		// routes/ssrfGuard.ts guards against.
		if (/^0x[0-9a-f]+$/.test(host) || /^\d+$/.test(host) || /^0[0-7]+$/.test(host)) {
			return { ok: false, error: 'Webhook url host is not a valid hostname' }
		}
	}

	return { ok: true }
}

// ─── dispatch ────────────────────────────────────────────────────────────────

export interface DeliveryOutcome {
	ok: boolean
	status: number | null
	error?: string
}

function buildSignedBody(
	eventType: string,
	orgId: string,
	payload: Record<string, unknown>,
): { body: string; eventId: string } {
	const eventId = randomUUID()
	const body = JSON.stringify({
		id: eventId,
		eventType,
		orgId,
		timestamp: new Date().toISOString(),
		payload,
	})
	return { body, eventId }
}

/**
 * Deliver one signed POST to a single webhook row and persist the delivery
 * outcome (`lastDeliveryAt`/`lastDeliveryStatus`/`failureCount`). Never
 * rejects — every failure mode (bad URL, network error, timeout, non-2xx) is
 * captured in the returned `DeliveryOutcome` and also recorded on the row.
 * `lastDeliveryStatus` is the HTTP status on a completed request, or `0` when
 * no HTTP response was ever received (DNS/connect/timeout/SSRF-blocked).
 */
function deliverOne(
	webhook: OrgWebhook,
	eventType: string,
	orgId: string,
	payload: Record<string, unknown>,
) {
	return Effect.gen(function* () {
		const db = yield* requireDb
		const now = new Date()

		const urlCheck = isSafeWebhookUrl(webhook.url)
		if (!urlCheck.ok) {
			yield* Effect.tryPromise({
				try: () =>
					db
						.update(orgWebhooks)
						.set({ lastDeliveryAt: now, lastDeliveryStatus: 0, failureCount: sql`${orgWebhooks.failureCount} + 1` })
						.where(eq(orgWebhooks.id, webhook.id)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return { ok: false, status: null, error: urlCheck.error } as DeliveryOutcome
		}

		const { body } = buildSignedBody(eventType, orgId, payload)
		const signature = createHmac('sha256', webhook.secret).update(body).digest('hex')

		const attempt = yield* Effect.tryPromise({
			try: () =>
				fetch(webhook.url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Suwappu-Signature': signature,
						'X-Suwappu-Event': eventType,
					},
					body,
					redirect: 'error',
					signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
				}),
			catch: (e) => (e instanceof Error ? e : new Error(String(e))),
		}).pipe(Effect.either)

		if (Either.isLeft(attempt)) {
			yield* Effect.tryPromise({
				try: () =>
					db
						.update(orgWebhooks)
						.set({ lastDeliveryAt: now, lastDeliveryStatus: 0, failureCount: sql`${orgWebhooks.failureCount} + 1` })
						.where(eq(orgWebhooks.id, webhook.id)),
				catch: (e) => (e instanceof Error ? e : new Error(String(e))),
			})
			return { ok: false, status: null, error: attempt.left.message } as DeliveryOutcome
		}

		const status = attempt.right.status
		const ok = status >= 200 && status < 300
		yield* Effect.tryPromise({
			try: () =>
				db
					.update(orgWebhooks)
					.set({
						lastDeliveryAt: now,
						lastDeliveryStatus: status,
						failureCount: ok ? 0 : sql`${orgWebhooks.failureCount} + 1`,
					})
					.where(eq(orgWebhooks.id, webhook.id)),
			catch: (e) => (e instanceof Error ? e : new Error(String(e))),
		})
		return { ok, status } as DeliveryOutcome
	}).pipe(
		Effect.catchAll((e) =>
			Effect.sync((): DeliveryOutcome => {
				logger.warn(`[webhookDispatcher] delivery failed webhookId=${webhook.id}: ${e}`)
				return { ok: false, status: null, error: e instanceof Error ? e.message : String(e) }
			}),
		),
	)
}

/**
 * Look up enabled webhooks subscribed to `eventType` for `orgId` and fan out
 * a signed delivery to each, concurrently. Every failure is swallowed inside
 * `deliverOne`; this Effect itself never fails, so callers of
 * {@link dispatchOrgEvent} can safely fire it without a `.catch`.
 */
const dispatchOrgEventEffect = (orgId: string, eventType: WebhookEventType, payload: Record<string, unknown>) =>
	Effect.gen(function* () {
		const db = yield* requireDb
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(orgWebhooks)
					.where(and(eq(orgWebhooks.orgId, orgId), eq(orgWebhooks.enabled, true))),
			catch: (e) => (e instanceof Error ? e : new Error(String(e))),
		})

		const matching = rows.filter(
			(w) => Array.isArray(w.eventTypes) && (w.eventTypes as string[]).includes(eventType),
		)

		yield* Effect.forEach(matching, (webhook) => deliverOne(webhook, eventType, orgId, payload), {
			concurrency: 'unbounded',
			discard: true,
		})
	}).pipe(
		Effect.catchAll((e) =>
			Effect.sync(() => logger.warn(`[webhookDispatcher] lookup failed org=${orgId} event=${eventType}: ${e}`)),
		),
	)

/**
 * Fire-and-forget: looks up subscribed, enabled webhooks for `orgId` and
 * dispatches a signed event to each. Callers MUST NOT await this for
 * correctness — it is invoked after a mutation + its audit write have
 * already succeeded (see routes/enterprisePolicies.ts) and must never block
 * or fail the caller's response. Errors are logged, never thrown/rejected
 * out of this function.
 */
export function dispatchOrgEvent(orgId: string, eventType: WebhookEventType, payload: Record<string, unknown>): void {
	runEffect(dispatchOrgEventEffect(orgId, eventType, payload)).catch((e) => {
		logger.warn(`[webhookDispatcher] unexpected dispatch failure org=${orgId} event=${eventType}: ${e}`)
	})
}

/**
 * Synchronous (awaited) single-webhook test delivery used by the
 * `POST /orgs/:orgId/webhooks/:webhookId/test` route — unlike
 * {@link dispatchOrgEvent}, the caller here needs the outcome to return in
 * the HTTP response, so this is exposed as an Effect for the route to
 * `yield*` directly rather than fire-and-forget.
 */
export const sendTestEvent = (webhook: OrgWebhook, orgId: string) =>
	deliverOne(webhook, TEST_EVENT_TYPE, orgId, {
		message: 'This is a test event from Suwappu enterprise webhook configuration.',
		webhookId: webhook.id,
	})

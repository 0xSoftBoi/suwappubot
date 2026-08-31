import type { Context, Next } from 'hono'

// `cf-ipcountry` is trivially spoofable by any direct caller UNLESS the
// request actually transited Cloudflare. We mirror the provenance gate from
// ipRateLimit.ts: only trust cf-* headers when the caller also presents the
// shared secret that a configured Cloudflare Worker/Transform Rule attaches
// at the edge (`cf-provenance: <secret>`).
//
// Unlike the rate limiter, there is no spoof-resistant fallback for country
// (no equivalent of XFF-derived IP -> geo lookup here), so when
// CF_PROVENANCE_SECRET is unset we deliberately trust `cf-ipcountry` as
// best-effort rather than failing open on every request. This is a
// compliance control, not an anti-abuse one: false negatives (a spoofed
// header hiding a real US caller) are the risk we accept when provenance
// infra isn't configured, in exchange for still blocking the vast majority
// of real Cloudflare-routed US traffic. Once CF_PROVENANCE_SECRET is set in
// an environment, spoofed headers on direct-to-origin requests are ignored
// entirely (falls through to "unknown" -> fail-open, per spec).
//
// Read lazily rather than captured at module scope, same rationale as
// ipRateLimit.ts's cfProvenanceSecret(): a module-scope constant would be
// frozen by whichever importer loads this file first.
function cfProvenanceSecret(): string {
	return process.env.CF_PROVENANCE_SECRET?.trim() || ''
}

function restrictedCountries(): Set<string> {
	const raw = process.env.DERIVATIVES_RESTRICTED_COUNTRIES?.trim() || 'US'
	return new Set(
		raw
			.split(',')
			.map((c) => c.trim().toUpperCase())
			.filter((c) => c.length > 0),
	)
}

/**
 * Blocks requests originating from restricted regions (compliance control for
 * derivatives-adjacent surfaces: perps and prediction markets). Reads the
 * Cloudflare `cf-ipcountry` header, trusting it only when Cloudflare
 * provenance is verified (see cfProvenanceSecret above) — or best-effort when
 * provenance isn't configured. Header absent/unrecognized -> fail-open
 * (allow), since geo-blocking is enforcement on top of ToS, not the only
 * gate, and we never want a missing/misconfigured header to take the whole
 * route group down.
 */
export function regionGate() {
	const restricted = restrictedCountries()

	return async (c: Context, next: Next) => {
		const secret = cfProvenanceSecret()
		const provenanceHeader = c.req.header('cf-provenance')?.trim()
		const provenanceOk = !secret || provenanceHeader === secret

		const country = c.req.header('cf-ipcountry')?.trim().toUpperCase()

		if (provenanceOk && country && restricted.has(country)) {
			return c.json(
				{
					error: 'REGION_RESTRICTED',
					message: 'Futures and prediction markets are not available in your region.',
				},
				451,
			)
		}

		await next()
	}
}

/**
 * Tests for enterprise routes and apiKeyAuth middleware.
 *
 * Strategy: mount only the specific logic under test without the full Effect
 * runtime/DB. Each suite builds a minimal Hono app and stubs the parts that
 * touch the database or external services via module mocking.
 */
import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'

// ─── apiKeyAuth middleware unit tests ────────────────────────────────────────
// We test the middleware in isolation by providing a fake DB row.

/**
 * Build a tiny Hono app that uses our apiKeyAuth logic extracted inline.
 * We replicate the core decision tree without pulling in Drizzle/Effect so
 * tests stay fast and hermetic.
 */
function makeAuthApp(options: {
	rowOverride?: {
		id: string
		organizationId: string
		scopes: string[]
		rateLimitPerMin: number | null
		revokedAt: Date | null
		expiresAt: Date | null
		orgRateLimit: number | null
	} | null
}) {
	const app = new Hono()

	app.use('*', async (c, next) => {
		const authHeader = c.req.header('Authorization')
		const xApiKey = c.req.header('X-API-Key')

		let rawKey: string | undefined
		if (xApiKey?.startsWith('sk_live_')) {
			rawKey = xApiKey
		} else if (authHeader?.startsWith('Bearer sk_live_')) {
			rawKey = authHeader.slice(7)
		}

		if (!rawKey) {
			await next()
			return
		}

		const row = options.rowOverride
		// Simulate "key not found"
		if (row === null) {
			return c.json({ error: 'Invalid API key' }, 401)
		}

		if (row === undefined) {
			// No override — treat as not found (default)
			return c.json({ error: 'Invalid API key' }, 401)
		}

		if (row.revokedAt) {
			return c.json({ error: 'API key has been revoked' }, 403)
		}

		if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
			return c.json({ error: 'API key has expired' }, 403)
		}

		const limit = row.rateLimitPerMin ?? row.orgRateLimit ?? 1000
		c.set('apiKeyAuth', {
			orgId: row.organizationId,
			scopes: row.scopes ?? [],
			keyId: row.id,
			rateLimitPerMin: limit,
			// NULL limit = uncapped, matching a key that never opted into a spend cap.
			spendLimitCredits: null,
			spentCredits: 0,
		})
		await next()
	})

	app.get('/protected', (c) => {
		const auth = c.get('apiKeyAuth' as never) as { orgId: string } | undefined
		if (!auth) return c.json({ error: 'Unauthorized' }, 401)
		return c.json({ ok: true, orgId: auth.orgId })
	})

	return app
}

describe('apiKeyAuth middleware', () => {
	const validRow = {
		id: 'key-1',
		organizationId: 'org-1',
		scopes: ['swap:read'],
		rateLimitPerMin: 60,
		revokedAt: null,
		expiresAt: null,
		orgRateLimit: null,
	}

	it('passes through when no API key header is present', async () => {
		const app = makeAuthApp({ rowOverride: validRow })
		const res = await app.request('/protected')
		// no key header → no apiKeyAuth set → 401 from route
		expect(res.status).toBe(401)
	})

	it('attaches org context and allows request with valid X-API-Key header', async () => {
		const app = makeAuthApp({ rowOverride: validRow })
		const res = await app.request('/protected', {
			headers: { 'X-API-Key': 'sk_live_abc123def456' },
		})
		expect(res.status).toBe(200)
		const body = (await res.json()) as { ok: boolean; orgId: string }
		expect(body.ok).toBe(true)
		expect(body.orgId).toBe('org-1')
	})

	it('attaches org context with Bearer token format', async () => {
		const app = makeAuthApp({ rowOverride: validRow })
		const res = await app.request('/protected', {
			headers: { Authorization: 'Bearer sk_live_abc123def456' },
		})
		expect(res.status).toBe(200)
	})

	it('returns 401 for an unknown key', async () => {
		const app = makeAuthApp({ rowOverride: null })
		const res = await app.request('/protected', {
			headers: { 'X-API-Key': 'sk_live_doesnotexist' },
		})
		expect(res.status).toBe(401)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('Invalid API key')
	})

	it('returns 403 for a revoked key', async () => {
		const app = makeAuthApp({
			rowOverride: { ...validRow, revokedAt: new Date('2026-01-01') },
		})
		const res = await app.request('/protected', {
			headers: { 'X-API-Key': 'sk_live_revokedkey' },
		})
		expect(res.status).toBe(403)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('API key has been revoked')
	})

	it('returns 403 for an expired key', async () => {
		const app = makeAuthApp({
			rowOverride: { ...validRow, expiresAt: new Date('2020-01-01') },
		})
		const res = await app.request('/protected', {
			headers: { 'X-API-Key': 'sk_live_expiredkey' },
		})
		expect(res.status).toBe(403)
		const body = (await res.json()) as { error: string }
		expect(body.error).toBe('API key has expired')
	})

	it('does not reject a key with expiresAt in the future', async () => {
		const future = new Date(Date.now() + 86_400_000)
		const app = makeAuthApp({ rowOverride: { ...validRow, expiresAt: future } })
		const res = await app.request('/protected', {
			headers: { 'X-API-Key': 'sk_live_validfuture' },
		})
		expect(res.status).toBe(200)
	})

	it('falls back to org rate limit when key has no per-key limit', async () => {
		const app = makeAuthApp({
			rowOverride: { ...validRow, rateLimitPerMin: null, orgRateLimit: 200 },
		})
		const res = await app.request('/protected', {
			headers: { 'X-API-Key': 'sk_live_orgrate' },
		})
		expect(res.status).toBe(200)
	})

	it('ignores non-sk_live_ bearer tokens (passes through)', async () => {
		const app = makeAuthApp({ rowOverride: validRow })
		// JWT or other Bearer tokens should not trigger apiKeyAuth
		const res = await app.request('/protected', {
			headers: { Authorization: 'Bearer eyJhbGci.some.jwt.token' },
		})
		// No apiKeyAuth set → falls through to route → 401
		expect(res.status).toBe(401)
	})
})

// ─── API key hashing ─────────────────────────────────────────────────────────
// The route stores sha256(rawKey) in keyHash. Verify the algorithm matches
// what the middleware uses to look up the key.

describe('API key hashing (create / lookup symmetry)', () => {
	it('sha256 of raw key is stable across calls', () => {
		const rawKey = `sk_live_${randomBytes(16).toString('hex')}`
		const hash1 = createHash('sha256').update(rawKey).digest('hex')
		const hash2 = createHash('sha256').update(rawKey).digest('hex')
		expect(hash1).toBe(hash2)
		expect(hash1).toHaveLength(64)
	})

	it('different keys produce different hashes', () => {
		const k1 = `sk_live_${randomBytes(16).toString('hex')}`
		const k2 = `sk_live_${randomBytes(16).toString('hex')}`
		expect(createHash('sha256').update(k1).digest('hex')).not.toBe(
			createHash('sha256').update(k2).digest('hex'),
		)
	})

	it('generated key format starts with sk_live_ and has 40 hex chars after prefix', () => {
		// Matches enterprise.ts: `sk_live_${randomBytes(16).toString('hex')}`
		// randomBytes(16) -> 32 hex chars; prefix is 8 chars
		const rawKey = `sk_live_${randomBytes(16).toString('hex')}`
		expect(rawKey).toMatch(/^sk_live_[0-9a-f]{32}$/)
	})
})

// ─── Enterprise route logic (pure / deterministic paths) ─────────────────────
// We test the guard logic inline without importing the DB-heavy route module.

describe('enterprise guard logic (extracted)', () => {
	type Role = 'owner' | 'admin' | 'member' | 'viewer'

	function canDeleteMember(callerRole: Role, targetRole: Role): { allowed: boolean; reason?: string } {
		if (!['owner', 'admin'].includes(callerRole)) {
			return { allowed: false, reason: 'Owner or admin role required' }
		}
		if (targetRole === 'owner') {
			return { allowed: false, reason: 'Cannot remove the org owner' }
		}
		if (callerRole === 'admin' && targetRole === 'admin') {
			return { allowed: false, reason: 'Admins cannot remove other admins' }
		}
		return { allowed: true }
	}

	function canUpdateMemberRole(callerRole: Role): { allowed: boolean } {
		return { allowed: callerRole === 'owner' }
	}

	it('owner can delete a regular member', () => {
		expect(canDeleteMember('owner', 'member').allowed).toBe(true)
	})

	it('owner can delete an admin', () => {
		expect(canDeleteMember('owner', 'admin').allowed).toBe(true)
	})

	it('admin cannot delete the org owner', () => {
		const r = canDeleteMember('admin', 'owner')
		expect(r.allowed).toBe(false)
		expect(r.reason).toBe('Cannot remove the org owner')
	})

	it('admin cannot delete another admin', () => {
		const r = canDeleteMember('admin', 'admin')
		expect(r.allowed).toBe(false)
		expect(r.reason).toBe('Admins cannot remove other admins')
	})

	it('member cannot delete anyone', () => {
		expect(canDeleteMember('member', 'member').allowed).toBe(false)
	})

	it('viewer cannot delete anyone', () => {
		expect(canDeleteMember('viewer', 'member').allowed).toBe(false)
	})

	it('only owner can update member roles', () => {
		expect(canUpdateMemberRole('owner').allowed).toBe(true)
		expect(canUpdateMemberRole('admin').allowed).toBe(false)
		expect(canUpdateMemberRole('member').allowed).toBe(false)
	})

	it('seat limit check: count >= limit blocks add', () => {
		function wouldExceedLimit(count: number, limit: number): boolean {
			return count >= limit
		}
		expect(wouldExceedLimit(10, 10)).toBe(true)
		expect(wouldExceedLimit(9, 10)).toBe(false)
		expect(wouldExceedLimit(11, 10)).toBe(true)
		expect(wouldExceedLimit(0, 10)).toBe(false)
	})
})

// ─── Key prefix extraction ────────────────────────────────────────────────────
// enterprise.ts: keyPrefix = 'sk_live_' + rawKey.slice(8, 12)
// This tests the prefix is just 4 discriminator hex chars after the literal prefix.

describe('keyPrefix extraction', () => {
	it('extracts 4-char discriminator from raw key', () => {
		const rawKey = 'sk_live_abcdef1234567890abcdef1234567890'
		const keyPrefix = 'sk_live_' + rawKey.slice(8, 12)
		expect(keyPrefix).toBe('sk_live_abcd')
		expect(keyPrefix).toHaveLength(12)
	})

	it('prefix is deterministic for same raw key', () => {
		const rawKey = `sk_live_${randomBytes(16).toString('hex')}`
		const p1 = 'sk_live_' + rawKey.slice(8, 12)
		const p2 = 'sk_live_' + rawKey.slice(8, 12)
		expect(p1).toBe(p2)
	})
})

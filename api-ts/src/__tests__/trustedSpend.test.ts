import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { bearerSessionSource, trustedSpendDecision, trustedSpendPreflight } from '../middleware/trustedSpend'

function unsignedJwt(src?: string): string {
	const encode = (value: object) =>
		btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
	return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ userId: 123, ...(src ? { src } : {}) })}.signature`
}

describe('trusted spend preflight', () => {
	it('recognizes only the bearer provenance tag; downstream auth still verifies the signature', () => {
		expect(bearerSessionSource(`Bearer ${unsignedJwt('siwe')}`)).toBe('siwe')
		expect(bearerSessionSource(`Bearer ${unsignedJwt('weak')}`)).toBe('weak')
		expect(bearerSessionSource(`Bearer ${unsignedJwt()}`)).toBeNull()
		expect(bearerSessionSource('Bearer malformed')).toBeNull()
	})

	it('accepts strong trading bearers and rejects weak/legacy bearer tokens', () => {
		for (const src of ['siwe', 'telegram', 'passkey']) {
			const request = new Request('https://api.suwappu.bot/public/swap/execute', {
				method: 'POST',
				headers: { Authorization: `Bearer ${unsignedJwt(src)}` },
			})
			expect(trustedSpendDecision(request)).toEqual({ ok: true, via: 'strong_bearer' })
		}

		for (const src of ['weak', 'oauth', undefined]) {
			const request = new Request('https://api.suwappu.bot/public/swap/execute', {
				method: 'POST',
				headers: { Authorization: `Bearer ${unsignedJwt(src)}` },
			})
			expect(trustedSpendDecision(request)).toEqual({ ok: false, reason: 'weak_bearer' })
		}
	})

	it('rejects cookie-only sessions even from first-party origins', () => {
		for (const src of ['weak', 'siwe', 'passkey']) {
			const request = new Request('https://api.suwappu.bot/public/swap/execute', {
				method: 'POST',
				headers: {
					Cookie: `suwappu_auth=${unsignedJwt(src)}`,
					Origin: 'https://terminal.suwappu.bot',
				},
			})
			expect(trustedSpendDecision(request)).toEqual({ ok: false, reason: 'missing_trading_proof' })
		}
	})

	it('does not let a weak bearer hide behind a cookie', () => {
		const request = new Request('https://api.suwappu.bot/public/swap/execute', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${unsignedJwt('weak')}`,
				Cookie: `suwappu_auth=${unsignedJwt('passkey')}`,
				Origin: 'https://terminal.suwappu.bot',
			},
		})
		expect(trustedSpendDecision(request)).toEqual({ ok: false, reason: 'weak_bearer' })
	})

	it('returns a stable 403 contract before a protected route runs', async () => {
		const app = new Hono()
		app.use('/execute', trustedSpendPreflight())
		app.post('/execute', (c) => c.json({ signed: true }))

		const denied = await app.request('/execute', {
			method: 'POST',
			headers: { Authorization: `Bearer ${unsignedJwt('weak')}` },
		})
		expect(denied.status).toBe(403)
		expect(await denied.json()).toMatchObject({ code: 'TRADING_PROOF_REQUIRED' })

		const allowed = await app.request('/execute', {
			method: 'POST',
			headers: { Authorization: `Bearer ${unsignedJwt('passkey')}` },
		})
		expect(allowed.status).toBe(200)
		expect(await allowed.json()).toEqual({ signed: true })
	})
})

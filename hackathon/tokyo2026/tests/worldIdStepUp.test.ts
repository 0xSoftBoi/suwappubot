import { describe, expect, test } from 'bun:test'
import { validateWorldIdStepUp, type WorldIdApproval } from '../src/world-id/stepUp.ts'

const ctx = { userId: 7, approvalId: 'appr-1', now: new Date('2026-09-25T12:00:00Z'), ttlMs: 15 * 60 * 1000 }

const fresh: WorldIdApproval = {
	nullifier: '123456789',
	signal: '0xsignal',
	expectedSignal: '0xsignal',
	verifiedAt: new Date('2026-09-25T11:55:00Z'),
	consumedAt: null,
	userId: 7,
	approvalId: 'appr-1',
}

describe('validateWorldIdStepUp', () => {
	test('fresh approval is valid', () => {
		expect(validateWorldIdStepUp(fresh, ctx)).toEqual({ valid: true })
	})
	test('missing approval fails', () => {
		expect(validateWorldIdStepUp(null, ctx).valid).toBe(false)
	})
	test('wrong user fails', () => {
		expect(validateWorldIdStepUp({ ...fresh, userId: 8 }, ctx).valid).toBe(false)
	})
	test('wrong approval id fails', () => {
		expect(validateWorldIdStepUp({ ...fresh, approvalId: 'appr-2' }, ctx).valid).toBe(false)
	})
	test('consumed approval fails (single-use)', () => {
		expect(validateWorldIdStepUp({ ...fresh, consumedAt: new Date() }, ctx).valid).toBe(false)
	})
	test('expired approval fails', () => {
		const expired = { ...fresh, verifiedAt: new Date('2026-09-25T11:30:00Z') }
		const r = validateWorldIdStepUp(expired, ctx)
		expect(r.valid).toBe(false)
		if (!r.valid) expect(r.reason).toContain('expired')
	})
	test('signal mismatch fails — proof bound to a different trade', () => {
		const r = validateWorldIdStepUp({ ...fresh, signal: '0xother' }, ctx)
		expect(r.valid).toBe(false)
		if (!r.valid) expect(r.reason).toContain('trade intent')
	})
})

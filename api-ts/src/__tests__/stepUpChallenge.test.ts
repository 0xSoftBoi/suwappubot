import { describe, expect, it } from 'bun:test'
import { validateStepUpChallenge } from '../lib/stepUpChallenge'

const NOW = new Date('2026-08-01T12:00:00.000Z')

const baseRow = {
	userId: 42,
	approvalId: 'aaaaaaaa-0000-0000-0000-000000000001',
	usedAt: null,
	expiresAt: new Date('2026-08-01T12:02:00.000Z'),
}

const baseCtx = {
	userId: 42,
	approvalId: 'aaaaaaaa-0000-0000-0000-000000000001',
	now: NOW,
}

describe('validateStepUpChallenge', () => {
	it('accepts a fresh, unused, matching challenge', () => {
		expect(validateStepUpChallenge(baseRow, baseCtx)).toEqual({ valid: true })
	})

	it('rejects a missing row', () => {
		const result = validateStepUpChallenge(null, baseCtx)
		expect(result.valid).toBe(false)
	})

	it('rejects a challenge issued to a different user', () => {
		const result = validateStepUpChallenge({ ...baseRow, userId: 999 }, baseCtx)
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.reason).toMatch(/does not belong to this user/)
	})

	it('rejects a challenge bound to a different approval id (cross-approval binding)', () => {
		const result = validateStepUpChallenge(
			{ ...baseRow, approvalId: 'bbbbbbbb-0000-0000-0000-000000000002' },
			baseCtx,
		)
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.reason).toMatch(/different approval request/)
	})

	it('rejects an already-used challenge (single-use)', () => {
		const result = validateStepUpChallenge(
			{ ...baseRow, usedAt: new Date('2026-08-01T12:01:00.000Z') },
			baseCtx,
		)
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.reason).toMatch(/already been used/)
	})

	it('rejects an expired challenge', () => {
		const result = validateStepUpChallenge(
			{ ...baseRow, expiresAt: new Date('2026-08-01T11:59:00.000Z') },
			baseCtx,
		)
		expect(result.valid).toBe(false)
		if (!result.valid) expect(result.reason).toMatch(/expired/)
	})

	it('rejects a challenge expiring exactly at `now` (boundary, not inclusive)', () => {
		const result = validateStepUpChallenge({ ...baseRow, expiresAt: NOW }, baseCtx)
		expect(result.valid).toBe(false)
	})
})

import { describe, expect, test } from 'bun:test'
import { scanResultToPolicySignal, escalationFor } from '../src/intercepta/policy.ts'
import type { ScanResult } from '../src/intercepta/client.ts'

const base: ScanResult = { target: '0xabc', verdict: 'safe', riskScore: 5, findings: [] }

describe('scanResultToPolicySignal', () => {
	test('safe → allow, empty reason', () => {
		const s = scanResultToPolicySignal(base, 'payment destination')
		expect(s.verdict).toBe('allow')
		expect(s.reason).toBe('')
		expect(s.trustPenalty).toBe(0)
	})
	test('malicious → block with visible reason', () => {
		const s = scanResultToPolicySignal(
			{
				...base,
				verdict: 'malicious',
				riskScore: 95,
				findings: [{ code: 'sanctioned_address', risk: 'CRITICAL', description: 'address on sanctions list' }],
			},
			'payment destination',
		)
		expect(s.verdict).toBe('block')
		expect(s.reason).toContain('sanctions list')
		expect(s.reason).toContain('95/100')
		expect(s.trustPenalty).toBeGreaterThan(0)
	})
	test('high score alone blocks even without malicious verdict', () => {
		const s = scanResultToPolicySignal({ ...base, verdict: 'suspicious', riskScore: 80, findings: [] }, 'transaction')
		expect(s.verdict).toBe('block')
	})
	test('medium score → require_approval (escalates to World ID)', () => {
		const s = scanResultToPolicySignal(
			{
				...base,
				verdict: 'suspicious',
				riskScore: 55,
				findings: [{ code: 'mixer_interaction', risk: 'HIGH', description: 'recent mixer interaction' }],
			},
			'payment destination',
		)
		expect(s.verdict).toBe('require_approval')
		expect(s.reason).toContain('human approval required')
		expect(escalationFor(s)).toBe('world_id_step_up')
	})
	test('allow → no escalation', () => {
		expect(escalationFor(scanResultToPolicySignal(base, 'x'))).toBe('none')
	})
	test('trust penalty accumulates and caps', () => {
		const s = scanResultToPolicySignal(
			{
				...base,
				verdict: 'malicious',
				riskScore: 100,
				findings: [
					{ code: 'a', risk: 'CRITICAL', description: 'a' },
					{ code: 'b', risk: 'CRITICAL', description: 'b' },
					{ code: 'c', risk: 'CRITICAL', description: 'c' },
				],
			},
			'x',
		)
		expect(s.trustPenalty).toBe(50) // capped
	})
})

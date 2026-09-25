import { describe, expect, test } from 'bun:test'
import {
	ROLES,
	grantRoles,
	revokeRoles,
	hasRole,
	assertAgentGrantSafe,
	AGENT_DEFAULT_ROLES,
} from '../src/ensv2/roles.ts'

describe('role bitmaps', () => {
	test('grant/has round-trip', () => {
		const g = grantRoles(0n, 'POLICY_READER', 'METADATA_WRITER')
		expect(hasRole(g, 'POLICY_READER')).toBe(true)
		expect(hasRole(g, 'METADATA_WRITER')).toBe(true)
		expect(hasRole(g, 'LIMIT_WRITER')).toBe(false)
		expect(hasRole(g, 'ADMIN')).toBe(false)
	})
	test('revoke removes only the named role', () => {
		const g = revokeRoles(grantRoles(0n, 'POLICY_READER', 'METADATA_WRITER'), 'METADATA_WRITER')
		expect(hasRole(g, 'POLICY_READER')).toBe(true)
		expect(hasRole(g, 'METADATA_WRITER')).toBe(false)
	})
	test('roles are distinct single bits', () => {
		const bits = Object.values(ROLES)
		expect(new Set(bits).size).toBe(bits.length)
		for (const b of bits) {
			expect(b & (b - 1n)).toBe(0n) // power of two
		}
	})
})

describe('agent grant invariant', () => {
	test('default agent grant is safe', () => {
		assertAgentGrantSafe(grantRoles(0n, ...AGENT_DEFAULT_ROLES))
	})
	test('LIMIT_WRITER in agent grant throws', () => {
		expect(() => assertAgentGrantSafe(grantRoles(0n, 'METADATA_WRITER', 'LIMIT_WRITER'))).toThrow('SECURITY')
	})
	test('ADMIN in agent grant throws', () => {
		expect(() => assertAgentGrantSafe(grantRoles(0n, 'ADMIN'))).toThrow('SECURITY')
	})
	test('default grant lets the agent update metadata but not caps', () => {
		const g = grantRoles(0n, ...AGENT_DEFAULT_ROLES)
		expect(hasRole(g, 'METADATA_WRITER')).toBe(true)
		expect(hasRole(g, 'LIMIT_WRITER')).toBe(false)
	})
})

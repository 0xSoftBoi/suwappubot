import { describe, expect, test } from 'bun:test'
import {
	encodeAbiParameters,
	encodeFunctionData,
	keccak256,
	namehash,
	toFunctionSelector,
} from 'viem'
import {
	REGISTRY_ROLES,
	RESOLVER_ROLES,
	adminOf,
	assertAgentKeysSafe,
	assertAgentRootGrantSafe,
	grantRoles,
	hasRole,
	resolverResource,
	revokeRoles,
	textPart,
	textRecordResource,
} from '../src/ensv2/roles.ts'
import { dnsEncode } from '../src/ensv2/resolver.ts'
import { encodeResolverInit, encodeSetText } from '../src/ensv2/register.ts'
import { AGENT_WRITABLE_KEYS, TEXT_KEYS } from '../src/ensv2/addresses.ts'

describe('canonical registry roles (RegistryRolesLib)', () => {
	test('roles are distinct single nybbles', () => {
		const bits = Object.values(REGISTRY_ROLES)
		expect(new Set(bits).size).toBe(bits.length)
		for (const b of bits) {
			// exactly one nybble set: b == 1 << (4k)
			expect(b & (b - 1n)).toBe(0n)
			expect(b.toString(16).replace(/0/g, '').length).toBe(1)
		}
	})
	test('SET_RESOLVER is nybble 6 (1 << 24)', () => {
		expect(REGISTRY_ROLES.SET_RESOLVER).toBe(1n << 24n)
	})
	test('adminOf shifts the nybble 128 bits', () => {
		expect(adminOf(REGISTRY_ROLES.SET_RESOLVER)).toBe((1n << 24n) << 128n)
	})
	test('grant/has/revoke round-trip on real bits', () => {
		const g = grantRoles(0n, REGISTRY_ROLES.SET_RESOLVER, REGISTRY_ROLES.RENEW)
		expect(hasRole(g, REGISTRY_ROLES.SET_RESOLVER)).toBe(true)
		expect(hasRole(g, REGISTRY_ROLES.SET_SUBREGISTRY)).toBe(false)
		const r = revokeRoles(g, REGISTRY_ROLES.RENEW)
		expect(hasRole(r, REGISTRY_ROLES.RENEW)).toBe(false)
		expect(hasRole(r, REGISTRY_ROLES.SET_RESOLVER)).toBe(true)
	})
})

describe('canonical resolver roles (PermissionedResolverLib)', () => {
	test('SET_TEXT is nybble 1 (1 << 4)', () => {
		expect(RESOLVER_ROLES.SET_TEXT).toBe(1n << 4n)
	})
	test('resource(node, part) = keccak256(abi.encode(node, part))', () => {
		const node = namehash('clanker.suwappu.eth')
		const part = textPart('suwappu.policy')
		const expected = BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [node, part])))
		expect(resolverResource(node, part)).toBe(expected)
		expect(textRecordResource(node, 'suwappu.policy')).toBe(expected)
	})
	test('textPart(key) = keccak256(bytes(key))', () => {
		expect(textPart('avatar')).toBe(keccak256(Buffer.from('avatar', 'utf8')))
	})
	test('different keys map to different resources', () => {
		const node = namehash('clanker.suwappu.eth')
		expect(textRecordResource(node, 'suwappu.policy')).not.toBe(textRecordResource(node, 'avatar'))
	})
})

describe('agent authorization invariant', () => {
	test('default writable keys exclude the policy key', () => {
		expect(AGENT_WRITABLE_KEYS).not.toContain(TEXT_KEYS.policy)
		assertAgentKeysSafe(AGENT_WRITABLE_KEYS, TEXT_KEYS.policy)
	})
	test('authorizing the policy key throws', () => {
		expect(() => assertAgentKeysSafe(['avatar', TEXT_KEYS.policy], TEXT_KEYS.policy)).toThrow('SECURITY')
	})
	test('authorizing any suwappu.* key throws', () => {
		expect(() => assertAgentKeysSafe(['suwappu.risk'], TEXT_KEYS.policy)).toThrow('SECURITY')
	})
	test('empty agent root grant is safe; anything else throws', () => {
		assertAgentRootGrantSafe(0n)
		expect(() => assertAgentRootGrantSafe(adminOf(RESOLVER_ROLES.SET_TEXT))).toThrow('SECURITY')
		expect(() => assertAgentRootGrantSafe(RESOLVER_ROLES.CLEAR)).toThrow('SECURITY')
		expect(() => assertAgentRootGrantSafe(RESOLVER_ROLES.SET_TEXT)).toThrow('SECURITY')
	})
})

describe('dnsEncode', () => {
	test('encodes clanker.suwappu.eth to DNS wire format', () => {
		// 7 "clanker" 7 "suwappu" 3 "eth" 0
		expect(dnsEncode('clanker.suwappu.eth')).toBe(
			'0x07636c616e6b657207737577617070750365746800',
		)
	})
	test('rejects empty labels', () => {
		expect(() => dnsEncode('clanker..eth')).toThrow()
	})
})

describe('calldata encoding matches canonical ABIs', () => {
	const node = namehash('clanker.suwappu.eth')

	test('setText selector matches canonical signature', () => {
		const sel = toFunctionSelector('setText(bytes32,string,string)')
		const encoded = encodeSetText(node, TEXT_KEYS.policy, '{"maxTxUsd":50}')
		expect(encoded.slice(0, 10)).toBe(sel)
		// cross-check full encoding via viem directly
		const expected = encodeFunctionData({
			abi: [{ type: 'function', name: 'setText', stateMutability: 'nonpayable', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }], outputs: [] }],
			functionName: 'setText',
			args: [node, TEXT_KEYS.policy, '{"maxTxUsd":50}'],
		})
		expect(encoded).toBe(expected)
	})

	test('initialize selector matches canonical signature', () => {
		const sel = toFunctionSelector('initialize(address,uint256,bytes[])')
		const admin = '0x1111111111111111111111111111111111111111' as const
		const setters = [encodeSetText(node, TEXT_KEYS.policy, '{}')]
		const encoded = encodeResolverInit(admin, adminOf(RESOLVER_ROLES.SET_TEXT), setters)
		expect(encoded.slice(0, 10)).toBe(sel)
	})

	test('grantRoles calldata layout is (anyId, roleBitmap, account)', () => {
		// IEnhancedAccessControl: grantRoles(uint256 resource, uint256 roleBitmap, address account).
		// PermissionedRegistry overrides the first param as `anyId` and maps it
		// to the resource internally — positional order is unchanged.
		const anyId = BigInt(node)
		const bitmap = REGISTRY_ROLES.SET_RESOLVER
		const account = '0x2222222222222222222222222222222222222222' as const
		const encoded = encodeFunctionData({
			abi: [{ type: 'function', name: 'grantRoles', stateMutability: 'nonpayable', inputs: [{ name: 'anyId', type: 'uint256' }, { name: 'roleBitmap', type: 'uint256' }, { name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }] }],
			functionName: 'grantRoles',
			args: [anyId, bitmap, account],
		})
		const words = encoded.slice(10) // strip selector
		expect('0x' + words.slice(0, 64)).toBe('0x' + anyId.toString(16).padStart(64, '0'))
		expect('0x' + words.slice(64, 128)).toBe('0x' + bitmap.toString(16).padStart(64, '0'))
		expect('0x' + words.slice(128, 192)).toBe('0x' + '0'.repeat(24) + account.slice(2).toLowerCase())
	})
})

import { describe, expect, test } from 'bun:test'
import { decodeFunctionData, toFunctionSelector } from 'viem'
import { AGENT_WRITABLE_KEYS } from '../src/ensv2/addresses.ts'
import { dnsEncode } from '../src/ensv2/resolver.ts'
import { encodeGrantSetterRoles, encodeMulticall } from '../src/ensv2/register.ts'

const AGENT = '0x3333333333333333333333333333333333333333' as const
const NAME = 'clanker.suwappu.eth'

describe('gas: authorize batching', () => {
	test('grantSetterRoles selector matches canonical signature', () => {
		const sel = toFunctionSelector('grantSetterRoles(bytes,address)')
		expect(encodeGrantSetterRoles(NAME, 'avatar', AGENT).slice(0, 10)).toBe(sel)
	})

	test('multicall selector matches IMulticallable', () => {
		const sel = toFunctionSelector('multicall(bytes[])')
		expect(encodeMulticall([]).slice(0, 10)).toBe(sel)
	})

	test('all agent keys batch into one multicall with correct args', () => {
		const calls = AGENT_WRITABLE_KEYS.map((k) => encodeGrantSetterRoles(NAME, k, AGENT))
		expect(calls.length).toBe(AGENT_WRITABLE_KEYS.length)

		const batched = encodeMulticall(calls)
		const decoded = decodeFunctionData({
			abi: [
				{
					type: 'function',
					name: 'multicall',
					inputs: [{ name: 'calls', type: 'bytes[]' }],
					outputs: [],
				},
			],
			data: batched,
		})
		expect(decoded.functionName).toBe('multicall')
		const inner = (decoded.args as [`0x${string}`[]])[0]
		expect(inner.length).toBe(calls.length)

		// each inner call decodes back to (setter, account); the setter is an
		// encoded setText(dnsName, key, "") — the grant is key-scoped onchain
		const seenKeys = new Set<string>()
		for (const call of inner) {
			const d = decodeFunctionData({
				abi: [
					{
						type: 'function',
						name: 'grantSetterRoles',
						inputs: [
							{ name: 'setter', type: 'bytes' },
							{ name: 'account', type: 'address' },
						],
						outputs: [],
					},
				],
				data: call,
			})
			const [setter, account] = d.args as [`0x${string}`, string]
			const s = decodeFunctionData({
				abi: [
					{
						type: 'function',
						name: 'setText',
						inputs: [
							{ name: 'name', type: 'bytes' },
							{ name: 'key', type: 'string' },
							{ name: 'value', type: 'string' },
						],
						outputs: [],
					},
				],
				data: setter,
			})
			const [dnsName, key] = s.args as [`0x${string}`, string, string]
			expect(dnsName).toBe(dnsEncode(NAME))
			expect(account.toLowerCase()).toBe(AGENT.toLowerCase())
			seenKeys.add(key)
		}
		expect(seenKeys).toEqual(new Set(AGENT_WRITABLE_KEYS))
	})

	test('policy key is never in the batch (defense in depth)', () => {
		const calls = AGENT_WRITABLE_KEYS.map((k) => encodeGrantSetterRoles(NAME, k, AGENT))
		const joined = calls.join('').toLowerCase()
		// "suwappu.policy" must not appear in any batched calldata
		expect(joined).not.toContain(Buffer.from('suwappu.policy').toString('hex'))
	})
})

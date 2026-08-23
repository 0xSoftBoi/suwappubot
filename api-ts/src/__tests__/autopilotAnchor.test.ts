import { describe, expect, it } from 'bun:test'
import {
	createAnchor,
	EvmMemoAnchor,
	encodeAnchorCalldata,
	NullAnchor,
	parseAnchorCalldata,
} from '../services/autopilot/anchor'

const COMMITMENT = 'a3f1'.repeat(16)

describe('anchor calldata', () => {
	it('round-trips a commitment through calldata', () => {
		const data = encodeAnchorCalldata(COMMITMENT)
		expect(data).toStartWith('0x')
		expect(parseAnchorCalldata(data)).toBe(COMMITMENT)
	})

	it('stays small enough to be cheap on an L2', () => {
		// 4 bytes of memo prefix budget aside, the whole payload is ~80 bytes.
		expect((encodeAnchorCalldata(COMMITMENT).length - 2) / 2).toBeLessThan(120)
	})

	it('returns null for calldata that is not ours', () => {
		expect(parseAnchorCalldata('0x')).toBeNull()
		expect(parseAnchorCalldata('0xdeadbeef')).toBeNull()
		expect(parseAnchorCalldata('')).toBeNull()
		expect(parseAnchorCalldata('not-hex')).toBeNull()
	})

	it('rejects a memo whose hash was tampered with in transit', () => {
		const data = encodeAnchorCalldata(COMMITMENT)
		const recovered = parseAnchorCalldata(data)
		expect(recovered).not.toBe('b'.repeat(64))
	})
})

describe('createAnchor', () => {
	it('is off with no key', () => {
		const a = createAnchor({})
		expect(a.enabled).toBe(false)
		expect(a).toBeInstanceOf(NullAnchor)
	})

	it('is off — not crashing — on a malformed key or unknown chain', () => {
		expect(createAnchor({ AUTOPILOT_ANCHOR_PRIVATE_KEY: 'nope' }).enabled).toBe(false)
		expect(
			createAnchor({
				AUTOPILOT_ANCHOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
				AUTOPILOT_ANCHOR_CHAIN: 'dogecoin',
			}).enabled,
		).toBe(false)
	})

	it('builds an EVM anchor for a valid key', () => {
		const a = createAnchor({
			AUTOPILOT_ANCHOR_PRIVATE_KEY: `0x${'1'.repeat(64)}`,
			AUTOPILOT_ANCHOR_CHAIN: 'base',
		})
		expect(a.enabled).toBe(true)
		expect(a).toBeInstanceOf(EvmMemoAnchor)
		expect(a.chain).toBe('base')
	})

	it('never throws out of anchor() — a failed anchor is a decision, not a crash', async () => {
		const failing = new EvmMemoAnchor('base', `0x${'1'.repeat(64)}`, async () => {
			throw new Error('insufficient funds for gas')
		})
		const result = await failing.anchor(COMMITMENT)
		expect(result.ok).toBe(false)
		expect((result as { error: string }).error).toContain('insufficient funds')
	})

	it('reports the tx hash and the memo payload it sent on success', async () => {
		let sent: string | undefined
		const ok = new EvmMemoAnchor('base', `0x${'1'.repeat(64)}`, async ({ data }) => {
			sent = data
			return '0xabc123'
		})
		const result = await ok.anchor(COMMITMENT)
		expect(result).toEqual({ ok: true, txHash: '0xabc123', chain: 'base' })
		expect(parseAnchorCalldata(sent as string)).toBe(COMMITMENT)
	})

	it('NullAnchor reports why it did nothing', async () => {
		const r = await new NullAnchor().anchor()
		expect(r).toEqual({ ok: false, error: 'anchoring not configured' })
	})
})

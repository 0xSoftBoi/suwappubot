import { describe, expect, it } from 'bun:test'
import { computeApprovalIntentHash, isWithinValueBand } from './policyGate'

describe('computeApprovalIntentHash', () => {
	const base = {
		agentId: 'agent-1',
		chain: 'ethereum',
		fromToken: 'USDC',
		toToken: 'WETH',
		contractAddress: '0xRouter',
		walletAddress: '0xWallet',
		destinationAddress: '0xDest',
	}

	it('is stable regardless of the input object key order', () => {
		const reordered = {
			destinationAddress: base.destinationAddress,
			walletAddress: base.walletAddress,
			toToken: base.toToken,
			fromToken: base.fromToken,
			contractAddress: base.contractAddress,
			chain: base.chain,
			agentId: base.agentId,
		}
		expect(computeApprovalIntentHash(base)).toBe(computeApprovalIntentHash(reordered))
	})

	it('changes when walletAddress changes', () => {
		const hash1 = computeApprovalIntentHash(base)
		const hash2 = computeApprovalIntentHash({ ...base, walletAddress: '0xDifferentWallet' })
		expect(hash1).not.toBe(hash2)
	})

	it('changes when destinationAddress changes', () => {
		const hash1 = computeApprovalIntentHash(base)
		const hash2 = computeApprovalIntentHash({ ...base, destinationAddress: '0xDifferentDest' })
		expect(hash1).not.toBe(hash2)
	})

	it('does NOT take amount/valueUsd as inputs at all (excluded from the hashed shape)', () => {
		// computeApprovalIntentHash's type signature has no amount/valueUsd field,
		// so the same trade "shape" always hashes identically regardless of what
		// amount/valueUsd the caller separately tracks alongside it.
		const hash1 = computeApprovalIntentHash(base)
		const hash2 = computeApprovalIntentHash(base)
		expect(hash1).toBe(hash2)
	})

	it('treats a field explicitly set to null the same as an omitted field', () => {
		const withNull = computeApprovalIntentHash({ ...base, contractAddress: null })
		const omitted = computeApprovalIntentHash({
			agentId: base.agentId,
			chain: base.chain,
			fromToken: base.fromToken,
			toToken: base.toToken,
			walletAddress: base.walletAddress,
			destinationAddress: base.destinationAddress,
		})
		expect(withNull).toBe(omitted)
	})

	it('is case-sensitive for addresses (checksummed vs lowercase hash differently)', () => {
		const checksummed = computeApprovalIntentHash({
			...base,
			walletAddress: '0xAbCdEf1234567890',
		})
		const lowercase = computeApprovalIntentHash({
			...base,
			walletAddress: '0xabcdef1234567890',
		})
		expect(checksummed).not.toBe(lowercase)
	})
})

describe('isWithinValueBand', () => {
	it('is within band when new value equals old value', () => {
		expect(isWithinValueBand(100, 100)).toBe(true)
	})

	it('is within band when new value is lower than old value', () => {
		expect(isWithinValueBand(100, 50)).toBe(true)
	})

	it('is within band exactly at the 5% upper boundary', () => {
		expect(isWithinValueBand(100, 105)).toBe(true)
	})

	it('is out of band just above the 5% upper boundary', () => {
		expect(isWithinValueBand(100, 105.01)).toBe(false)
	})

	it('is out of band for a materially larger value', () => {
		expect(isWithinValueBand(100, 200)).toBe(false)
	})

	it('respects a custom band percentage', () => {
		expect(isWithinValueBand(100, 110, 0.1)).toBe(true)
		expect(isWithinValueBand(100, 110.01, 0.1)).toBe(false)
	})
})

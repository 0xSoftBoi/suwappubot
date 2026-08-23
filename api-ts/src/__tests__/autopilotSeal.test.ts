import { describe, expect, it } from 'bun:test'
import {
	canonicalize,
	computeCommitment,
	generateNonce,
	parseSealMemo,
	SEAL_ALGO,
	seal,
	sealMemo,
	verifySeal,
} from '../lib/seal'

const thesis = {
	action: 'buy',
	symbol: 'CATE',
	sizeUsd: 25,
	confidence: 0.72,
	evidence: { liquidityUsd: 180000, holders: 4200 },
}

describe('canonicalize', () => {
	it('is insensitive to key insertion order', () => {
		expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
		expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
	})

	it('sorts nested keys too', () => {
		expect(canonicalize({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}')
	})

	it('drops undefined properties but preserves array holes as null', () => {
		expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}')
		expect(canonicalize([1, undefined, 3])).toBe('[1,null,3]')
	})

	it('refuses non-finite numbers rather than silently hashing null', () => {
		expect(() => canonicalize({ a: Number.NaN })).toThrow()
		expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow()
	})
})

describe('commit-reveal', () => {
	it('produces a stable 64-hex commitment', () => {
		const nonce = 'a'.repeat(64)
		const c = computeCommitment(thesis, nonce)
		expect(c).toMatch(/^[0-9a-f]{64}$/)
		expect(computeCommitment(thesis, nonce)).toBe(c)
	})

	it('changes when the thesis changes', () => {
		const nonce = generateNonce()
		const a = computeCommitment(thesis, nonce)
		const b = computeCommitment({ ...thesis, sizeUsd: 26 }, nonce)
		expect(a).not.toBe(b)
	})

	it('changes when the nonce changes (commitment is blinded)', () => {
		expect(computeCommitment(thesis, generateNonce())).not.toBe(
			computeCommitment(thesis, generateNonce()),
		)
	})

	it('round-trips through seal/verifySeal', () => {
		const s = seal(thesis)
		expect(s.algo).toBe(SEAL_ALGO)
		expect(verifySeal(thesis, s.nonce, s.commitment)).toBe(true)
	})

	it('rejects a tampered thesis, a wrong nonce, and malformed input', () => {
		const s = seal(thesis)
		expect(verifySeal({ ...thesis, sizeUsd: 9999 }, s.nonce, s.commitment)).toBe(false)
		expect(verifySeal(thesis, generateNonce(), s.commitment)).toBe(false)
		expect(verifySeal(thesis, s.nonce, 'not-a-hash')).toBe(false)
		expect(verifySeal(thesis, s.nonce, '')).toBe(false)
	})

	it('verifies regardless of property order in the revealed object', () => {
		const s = seal({ a: 1, b: { c: 2, d: 3 } })
		expect(verifySeal({ b: { d: 3, c: 2 }, a: 1 }, s.nonce, s.commitment)).toBe(true)
	})

	it('requires a nonce', () => {
		expect(() => computeCommitment(thesis, '')).toThrow()
	})
})

describe('string encoding is part of the spec', () => {
	// A live thesis reads "… (score 0.68) — the engine fades parabolic moves …".
	// Python's json.dumps would render that em dash as \u2014 and compute a
	// different digest from identical data, which looks like a forged commitment
	// rather than a library default. Pin the raw-UTF-8 behaviour.
	const emDash = { reasoning: 'depth is rising — the move is not vertical' }

	it('emits non-ASCII raw, not \\uXXXX-escaped', () => {
		const c = canonicalize(emDash)
		expect(c).toContain('—')
		expect(c).not.toContain('\\u2014')
	})

	it('still verifies a thesis carrying non-ASCII text', () => {
		const s = seal(emDash)
		expect(verifySeal(emDash, s.nonce, s.commitment)).toBe(true)
	})

	it('an escaped rendering of the same data is a different pre-image', () => {
		// What an ensure_ascii=True implementation would hash.
		const escaped = '{"reasoning":"depth is rising \\u2014 the move is not vertical"}'
		expect(canonicalize(emDash)).not.toBe(escaped)
	})

	it('handles the other characters a thesis picks up', () => {
		for (const text of ['naïve', 'ドル', '🚀 up', 'a\tb', 'quote " inside']) {
			const value = { reasoning: text }
			const s = seal(value)
			expect(verifySeal(value, s.nonce, s.commitment)).toBe(true)
		}
	})
})

describe('on-chain memo', () => {
	it('round-trips', () => {
		const s = seal(thesis)
		const memo = sealMemo(s.commitment)
		expect(memo.length).toBeLessThanOrEqual(200)
		expect(parseSealMemo(memo)).toEqual({ algo: SEAL_ALGO, commitment: s.commitment })
	})

	it('rejects junk', () => {
		expect(parseSealMemo('hello')).toBeNull()
		expect(parseSealMemo('suwappu-autopilot:v1:sha256-canonical-v1:abc')).toBeNull()
	})
})

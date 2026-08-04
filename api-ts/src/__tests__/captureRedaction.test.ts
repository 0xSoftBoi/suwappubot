import { describe, expect, it } from 'bun:test'
import { screenForSecrets } from '../utils/captureRedaction'

describe('screenForSecrets', () => {
	it('flags a 12-word BIP-39-shaped mnemonic', () => {
		const mnemonic =
			'abandon ability able about above absent absorb abstract absurd abuse access accident'
		const result = screenForSecrets(mnemonic)
		expect(result.unsafe).toBe(true)
		expect(result.reason).toBe('secret_detected')
	})

	it('flags a 24-word BIP-39-shaped mnemonic', () => {
		const words = [
			'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
			'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
			'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
		]
		expect(words.length).toBe(24)
		const result = screenForSecrets(words.join(' '))
		expect(result.unsafe).toBe(true)
	})

	it('flags a 0x-prefixed 64-hex private key', () => {
		const key = `0x${'ab'.repeat(32)}`
		const result = screenForSecrets(`here is my key ${key} please help`)
		expect(result.unsafe).toBe(true)
		expect(result.reason).toBe('secret_detected')
	})

	it('flags a bare 64-hex private key', () => {
		const key = 'cd'.repeat(32)
		const result = screenForSecrets(`private key: ${key}`)
		expect(result.unsafe).toBe(true)
	})

	it('allows a normal trading sentence', () => {
		const result = screenForSecrets('swap 0.5 eth to usdc on base')
		expect(result.unsafe).toBe(false)
	})

	it('allows a sentence containing a wallet address', () => {
		// 0x + 40 hex chars (20 bytes) — a real EVM address length, NOT a 64-hex
		// private key. Must be treated as safe, ordinary trading input.
		const result = screenForSecrets(
			'send 100 usdc to 0x807a118a84f785955c5b9ffbc59ca0361669bd11 please',
		)
		expect(result.unsafe).toBe(false)
	})

	// FIX 1: 128-hex-char hex-encoded ed25519/Solana keypair. A \b-anchored
	// exactly-64 pattern cannot match mid-run of a longer hex string, so this
	// previously slipped through in CLEARTEXT. The {64,} lookaround form must
	// catch it.
	it('flags a 128-hex hex-encoded ed25519/Solana keypair', () => {
		const key = 'ab'.repeat(64)
		expect(key.length).toBe(128)
		const result = screenForSecrets(`here is my secret key ${key} thanks`)
		expect(result.unsafe).toBe(true)
		expect(result.reason).toBe('secret_detected')
	})

	it('flags a bare 64-hex private key embedded mid-sentence', () => {
		const key = 'cd'.repeat(32)
		expect(key.length).toBe(64)
		const result = screenForSecrets(`private key: ${key}`)
		expect(result.unsafe).toBe(true)
	})

	it('does NOT flag a 40-hex EVM address as unsafe (regression floor)', () => {
		const address = '807a118a84f785955c5b9ffbc59ca0361669bd11'
		expect(address.length).toBe(40)
		const result = screenForSecrets(`swap to 0x${address} please`)
		expect(result.unsafe).toBe(false)
	})

	// FIX 2: mnemonic detection must fire on a consecutive run of >=11
	// wordlike tokens even when it is NOT the entire message (matches the
	// Python _MIN_CONSECUTIVE_WORDLIKE_TOKENS fallback in
	// bot/utils/capture_redaction.py).
	it('flags a 12-word mnemonic embedded in a longer sentence', () => {
		const mnemonic =
			'abandon ability able about above absent absorb abstract absurd abuse access accident'
		const result = screenForSecrets(`here is my seed phrase: ${mnemonic} - keep it safe please`)
		expect(result.unsafe).toBe(true)
		expect(result.reason).toBe('secret_detected')
	})

	it('does not flag an ordinary long sentence without a wordlike run >= 11', () => {
		const result = screenForSecrets(
			'I would like to swap 0.5 eth for usdc on base and then bridge to arbitrum please if you can help me out today',
		)
		expect(result.unsafe).toBe(false)
	})
})

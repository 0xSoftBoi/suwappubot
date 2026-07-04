import { describe, expect, it } from 'bun:test'
import { assertSenderBound, consumePayment, paymentKey } from '../lib/paymentConsumption'

/**
 * Regression tests for the x402 on-chain payment replay / sender-spoof /
 * cross-table double-redeem vuln.
 *
 * These exercise the two shared guards every redemption path now uses:
 *   - consumePayment(): a SINGLE global (chain, txHash) ledger — one payment is
 *     consumable exactly once, ACROSS paths (topup, subscribe, webapp, mpp).
 *   - assertSenderBound(): the on-chain payer must be a wallet bound to the caller.
 *
 * Before the fix these helpers did not exist and each redemption path relied on
 * its OWN per-table unique(tx_hash) guard (so a payment could be redeemed once
 * per table) with no sender check — this suite fails to even import against the
 * pre-fix tree, and the assertions below encode the required post-fix behavior.
 */

// --- Minimal in-memory stand-in for a Drizzle tx honoring the (chain,txHash)
//     UNIQUE constraint used by consumed_payments. Mirrors
//     insert().values().onConflictDoNothing().returning() semantics: a row whose
//     key already exists inserts nothing and returns []. ---
function makeFakeLedger() {
	const seen = new Set<string>()
	let nextId = 1
	const tx = {
		insert: (_table: unknown) => ({
			values: (v: { chain: string; txHash: string }) => ({
				onConflictDoNothing: (_cfg: { target: unknown[] }) => ({
					returning: async (_cols: unknown) => {
						const key = paymentKey(v.chain, v.txHash)
						if (seen.has(key)) return [] // unique violation → nothing inserted
						seen.add(key)
						return [{ id: nextId++ }]
					},
				}),
			}),
		}),
	}
	return { tx, seen }
}

describe('consumePayment — global (chain,txHash) replay/double-redeem guard', () => {
	const CHAIN = 'base'
	const TX = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

	it('lets the first redemption win and consumes the payment', async () => {
		const { tx } = makeFakeLedger()
		const first = await consumePayment(tx as any, {
			chain: CHAIN,
			txHash: TX,
			purpose: 'agent_topup',
		})
		expect(first).toBe(true)
	})

	it('rejects the SAME (chain,txHash) redeemed a second time across a DIFFERENT path', async () => {
		const { tx } = makeFakeLedger()
		// Path 1: agent credit topup consumes the payment.
		const topup = await consumePayment(tx as any, {
			chain: CHAIN,
			txHash: TX,
			purpose: 'agent_topup',
		})
		// Path 2: webapp crypto subscription tries to reuse the same payment.
		const webappSub = await consumePayment(tx as any, {
			chain: CHAIN,
			txHash: TX,
			purpose: 'webapp_subscribe',
		})
		expect(topup).toBe(true)
		expect(webappSub).toBe(false) // second path MUST NOT be credited
	})

	it('treats txHash case-insensitively (no bypass by re-casing the hash)', async () => {
		const { tx } = makeFakeLedger()
		const a = await consumePayment(tx as any, { chain: CHAIN, txHash: TX, purpose: 'mpp_swap' })
		const b = await consumePayment(tx as any, {
			chain: CHAIN,
			txHash: TX.toUpperCase(),
			purpose: 'mpp_swap',
		})
		expect(a).toBe(true)
		expect(b).toBe(false)
	})

	it('allows the same txHash on a DIFFERENT chain (key is chain-scoped)', async () => {
		const { tx } = makeFakeLedger()
		const onBase = await consumePayment(tx as any, {
			chain: 'base',
			txHash: TX,
			purpose: 'agent_topup',
		})
		const onTempo = await consumePayment(tx as any, {
			chain: 'tempo',
			txHash: TX,
			purpose: 'agent_topup',
		})
		expect(onBase).toBe(true)
		expect(onTempo).toBe(true)
	})
})

describe('assertSenderBound — sender-spoof defense', () => {
	const MINE = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
	const VICTIM = '0x1111111111111111111111111111111111111111'

	it('accepts a payment whose sender is one of the caller-bound wallets (case-insensitive)', () => {
		expect(assertSenderBound(MINE.toLowerCase(), [MINE])).toBe(true)
		expect(assertSenderBound(MINE, [VICTIM, MINE.toLowerCase()])).toBe(true)
	})

	it("rejects a payment sent by someone else's wallet (the spoof attempt)", () => {
		expect(assertSenderBound(VICTIM, [MINE])).toBe(false)
	})

	it('fails closed when the sender is unknown/unparseable or no wallets are bound', () => {
		expect(assertSenderBound(null, [MINE])).toBe(false)
		expect(assertSenderBound(undefined, [MINE])).toBe(false)
		expect(assertSenderBound('not-an-address', [MINE])).toBe(false)
		expect(assertSenderBound(MINE, [])).toBe(false)
	})
})

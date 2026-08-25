import { describe, expect, it } from 'bun:test'
import { formatUnits, isRetryable, verifyBurn } from '../services/tenantBots/burnVerify'
import { caveatsFor, headline, type ProofRun, summarise } from '../services/tenantBots/proof'

/**
 * Independent verification of a burn.
 *
 * The response fixtures here are shaped from real Blockscout mainnet data
 * captured while building this, not from the docs — the `total.value` /
 * `total.decimals` split and the `token.address_hash` field are both easy to
 * get subtly wrong from a spec.
 *
 * The case that matters most is `mismatch`: a transaction that succeeded but
 * did not deliver the token to the burn address. Without this check such a run
 * sits on the public page as a success forever, which is the precise failure
 * the proof surface exists to prevent.
 */

const TOKEN = '0xbEEf3bB9dA340EbdF0f5bae2E85368140d7D85D0'
const BURN = '0x000000000000000000000000000000000000dEaD'
const TX = `0x${'a'.repeat(64)}`

function transfer(over: Record<string, unknown> = {}) {
	return {
		from: '0xE26c5cD8321A7e47327559f795193E57F53E8Ef3',
		to: BURN,
		status: 'success',
		timestamp: '2026-08-25T18:30:11.000000Z',
		total: { value: '1115609398956947883', decimals: '18' },
		token: { address_hash: TOKEN, symbol: 'MORE', decimals: '18' },
		block_number: 25834012,
		...over,
	}
}

function fetchReturning(body: unknown, status = 200): typeof fetch {
	return (async () =>
		({
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		}) as unknown as Response) as unknown as typeof fetch
}

const base = { chain: 'ethereum', txHash: TX, tokenAddress: TOKEN, burnAddress: BURN }

describe('verified — the transfer really is on-chain', () => {
	it('confirms a matching transfer and reports the chain amount', async () => {
		const r = await verifyBurn({
			...base,
			fetchImpl: fetchReturning({ items: [transfer()] }),
		})
		expect(r.status).toBe('verified')
		// The amount comes from the chain, never from what we intended to spend.
		expect(r.amountRaw).toBe('1115609398956947883')
		expect(r.amountHuman).toBe('1.115609')
		expect(r.blockNumber).toBe(25834012)
		expect(r.tokenSymbol).toBe('MORE')
	})

	it('matches regardless of address casing', async () => {
		const r = await verifyBurn({
			...base,
			tokenAddress: TOKEN.toLowerCase(),
			burnAddress: BURN.toUpperCase(),
			fetchImpl: fetchReturning({ items: [transfer()] }),
		})
		expect(r.status).toBe('verified')
	})

	it('finds the burn among unrelated transfers in the same transaction', async () => {
		// A swap-and-burn produces several transfers; ours is one of them.
		const r = await verifyBurn({
			...base,
			fetchImpl: fetchReturning({
				items: [
					transfer({ to: '0x1111111111111111111111111111111111111111' }),
					transfer({ token: { address_hash: '0xdeadbeef', symbol: 'OTHER', decimals: '18' } }),
					transfer(),
				],
			}),
		})
		expect(r.status).toBe('verified')
	})
})

describe('mismatch — the reason this module exists', () => {
	it('catches a transaction that sent nothing to the burn address', async () => {
		const r = await verifyBurn({
			...base,
			fetchImpl: fetchReturning({
				items: [transfer({ to: '0x1111111111111111111111111111111111111111' })],
			}),
		})
		expect(r.status).toBe('mismatch')
		expect(r.detail).toContain('sent nothing to the burn address')
	})

	it('catches a burn of the wrong token', async () => {
		// Tokens reached the sink, but not this project's — a real routing bug
		// that would otherwise read as a successful burn.
		const r = await verifyBurn({
			...base,
			fetchImpl: fetchReturning({
				items: [transfer({ token: { address_hash: '0xother', symbol: 'NOT', decimals: '18' } })],
			}),
		})
		expect(r.status).toBe('mismatch')
		expect(r.detail).toContain("not this project's token")
	})

	it('catches a transaction that moved no tokens at all', async () => {
		const r = await verifyBurn({ ...base, fetchImpl: fetchReturning({ items: [] }) })
		expect(r.status).toBe('mismatch')
	})

	it('never retries a mismatch — it is a finding, not a hiccup', () => {
		expect(isRetryable('mismatch')).toBe(false)
		expect(isRetryable('verified')).toBe(false)
		expect(isRetryable('not_found')).toBe(true)
		expect(isRetryable('unavailable')).toBe(true)
	})
})

describe('degrading safely', () => {
	it('reports not_found for an unknown transaction', async () => {
		const r = await verifyBurn({ ...base, fetchImpl: fetchReturning({}, 404) })
		expect(r.status).toBe('not_found')
	})

	it('reports unavailable — never mismatch — when the explorer is down', async () => {
		// Failing to check is not evidence a burn did not happen. Recording it as
		// a failure would be its own dishonesty.
		const r = await verifyBurn({ ...base, fetchImpl: fetchReturning({}, 503) })
		expect(r.status).toBe('unavailable')
	})

	it('reports unavailable when the fetch throws', async () => {
		const r = await verifyBurn({
			...base,
			fetchImpl: (async () => {
				throw new Error('network down')
			}) as unknown as typeof fetch,
		})
		expect(r.status).toBe('unavailable')
	})

	it('refuses to guess on an unknown chain', async () => {
		const r = await verifyBurn({ ...base, chain: 'dogechain' })
		expect(r.status).toBe('unsupported_chain')
	})

	it('rejects a malformed transaction hash without a network call', async () => {
		const r = await verifyBurn({
			...base,
			txHash: 'not-a-hash',
			fetchImpl: (() => {
				throw new Error('should not be called')
			}) as unknown as typeof fetch,
		})
		expect(r.status).toBe('not_found')
	})
})

describe('formatUnits keeps integer precision', () => {
	it('formats common amounts', () => {
		expect(formatUnits('2264640579815099281380', 18)).toBe('2,264.640579')
		expect(formatUnits('50000000', 6)).toBe('50')
		expect(formatUnits('4000000000000000000000', 18)).toBe('4,000')
		expect(formatUnits('0', 18)).toBe('0')
	})

	it('never renders a non-zero amount as zero', () => {
		// Truncating to 6 places showed 1 wei as "0.000000". Understating a burn
		// to nothing is the same failure as overstating it.
		expect(formatUnits('1', 18)).not.toMatch(/^0(\.0+)?$/)
		expect(formatUnits('1', 18)).toBe('0.000000000000000001')
		expect(formatUnits('1000000000000', 18)).toBe('0.000001')
	})
})

describe('the proof page reflects the chain, not our claims', () => {
	const at = (iso: string) => new Date(iso)
	const run = (over: Partial<ProofRun> = {}): ProofRun => ({
		status: 'succeeded',
		reason: null,
		spendUsd: 50,
		tokenAmount: '1.2M',
		txHash: '0xabc',
		startedAt: at('2026-08-25T10:00:00Z'),
		verification: 'verified',
		...over,
	})

	it('counts confirmed and failed verifications separately', () => {
		const t = summarise([run(), run({ verification: 'mismatch' }), run({ verification: 'pending' })])
		expect(t.executedRuns).toBe(3)
		expect(t.confirmedRuns).toBe(1)
		expect(t.failedVerificationRuns).toBe(1)
	})

	it('says so in the headline when a run failed verification', () => {
		const h = headline(summarise([run(), run({ verification: 'mismatch' })]), 'buy_and_burn', 'PEPE')
		expect(h).toContain('unconfirmed by the chain')
	})

	it('only claims full confirmation when every run is confirmed', () => {
		expect(headline(summarise([run(), run()]), 'buy_and_burn', 'PEPE')).toContain(
			'all confirmed on-chain',
		)
		expect(
			headline(summarise([run(), run({ verification: 'pending' })]), 'buy_and_burn', 'PEPE'),
		).not.toContain('all confirmed')
	})

	it('raises a caveat naming the failed runs', () => {
		const c = caveatsFor({
			totals: summarise([run(), run({ verification: 'mismatch' })]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now: at('2026-08-25T12:00:00Z'),
		})
		const failed = c.find((x) => x.code === 'failed_verification')
		expect(failed).toBeDefined()
		expect(failed!.text).toContain('did NOT')
		expect(failed!.text).toContain('Money left')
	})

	it('flags runs still awaiting confirmation', () => {
		const c = caveatsFor({
			totals: summarise([run({ verification: 'pending' })]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now: at('2026-08-25T12:00:00Z'),
		})
		expect(c.find((x) => x.code === 'unconfirmed')).toBeDefined()
	})

	it('raises no confirmation caveat when everything is confirmed', () => {
		const c = caveatsFor({
			totals: summarise([run(), run()]),
			fundingSource: 'revenue',
			kind: 'buy_and_burn',
			recentFailures: 0,
			now: at('2026-08-25T12:00:00Z'),
		})
		expect(c.find((x) => x.code === 'unconfirmed')).toBeUndefined()
		expect(c.find((x) => x.code === 'failed_verification')).toBeUndefined()
	})
})

/**
 * The live executor, against a stubbed agent API.
 *
 * This path has never run. Everything it does — quote parsing, idempotency,
 * the fill-price arithmetic, and above all which failures are recoverable —
 * happens with real money the first time it executes for real. These tests are
 * the difference between "the code compiles" and "we know what it does when
 * the API times out mid-swap".
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { ManagedExecutor } from '../services/autopilot/executor'
import type { ExecutionCall } from '../services/autopilot/types'

const realFetch = globalThis.fetch
afterEach(() => {
	globalThis.fetch = realFetch
})

const call: ExecutionCall = {
	chain: 'base',
	side: 'buy',
	fromToken: 'USDC',
	toToken: '0xdead',
	amountUsd: 100,
	slippageBps: 150,
	idempotencyKey: 'c'.repeat(64),
	referencePriceUsd: 2,
}

const exec = () => new ManagedExecutor({ apiBaseUrl: 'https://api.test', apiKey: 'k', timeoutMs: 500 })

/** Stub fetch: quote first, then execute. */
function stub(
	handlers: { quote?: () => Response | Promise<Response>; execute?: () => Response | Promise<Response> },
	seen?: { headers: Headers[]; bodies: string[] },
) {
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		if (seen && init) {
			seen.headers.push(new Headers(init.headers as HeadersInit))
			seen.bodies.push(String(init.body))
		}
		if (String(url).includes('/quote')) {
			return handlers.quote
				? await handlers.quote()
				: Response.json({ success: true, quote: { quote_id: 'q1', to_amount_human: 50 } })
		}
		return handlers.execute
			? await handlers.execute()
			: Response.json({ success: true, tx_hash: '0xabc' })
	}) as typeof fetch
}

describe('ManagedExecutor — the happy path', () => {
	it('quotes, executes, and derives the fill price from what it received', async () => {
		stub({})
		const r = await exec().execute(call)
		expect(r.ok).toBe(true)
		expect(r.paper).toBe(false)
		expect(r.txHash).toBe('0xabc')
		expect(r.quoteId).toBe('q1')
		// $100 for 50 tokens.
		expect(r.fillPriceUsd).toBe(2)
		expect(r.fillAmount).toBe('50')
	})

	it('sends the decision commitment as the idempotency key', async () => {
		// Our own API dedupes on this. It is the only thing standing between a
		// retry and a second swap.
		const seen = { headers: [] as Headers[], bodies: [] as string[] }
		stub({}, seen)
		await exec().execute(call)
		expect(seen.headers[1]!.get('Idempotency-Key')).toBe('c'.repeat(64))
	})
})

describe('ManagedExecutor — failures that definitely did not trade', () => {
	it('treats a rejected quote as a clean failure', async () => {
		stub({ quote: () => Response.json({ error: 'no route' }, { status: 400 }) })
		const r = await exec().execute(call)
		expect(r.ok).toBe(false)
		expect(r.mayHaveBroadcast).toBeFalsy()
		expect(r.error).toContain('no route')
	})

	it('treats a quote with no id as a clean failure', async () => {
		stub({ quote: () => Response.json({ success: true }) })
		const r = await exec().execute(call)
		expect(r.ok).toBe(false)
		expect(r.mayHaveBroadcast).toBeFalsy()
	})

	it('treats a 4xx on execute as a clean refusal', async () => {
		// Our API declining the order. Nothing was sent to a chain.
		stub({ execute: () => Response.json({ error: 'policy denied' }, { status: 403 }) })
		const r = await exec().execute(call)
		expect(r.ok).toBe(false)
		expect(r.mayHaveBroadcast).toBeFalsy()
		expect(r.quoteId).toBe('q1')
	})
})

describe('ManagedExecutor — failures that might have traded', () => {
	it('flags a timeout after the order was sent', async () => {
		// The case that loses money silently: the swap may be on chain and we will
		// never learn it from this response. `ok: false` alone is not enough —
		// the agent would book no position, still believe it holds the cash, and
		// spend it again next cycle.
		// What AbortSignal.timeout actually produces once the deadline passes: the
		// request is abandoned in flight, with no information about its fate.
		stub({
			execute: () => {
				throw new DOMException('The operation timed out.', 'TimeoutError')
			},
		})
		const r = await exec().execute(call)
		expect(r.ok).toBe(false)
		expect(r.mayHaveBroadcast).toBe(true)
		expect(r.error).toContain('unknown')
	})

	it('flags a 5xx on execute as unresolved', async () => {
		// Our API failing while holding the order tells us nothing about whether
		// it reached the chain first.
		stub({ execute: () => Response.json({ error: 'boom' }, { status: 502 }) })
		const r = await exec().execute(call)
		expect(r.ok).toBe(false)
		expect(r.mayHaveBroadcast).toBe(true)
	})

	it('flags a dropped connection on execute as unresolved', async () => {
		stub({
			execute: () => {
				throw new TypeError('network error')
			},
		})
		const r = await exec().execute(call)
		expect(r.ok).toBe(false)
		expect(r.mayHaveBroadcast).toBe(true)
	})
})

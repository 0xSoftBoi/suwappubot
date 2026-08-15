import { describe, expect, it, mock } from 'bun:test'
import { Effect } from 'effect'
import { COMMON_TOKENS, TokenServiceLive, TokenService } from '../services/TokenService'

// Helper: run resolveToken against the live service implementation.
const resolveToken = (symbol: string, chainId: number) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const svc = yield* TokenService
			return yield* svc.resolveToken(symbol, chainId)
		}).pipe(Effect.provide(TokenServiceLive)),
	)

// Build a Li.Fi-shaped response for a single (chainId, token) entry.
const lifiResponse = (chainId: number, token: Record<string, unknown>) =>
	new Response(JSON.stringify({ tokens: { [String(chainId)]: [token] } }), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	})

const withMockedFetch = async (response: Response, fn: () => Promise<unknown>) => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = Object.assign(mock(() => Promise.resolve(response)), {
		preconnect: originalFetch.preconnect,
	}) as typeof fetch
	try {
		return await fn()
	} finally {
		globalThis.fetch = originalFetch
	}
}

describe('TokenService.resolveToken Li.Fi validation', () => {
	it('rejects a malformed (non-hex / wrong length) address from Li.Fi', async () => {
		const result = await withMockedFetch(
			lifiResponse(100, { address: '0xNOTAVALIDADDRESS', symbol: 'BADTOKEN', decimals: 18, name: 'Bad', chainId: 100 }),
			() => resolveToken('BADTOKEN', 100),
		)
		expect(result).toBeNull()
	})

	it('rejects a Li.Fi token whose chainId does not match the requested chain', async () => {
		const result = await withMockedFetch(
			lifiResponse(100, {
				address: '0x1234567890123456789012345678901234567890',
				symbol: 'MISMATCH',
				decimals: 18,
				name: 'Mismatch',
				chainId: 1, // wrong chain
			}),
			() => resolveToken('MISMATCH', 100),
		)
		expect(result).toBeNull()
	})

	it('resolves a known symbol to the hardcoded address, ignoring a spoofed Li.Fi response', async () => {
		// USDC on Ethereum is in COMMON_TOKENS, so it is resolved via the trusted
		// early-return path and never reaches Li.Fi. Even when Li.Fi (mocked here)
		// returns a spoofed address, the hardcoded trusted address is returned,
		// proving known symbols cannot be spoofed.
		const trustedUsdc = COMMON_TOKENS[1]?.USDC
		const result = (await withMockedFetch(
			lifiResponse(1, { address: '0x000000000000000000000000000000000000dead', symbol: 'USDC', decimals: 6, name: 'USDC', chainId: 1 }),
			() => resolveToken('USDC', 1),
		)) as { address: string } | null
		expect(result?.address).toBe(trustedUsdc)
	})

	it('accepts a well-formed long-tail token from Li.Fi', async () => {
		const addr = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
		const result = (await withMockedFetch(
			lifiResponse(100, { address: addr, symbol: 'PEPE', decimals: 18, name: 'Pepe', chainId: 100 }),
			() => resolveToken('PEPE', 100),
		)) as { address: string } | null
		expect(result?.address).toBe(addr)
	})
})

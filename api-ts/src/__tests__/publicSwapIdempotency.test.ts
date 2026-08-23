import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'bun:test'
import type { NewSwapTransaction, SwapTransaction } from '../db'
import {
	derivePublicSwapIdempotencyKey,
	publicSwapReplayEnvelope,
} from '../routes/publicSwap'
import { differingSwapExecutionFields } from '../services/swapExecutionClaim'

function swapRecord(overrides: Partial<SwapTransaction> = {}): SwapTransaction {
	return {
		id: 42,
		userId: 7,
		fromChain: '8453',
		fromToken: 'USDC',
		fromAmount: '1000000',
		fromAmountUsd: 1,
		toChain: '8453',
		toToken: 'ETH',
		toAmount: '500000000000000',
		toAmountUsd: 1,
		realizedToAmount: null,
		realizedToAmountUsd: null,
		status: 'pending',
		txHash: null,
		bridgeTxHash: null,
		destinationTxHash: null,
		idempotencyKey: 'public-swap:7:key:abc',
		routeProvider: 'lifi',
		routeData: '{"route":"one"}',
		entryPriceUsd: null,
		toEntryPriceUsd: null,
		gasCostUsd: null,
		feeCostUsd: null,
		gasFee: 0.01,
		bridgeFee: 0,
		priceImprovementUsd: null,
		runnerUpProvider: null,
		slippage: 50,
		createdAt: new Date('2026-08-21T00:00:00.000Z'),
		updatedAt: new Date('2026-08-21T00:00:00.000Z'),
		completedAt: null,
		errorMessage: null,
		agentId: null,
		agentUuid: null,
		...overrides,
	}
}

function requested(overrides: Partial<NewSwapTransaction> = {}): NewSwapTransaction {
	return {
		userId: 7,
		fromChain: '8453',
		fromToken: 'USDC',
		fromAmount: '1000000',
		fromAmountUsd: 1,
		toChain: '8453',
		toToken: 'ETH',
		toAmount: '500000000000000',
		toAmountUsd: 1,
		status: 'pending',
		idempotencyKey: 'public-swap:7:key:abc',
		routeProvider: 'lifi',
		routeData: '{"route":"one"}',
		slippage: 50,
		gasFee: 0.01,
		bridgeFee: 0,
		...overrides,
	}
}

describe('public managed-swap idempotency', () => {
	it('scopes caller keys to the authenticated user', () => {
		const a = derivePublicSwapIdempotencyKey(7, 'quote-1', 'client-operation-1')
		const replay = derivePublicSwapIdempotencyKey(7, 'different-quote', 'client-operation-1')
		const otherUser = derivePublicSwapIdempotencyKey(8, 'quote-1', 'client-operation-1')

		expect(a).toBe(replay)
		expect(otherUser).not.toBe(a)
		expect(a).not.toContain('client-operation-1')
	})

	it('uses quote identity as a deterministic fallback for legacy callers', () => {
		const first = derivePublicSwapIdempotencyKey(7, 'quote-1')
		const retry = derivePublicSwapIdempotencyKey(7, 'quote-1')
		const newQuote = derivePublicSwapIdempotencyKey(7, 'quote-2')

		expect(first).toBe(retry)
		expect(newQuote).not.toBe(first)
		expect(first).toContain('public-swap:7:quote:')
	})

	it('returns submitted/completed replays without asking for another execution', () => {
		for (const status of ['submitted', 'completed'] as const) {
			const replay = publicSwapReplayEnvelope(swapRecord({ status, txHash: '0x123' }))
			expect(replay.httpStatus).toBe(200)
			expect(replay.body.idempotentReplay).toBe(true)
			expect(replay.body.reconcileRequired).toBe(false)
			expect(replay.body.swapId).toBe(42)
		}
	})

	it('freezes pending/signing/signed retries for reconciliation before signing again', () => {
		for (const status of ['pending', 'signing', 'signed'] as const) {
			const replay = publicSwapReplayEnvelope(swapRecord({ status, txHash: status === 'signed' ? '0x123' : null }))
			expect(replay.httpStatus).toBe(202)
			expect(replay.body.idempotentReplay).toBe(true)
			expect(replay.body.reconcileRequired).toBe(true)
			expect(replay.body.message).toContain('Do not create a new execution')
		}
	})

	it('requires a new operation identity after a terminal failure', () => {
		for (const status of ['failed', 'cancelled'] as const) {
			const replay = publicSwapReplayEnvelope(swapRecord({ status }))
			expect(replay.httpStatus).toBe(409)
			expect(replay.body.success).toBe(false)
			expect(replay.body.reconcileRequired).toBe(false)
			expect(replay.body.message).toContain('new key and new quote')
		}
	})

	it('treats the exact durable execution intent as a replay', () => {
		expect(differingSwapExecutionFields(swapRecord(), requested())).toEqual([])
	})

	it('rejects reuse of one key for a different amount or route', () => {
		expect(differingSwapExecutionFields(swapRecord(), requested({ fromAmount: '2000000' }))).toContain('fromAmount')
		expect(differingSwapExecutionFields(swapRecord(), requested({ routeData: '{"route":"two"}' }))).toContain('routeData')
	})

	it('claims the database operation before the first signing call', () => {
		const routeSource = readFileSync(new URL('../routes/publicSwap.ts', import.meta.url), 'utf8')
		const claimIndex = routeSource.indexOf('claimSwapExecution(executionInput)')
		const signingIndex = routeSource.indexOf('withSigningFallback(')
		expect(claimIndex).toBeGreaterThan(-1)
		expect(signingIndex).toBeGreaterThan(-1)
		expect(claimIndex).toBeLessThan(signingIndex)

		const claimSource = readFileSync(new URL('../services/swapExecutionClaim.ts', import.meta.url), 'utf8')
		expect(claimSource).toContain('.onConflictDoNothing()')
		expect(claimSource).toContain("kind: 'replay'")
		expect(claimSource).toContain("kind: 'conflict'")
	})
})

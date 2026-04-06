import { describe, expect, it } from 'bun:test'
import { buildQuoteDataFromQuote } from '../src/workers/dcaMonitor'
import type { DCAOrder } from '../src/db'
import type { SwapQuote } from '../src/services/SwapService'

describe('dca monitor quote conversion', () => {
	it('builds executable Li.Fi quote data for the Python swap executor', () => {
		const order = {
			id: 7,
			userId: 42,
			fromChain: 'base',
			toChain: 'base',
			fromToken: '0xfrom',
			toToken: '0xto',
			amountPerExecution: '1000000',
			interval: 'daily',
			executionsCompleted: 2,
			maxSlippage: 50,
		} as DCAOrder

		const quote = {
			fromAmount: '1000000',
			toAmount: '990000',
			toAmountMin: '980000',
			estimatedGasUsd: '1.25',
			bridgeFeeUsd: '0.15',
			estimatedDuration: 90,
			priceImpact: '0.02',
			exchangeRate: '0.99',
			fromAmountUsd: '1.00',
			toAmountUsd: '0.99',
			_rawQuote: {
				id: 'quote-1',
				transactionRequest: {
					from: '0xabc',
					to: '0xdef',
					chainId: 8453,
					data: '0x1234',
					value: '0',
				},
			},
		} as SwapQuote

		const result = buildQuoteDataFromQuote(order, quote)

		expect(result.provider).toBe('lifi')
		expect(result.to_amount).toBe('990000')
		expect(result.raw_quote.transactionRequest).toBeDefined()
		expect(result.raw_quote.order_id).toBe(7)
		expect(result.total_cost_usd).toBeCloseTo(1.4)
	})
})

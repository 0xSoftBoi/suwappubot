import { describe, expect, it } from 'bun:test'
import { buildPreviewHops } from '../routes/publicSwap'
import type { SwapQuote } from '../services'

/**
 * The public preview reports a route leg by leg (`hops`), because most
 * cross-chain routes are more than one transaction — a swap on the source
 * chain, a bridge relay, a swap on the destination. The Agent Desk's agents
 * plan and explain trades against these legs, so the mapping from Li.Fi's
 * `includedSteps` must survive partial shapes and never come back empty.
 */

const lifiToken = (symbol: string, decimals: number, chainId: number) => ({
	address: '0x0',
	symbol,
	decimals,
	chainId,
	name: symbol,
})

const estimate = (fromAmount: string, toAmount: string, duration?: number) => ({
	fromAmount,
	toAmount,
	toAmountMin: toAmount,
	approvalAddress: '0x0',
	feeCosts: [
		{
			name: 'relay',
			amount: '1',
			amountUSD: '0.91',
			token: lifiToken('USDC', 6, 8453),
			included: true,
		},
	],
	gasCosts: [
		{
			type: 'SEND',
			price: '1',
			estimate: '1',
			limit: '1',
			amount: '1',
			amountUSD: '0.30',
			token: lifiToken('ETH', 18, 8453),
		},
	],
	executionDuration: duration,
})

function quoteWith(includedSteps: unknown[]): SwapQuote {
	return {
		quoteId: 'q1',
		fromChain: 'base',
		toChain: 'arbitrum',
		fromToken: { address: '0x0', symbol: 'ETH', decimals: 18 },
		toToken: { address: '0x1', symbol: 'USDC', decimals: 6 },
		fromAmount: '50000000000000000',
		toAmount: '160000000',
		toAmountMin: '159000000',
		exchangeRate: '3200',
		priceImpact: '0.08',
		estimatedGas: '1',
		estimatedGasUsd: '0.42',
		bridgeFee: '1',
		bridgeFeeUsd: '0.91',
		slippage: 0.005,
		estimatedDuration: 92,
		fromAmountUsd: '160.00',
		toAmountUsd: '159.52',
		route: 'Uniswap → Across',
		transactionRequest: { from: '0x0', to: '0x0', chainId: 8453, data: '0x', value: '0' },
		_rawQuote: {
			id: 'q1',
			type: 'lifi',
			tool: 'across',
			toolDetails: { key: 'across', name: 'Across', logoURI: '' },
			action: {
				fromChainId: 8453,
				toChainId: 42161,
				fromToken: lifiToken('ETH', 18, 8453),
				toToken: lifiToken('USDC', 6, 42161),
				fromAmount: '50000000000000000',
				slippage: 0.005,
				fromAddress: '0x0',
				toAddress: '0x0',
			},
			estimate: estimate('50000000000000000', '160000000', 92),
			transactionRequest: { from: '0x0', to: '0x0', chainId: 8453, data: '0x', value: '0' },
			// biome-ignore lint/suspicious/noExplicitAny: test fixture
			includedSteps: includedSteps as any,
		},
	}
}

describe('buildPreviewHops', () => {
	it('maps every included step with chains, tokens and human amounts', () => {
		const hops = buildPreviewHops(
			quoteWith([
				{
					id: 's1',
					type: 'swap',
					tool: 'uniswap',
					toolDetails: { key: 'uniswap', name: 'Uniswap' },
					action: {
						fromChainId: 8453,
						toChainId: 8453,
						fromToken: lifiToken('ETH', 18, 8453),
						toToken: lifiToken('USDC', 6, 8453),
					},
					estimate: estimate('50000000000000000', '160500000', 12),
				},
				{
					id: 's2',
					type: 'cross',
					tool: 'across',
					toolDetails: { key: 'across', name: 'Across' },
					action: {
						fromChainId: 8453,
						toChainId: 42161,
						fromToken: lifiToken('USDC', 6, 8453),
						toToken: lifiToken('USDC', 6, 42161),
					},
					estimate: estimate('160500000', '160000000', 80),
				},
			]),
		)
		expect(hops).toHaveLength(2)
		expect(hops[0]).toMatchObject({
			index: 0,
			type: 'swap',
			toolName: 'Uniswap',
			fromChain: 'base',
			toChain: 'base',
			fromToken: 'ETH',
			toToken: 'USDC',
			fromAmount: '0.05',
			toAmount: '160.5',
			estimatedDurationSeconds: 12,
		})
		expect(hops[1]).toMatchObject({
			index: 1,
			type: 'cross',
			toolName: 'Across',
			fromChain: 'base',
			toChain: 'arbitrum',
			fromAmount: '160.5',
			toAmount: '160',
			estimatedDurationSeconds: 80,
		})
		// Per-hop costs come from that hop's own estimate.
		expect(hops[0]?.estimatedGasUsd).toBe('0.3000')
		expect(hops[1]?.feeUsd).toBe('0.9100')
	})

	it('falls back to one honest hop when a provider gives no step detail', () => {
		const hops = buildPreviewHops(quoteWith([]))
		expect(hops).toHaveLength(1)
		expect(hops[0]).toMatchObject({
			index: 0,
			type: 'cross', // fromChain !== toChain on the quote
			fromChain: 'base',
			toChain: 'arbitrum',
			fromToken: 'ETH',
			toToken: 'USDC',
			fromAmount: '0.05',
			toAmount: '160',
		})
	})

	it('tolerates steps with missing action detail instead of throwing', () => {
		const hops = buildPreviewHops(
			quoteWith([{ id: 's1', type: 'swap', tool: 'mystery', estimate: undefined }]),
		)
		expect(hops).toHaveLength(1)
		expect(hops[0]).toMatchObject({
			type: 'swap',
			tool: 'mystery',
			toolName: 'mystery',
			fromChain: null,
			fromAmount: null,
			estimatedGasUsd: null,
		})
	})

	it('reports unknown chain ids as their numeric id, not a wrong key', () => {
		const hops = buildPreviewHops(
			quoteWith([
				{
					id: 's1',
					type: 'cross',
					tool: 'wormhole',
					action: { fromChainId: 999999, toChainId: 42161 },
					estimate: estimate('1', '1'),
				},
			]),
		)
		expect(hops[0]?.fromChain).toBe('999999')
		expect(hops[0]?.toChain).toBe('arbitrum')
	})
})

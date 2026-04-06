import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Option } from 'effect'
import { cacheKeys, SwapService, TelegramAuthService, UserService, WalletService } from '../src/services'
import { createTestApp, mockTelegramUser, serviceLayer } from './setup'

mock.module('@turnkey/sdk-server', () => ({
	Turnkey: class {
		apiClient() {
			return {
				signTransaction: async () => ({ signedTransaction: '0xsignedtransaction' }),
			}
		}
	},
}))

const user = {
	id: 42,
	telegramId: mockTelegramUser.id,
	username: mockTelegramUser.username,
	firstName: mockTelegramUser.first_name,
	lastName: mockTelegramUser.last_name ?? null,
}

const wallet = {
	id: 7,
	userId: user.id,
	address: '0x1234567890123456789012345678901234567890',
	walletProvider: 'turnkey',
	turnkeySubOrgId: 'sub-org-1',
	turnkeyWalletId: 'wallet-1',
	turnkeyAccountId: 'account-1',
	chainType: 'evm',
	isActive: true,
	isDefault: true,
	name: 'Primary',
	createdAt: new Date(),
}

const originalFetch = globalThis.fetch

const quote = {
	quoteId: 'quote-1',
	fromChain: '8453',
	toChain: '1',
	fromToken: {
		address: '0x0000000000000000000000000000000000000000',
		symbol: 'ETH',
		decimals: 18,
		logoURI: undefined,
	},
	toToken: {
		address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
		symbol: 'USDC',
		decimals: 6,
		logoURI: undefined,
	},
	fromAmount: '1000000000000000000',
	toAmount: '3000000000',
	toAmountMin: '2950000000',
	exchangeRate: '3000',
	priceImpact: '0.10',
	estimatedGas: '21000',
	estimatedGasUsd: '2.50',
	bridgeFee: '0',
	bridgeFeeUsd: '0',
	slippage: 0.03,
	estimatedDuration: 90,
	fromAmountUsd: '3000',
	toAmountUsd: '3000',
	route: 'lifi',
	transactionRequest: {
		to: '0x1111111111111111111111111111111111111111',
		from: wallet.address,
		value: '0xde0b6b3a7640000',
		data: '0xabcdef',
		chainId: 8453,
		gasLimit: '0x5208',
		gasPrice: '0x3b9aca00',
	},
	_rawQuote: {
		action: {
			fromToken: { priceUSD: '3000' },
			toToken: { priceUSD: '1' },
		},
		estimate: {},
	},
}

describe('webapp swap routes', () => {
	beforeEach(() => {
		mock.restore()
		mock.module('@turnkey/sdk-server', () => ({
			Turnkey: class {
				apiClient() {
					return {
						signTransaction: async () => ({ signedTransaction: '0xsignedtransaction' }),
					}
				}
			},
		}))
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
	})

	it('GET /webapp/swap/quote returns quote with required fields', async () => {
		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(SwapService, {
					getQuote: () => Effect.succeed(quote),
				}),
			],
		})

		try {
			const response = await app.request(
				'/webapp/swap/quote?fromChain=base&toChain=ethereum&fromToken=0x0&toToken=0x1&fromAmount=1000000000000000000',
				{
					headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
				},
			)
			expect(response.status).toBe(200)

			const body = (await response.json()) as { id: string; txData?: { to: string } }
			expect(body.id).toBe(quote.quoteId)
			expect(body.txData?.to).toBe(quote.transactionRequest.to)
		} finally {
			await cleanup()
		}
	})

	it('GET /webapp/swap/quote validates required query params', async () => {
		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(SwapService, {
					getQuote: () => Effect.fail(new Error('not expected')),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/swap/quote?fromChain=base', {
				headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
			})
			expect(response.status).toBe(400)

			const body = (await response.json()) as { error: string; message?: string }
			expect(body.error).toBe('Validation Error')
			expect(body.message).toContain('Missing required parameters')
		} finally {
			await cleanup()
		}
	})

	it('POST /webapp/swap/execute returns swap result', async () => {
		let updatedStatus: string | null = null
		const swapRecord = {
			id: 88,
			userId: user.id,
			fromChain: quote.fromChain,
			toChain: quote.toChain,
			fromToken: quote.fromToken.symbol,
			toToken: quote.toToken.symbol,
			fromAmount: quote.fromAmount,
			toAmount: quote.toAmount,
			fromAmountUsd: 3000,
			toAmountUsd: null,
			status: 'pending',
			txHash: null,
			bridgeTxHash: null,
			destinationTxHash: null,
			idempotencyKey: null,
			routeProvider: 'lifi',
			routeData: JSON.stringify(quote._rawQuote),
			slippage: 300,
			gasFee: 2.5,
			bridgeFee: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
			completedAt: null,
			errorMessage: null,
			agentId: null,
			agentUuid: null,
		}

		;(globalThis.fetch as any) = async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body || '{}'))
			if (body.method === 'eth_getTransactionCount') {
				return new Response(JSON.stringify({ result: '0x1' }), { status: 200 })
			}
			if (body.method === 'eth_sendRawTransaction') {
				return new Response(JSON.stringify({ result: '0xsubmittedhash' }), { status: 200 })
			}
			throw new Error(`Unexpected fetch call: ${body.method}`)
		}

		const { app, cleanup, redis } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(WalletService, {
					getActiveWallets: () => Effect.succeed([wallet]),
				}),
				serviceLayer(SwapService, {
					createSwapRecord: () => Effect.succeed(swapRecord),
					updateSwapStatus: (_swapId: number, status: string, txHash?: string) => {
						updatedStatus = status
						return Effect.succeed({ ...swapRecord, status, txHash: txHash ?? null })
					},
				}),
			],
		})

		try {
			await Effect.runPromise(redis.set(cacheKeys.quote(quote.quoteId), quote, 30))

			const response = await app.request('/webapp/swap/execute', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Init-Data': 'valid-init-data',
				},
				body: JSON.stringify({ quoteId: quote.quoteId }),
			})
			expect(response.status).toBe(200)

			const body = (await response.json()) as { success: boolean; swapId: number; txHash?: string }
			expect(body.success).toBe(true)
			expect(body.swapId).toBe(swapRecord.id)
			expect(body.txHash).toBe('0xsubmittedhash')
			expect(updatedStatus).toBe('submitted')
		} finally {
			await cleanup()
		}
	})

	it('GET /webapp/swap/status/:id returns current status', async () => {
		const { app, cleanup } = await createTestApp({
			layers: [
				serviceLayer(TelegramAuthService, {
					validateInitData: () => Effect.succeed(Option.some(mockTelegramUser)),
				}),
				serviceLayer(UserService, {
					getUserByTelegramId: () => Effect.succeed(Option.some(user)),
				}),
				serviceLayer(SwapService, {
					getSwapById: () =>
						Effect.succeed({
							id: 91,
							userId: user.id,
							fromChain: '8453',
							toChain: '1',
							fromToken: 'ETH',
							toToken: 'USDC',
							fromAmount: '1000000000000000000',
							toAmount: '3000000000',
							txHash: '0xstatushash',
							bridgeTxHash: null,
							destinationTxHash: null,
							errorMessage: null,
							status: 'submitted',
							createdAt: new Date('2026-01-01T00:00:00Z'),
							completedAt: null,
						}),
				}),
			],
		})

		try {
			const response = await app.request('/webapp/swap/status/91', {
				headers: { 'X-Telegram-Init-Data': 'valid-init-data' },
			})
			expect(response.status).toBe(200)

			const body = (await response.json()) as { id: number; status: string; txHash: string }
			expect(body).toMatchObject({ id: 91, status: 'submitted', txHash: '0xstatushash' })
		} finally {
			await cleanup()
		}
	})
})

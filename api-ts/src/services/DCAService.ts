import { Context, Effect, Layer } from 'effect'

export interface CreateDCAOrderParams {
	userId: number
	fromChain: string
	fromToken: string
	fromTokenSymbol: string
	toChain: string
	toToken: string
	toTokenSymbol: string
	amountPerExecution: string
	frequency: 'hourly' | 'daily' | 'weekly' | 'monthly'
	totalExecutions?: number
	walletAddress: string
	slippage?: number
}

export interface DCAOrder {
	id: number
	userId: number
	status: string
	createdAt: Date
}

export interface DCAExecution {
	id: number
	orderId: number
	executedAt: Date
	txHash?: string
}

export interface DCAStats {
	totalOrders: number
	activeOrders: number
	totalExecutions: number
	totalVolumeUsd: number
}

export interface DCAServiceInterface {
	readonly createOrder: (params: CreateDCAOrderParams) => Effect.Effect<DCAOrder, Error>

	readonly getUserOrders: (
		userId: number,
		status?: string,
		limit?: number,
		offset?: number,
	) => Effect.Effect<DCAOrder[], Error>

	readonly pauseOrder: (orderId: number, userId: number) => Effect.Effect<DCAOrder, Error>

	readonly resumeOrder: (orderId: number, userId: number) => Effect.Effect<DCAOrder, Error>

	readonly cancelOrder: (orderId: number, userId: number) => Effect.Effect<DCAOrder, Error>

	readonly getExecutions: (orderId: number, userId: number) => Effect.Effect<DCAExecution[], Error>

	readonly getStats: (userId: number) => Effect.Effect<DCAStats, Error>
}

export class DCAService extends Context.Tag('DCAService')<DCAService, DCAServiceInterface>() {}

export const DCAServiceLive = Layer.succeed(DCAService, {
	createOrder: () => Effect.fail(new Error('Not implemented')),
	getUserOrders: () => Effect.fail(new Error('Not implemented')),
	pauseOrder: () => Effect.fail(new Error('Not implemented')),
	resumeOrder: () => Effect.fail(new Error('Not implemented')),
	cancelOrder: () => Effect.fail(new Error('Not implemented')),
	getExecutions: () => Effect.fail(new Error('Not implemented')),
	getStats: () => Effect.fail(new Error('Not implemented')),
})

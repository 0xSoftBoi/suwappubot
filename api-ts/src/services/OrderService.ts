import { Context, Effect, Layer } from 'effect'

export interface CreateOrderParams {
	userId: number
	orderType: 'market' | 'limit' | 'stop_loss' | 'take_profit'
	fromChain: string
	fromToken: string
	fromTokenSymbol: string
	fromAmount: string
	toChain: string
	toToken: string
	toTokenSymbol: string
	triggerPrice?: number
	walletAddress: string
	slippage?: number
}

export interface Order {
	id: number
	userId: number
	orderType: string
	status: string
	createdAt: Date
}

export interface OrderFill {
	id: number
	orderId: number
	filledAt: Date
	price: number
	amount: string
	txHash?: string
}

export interface OrderServiceInterface {
	readonly getUserOrders: (
		userId: number,
		status?: string,
		limit?: number,
		offset?: number
	) => Effect.Effect<Order[], Error>

	readonly createOrder: (
		params: CreateOrderParams
	) => Effect.Effect<Order, Error>

	readonly cancelOrder: (
		orderId: number,
		userId: number
	) => Effect.Effect<Order, Error>

	readonly getOrderFills: (
		orderId: number,
		userId: number
	) => Effect.Effect<OrderFill[], Error>
}

export class OrderService extends Context.Tag('OrderService')<
	OrderService,
	OrderServiceInterface
>() {}

export const OrderServiceLive = Layer.succeed(OrderService, {
	getUserOrders: () => Effect.fail(new Error('Not implemented')),
	createOrder: () => Effect.fail(new Error('Not implemented')),
	cancelOrder: () => Effect.fail(new Error('Not implemented')),
	getOrderFills: () => Effect.fail(new Error('Not implemented')),
})

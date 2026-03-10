import { Context, Effect, Layer } from 'effect'
import Redis from 'ioredis'
import { EnvService } from '../config/EnvService'

// ─── Event Types ────────────────────────────────────────────

export type SuwappuEvent =
	| SwapCompletedEvent
	| SwapFailedEvent
	| SwapSubmittedEvent
	| WalletCreatedEvent
	| OrderFilledEvent
	| OrderCancelledEvent
	| BalanceChangedEvent
	| UserCreatedEvent

export interface SwapCompletedEvent {
	type: 'swap.completed'
	data: {
		userId: number
		swapId: number
		txHash: string
		fromChain: string
		toChain: string
		fromToken: string
		toToken: string
		fromAmount: string
		toAmount: string
		provider: string
	}
}

export interface SwapFailedEvent {
	type: 'swap.failed'
	data: {
		userId: number
		swapId: number
		error: string
		fromChain: string
		toChain: string
		fromToken: string
		toToken: string
	}
}

export interface SwapSubmittedEvent {
	type: 'swap.submitted'
	data: {
		userId: number
		swapId: number
		txHash: string
		fromChain: string
		toChain: string
		provider: string
	}
}

export interface WalletCreatedEvent {
	type: 'wallet.created'
	data: {
		userId: number
		walletId: number
		address: string
		chain: string
	}
}

export interface OrderFilledEvent {
	type: 'order.filled'
	data: {
		userId: number
		orderId: number
		orderType: 'limit' | 'dca' | 'trailing_stop'
		txHash: string
	}
}

export interface OrderCancelledEvent {
	type: 'order.cancelled'
	data: {
		userId: number
		orderId: number
		orderType: 'limit' | 'dca' | 'trailing_stop'
		reason: string
	}
}

export interface BalanceChangedEvent {
	type: 'balance.changed'
	data: {
		userId: number
		walletId: number
		chain: string
		token: string
		newBalance: string
	}
}

export interface UserCreatedEvent {
	type: 'user.created'
	data: {
		userId: number
		platform: 'telegram' | 'whatsapp' | 'discord' | 'agent'
		username?: string
	}
}

// ─── Event Envelope ─────────────────────────────────────────

export interface EventEnvelope {
	event: SuwappuEvent
	source: 'api-ts' | 'bot'
	timestamp: string
	id: string
}

// ─── Channel ────────────────────────────────────────────────

const CHANNEL = 'suwappu:events'

// ─── Service Interface ──────────────────────────────────────

type EventHandler = (envelope: EventEnvelope) => void | Promise<void>

export interface EventBusInterface {
	readonly publish: (event: SuwappuEvent) => Effect.Effect<void, Error>
	readonly subscribe: (
		eventType: SuwappuEvent['type'] | '*',
		handler: EventHandler,
	) => Effect.Effect<void, Error>
	readonly isConnected: () => boolean
}

export class EventBus extends Context.Tag('EventBus')<EventBus, EventBusInterface>() {}

// ─── No-op fallback ─────────────────────────────────────────

const createNoOpEventBus = (): EventBusInterface => ({
	publish: () => Effect.void,
	subscribe: () => Effect.void,
	isConnected: () => false,
})

// ─── Live implementation ────────────────────────────────────

export const EventBusLive = Layer.effect(
	EventBus,
	Effect.gen(function* () {
		const env = yield* EnvService

		if (!env.REDIS_URL) {
			console.log('[EventBus] REDIS_URL not configured, events disabled')
			return createNoOpEventBus()
		}

		// Publisher connection (reuse main redis or create new)
		const publisher = new Redis(env.REDIS_URL, {
			maxRetriesPerRequest: 3,
			retryStrategy: (times) => Math.min(times * 100, 3000),
			lazyConnect: true,
		})

		// Subscriber needs its own connection (ioredis requirement)
		const subscriber = new Redis(env.REDIS_URL, {
			maxRetriesPerRequest: 3,
			retryStrategy: (times) => Math.min(times * 100, 3000),
			lazyConnect: true,
		})

		// Connect both
		const connectPub = yield* Effect.tryPromise({
			try: () => publisher.connect(),
			catch: (e) => e as Error,
		}).pipe(Effect.either)

		const connectSub = yield* Effect.tryPromise({
			try: () => subscriber.connect(),
			catch: (e) => e as Error,
		}).pipe(Effect.either)

		if (connectPub._tag === 'Left' || connectSub._tag === 'Left') {
			console.warn('[EventBus] Failed to connect to Redis, events disabled')
			return createNoOpEventBus()
		}

		console.log('[EventBus] Connected to Redis pub/sub')

		// Handler registry: eventType -> Set<handler>
		const handlers = new Map<string, Set<EventHandler>>()

		// Subscribe to channel
		subscriber.subscribe(CHANNEL, (err) => {
			if (err) console.error('[EventBus] Subscribe error:', err.message)
		})

		subscriber.on('message', (_channel: string, message: string) => {
			try {
				const envelope = JSON.parse(message) as EventEnvelope
				const eventType = envelope.event.type

				// Call type-specific handlers
				const typeHandlers = handlers.get(eventType)
				if (typeHandlers) {
					for (const handler of typeHandlers) {
						Promise.resolve(handler(envelope)).catch((err) =>
							console.error(`[EventBus] Handler error for ${eventType}:`, err),
						)
					}
				}

				// Call wildcard handlers
				const wildcardHandlers = handlers.get('*')
				if (wildcardHandlers) {
					for (const handler of wildcardHandlers) {
						Promise.resolve(handler(envelope)).catch((err) =>
							console.error('[EventBus] Wildcard handler error:', err),
						)
					}
				}
			} catch (err) {
				console.error('[EventBus] Failed to parse event:', err)
			}
		})

		publisher.on('error', (err) => console.error('[EventBus] Publisher error:', err.message))
		subscriber.on('error', (err) => console.error('[EventBus] Subscriber error:', err.message))

		let counter = 0

		return {
			publish: (event: SuwappuEvent) =>
				Effect.tryPromise({
					try: async () => {
						const envelope: EventEnvelope = {
							event,
							source: 'api-ts',
							timestamp: new Date().toISOString(),
							id: `apits-${Date.now()}-${++counter}`,
						}
						await publisher.publish(CHANNEL, JSON.stringify(envelope))
					},
					catch: (e) => new Error(`EventBus publish failed: ${e}`),
				}),

			subscribe: (eventType: SuwappuEvent['type'] | '*', handler: EventHandler) =>
				Effect.sync(() => {
					if (!handlers.has(eventType)) {
						handlers.set(eventType, new Set())
					}
					handlers.get(eventType)!.add(handler)
				}),

			isConnected: () => publisher.status === 'ready' && subscriber.status === 'ready',
		} satisfies EventBusInterface
	}),
)

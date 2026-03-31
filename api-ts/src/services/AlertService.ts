import { Context, Effect, Layer } from 'effect'

export interface CreateAlertParams {
	userId: number
	alertType: 'price' | 'volume' | 'whale' | 'listing'
	chain: string
	tokenAddress: string
	tokenSymbol: string
	condition: string
	threshold: number
}

export interface Alert {
	id: number
	userId: number
	alertType: string
	active: boolean
	createdAt: Date
}

export interface AlertServiceInterface {
	readonly getUserAlerts: (userId: number, activeOnly?: boolean) => Effect.Effect<Alert[], Error>

	readonly createAlert: (params: CreateAlertParams) => Effect.Effect<Alert, Error>

	readonly toggleAlert: (alertId: number, userId: number) => Effect.Effect<Alert, Error>

	readonly deleteAlert: (alertId: number, userId: number) => Effect.Effect<void, Error>
}

export class AlertService extends Context.Tag('AlertService')<
	AlertService,
	AlertServiceInterface
>() {}

export const AlertServiceLive = Layer.succeed(AlertService, {
	getUserAlerts: () => Effect.fail(new Error('Not implemented')),
	createAlert: () => Effect.fail(new Error('Not implemented')),
	toggleAlert: () => Effect.fail(new Error('Not implemented')),
	deleteAlert: () => Effect.fail(new Error('Not implemented')),
})

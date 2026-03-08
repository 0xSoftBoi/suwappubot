import { Context, Effect, Layer } from 'effect'

export interface ReferralCode {
	code: string
	userId: number
	createdAt: Date
}

export interface ReferralStats {
	totalReferred: number
	activeReferred: number
	totalEarningsUsd: number
	pendingEarningsUsd: number
}

export interface ReferredUser {
	userId: number
	referredAt: Date
	totalVolumeUsd: number
	active: boolean
}

export interface ReferralServiceInterface {
	readonly getReferralCode: (userId: number) => Effect.Effect<ReferralCode, Error>

	readonly getReferralStats: (userId: number) => Effect.Effect<ReferralStats, Error>

	readonly getReferredUsers: (userId: number) => Effect.Effect<ReferredUser[], Error>
}

export class ReferralService extends Context.Tag('ReferralService')<
	ReferralService,
	ReferralServiceInterface
>() {}

export const ReferralServiceLive = Layer.succeed(ReferralService, {
	getReferralCode: () => Effect.fail(new Error('Not implemented')),
	getReferralStats: () => Effect.fail(new Error('Not implemented')),
	getReferredUsers: () => Effect.fail(new Error('Not implemented')),
})

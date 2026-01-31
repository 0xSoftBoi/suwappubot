import { Context, Effect, Layer, Option } from 'effect'
import { eq } from 'drizzle-orm'
import { DrizzleService, requireDb } from '../db'
import {
	userSettings,
	type UserSettings,
	type UserSettingsResponse,
	type UpdateUserSettingsRequest,
} from '../db/schema/settings'
import { DatabaseError } from '../errors'

export interface SettingsServiceInterface {
	/**
	 * Get user settings by user ID.
	 * Creates default settings if none exist.
	 */
	readonly getSettings: (
		userId: number
	) => Effect.Effect<UserSettingsResponse, DatabaseError, DrizzleService>

	/**
	 * Update user settings.
	 * Creates settings if they don't exist.
	 */
	readonly updateSettings: (
		userId: number,
		updates: UpdateUserSettingsRequest
	) => Effect.Effect<UserSettingsResponse, DatabaseError, DrizzleService>
}

export class SettingsService extends Context.Tag('SettingsService')<
	SettingsService,
	SettingsServiceInterface
>() {}

// Convert DB settings to API response format
function toResponse(settings: UserSettings): UserSettingsResponse {
	return {
		slippage: settings.slippageBps / 100, // Convert basis points to percentage
		priceAlerts: settings.priceAlertsEnabled,
		txUpdates: settings.txUpdatesEnabled,
		promotions: settings.promotionsEnabled,
		language: settings.language,
		theme: settings.theme,
	}
}

// Default settings for new users
const DEFAULT_SETTINGS: UserSettingsResponse = {
	slippage: 0.5,
	priceAlerts: true,
	txUpdates: true,
	promotions: false,
	language: 'en',
	theme: 'light',
}

export const SettingsServiceLive = Layer.succeed(SettingsService, {
	getSettings: (userId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			// Try to fetch existing settings
			const result = yield* Effect.tryPromise({
				try: () => db.select().from(userSettings).where(eq(userSettings.userId, userId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to get settings: ${e}`, cause: e }),
			})

			if (result.length > 0) {
				return toResponse(result[0])
			}

			// Create default settings for new user
			const created = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(userSettings)
						.values({
							userId,
							slippageBps: 50, // 0.5%
							priceAlertsEnabled: true,
							txUpdatesEnabled: true,
							promotionsEnabled: false,
							language: 'en',
							theme: 'light',
						})
						.returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to create settings: ${e}`, cause: e }),
			})

			return toResponse(created[0])
		}),

	updateSettings: (userId: number, updates: UpdateUserSettingsRequest) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			// Build update values
			const updateValues: Partial<{
				slippageBps: number
				priceAlertsEnabled: boolean
				txUpdatesEnabled: boolean
				promotionsEnabled: boolean
				language: string
				theme: string
				updatedAt: Date
			}> = {
				updatedAt: new Date(),
			}

			if (updates.slippage !== undefined) {
				// Convert percentage to basis points and clamp to reasonable range
				const bps = Math.round(updates.slippage * 100)
				updateValues.slippageBps = Math.max(1, Math.min(5000, bps)) // 0.01% to 50%
			}
			if (updates.priceAlerts !== undefined) {
				updateValues.priceAlertsEnabled = updates.priceAlerts
			}
			if (updates.txUpdates !== undefined) {
				updateValues.txUpdatesEnabled = updates.txUpdates
			}
			if (updates.promotions !== undefined) {
				updateValues.promotionsEnabled = updates.promotions
			}
			if (updates.language !== undefined) {
				updateValues.language = updates.language
			}
			if (updates.theme !== undefined) {
				updateValues.theme = updates.theme
			}

			// Try to update existing settings
			const updated = yield* Effect.tryPromise({
				try: () =>
					db
						.update(userSettings)
						.set(updateValues)
						.where(eq(userSettings.userId, userId))
						.returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to update settings: ${e}`, cause: e }),
			})

			if (updated.length > 0) {
				return toResponse(updated[0])
			}

			// Settings don't exist, create them with updates applied
			const created = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(userSettings)
						.values({
							userId,
							slippageBps: updateValues.slippageBps ?? 50,
							priceAlertsEnabled: updateValues.priceAlertsEnabled ?? true,
							txUpdatesEnabled: updateValues.txUpdatesEnabled ?? true,
							promotionsEnabled: updateValues.promotionsEnabled ?? false,
							language: updateValues.language ?? 'en',
							theme: updateValues.theme ?? 'light',
						})
						.returning(),
				catch: (e) =>
					new DatabaseError({ message: `Failed to create settings: ${e}`, cause: e }),
			})

			return toResponse(created[0])
		}),
})

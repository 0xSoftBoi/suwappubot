import { eq } from 'drizzle-orm'
import { Effect, Either, Option } from 'effect'
import type { Context, Next } from 'hono'
import { requireDb, subscriptions } from '../db'
import { runEffectEither } from '../runtime'
import { UserService } from '../services'

// ENTERPRISE > PREMIUM > PRO > FREE
const TIER_RANK: Record<string, number> = { free: 0, pro: 1, premium: 2, enterprise: 3 }

/**
 * Gate a webapp route on the caller's subscription tier.
 *
 * MUST be mounted AFTER telegramAuth() (it reads c.get('telegramUser')).
 *
 * `telegramUser.id` is the Telegram id, so we resolve it to the internal
 * users.id (via UserService) and read the `subscriptions` row by that id — the
 * same path the Stripe/crypto checkout writes (billing.ts). An expired
 * `expiresAt` is treated as free. Fail-closed: if the tier can't be confirmed
 * the request is denied, so the paywall never leaks on error.
 */
export function requireTier(required: 'pro' | 'premium' | 'enterprise') {
	return async (c: Context, next: Next) => {
		const telegramUser = c.get('telegramUser')
		if (!telegramUser) return c.json({ error: 'Authentication required' }, 401)

		const result = await runEffectEither(
			Effect.gen(function* () {
				const db = yield* requireDb
				const userService = yield* UserService
				const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
				if (Option.isNone(userOption)) return 'free'

				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ tier: subscriptions.tier, expiresAt: subscriptions.expiresAt })
							.from(subscriptions)
							.where(eq(subscriptions.userId, userOption.value.id))
							.limit(1),
					catch: (e) => (e instanceof Error ? e : new Error(String(e))),
				})

				const sub = rows[0]
				if (!sub) return 'free'
				if (sub.expiresAt && new Date(sub.expiresAt).getTime() < Date.now()) return 'free'
				return sub.tier ?? 'free'
			}),
		)

		if (Either.isLeft(result)) {
			return c.json({ error: 'Failed to verify subscription tier' }, 500)
		}

		const currentTier = result.right
		if ((TIER_RANK[currentTier] ?? 0) < (TIER_RANK[required] ?? 0)) {
			return c.json(
				{
					error: `This feature requires the ${required} plan.`,
					requiredTier: required,
					currentTier,
				},
				402,
			)
		}

		await next()
	}
}

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
 * MUST be mounted AFTER an auth middleware. Accepts EITHER context var:
 *   - `authUser`     (flexAuth: JWT bearer or session cookie) — already the
 *                    internal users.id, so no lookup is needed.
 *   - `telegramUser` (telegramAuth: Mini App initData) — a Telegram id, which
 *                    must be resolved to the internal users.id first.
 *
 * Reading ONLY telegramUser was a real outage: /enterprise/* moved to flexAuth
 * so the web dashboard could authenticate by cookie, but this gate still
 * demanded telegramUser. flexAuth authenticated successfully and set authUser,
 * then this middleware rejected the request with "Authentication required" —
 * blaming the credential rather than the gate.
 *
 * We read the `subscriptions` row by internal user id — the
 * same path the Stripe/crypto checkout writes (billing.ts). An expired
 * `expiresAt` is treated as free. Fail-closed: if the tier can't be confirmed
 * the request is denied, so the paywall never leaks on error.
 */
export function requireTier(required: 'pro' | 'premium' | 'enterprise') {
	return async (c: Context, next: Next) => {
		const authUser = c.get('authUser')
		const telegramUser = c.get('telegramUser')
		// Fail closed: an authUser without a usable id is NOT authenticated.
		if (!authUser?.userId && !telegramUser) {
			return c.json({ error: 'Authentication required' }, 401)
		}

		const result = await runEffectEither(
			Effect.gen(function* () {
				const db = yield* requireDb

				// flexAuth already carries the internal id; telegramAuth does not.
				let userId: number
				if (authUser?.userId) {
					userId = authUser.userId
				} else {
					const userService = yield* UserService
					const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
					if (Option.isNone(userOption)) return 'free'
					userId = userOption.value.id
				}

				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ tier: subscriptions.tier, expiresAt: subscriptions.expiresAt })
							.from(subscriptions)
							.where(eq(subscriptions.userId, userId))
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

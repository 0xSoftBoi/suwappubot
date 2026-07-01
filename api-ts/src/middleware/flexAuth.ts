import { Effect, Either, Option } from 'effect'
import type { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import jwt from 'jsonwebtoken'
import { EnvService } from '../config/EnvService'
import { runEffectEither } from '../runtime'
import { TelegramAuthService, UserService, WalletService } from '../services'

export interface AuthUser {
	userId: number
	walletAddress: string | null
}

/**
 * Allowed JWT signing algorithms for verification.
 *
 * Tokens are signed with HS256 (jsonwebtoken's default in publicSwap.ts /
 * webapp.ts) and decoded with `algorithms=["HS256"]` on the Python side
 * (api/main.py, api/webapp.py). Pinning the allowlist here closes a latent
 * algorithm-confusion gap: without it, `jwt.verify` accepts any algorithm the
 * library defaults to for a string secret, so a token forged with a different
 * HMAC alg would still verify against the same secret.
 */
export const ALLOWED_JWT_ALGORITHMS = ['HS256'] as const

/**
 * Verify a bearer JWT with an explicit algorithm allowlist. Extracted so the
 * hardening (algorithm pinning) is unit-testable independent of the Effect
 * runtime / service layer.
 */
export function verifyAuthJwt(
	token: string,
	jwtSecret: string,
): { userId: number; walletAddress?: string } {
	return jwt.verify(token, jwtSecret, {
		algorithms: ALLOWED_JWT_ALGORITHMS as unknown as jwt.Algorithm[],
	}) as { userId: number; walletAddress?: string }
}

declare module 'hono' {
	interface ContextVariableMap {
		authUser: AuthUser
		requestId: string
		apiKeyAuth: {
			orgId: string
			scopes: string[]
			keyId: string
			rateLimitPerMin: number
		} | undefined
	}
}

/**
 * Flexible auth middleware that accepts either:
 * 1. X-Telegram-Init-Data header (Telegram auth)
 * 2. Authorization: Bearer <jwt> (JWT auth from passkey/showcase)
 *
 * Normalizes to a common `authUser` context variable.
 */
export function flexAuth() {
	return async (c: Context, next: Next) => {
		// 1. Try Telegram auth first
		const initData = c.req.header('X-Telegram-Init-Data')
		if (initData) {
			const result = await runEffectEither(
				Effect.gen(function* () {
					const authService = yield* TelegramAuthService
					const userService = yield* UserService
					const walletService = yield* WalletService

					const telegramUserOption = yield* authService.validateInitData(initData)
					if (Option.isNone(telegramUserOption)) {
						return yield* Effect.fail(new Error('Invalid Telegram authentication'))
					}

					const telegramUser = telegramUserOption.value

					const userOption = yield* userService.getUserByTelegramId(telegramUser.id)
					if (Option.isNone(userOption)) {
						return yield* Effect.fail(new Error('User not found'))
					}

					const user = userOption.value
					let walletAddress: string | null = null

					const wallets = yield* walletService.getActiveWallets(user.id)
					const primaryWallet = wallets[0]
					if (primaryWallet) {
						walletAddress = primaryWallet.address
					}

					return { userId: user.id, walletAddress } as AuthUser
				}),
			)

			if (Either.isRight(result)) {
				c.set('authUser', result.right)
				await next()
				return
			}
			// If Telegram auth fails, fall through to try JWT
		}

		// 2. Try JWT Bearer auth
		const authHeader = c.req.header('Authorization')
		if (authHeader?.startsWith('Bearer ')) {
			const token = authHeader.slice(7)

			const result = await runEffectEither(
				Effect.gen(function* () {
					const env = yield* EnvService
					if (!env.JWT_SECRET) {
						return yield* Effect.fail(new Error('JWT_SECRET not configured'))
					}
					const jwtSecret = env.JWT_SECRET

					const decoded = yield* Effect.try({
						try: () => verifyAuthJwt(token, jwtSecret),
						catch: () => new Error('Invalid JWT token'),
					})

					return {
						userId: decoded.userId,
						walletAddress: decoded.walletAddress || null,
					} as AuthUser
				}),
			)

			if (Either.isRight(result)) {
				c.set('authUser', result.right)
				await next()
				return
			}

			throw new HTTPException(401, { message: 'Invalid authentication token' })
		}

		// 3. No auth provided
		throw new HTTPException(401, { message: 'Authentication required' })
	}
}

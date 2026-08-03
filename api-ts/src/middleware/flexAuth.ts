import { Effect, Either, Option } from 'effect'
import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
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
export const ALLOWED_JWT_ALGORITHMS: readonly jwt.Algorithm[] = ['HS256']

/**
 * `src` claim values that prove the bearer actually possesses the
 * credential the token represents (a verified login session), as opposed
 * to merely presenting a token that decodes correctly.
 *
 * - 'telegram' — minted by POST /webapp/telegram/auth after verifying
 *   Telegram's initData HMAC signature.
 * - 'siwe'     — minted after a verified wallet-signature challenge
 *   (turnkey/solana signature verification).
 * - 'passkey'  — minted after a verified WebAuthn/passkey assertion.
 *
 * A token with `src === 'weak'`, or with NO `src` claim at all, is
 * rejected by requireProofOfPossession(). Absent `src` is exactly the
 * shape of the legacy forgeable token minted by POST /public/swap/auth
 * (`{userId, walletAddress}`, no possession proof) — treat any future
 * mint that omits `src` the same way unless it is added here deliberately.
 */
export const PROOF_OF_POSSESSION_SRCS = ['telegram', 'siwe', 'passkey'] as const
export type ProofOfPossessionSrc = (typeof PROOF_OF_POSSESSION_SRCS)[number]

/**
 * Verify a bearer JWT with an explicit algorithm allowlist. Extracted so the
 * hardening (algorithm pinning) is unit-testable independent of the Effect
 * runtime / service layer.
 */
export function verifyAuthJwt(
	token: string,
	jwtSecret: string,
): { userId: number; walletAddress?: string; src?: string } {
	return jwt.verify(token, jwtSecret, {
		algorithms: [...ALLOWED_JWT_ALGORITHMS],
	}) as { userId: number; walletAddress?: string; src?: string }
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
/**
 * Session cookie minted by python-api. Scoped to the parent domain so it is
 * sent to api.suwappu.bot as a same-site request from the showcase origin.
 */
export const SESSION_COOKIE = 'suwappu_auth'

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

		// 2. Try JWT — from the Authorization header OR the session cookie.
		//
		// The cookie source exists because the web dashboard had NO working
		// sign-in at all: it sent `Authorization: Bearer <token>` to routes
		// guarded by telegramAuth(), which reads only X-Telegram-Init-Data, so
		// every request 401'd with "Missing Telegram authentication" and the
		// login screen reported the token as rejected. Nobody could get in.
		//
		// python-api mints this JWT on every auth flow (Google OAuth, Telegram,
		// passkey, SIWE) and sets it as an HttpOnly cookie scoped to the parent
		// domain, so it reaches api-ts as a same-site request. Reading it here
		// means the browser never has to hold a bearer token in JS — which is
		// what the old paste-a-token flow trained people to do.
		//
		// The header is tried first so machine clients are unaffected.
		const authHeader = c.req.header('Authorization')
		const headerToken = authHeader?.startsWith('Bearer ')
			? authHeader.slice(7)
			: undefined
		const cookieToken = getCookie(c, SESSION_COOKIE)
		const token = headerToken ?? cookieToken

		if (token) {

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

/**
 * Stricter variant of flexAuth() for endpoints that authorize spend-affecting
 * actions: agent-approval decisions (agent.ts POST /approvals/:id/approve,
 * /approvals/:id/deny, GET /approvals).
 *
 * Background: POST /public/swap/auth (src/routes/publicSwap.ts) mints a
 * 7-day JWT from a bare `{subOrgId, walletAddress}` request body with NO
 * proof of possession — anyone who knows a victim's wallet address can mint
 * a valid token for that victim. flexAuth() accepts any JWT signed with our
 * secret, which means that forgeable token would be enough to approve or
 * deny a victim's pending agent-spend approval. Fixing publicSwap's /auth
 * itself is out of scope here (separate pre-existing vuln, separate blast
 * radius) — instead this guard narrows what the approvals surface will
 * accept.
 *
 * Accepted credentials (both are genuine proof-of-possession):
 * 1. X-Telegram-Init-Data — verified via TelegramAuthService (Telegram's
 *    HMAC signature over the initData payload).
 * 2. Authorization: Bearer <jwt> OR the suwappu_auth session cookie WHERE
 *    the decoded token carries `src` ∈ PROOF_OF_POSSESSION_SRCS
 *    ('telegram' | 'siwe' | 'passkey'). Those claims are only ever set
 *    after a verified possession check (Telegram initData HMAC, wallet-
 *    signature challenge, or passkey assertion respectively). Tokens
 *    minted by POST /public/swap/auth never carry a `src` claim at all
 *    (they only ever contain {userId, walletAddress}), and any mint
 *    explicitly tagged `src: 'weak'` (e.g. python-api's /auth/refresh)
 *    proves nothing — both are rejected here even though they verify fine
 *    against the shared JWT secret.
 *
 * Anything else — including a structurally valid, correctly-signed JWT that
 * lacks an accepted `src` value — is treated as insufficient and rejected
 * with 403 (not 401), since the caller may be "authenticated" for other
 * surfaces but is not authorized for this one.
 */
export function requireProofOfPossession() {
	return async (c: Context, next: Next) => {
		// 1. Telegram init-data — verified HMAC signature, always sufficient.
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
			// Fall through to try JWT.
		}

		// 2. JWT — from the Authorization header or the session cookie — must
		// carry a proof-of-possession `src` claim.
		const authHeader = c.req.header('Authorization')
		const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
		const cookieToken = getCookie(c, SESSION_COOKIE)
		const token = headerToken ?? cookieToken

		if (token) {
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

					if (
						!decoded.src ||
						!(PROOF_OF_POSSESSION_SRCS as readonly string[]).includes(decoded.src)
					) {
						return yield* Effect.fail(new Error('Insufficient credential'))
					}

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

			throw new HTTPException(403, {
				message:
					'Insufficient credentials for this action. This endpoint requires a verified login session (wallet signature, passkey, or Telegram), not a wallet-address token.',
			})
		}

		// 3. No auth provided at all.
		throw new HTTPException(401, { message: 'Authentication required' })
	}
}

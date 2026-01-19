import { Context, Effect, Layer } from 'effect'
import { eq, and, gt } from 'drizzle-orm'
import { DrizzleService, requireDb, passkeyCredentials, passkeyChallenges, users, wallets } from '../db'
import { EnvService } from '../config/EnvService'
import * as crypto from 'crypto'

// Types for WebAuthn responses
export interface RegistrationInitRequest {
	displayName?: string
}

export interface RegistrationInitResponse {
	challenge: string
	userId: string
	userName: string
	rpId: string
	rpName: string
	attestation: 'none' | 'indirect' | 'direct'
}

export interface RegistrationCompleteRequest {
	credentialId: string
	attestationObject: string
	clientDataJSON: string
	transports?: string[]
}

export interface RegistrationCompleteResponse {
	success: boolean
	userId: number
	walletAddress: string
	subOrgId: string
}

export interface AuthenticationInitResponse {
	challenge: string
	rpId: string
	allowCredentials?: { id: string; type: 'public-key' }[]
}

export interface AuthenticationCompleteRequest {
	credentialId: string
	authenticatorData: string
	clientDataJSON: string
	signature: string
	userHandle?: string | null
}

export interface AuthenticationCompleteResponse {
	success: boolean
	token: string
	userId: number
	walletAddress: string
	expiresAt: string
}

export interface TurnkeyWallet {
	id: string
	address: string
	chainType: string
	name: string
}

export interface PasskeyServiceInterface {
	readonly initRegistration: (
		telegramId: number,
		displayName?: string
	) => Effect.Effect<RegistrationInitResponse, Error, DrizzleService>
	readonly completeRegistration: (
		telegramId: number,
		request: RegistrationCompleteRequest
	) => Effect.Effect<RegistrationCompleteResponse, Error, DrizzleService>
	readonly initAuthentication: (
		telegramId?: number
	) => Effect.Effect<AuthenticationInitResponse, Error, DrizzleService>
	readonly completeAuthentication: (
		request: AuthenticationCompleteRequest
	) => Effect.Effect<AuthenticationCompleteResponse, Error, DrizzleService>
	readonly getWallets: (
		telegramId: number
	) => Effect.Effect<TurnkeyWallet[], Error, DrizzleService>
	readonly createWallet: (
		telegramId: number,
		chainType: 'evm' | 'solana',
		name?: string
	) => Effect.Effect<{ address: string; walletId: string }, Error, DrizzleService>
}

export class PasskeyService extends Context.Tag('PasskeyService')<
	PasskeyService,
	PasskeyServiceInterface
>() {}

// Helper to generate secure random bytes as base64url
function generateChallenge(): string {
	const buffer = crypto.randomBytes(32)
	return buffer.toString('base64url')
}

// Helper to generate a JWT token
function generateJWT(payload: object, secret: string, expiresInHours: number): string {
	const header = { alg: 'HS256', typ: 'JWT' }
	const now = Math.floor(Date.now() / 1000)
	const exp = now + expiresInHours * 3600

	const fullPayload = { ...payload, iat: now, exp }

	const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
	const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url')

	const signature = crypto
		.createHmac('sha256', secret)
		.update(`${encodedHeader}.${encodedPayload}`)
		.digest('base64url')

	return `${encodedHeader}.${encodedPayload}.${signature}`
}

// Helper to generate a placeholder wallet address (in production, use Turnkey)
function generateWalletAddress(): string {
	const bytes = crypto.randomBytes(20)
	return `0x${bytes.toString('hex')}`
}

export const PasskeyServiceLive = Layer.effect(
	PasskeyService,
	Effect.gen(function* () {
		const env = yield* EnvService

		return {
			initRegistration: (telegramId: number, displayName?: string) =>
				Effect.gen(function* () {
					const db = yield* requireDb.pipe(
						Effect.mapError((e) => new Error(`Database error: ${e.message}`))
					)

					// Find or create user
					let userResult = yield* Effect.tryPromise({
						try: () => db.select().from(users).where(eq(users.telegramId, telegramId)),
						catch: (e) => new Error(`Failed to find user: ${e}`),
					})

					let userId: number
					if (userResult.length === 0) {
						// Create new user
						const newUser = yield* Effect.tryPromise({
							try: () =>
								db
									.insert(users)
									.values({
										telegramId,
										firstName: displayName || 'Suwappu User',
									})
									.returning(),
							catch: (e) => new Error(`Failed to create user: ${e}`),
						})
						userId = newUser[0].id
					} else {
						userId = userResult[0].id
					}

					// Generate challenge
					const challenge = generateChallenge()
					const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

					// Store challenge
					yield* Effect.tryPromise({
						try: () =>
							db.insert(passkeyChallenges).values({
								challenge,
								userId,
								type: 'registration',
								expiresAt,
							}),
						catch: (e) => new Error(`Failed to store challenge: ${e}`),
					})

					return {
						challenge,
						userId: String(userId),
						userName: displayName || `user_${telegramId}`,
						rpId: env.WEBAUTHN_RP_ID || 'suwappu.bot',
						rpName: env.WEBAUTHN_RP_NAME || 'Suwappu',
						attestation: 'none' as const,
					}
				}),

			completeRegistration: (telegramId: number, request: RegistrationCompleteRequest) =>
				Effect.gen(function* () {
					const db = yield* requireDb.pipe(
						Effect.mapError((e) => new Error(`Database error: ${e.message}`))
					)

					// Find user
					const userResult = yield* Effect.tryPromise({
						try: () => db.select().from(users).where(eq(users.telegramId, telegramId)),
						catch: (e) => new Error(`Failed to find user: ${e}`),
					})

					if (userResult.length === 0) {
						yield* Effect.fail(new Error('User not found'))
					}

					const user = userResult[0]

					// Verify challenge exists and is valid
					const challengeResult = yield* Effect.tryPromise({
						try: () =>
							db
								.select()
								.from(passkeyChallenges)
								.where(
									and(
										eq(passkeyChallenges.userId, user.id),
										eq(passkeyChallenges.type, 'registration'),
										gt(passkeyChallenges.expiresAt, new Date())
									)
								),
						catch: (e) => new Error(`Failed to verify challenge: ${e}`),
					})

					if (challengeResult.length === 0) {
						yield* Effect.fail(new Error('Invalid or expired challenge'))
					}

					// In production, verify the attestation properly using a WebAuthn library
					// For now, we trust the credential and extract the public key

					// Parse clientDataJSON to verify challenge
					const clientDataJSON = JSON.parse(
						Buffer.from(request.clientDataJSON, 'base64url').toString()
					)

					if (clientDataJSON.challenge !== challengeResult[0].challenge) {
						yield* Effect.fail(new Error('Challenge mismatch'))
					}

					// Generate a placeholder sub-org ID (in production, create via Turnkey)
					const subOrgId = `sub_${crypto.randomBytes(16).toString('hex')}`

					// Store credential
					yield* Effect.tryPromise({
						try: () =>
							db.insert(passkeyCredentials).values({
								userId: user.id,
								credentialId: request.credentialId,
								publicKey: request.attestationObject, // Store attestation for now
								counter: 0,
								transports: request.transports ? JSON.stringify(request.transports) : null,
								turnkeySubOrgId: subOrgId,
							}),
						catch: (e) => new Error(`Failed to store credential: ${e}`),
					})

					// Delete used challenge
					yield* Effect.tryPromise({
						try: () =>
							db.delete(passkeyChallenges).where(eq(passkeyChallenges.id, challengeResult[0].id)),
						catch: () => new Error('Failed to cleanup challenge'),
					})

					// Create a default EVM wallet for the user
					const walletAddress = generateWalletAddress()
					const walletId = `wallet_${crypto.randomBytes(16).toString('hex')}`

					yield* Effect.tryPromise({
						try: () =>
							db.insert(wallets).values({
								userId: user.id,
								address: walletAddress,
								chainType: 'evm',
								walletProvider: 'turnkey',
								turnkeySubOrgId: subOrgId,
								turnkeyWalletId: walletId,
								isDefault: true,
								name: 'Passkey Wallet',
							}),
						catch: (e) => new Error(`Failed to create wallet: ${e}`),
					})

					return {
						success: true,
						userId: user.id,
						walletAddress,
						subOrgId,
					}
				}),

			initAuthentication: (telegramId?: number) =>
				Effect.gen(function* () {
					const db = yield* requireDb.pipe(
						Effect.mapError((e) => new Error(`Database error: ${e.message}`))
					)

					const challenge = generateChallenge()
					const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

					// If telegramId provided, get user's credentials
					let allowCredentials: { id: string; type: 'public-key' }[] | undefined

					if (telegramId) {
						const userResult = yield* Effect.tryPromise({
							try: () => db.select().from(users).where(eq(users.telegramId, telegramId)),
							catch: (e) => new Error(`Failed to find user: ${e}`),
						})

						if (userResult.length > 0) {
							const credentials = yield* Effect.tryPromise({
								try: () =>
									db
										.select()
										.from(passkeyCredentials)
										.where(eq(passkeyCredentials.userId, userResult[0].id)),
								catch: (e) => new Error(`Failed to get credentials: ${e}`),
							})

							if (credentials.length > 0) {
								allowCredentials = credentials.map((c) => ({
									id: c.credentialId,
									type: 'public-key' as const,
								}))
							}

							// Store challenge with user association
							yield* Effect.tryPromise({
								try: () =>
									db.insert(passkeyChallenges).values({
										challenge,
										userId: userResult[0].id,
										type: 'authentication',
										expiresAt,
									}),
								catch: (e) => new Error(`Failed to store challenge: ${e}`),
							})
						}
					} else {
						// Discoverable credential flow - store challenge without user
						yield* Effect.tryPromise({
							try: () =>
								db.insert(passkeyChallenges).values({
									challenge,
									type: 'authentication',
									expiresAt,
								}),
							catch: (e) => new Error(`Failed to store challenge: ${e}`),
						})
					}

					return {
						challenge,
						rpId: env.WEBAUTHN_RP_ID || 'suwappu.bot',
						allowCredentials,
					}
				}),

			completeAuthentication: (request: AuthenticationCompleteRequest) =>
				Effect.gen(function* () {
					const db = yield* requireDb.pipe(
						Effect.mapError((e) => new Error(`Database error: ${e.message}`))
					)

					// Find credential
					const credentialResult = yield* Effect.tryPromise({
						try: () =>
							db
								.select()
								.from(passkeyCredentials)
								.where(eq(passkeyCredentials.credentialId, request.credentialId)),
						catch: (e) => new Error(`Failed to find credential: ${e}`),
					})

					if (credentialResult.length === 0) {
						yield* Effect.fail(new Error('Credential not found'))
					}

					const credential = credentialResult[0]

					// Parse clientDataJSON to verify challenge
					const clientDataJSON = JSON.parse(
						Buffer.from(request.clientDataJSON, 'base64url').toString()
					)

					// Verify challenge exists
					const challengeResult = yield* Effect.tryPromise({
						try: () =>
							db
								.select()
								.from(passkeyChallenges)
								.where(
									and(
										eq(passkeyChallenges.challenge, clientDataJSON.challenge),
										eq(passkeyChallenges.type, 'authentication'),
										gt(passkeyChallenges.expiresAt, new Date())
									)
								),
						catch: (e) => new Error(`Failed to verify challenge: ${e}`),
					})

					if (challengeResult.length === 0) {
						yield* Effect.fail(new Error('Invalid or expired challenge'))
					}

					// In production, verify the signature using the stored public key
					// For now, we trust the authenticator response

					// Update counter to prevent replay attacks
					yield* Effect.tryPromise({
						try: () =>
							db
								.update(passkeyCredentials)
								.set({
									counter: credential.counter + 1,
									lastUsedAt: new Date(),
								})
								.where(eq(passkeyCredentials.id, credential.id)),
						catch: (e) => new Error(`Failed to update counter: ${e}`),
					})

					// Delete used challenge
					yield* Effect.tryPromise({
						try: () =>
							db.delete(passkeyChallenges).where(eq(passkeyChallenges.id, challengeResult[0].id)),
						catch: () => new Error('Failed to cleanup challenge'),
					})

					// Get user and default wallet
					const userResult = yield* Effect.tryPromise({
						try: () => db.select().from(users).where(eq(users.id, credential.userId)),
						catch: (e) => new Error(`Failed to get user: ${e}`),
					})

					const walletResult = yield* Effect.tryPromise({
						try: () =>
							db
								.select()
								.from(wallets)
								.where(and(eq(wallets.userId, credential.userId), eq(wallets.isDefault, true))),
						catch: (e) => new Error(`Failed to get wallet: ${e}`),
					})

					const walletAddress = walletResult.length > 0 ? walletResult[0].address : ''

					// Generate JWT token
					const expiresAt = new Date(
						Date.now() + (env.JWT_EXPIRY_HOURS || 24) * 60 * 60 * 1000
					)
					const token = generateJWT(
						{
							userId: credential.userId,
							telegramId: userResult[0]?.telegramId,
							walletAddress,
						},
						env.JWT_SECRET || 'development-secret',
						env.JWT_EXPIRY_HOURS || 24
					)

					return {
						success: true,
						token,
						userId: credential.userId,
						walletAddress,
						expiresAt: expiresAt.toISOString(),
					}
				}),

			getWallets: (telegramId: number) =>
				Effect.gen(function* () {
					const db = yield* requireDb.pipe(
						Effect.mapError((e) => new Error(`Database error: ${e.message}`))
					)

					// Find user
					const userResult = yield* Effect.tryPromise({
						try: () => db.select().from(users).where(eq(users.telegramId, telegramId)),
						catch: (e) => new Error(`Failed to find user: ${e}`),
					})

					if (userResult.length === 0) {
						return []
					}

					// Get Turnkey wallets
					const walletResult = yield* Effect.tryPromise({
						try: () =>
							db
								.select()
								.from(wallets)
								.where(
									and(
										eq(wallets.userId, userResult[0].id),
										eq(wallets.walletProvider, 'turnkey'),
										eq(wallets.isActive, true)
									)
								),
						catch: (e) => new Error(`Failed to get wallets: ${e}`),
					})

					return walletResult.map((w) => ({
						id: w.turnkeyWalletId || String(w.id),
						address: w.address,
						chainType: w.chainType,
						name: w.name || 'Wallet',
					}))
				}),

			createWallet: (telegramId: number, chainType: 'evm' | 'solana', name?: string) =>
				Effect.gen(function* () {
					const db = yield* requireDb.pipe(
						Effect.mapError((e) => new Error(`Database error: ${e.message}`))
					)

					// Find user
					const userResult = yield* Effect.tryPromise({
						try: () => db.select().from(users).where(eq(users.telegramId, telegramId)),
						catch: (e) => new Error(`Failed to find user: ${e}`),
					})

					if (userResult.length === 0) {
						yield* Effect.fail(new Error('User not found'))
					}

					const user = userResult[0]

					// Get user's passkey credential for sub-org ID
					const credResult = yield* Effect.tryPromise({
						try: () =>
							db.select().from(passkeyCredentials).where(eq(passkeyCredentials.userId, user.id)),
						catch: (e) => new Error(`Failed to get credentials: ${e}`),
					})

					const subOrgId = credResult.length > 0 ? credResult[0].turnkeySubOrgId : null

					if (!subOrgId) {
						yield* Effect.fail(new Error('No Turnkey sub-organization found. Please create a passkey first.'))
					}

					// In production, call Turnkey API to create wallet
					// For now, generate placeholder values
					const walletAddress =
						chainType === 'solana'
							? crypto.randomBytes(32).toString('hex') // Placeholder Solana-style address
							: generateWalletAddress()
					const walletId = `wallet_${crypto.randomBytes(16).toString('hex')}`

					yield* Effect.tryPromise({
						try: () =>
							db.insert(wallets).values({
								userId: user.id,
								address: walletAddress,
								chainType,
								walletProvider: 'turnkey',
								turnkeySubOrgId: subOrgId,
								turnkeyWalletId: walletId,
								name: name || `${chainType.toUpperCase()} Wallet`,
							}),
						catch: (e) => new Error(`Failed to create wallet: ${e}`),
					})

					return {
						address: walletAddress,
						walletId,
					}
				}),
		}
	})
)

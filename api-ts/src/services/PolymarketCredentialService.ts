import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../config/EnvService'
import { type DrizzleService, requireDb, polymarketAccounts } from '../db'
import type { ClobApiCredentials } from './PolymarketService'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function encrypt(plaintext: string, key: Buffer): { encrypted: string; nonce: string } {
	const iv = crypto.randomBytes(IV_LENGTH)
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	const authTag = cipher.getAuthTag()
	return {
		encrypted: Buffer.concat([encrypted, authTag]).toString('base64'),
		nonce: iv.toString('base64'),
	}
}

function decrypt(ciphertext: string, nonce: string, key: Buffer): string {
	const iv = Buffer.from(nonce, 'base64')
	const raw = Buffer.from(ciphertext, 'base64')
	const authTag = raw.subarray(raw.length - AUTH_TAG_LENGTH)
	const encrypted = raw.subarray(0, raw.length - AUTH_TAG_LENGTH)
	const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
	decipher.setAuthTag(authTag)
	return decipher.update(encrypted) + decipher.final('utf8')
}

function deriveKey(secret: string): Buffer {
	return crypto.createHash('sha256').update(secret).digest()
}

export interface PolymarketCredentialServiceInterface {
	readonly getCredentials: (agentId: string) => Effect.Effect<ClobApiCredentials | null, Error, DrizzleService>
	readonly storeCredentials: (agentId: string, walletAddress: string, credentials: ClobApiCredentials) => Effect.Effect<void, Error, DrizzleService>
	readonly deleteCredentials: (agentId: string) => Effect.Effect<void, Error, DrizzleService>
}

export class PolymarketCredentialService extends Context.Tag('PolymarketCredentialService')<
	PolymarketCredentialService,
	PolymarketCredentialServiceInterface
>() {}

export const PolymarketCredentialServiceLive = Layer.effect(
	PolymarketCredentialService,
	Effect.gen(function* () {
		const env = yield* EnvService

		const getEncryptionKey = () =>
			Effect.gen(function* () {
				const keyMaterial = env.POLYMARKET_CREDENTIAL_KEY
				if (!keyMaterial) {
					return yield* Effect.fail(new Error('POLYMARKET_CREDENTIAL_KEY not configured'))
				}
				return deriveKey(keyMaterial)
			})

		const getCredentials = (agentId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const key = yield* getEncryptionKey()

				const rows = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(polymarketAccounts)
							.where(eq(polymarketAccounts.agentId, agentId))
							.limit(1),
					catch: (e) => new Error(`Failed to fetch polymarket credentials: ${e}`),
				})

				const row = rows[0]
				if (!row || !row.isActive) return null

				const nonce = row.aesgcmNonce || ''

				// New scheme: single encrypted JSON blob (sentinel __BLOB__ in other columns)
				if (row.apiSecretEncrypted === '__BLOB__') {
					const blob = decrypt(row.apiKeyEncrypted, nonce, key)
					return JSON.parse(blob) as ClobApiCredentials
				}

				// Legacy per-field decryption (should not exist in practice)
				return {
					apiKey: decrypt(row.apiKeyEncrypted, nonce, key),
					secret: decrypt(row.apiSecretEncrypted, nonce, key),
					passphrase: decrypt(row.passphraseEncrypted, nonce, key),
				}
			})

		const storeCredentials = (agentId: string, walletAddress: string, credentials: ClobApiCredentials) =>
			Effect.gen(function* () {
				const db = yield* requireDb
				const key = yield* getEncryptionKey()

				// Encrypt as single JSON blob to avoid AES-GCM nonce reuse
				const blob = JSON.stringify({
					apiKey: credentials.apiKey,
					secret: credentials.secret,
					passphrase: credentials.passphrase,
				})
				const enc = encrypt(blob, key)

				yield* Effect.tryPromise({
					try: () =>
						db
							.insert(polymarketAccounts)
							.values({
								agentId,
								walletAddress,
								apiKeyEncrypted: enc.encrypted,
								apiSecretEncrypted: '__BLOB__',
								passphraseEncrypted: '__BLOB__',
								encryptionScheme: ALGORITHM,
								aesgcmNonce: enc.nonce,
								isActive: true,
								updatedAt: new Date(),
							})
							.onConflictDoUpdate({
								target: polymarketAccounts.agentId,
								set: {
									walletAddress,
									apiKeyEncrypted: enc.encrypted,
									apiSecretEncrypted: '__BLOB__',
									passphraseEncrypted: '__BLOB__',
									encryptionScheme: ALGORITHM,
									aesgcmNonce: enc.nonce,
									isActive: true,
									updatedAt: new Date(),
								},
							}),
					catch: (e) => new Error(`Failed to store polymarket credentials: ${e}`),
				})
			})

		const deleteCredentials = (agentId: string) =>
			Effect.gen(function* () {
				const db = yield* requireDb

				yield* Effect.tryPromise({
					try: () =>
						db
							.delete(polymarketAccounts)
							.where(eq(polymarketAccounts.agentId, agentId)),
					catch: (e) => new Error(`Failed to delete polymarket credentials: ${e}`),
				})
			})

		return {
			getCredentials,
			storeCredentials,
			deleteCredentials,
		}
	}),
)

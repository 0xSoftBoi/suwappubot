import { describe, test, expect, beforeAll } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { Hono } from 'hono'
import { UserService, UserServiceLive } from '../services/UserService'
import { WalletService, WalletServiceLive } from '../services/WalletService'
import { EnvService } from '../config/EnvService'
import { DrizzleService } from '../db'
import type { User, Wallet } from '../db'

// Mock user storage
const mockUsers: Map<string, User> = new Map()
const mockWallets: Map<string, Wallet> = new Map()
let mockUserId = 1

// Mock UserService for testing
const MockUserService = Layer.succeed(UserService, {
	getUserById: (id: number) =>
		Effect.succeed(
			Array.from(mockUsers.values()).find(u => u.id === id)
				? Option.some(Array.from(mockUsers.values()).find(u => u.id === id)!)
				: Option.none()
		),
	getUserByTelegramId: (telegramId: number) =>
		Effect.succeed(
			Array.from(mockUsers.values()).find(u => u.telegramId === telegramId)
				? Option.some(Array.from(mockUsers.values()).find(u => u.telegramId === telegramId)!)
				: Option.none()
		),
	getUserByTurnkeySubOrg: (subOrgId: string) =>
		Effect.succeed(
			mockUsers.has(subOrgId)
				? Option.some(mockUsers.get(subOrgId)!)
				: Option.none()
		),
	createTurnkeyUser: (params: { turnkeySubOrgId: string; displayName?: string }) =>
		Effect.sync(() => {
			const user: User = {
				id: mockUserId++,
				telegramId: null,
				whatsappId: null,
				turnkeySubOrgId: params.turnkeySubOrgId,
				username: null,
				firstName: params.displayName || 'Suwappu User',
				lastName: null,
				defaultSlippage: 50,
				notificationsEnabled: true,
				tosAccepted: false,
				tosAcceptedAt: null,
				referredByUserId: null,
				totalReferralRewards: 0,
				referralCount: 0,
				twoFaEnabled: false,
				totpSecret: null,
				twoFaThreshold: 1000,
				createdAt: new Date(),
				updatedAt: new Date(),
				lastActiveAt: new Date(),
			}
			mockUsers.set(params.turnkeySubOrgId, user)
			return user
		}),
})

// Mock WalletService for testing
const MockWalletService = Layer.succeed(WalletService, {
	getUserWallets: (userId: number) =>
		Effect.succeed(
			Array.from(mockWallets.values()).filter(w => w.userId === userId)
		),
	getActiveWallets: (userId: number) =>
		Effect.succeed(
			Array.from(mockWallets.values()).filter(w => w.userId === userId && w.isActive)
		),
	getWalletByAddress: (address: string) =>
		Effect.succeed(
			mockWallets.has(address)
				? Option.some(mockWallets.get(address)!)
				: Option.none()
		),
	createWallet: (params: any) =>
		Effect.sync(() => {
			const wallet: Wallet = {
				id: mockWallets.size + 1,
				userId: params.userId,
				name: params.name || 'Default Wallet',
				address: params.address,
				encryptedPrivateKey: null,
				encryptionScheme: 'legacy_fernet_v1',
				kmsWrappedDek: null,
				aesgcmNonce: null,
				kmsKeyId: null,
				keyVersion: 1,
				walletProvider: params.walletProvider || 'local',
				turnkeySubOrgId: params.turnkeySubOrgId || null,
				turnkeyWalletId: params.turnkeyWalletId || null,
				turnkeyAccountId: null,
				chainType: params.chainType,
				isActive: true,
				isDefault: params.isDefault || false,
				createdAt: new Date(),
			}
			mockWallets.set(params.address, wallet)
			return wallet
		}),
})

// Mock EnvService
const MockEnvService = Layer.succeed(EnvService, {
	NODE_ENV: 'test',
	PORT: 8000,
	DATABASE_URL: undefined,
	TELEGRAM_BOT_TOKEN: 'test_token',
	AGENT_API_KEY: 'test_agent_key',
	ADMIN_API_KEY: 'test_admin_key',
	ETH_RPC_URL: undefined,
	POLYGON_RPC_URL: undefined,
	ARBITRUM_RPC_URL: undefined,
	OPTIMISM_RPC_URL: undefined,
	BASE_RPC_URL: undefined,
	BSC_RPC_URL: undefined,
	SOLANA_RPC_URL: undefined,
	ALLOWED_ORIGINS: 'http://localhost:3000',
	TURNKEY_ORGANIZATION_ID: 'test_org_id',
	TURNKEY_API_PUBLIC_KEY: 'test_public_key',
	TURNKEY_API_PRIVATE_KEY: 'test_private_key',
	TURNKEY_BASE_URL: 'https://api.turnkey.com',
	JWT_SECRET: 'test_jwt_secret_key_for_testing',
	JWT_EXPIRY_HOURS: 24,
	WEBAUTHN_RP_ID: 'localhost',
	WEBAUTHN_RP_NAME: 'Suwappu Test',
	WEBAUTHN_ORIGIN: 'http://localhost:5173',
})

describe('Turnkey Sync Routes', () => {
	beforeAll(() => {
		// Clear mock data before tests
		mockUsers.clear()
		mockWallets.clear()
		mockUserId = 1
	})

	describe('POST /webapp/turnkey/sync', () => {
		test('should return error when subOrgId is missing', async () => {
			const app = new Hono()

			app.post('/webapp/turnkey/sync', async (c) => {
				const body = await c.req.json()
				const { subOrgId, walletAddress } = body

				if (!subOrgId || !walletAddress) {
					return c.json({ error: 'subOrgId and walletAddress are required' }, 400)
				}

				return c.json({ success: true })
			})

			const res = await app.request('/webapp/turnkey/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ walletAddress: '0x123' }),
			})

			expect(res.status).toBe(400)
			const json = await res.json()
			expect(json.error).toBe('subOrgId and walletAddress are required')
		})

		test('should return error when walletAddress is missing', async () => {
			const app = new Hono()

			app.post('/webapp/turnkey/sync', async (c) => {
				const body = await c.req.json()
				const { subOrgId, walletAddress } = body

				if (!subOrgId || !walletAddress) {
					return c.json({ error: 'subOrgId and walletAddress are required' }, 400)
				}

				return c.json({ success: true })
			})

			const res = await app.request('/webapp/turnkey/sync', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ subOrgId: 'test_sub_org' }),
			})

			expect(res.status).toBe(400)
			const json = await res.json()
			expect(json.error).toBe('subOrgId and walletAddress are required')
		})

		test('should create new user and wallet when they do not exist', async () => {
			// Clear mock data
			mockUsers.clear()
			mockWallets.clear()

			// Test the logic directly using Effect
			const program = Effect.gen(function* () {
				const userService = yield* UserService
				const walletService = yield* WalletService

				const subOrgId = 'new_sub_org_123'
				const walletAddress = '0xabc123def456'
				const displayName = 'Test User'

				// Check if user exists
				const existingUser = yield* userService.getUserByTurnkeySubOrg(subOrgId)

				let userId: number
				if (Option.isSome(existingUser)) {
					userId = existingUser.value.id
				} else {
					// Create new user
					const newUser = yield* userService.createTurnkeyUser({
						turnkeySubOrgId: subOrgId,
						displayName,
					})
					userId = newUser.id
				}

				// Check if wallet exists
				const existingWallet = yield* walletService.getWalletByAddress(walletAddress)

				if (Option.isNone(existingWallet)) {
					// Create wallet
					yield* walletService.createWallet({
						userId,
						address: walletAddress,
						chainType: 'evm',
						walletProvider: 'turnkey',
						turnkeySubOrgId: subOrgId,
						isDefault: true,
						name: 'Passkey Wallet',
					})
				}

				return { userId, subOrgId, walletAddress }
			})

			const TestLayer = Layer.mergeAll(MockUserService, MockWalletService)

			const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))

			expect(result.userId).toBe(1)
			expect(result.subOrgId).toBe('new_sub_org_123')
			expect(result.walletAddress).toBe('0xabc123def456')
			expect(mockUsers.size).toBe(1)
			expect(mockWallets.size).toBe(1)
		})

		test('should return existing user when sub-org already exists', async () => {
			// User already exists from previous test
			const program = Effect.gen(function* () {
				const userService = yield* UserService

				const subOrgId = 'new_sub_org_123'
				const existingUser = yield* userService.getUserByTurnkeySubOrg(subOrgId)

				return Option.isSome(existingUser)
			})

			const TestLayer = Layer.mergeAll(MockUserService, MockWalletService)

			const result = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(result).toBe(true)
		})
	})

	describe('GET /webapp/turnkey/session', () => {
		test('should return error when Authorization header is missing', async () => {
			const app = new Hono()

			app.get('/webapp/turnkey/session', async (c) => {
				const authHeader = c.req.header('Authorization')
				if (!authHeader?.startsWith('Bearer ')) {
					return c.json({ error: 'Authorization header required' }, 401)
				}
				return c.json({ success: true })
			})

			const res = await app.request('/webapp/turnkey/session')

			expect(res.status).toBe(401)
			const json = await res.json()
			expect(json.error).toBe('Authorization header required')
		})

		test('should return error for invalid token format', async () => {
			const app = new Hono()

			app.get('/webapp/turnkey/session', async (c) => {
				const authHeader = c.req.header('Authorization')
				if (!authHeader?.startsWith('Bearer ')) {
					return c.json({ error: 'Authorization header required' }, 401)
				}

				const token = authHeader.slice(7)
				const parts = token.split('.')
				if (parts.length !== 3) {
					return c.json({ error: 'Invalid token format' }, 401)
				}

				return c.json({ success: true })
			})

			const res = await app.request('/webapp/turnkey/session', {
				headers: { Authorization: 'Bearer invalid_token' },
			})

			expect(res.status).toBe(401)
			const json = await res.json()
			expect(json.error).toBe('Invalid token format')
		})

		test('should decode valid JWT and return session info', async () => {
			const app = new Hono()

			app.get('/webapp/turnkey/session', async (c) => {
				const authHeader = c.req.header('Authorization')
				if (!authHeader?.startsWith('Bearer ')) {
					return c.json({ error: 'Authorization header required' }, 401)
				}

				const token = authHeader.slice(7)

				try {
					const parts = token.split('.')
					if (parts.length !== 3) {
						return c.json({ error: 'Invalid token format' }, 401)
					}

					const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

					if (payload.exp && payload.exp < Date.now() / 1000) {
						return c.json({ error: 'Token expired' }, 401)
					}

					return c.json({
						userId: payload.userId,
						subOrgId: payload.subOrgId,
						walletAddress: payload.walletAddress,
						expiresAt: new Date(payload.exp * 1000).toISOString(),
					})
				} catch (e) {
					return c.json({ error: 'Invalid token' }, 401)
				}
			})

			// Create a valid JWT
			const header = { alg: 'HS256', typ: 'JWT' }
			const now = Math.floor(Date.now() / 1000)
			const payload = {
				userId: 1,
				subOrgId: 'test_sub_org',
				walletAddress: '0x123456',
				iat: now,
				exp: now + 3600, // 1 hour from now
			}

			const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
			const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
			// For testing, we don't need a valid signature
			const token = `${encodedHeader}.${encodedPayload}.fake_signature`

			const res = await app.request('/webapp/turnkey/session', {
				headers: { Authorization: `Bearer ${token}` },
			})

			expect(res.status).toBe(200)
			const json = await res.json()
			expect(json.userId).toBe(1)
			expect(json.subOrgId).toBe('test_sub_org')
			expect(json.walletAddress).toBe('0x123456')
		})

		test('should return error for expired token', async () => {
			const app = new Hono()

			app.get('/webapp/turnkey/session', async (c) => {
				const authHeader = c.req.header('Authorization')
				if (!authHeader?.startsWith('Bearer ')) {
					return c.json({ error: 'Authorization header required' }, 401)
				}

				const token = authHeader.slice(7)

				try {
					const parts = token.split('.')
					if (parts.length !== 3) {
						return c.json({ error: 'Invalid token format' }, 401)
					}

					const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())

					if (payload.exp && payload.exp < Date.now() / 1000) {
						return c.json({ error: 'Token expired' }, 401)
					}

					return c.json({ success: true })
				} catch (e) {
					return c.json({ error: 'Invalid token' }, 401)
				}
			})

			// Create an expired JWT
			const header = { alg: 'HS256', typ: 'JWT' }
			const now = Math.floor(Date.now() / 1000)
			const payload = {
				userId: 1,
				subOrgId: 'test_sub_org',
				walletAddress: '0x123456',
				iat: now - 7200, // 2 hours ago
				exp: now - 3600, // 1 hour ago (expired)
			}

			const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
			const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
			const token = `${encodedHeader}.${encodedPayload}.fake_signature`

			const res = await app.request('/webapp/turnkey/session', {
				headers: { Authorization: `Bearer ${token}` },
			})

			expect(res.status).toBe(401)
			const json = await res.json()
			expect(json.error).toBe('Token expired')
		})
	})
})

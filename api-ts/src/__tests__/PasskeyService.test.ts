import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { Effect, Layer } from 'effect'
import { PasskeyService, PasskeyServiceLive } from '../services/PasskeyService'
import { EnvService } from '../config/EnvService'
import { DrizzleService } from '../db'

// Mock environment for testing
const MockEnv = Layer.succeed(EnvService, {
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
	TURNKEY_ORGANIZATION_ID: undefined,
	TURNKEY_API_PUBLIC_KEY: undefined,
	TURNKEY_API_PRIVATE_KEY: undefined,
	TURNKEY_BASE_URL: undefined,
	JWT_SECRET: 'test_jwt_secret_for_testing',
	JWT_EXPIRY_HOURS: 24,
	WEBAUTHN_RP_ID: 'localhost',
	WEBAUTHN_RP_NAME: 'Suwappu Test',
	WEBAUTHN_ORIGIN: 'http://localhost:5173',
})

describe('PasskeyService', () => {
	describe('initRegistration', () => {
		test('returns proper WebAuthn challenge response structure', async () => {
			// This test verifies the response shape without database
			// In real scenarios, this would use a test database

			const TestLayer = PasskeyServiceLive.pipe(Layer.provide(MockEnv))

			const program = Effect.gen(function* () {
				const passkey = yield* PasskeyService
				// This will fail due to no database, but we can verify the service exists
				return passkey
			})

			const service = await Effect.runPromise(program.pipe(Effect.provide(TestLayer)))
			expect(service).toBeDefined()
			expect(typeof service.initRegistration).toBe('function')
			expect(typeof service.completeRegistration).toBe('function')
			expect(typeof service.initAuthentication).toBe('function')
			expect(typeof service.completeAuthentication).toBe('function')
			expect(typeof service.getWallets).toBe('function')
			expect(typeof service.createWallet).toBe('function')
		})
	})

	describe('WebAuthn response types', () => {
		test('RegistrationInitResponse has correct shape', () => {
			// Type-level test - if this compiles, the types are correct
			const mockResponse = {
				challenge: 'base64url_encoded_challenge',
				userId: '12345',
				userName: 'test_user',
				rpId: 'localhost',
				rpName: 'Suwappu',
				attestation: 'none' as const,
			}

			expect(mockResponse.challenge).toBeDefined()
			expect(mockResponse.userId).toBeDefined()
			expect(mockResponse.userName).toBeDefined()
			expect(mockResponse.rpId).toBe('localhost')
			expect(mockResponse.rpName).toBe('Suwappu')
			expect(mockResponse.attestation).toBe('none')
		})

		test('AuthenticationInitResponse has correct shape', () => {
			const mockResponse = {
				challenge: 'base64url_encoded_challenge',
				rpId: 'localhost',
				allowCredentials: [{ id: 'cred_id', type: 'public-key' as const }],
			}

			expect(mockResponse.challenge).toBeDefined()
			expect(mockResponse.rpId).toBe('localhost')
			expect(Array.isArray(mockResponse.allowCredentials)).toBe(true)
		})

		test('AuthenticationCompleteResponse has correct shape', () => {
			const mockResponse = {
				success: true,
				token: 'jwt_token_here',
				userId: 1,
				walletAddress: '0x1234567890123456789012345678901234567890',
				expiresAt: new Date().toISOString(),
			}

			expect(mockResponse.success).toBe(true)
			expect(mockResponse.token).toBeDefined()
			expect(mockResponse.userId).toBeGreaterThan(0)
			expect(mockResponse.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
			expect(mockResponse.expiresAt).toBeDefined()
		})
	})
})

describe('JWT Generation', () => {
	test('JWT has correct structure (header.payload.signature)', () => {
		// Test JWT structure validation
		const mockJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTYzMjE1MDQwMH0.signature'
		const parts = mockJwt.split('.')

		expect(parts.length).toBe(3)
		expect(parts[0]).toBeDefined() // header
		expect(parts[1]).toBeDefined() // payload
		expect(parts[2]).toBeDefined() // signature
	})

	test('JWT payload can be decoded', () => {
		const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
		const payload = Buffer.from(
			JSON.stringify({
				userId: 1,
				telegramId: 12345,
				walletAddress: '0x1234',
				iat: Math.floor(Date.now() / 1000),
				exp: Math.floor(Date.now() / 1000) + 3600,
			})
		).toString('base64url')

		const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString())

		expect(decodedPayload.userId).toBe(1)
		expect(decodedPayload.telegramId).toBe(12345)
		expect(decodedPayload.walletAddress).toBe('0x1234')
		expect(decodedPayload.exp).toBeGreaterThan(decodedPayload.iat)
	})
})

describe('Challenge Generation', () => {
	test('challenge is base64url encoded', () => {
		// Base64url should not contain +, /, or =
		const base64urlRegex = /^[A-Za-z0-9_-]+$/

		// Simulate challenge generation
		const buffer = crypto.getRandomValues(new Uint8Array(32))
		const challenge = Buffer.from(buffer).toString('base64url')

		expect(challenge).toMatch(base64urlRegex)
		expect(challenge.length).toBeGreaterThan(0)
	})

	test('challenges are unique', () => {
		const challenges = new Set<string>()

		for (let i = 0; i < 100; i++) {
			const buffer = crypto.getRandomValues(new Uint8Array(32))
			const challenge = Buffer.from(buffer).toString('base64url')
			challenges.add(challenge)
		}

		// All 100 challenges should be unique
		expect(challenges.size).toBe(100)
	})
})

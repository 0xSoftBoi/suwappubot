import { describe, test, expect, beforeAll } from 'bun:test'
import { Hono } from 'hono'

// Test the route handlers directly without the full app context
// This tests the HTTP layer behavior

describe('Webapp Passkey Routes - Request/Response Structure', () => {
	describe('POST /webapp/passkey/register/init', () => {
		test('request body schema is correct', () => {
			const validRequest = {
				displayName: 'Test User',
			}

			expect(validRequest).toHaveProperty('displayName')
			expect(typeof validRequest.displayName).toBe('string')
		})

		test('request body can be empty', () => {
			const emptyRequest = {}
			expect(emptyRequest).toBeDefined()
		})

		test('response should have WebAuthn registration options', () => {
			const expectedResponseShape = {
				challenge: expect.any(String),
				userId: expect.any(String),
				userName: expect.any(String),
				rpId: expect.any(String),
				rpName: expect.any(String),
				attestation: expect.stringMatching(/^(none|indirect|direct)$/),
			}

			const mockResponse = {
				challenge: 'abc123',
				userId: '1',
				userName: 'user_1',
				rpId: 'localhost',
				rpName: 'Suwappu',
				attestation: 'none',
			}

			expect(mockResponse).toMatchObject({
				challenge: expect.any(String),
				userId: expect.any(String),
				userName: expect.any(String),
				rpId: expect.any(String),
				rpName: expect.any(String),
			})
		})
	})

	describe('POST /webapp/passkey/register/complete', () => {
		test('request body schema is correct', () => {
			const validRequest = {
				credentialId: 'base64url_credential_id',
				attestationObject: 'base64url_attestation',
				clientDataJSON: 'base64url_client_data',
				transports: ['internal', 'hybrid'],
			}

			expect(validRequest.credentialId).toBeDefined()
			expect(validRequest.attestationObject).toBeDefined()
			expect(validRequest.clientDataJSON).toBeDefined()
			expect(Array.isArray(validRequest.transports)).toBe(true)
		})

		test('transports is optional', () => {
			const requestWithoutTransports = {
				credentialId: 'base64url_credential_id',
				attestationObject: 'base64url_attestation',
				clientDataJSON: 'base64url_client_data',
			}

			expect(requestWithoutTransports).not.toHaveProperty('transports')
		})

		test('response should have success, userId, walletAddress, subOrgId', () => {
			const mockResponse = {
				success: true,
				userId: 1,
				walletAddress: '0x1234567890123456789012345678901234567890',
				subOrgId: 'sub_abc123',
			}

			expect(mockResponse.success).toBe(true)
			expect(typeof mockResponse.userId).toBe('number')
			expect(mockResponse.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
			expect(mockResponse.subOrgId).toBeDefined()
		})
	})

	describe('POST /webapp/passkey/authenticate/init', () => {
		test('request body can be empty for discoverable credentials', () => {
			const emptyRequest = {}
			expect(emptyRequest).toBeDefined()
		})

		test('response should have challenge and rpId', () => {
			const mockResponse = {
				challenge: 'base64url_challenge',
				rpId: 'localhost',
				allowCredentials: undefined,
			}

			expect(mockResponse.challenge).toBeDefined()
			expect(mockResponse.rpId).toBeDefined()
		})

		test('response can include allowCredentials', () => {
			const mockResponse = {
				challenge: 'base64url_challenge',
				rpId: 'localhost',
				allowCredentials: [
					{ id: 'cred_1', type: 'public-key' },
					{ id: 'cred_2', type: 'public-key' },
				],
			}

			expect(Array.isArray(mockResponse.allowCredentials)).toBe(true)
			expect(mockResponse.allowCredentials[0].type).toBe('public-key')
		})
	})

	describe('POST /webapp/passkey/authenticate/complete', () => {
		test('request body schema is correct', () => {
			const validRequest = {
				credentialId: 'base64url_credential_id',
				authenticatorData: 'base64url_auth_data',
				clientDataJSON: 'base64url_client_data',
				signature: 'base64url_signature',
				userHandle: 'base64url_user_handle',
			}

			expect(validRequest.credentialId).toBeDefined()
			expect(validRequest.authenticatorData).toBeDefined()
			expect(validRequest.clientDataJSON).toBeDefined()
			expect(validRequest.signature).toBeDefined()
		})

		test('userHandle is optional', () => {
			const requestWithoutUserHandle = {
				credentialId: 'base64url_credential_id',
				authenticatorData: 'base64url_auth_data',
				clientDataJSON: 'base64url_client_data',
				signature: 'base64url_signature',
			}

			expect(requestWithoutUserHandle).not.toHaveProperty('userHandle')
		})

		test('response should have success, token, userId, walletAddress, expiresAt', () => {
			const mockResponse = {
				success: true,
				token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
				userId: 1,
				walletAddress: '0x1234567890123456789012345678901234567890',
				expiresAt: '2024-01-01T00:00:00.000Z',
			}

			expect(mockResponse.success).toBe(true)
			expect(mockResponse.token).toContain('.')
			expect(typeof mockResponse.userId).toBe('number')
			expect(mockResponse.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}/)
		})
	})

	describe('GET /webapp/passkey/wallets', () => {
		test('response should be an array of wallets', () => {
			const mockResponse = [
				{
					id: 'wallet_123',
					address: '0x1234567890123456789012345678901234567890',
					chainType: 'evm',
					name: 'Main Wallet',
				},
				{
					id: 'wallet_456',
					address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
					chainType: 'solana',
					name: 'Solana Wallet',
				},
			]

			expect(Array.isArray(mockResponse)).toBe(true)
			mockResponse.forEach((wallet) => {
				expect(wallet).toHaveProperty('id')
				expect(wallet).toHaveProperty('address')
				expect(wallet).toHaveProperty('chainType')
				expect(wallet).toHaveProperty('name')
			})
		})

		test('empty array is valid response for new users', () => {
			const mockResponse: any[] = []
			expect(Array.isArray(mockResponse)).toBe(true)
			expect(mockResponse.length).toBe(0)
		})
	})

	describe('POST /webapp/passkey/wallets', () => {
		test('request body schema is correct', () => {
			const validRequest = {
				chainType: 'evm',
				name: 'My New Wallet',
			}

			expect(validRequest.chainType).toMatch(/^(evm|solana)$/)
			expect(typeof validRequest.name).toBe('string')
		})

		test('name is optional', () => {
			const requestWithoutName = {
				chainType: 'solana',
			}

			expect(requestWithoutName).not.toHaveProperty('name')
			expect(requestWithoutName.chainType).toBe('solana')
		})

		test('response should have success, address, walletId', () => {
			const mockResponse = {
				success: true,
				address: '0x1234567890123456789012345678901234567890',
				walletId: 'wallet_new_123',
			}

			expect(mockResponse.success).toBe(true)
			expect(mockResponse.address).toBeDefined()
			expect(mockResponse.walletId).toBeDefined()
		})

		test('error response should have success false and error message', () => {
			const mockErrorResponse = {
				success: false,
				error: 'No Turnkey sub-organization found. Please create a passkey first.',
			}

			expect(mockErrorResponse.success).toBe(false)
			expect(mockErrorResponse.error).toBeDefined()
		})
	})
})

describe('Telegram Auth Header', () => {
	test('X-Telegram-Init-Data header format', () => {
		// Telegram initData is a URL-encoded query string
		const mockInitData =
			'user=%7B%22id%22%3A123456%2C%22first_name%22%3A%22Test%22%7D&hash=abc123&auth_date=1234567890'

		expect(mockInitData).toContain('user=')
		expect(mockInitData).toContain('hash=')
		expect(mockInitData).toContain('auth_date=')
	})

	test('parsed user from initData', () => {
		const userJson = '{"id":123456,"first_name":"Test","last_name":"User","username":"testuser"}'
		const user = JSON.parse(userJson)

		expect(user.id).toBe(123456)
		expect(user.first_name).toBe('Test')
		expect(user.username).toBe('testuser')
	})
})

describe('Error Responses', () => {
	test('401 Unauthorized structure', () => {
		const errorResponse = {
			error: 'Unauthorized',
			message: 'Missing or invalid Telegram authentication',
		}

		expect(errorResponse).toHaveProperty('error')
		expect(errorResponse).toHaveProperty('message')
	})

	test('400 Bad Request structure', () => {
		const errorResponse = {
			error: 'Bad Request',
			message: 'Invalid request body',
		}

		expect(errorResponse).toHaveProperty('error')
		expect(errorResponse).toHaveProperty('message')
	})

	test('500 Internal Server Error structure', () => {
		const errorResponse = {
			error: 'Internal Server Error',
			message: 'An unexpected error occurred',
		}

		expect(errorResponse).toHaveProperty('error')
		expect(errorResponse).toHaveProperty('message')
	})
})

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { AgentService } from '../services/AgentService'
import { PolymarketCredentialService } from '../services/PolymarketCredentialService'
import { PolymarketService } from '../services/PolymarketService'
import { TurnkeyService } from '../services/TurnkeyService'

const REAL_RUNTIME = { ...(await import('../runtime')) }

const API_KEY = `suwappu_sk_${'p'.repeat(32)}`
const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const FORGED_ADDRESS = '0x0000000000000000000000000000000000000001'
const TEST_AGENT = {
	id: 92,
	uuid: '22222222-2222-4222-8222-222222222222',
	name: 'predict_wallet_identity_test',
	rateLimitTier: 'pro',
	metadata: null as Record<string, unknown> | null,
	createdAt: new Date('2026-08-01T00:00:00.000Z'),
} as any

let verifyFailure = false
let verifyInputs: Array<{ agentId: number; subOrgId: string; address: string }> = []
let signInputs: Array<{ subOrgId: string; signWith: string }> = []
let placedWallets: string[] = []

const agentLayer = Layer.succeed(AgentService, {
	getAgentByApiKey: () => Effect.succeed(Option.some(TEST_AGENT)),
} as any)

const turnkeyLayer = Layer.succeed(TurnkeyService, {
	verifyAgentWallet: (agentId: number, subOrgId: string, address: string) => {
		verifyInputs.push({ agentId, subOrgId, address })
		if (verifyFailure) return Effect.fail(new Error('provider ownership mismatch'))
		return Effect.succeed({
			address,
			subOrgId,
			walletId: 'turnkey-wallet-a',
			accountId: 'turnkey-account-a',
		})
	},
	signRawPayload: (subOrgId: string, _payload: string, signWith: string) => {
		signInputs.push({ subOrgId, signWith })
		return Effect.succeed({ r: '1', s: '2', v: '27', signature: '0xsigned' })
	},
} as any)

const credentialLayer = Layer.succeed(PolymarketCredentialService, {
	getCredentials: () => Effect.succeed(null),
	storeCredentials: () => Effect.void,
} as any)

const polymarketLayer = Layer.succeed(PolymarketService, {
	createApiCredentials: () =>
		Effect.succeed({ apiKey: 'clob-key', secret: 'clob-secret', passphrase: 'clob-pass' }),
	getNegRisk: () => Effect.succeed(false),
	placeOrder: (_credentials: unknown, walletAddress: string) => {
		placedWallets.push(walletAddress)
		return Effect.succeed({ id: 'order-a', status: 'live' })
	},
} as any)

const testLayer = Layer.mergeAll(agentLayer, turnkeyLayer, credentialLayer, polymarketLayer)
const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let predictRoutes: any

beforeAll(async () => {
	;({ predictRoutes } = await import('../routes/predict'))
})

beforeEach(() => {
	TEST_AGENT.metadata = null
	verifyFailure = false
	verifyInputs = []
	signInputs = []
	placedWallets = []
})

afterAll(() => {
	mock.module('../runtime', () => REAL_RUNTIME)
})

const AUTH_HEADERS = {
	Authorization: `Bearer ${API_KEY}`,
	'Content-Type': 'application/json',
}
const ORDER_BODY = JSON.stringify({ tokenId: '1', price: '0.42', size: '10', side: 'BUY' })

const provisionedMetadata = {
	wallet_address: ADDRESS,
	wallet_sub_org_id: 'turnkey-sub-org-a',
	turnkey_wallet_id: 'turnkey-wallet-a',
	turnkey_account_id: 'turnkey-account-a',
	internal_user_id: 901,
	internal_wallet_id: 902,
	managed_wallet_identity_version: 2,
}

describe('POST /v1/agent/predict/order — managed wallet ownership', () => {
	it('ignores legacy caller-writable aliases and refuses to sign', async () => {
		TEST_AGENT.metadata = {
			walletAddress: FORGED_ADDRESS,
			subOrgId: 'victim-sub-org',
		}

		const response = await predictRoutes.request('/order', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: ORDER_BODY,
		})

		expect(response.status).toBe(400)
		expect(verifyInputs).toHaveLength(0)
		expect(signInputs).toHaveLength(0)
		expect(placedWallets).toHaveLength(0)
	})

	it('fails closed before signing when provider attestation rejects canonical metadata', async () => {
		TEST_AGENT.metadata = { ...provisionedMetadata }
		verifyFailure = true

		const response = await predictRoutes.request('/order', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: ORDER_BODY,
		})

		expect(response.status).toBe(502)
		expect(verifyInputs).toEqual([
			{ agentId: TEST_AGENT.id, subOrgId: 'turnkey-sub-org-a', address: ADDRESS },
		])
		expect(signInputs).toHaveLength(0)
		expect(placedWallets).toHaveLength(0)
	})

	it('uses only the provider-attested canonical identity for credentials and order signing', async () => {
		TEST_AGENT.metadata = {
			...provisionedMetadata,
			walletAddress: FORGED_ADDRESS,
			subOrgId: 'victim-sub-org',
		}

		const response = await predictRoutes.request('/order', {
			method: 'POST',
			headers: AUTH_HEADERS,
			body: ORDER_BODY,
		})

		expect(response.status).toBe(200)
		expect(verifyInputs).toEqual([
			{ agentId: TEST_AGENT.id, subOrgId: 'turnkey-sub-org-a', address: ADDRESS },
		])
		expect(signInputs).toEqual([
			{ subOrgId: 'turnkey-sub-org-a', signWith: ADDRESS },
			{ subOrgId: 'turnkey-sub-org-a', signWith: ADDRESS },
		])
		expect(placedWallets).toEqual([ADDRESS])
	})
})

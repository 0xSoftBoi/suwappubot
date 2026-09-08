import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { EnvService } from '../config/EnvService'
import {
	MANAGED_WALLET_METADATA_KEYS,
	preserveManagedWalletMetadata,
} from '../lib/managedWalletMetadata'
import { RegisterAgentSchema, UpdateAgentSchema } from '../routes/validators'
import { AgentService, TurnkeyService } from '../services'

const REAL_RUNTIME = { ...(await import('../runtime')) }
const originalFetch = globalThis.fetch

const API_KEY = `suwappu_sk_${'a'.repeat(32)}`
const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const TEST_AGENT = {
	id: 91,
	uuid: '11111111-1111-4111-8111-111111111111',
	name: 'managed_wallet_identity_test',
	rateLimitTier: 'pro',
	metadata: null as Record<string, unknown> | null,
	createdAt: new Date('2026-08-01T00:00:00.000Z'),
} as any

let createWalletCalls = 0
let createdWalletAddress = ADDRESS
let updateCalls: Record<string, unknown>[] = []
let provisionBodies: Record<string, unknown>[] = []
let provisionAddress = ADDRESS
let provisionGate: Promise<void> | null = null
let onProvisionStarted: (() => void) | null = null
let verifyWalletCalls = 0
let verifyWalletFailure = false
let verifiedWalletInputs: Array<{ agentId: number; subOrgId: string; address: string }> = []
let createPolicySubOrgs: string[] = []
let listPolicySubOrgs: string[] = []
let deletePolicySubOrgs: string[] = []
let mutateAfterLeaseClaim = false

const envLayer = Layer.succeed(EnvService, {
	INTERNAL_API_KEY: 'internal-test-key',
	INTERNAL_API_URL: 'https://python.internal',
} as any)
const agentLayer = Layer.succeed(AgentService, {
	getAgentByApiKey: () => Effect.succeed(Option.some(TEST_AGENT)),
	getAgentById: () => Effect.succeed(Option.some({ ...TEST_AGENT })),
	incrementAgentStats: () => Effect.void,
	compareAndSetMetadata: (
		_agentId: number,
		expected: Record<string, unknown> | null,
		replacement: Record<string, unknown>,
	) => {
		if (JSON.stringify(TEST_AGENT.metadata) !== JSON.stringify(expected)) {
			return Effect.succeed(Option.none())
		}
		TEST_AGENT.metadata = replacement
		if (
			mutateAfterLeaseClaim &&
			typeof replacement.managed_wallet_provision_token === 'string'
		) {
			TEST_AGENT.metadata = { ...replacement, caller_note: 'concurrent-update' }
			mutateAfterLeaseClaim = false
		}
		updateCalls.push(TEST_AGENT.metadata as Record<string, unknown>)
		return Effect.succeed(Option.some({ ...TEST_AGENT }))
	},
	updateAgent: (_agentId: number, update: { metadata?: Record<string, unknown> }) => {
		const metadata = update.metadata ?? {}
		updateCalls.push(metadata)
		TEST_AGENT.metadata = metadata
		return Effect.succeed({ ...TEST_AGENT, metadata })
	},
} as any)
const turnkeyLayer = Layer.succeed(TurnkeyService, {
	createAgentWallet: () => {
		createWalletCalls++
		return Effect.succeed({
			address: createdWalletAddress,
			subOrgId: 'turnkey-sub-org-a',
			walletId: 'turnkey-wallet-a',
			accountId: 'turnkey-account-a',
		})
	},
	verifyAgentWallet: (agentId: number, subOrgId: string, address: string) => {
		verifyWalletCalls++
		verifiedWalletInputs.push({ agentId, subOrgId, address })
		if (verifyWalletFailure) return Effect.fail(new Error('provider ownership mismatch'))
		return Effect.succeed({
			address,
			subOrgId,
			walletId: subOrgId === 'legacy-turnkey-sub-org-a' ? 'legacy-wallet-a' : 'turnkey-wallet-a',
			accountId: subOrgId === 'legacy-turnkey-sub-org-a' ? 'legacy-account-a' : 'turnkey-account-a',
		})
	},
	createPolicy: (subOrgId: string) => {
		createPolicySubOrgs.push(subOrgId)
		return Effect.succeed('agent-policy-a')
	},
	listPolicies: (subOrgId: string) => {
		listPolicySubOrgs.push(subOrgId)
		return Effect.succeed([
			{
				policyId: 'agent-policy-a',
				policyName: 'agent-spending-limit-60s',
				effect: 'EFFECT_DENY',
				condition: 'eth.value <= 100',
			},
		])
	},
	deletePolicy: (subOrgId: string) => {
		deletePolicySubOrgs.push(subOrgId)
		return Effect.succeed(true)
	},
} as any)
const testLayer = Layer.mergeAll(envLayer, agentLayer, turnkeyLayer)
const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let agentRoutes: any
let managedAgentWalletIdentityFromMetadata: any
let managedAgentWalletIsProvisioned: any

beforeAll(async () => {
	;({ agentRoutes, managedAgentWalletIdentityFromMetadata, managedAgentWalletIsProvisioned } =
		await import('../routes/agent'))
	globalThis.fetch = Object.assign(
		async (_input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>
			provisionBodies.push(body)
			onProvisionStarted?.()
			if (provisionGate) await provisionGate
			return new Response(
				JSON.stringify({
					internal_user_id: 901,
					internal_wallet_id: 902,
					address: provisionAddress,
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			)
		},
		{ preconnect: originalFetch.preconnect },
	) as typeof fetch
})

beforeEach(() => {
	TEST_AGENT.metadata = null
	createWalletCalls = 0
	createdWalletAddress = ADDRESS
	updateCalls = []
	provisionBodies = []
	provisionAddress = ADDRESS
	provisionGate = null
	onProvisionStarted = null
	verifyWalletCalls = 0
	verifyWalletFailure = false
	verifiedWalletInputs = []
	createPolicySubOrgs = []
	listPolicySubOrgs = []
	deletePolicySubOrgs = []
	mutateAfterLeaseClaim = false
})

afterAll(() => {
	globalThis.fetch = originalFetch
	mock.module('../runtime', () => REAL_RUNTIME)
})

const AUTH_HEADERS = { Authorization: `Bearer ${API_KEY}` }

describe('POST /v1/agent/wallets — one authoritative managed identity', () => {
	it('recognizes legacy address + sub-org as resumable, but not fully provisioned', () => {
		const legacyMetadata = {
			wallet_address: ADDRESS,
			wallet_sub_org_id: 'legacy-turnkey-sub-org-a',
			internal_user_id: 11,
			internal_wallet_id: 22,
		}

		expect(managedAgentWalletIdentityFromMetadata(legacyMetadata)).toEqual({
			address: ADDRESS,
			subOrgId: 'legacy-turnkey-sub-org-a',
		})
		expect(managedAgentWalletIsProvisioned(legacyMetadata)).toBe(false)
		expect(
			managedAgentWalletIsProvisioned({
				...legacyMetadata,
				managed_wallet_identity_version: 1,
			}),
		).toBe(false)
		expect(
			managedAgentWalletIsProvisioned({
				...legacyMetadata,
				managed_wallet_identity_version: 2,
			}),
		).toBe(true)
	})

	it('rejects a zero address as managed wallet identity', () => {
		expect(
			managedAgentWalletIdentityFromMetadata({
				wallet_address: '0x0000000000000000000000000000000000000000',
				wallet_sub_org_id: 'turnkey-sub-org-a',
			}),
		).toBeNull()
	})

	it('registers and advertises the same Turnkey wallet, then returns it idempotently', async () => {
		const first = await agentRoutes.request('/wallets', { method: 'POST', headers: AUTH_HEADERS })
		const firstBody = (await first.json()) as any
		const second = await agentRoutes.request('/wallets', { method: 'POST', headers: AUTH_HEADERS })
		const secondBody = (await second.json()) as any

		expect(first.status).toBe(201)
		expect(second.status).toBe(200)
		expect(firstBody.wallet.address).toBe(ADDRESS)
		expect(secondBody.wallet.address).toBe(ADDRESS)
		expect(createWalletCalls).toBe(1)
		expect(provisionBodies).toHaveLength(2)
		expect(provisionBodies[0]).toEqual({
			agent_uuid: TEST_AGENT.uuid,
			chain_type: 'evm',
			turnkey_wallet_id: 'turnkey-wallet-a',
			turnkey_sub_org_id: 'turnkey-sub-org-a',
			turnkey_account_id: 'turnkey-account-a',
			address: ADDRESS,
		})

		const stored = TEST_AGENT.metadata as Record<string, unknown>
		expect(stored.wallet_address).toBe(firstBody.wallet.address)
		expect(stored.internal_wallet_id).toBe(902)
		expect(stored.internal_user_id).toBe(901)
		expect(stored.managed_wallet_identity_version).toBe(2)
	})

	it('serializes concurrent creation before minting a provider wallet', async () => {
		const [left, right] = await Promise.all([
			agentRoutes.request('/wallets', { method: 'POST', headers: AUTH_HEADERS }),
			agentRoutes.request('/wallets', { method: 'POST', headers: AUTH_HEADERS }),
		])

		expect([left.status, right.status].sort()).toEqual([200, 201])
		expect(createWalletCalls).toBe(1)
		expect(verifyWalletCalls).toBe(1)
		expect(TEST_AGENT.metadata).toMatchObject({
			wallet_address: ADDRESS,
			internal_wallet_id: 902,
			managed_wallet_identity_version: 2,
		})
		expect((TEST_AGENT.metadata as Record<string, unknown>).managed_wallet_provision_token).toBeUndefined()
	})

	it('retains the provisioning lease until Python registration completes', async () => {
		let releaseProvision!: () => void
		let markProvisionStarted!: () => void
		provisionGate = new Promise<void>((resolve) => { releaseProvision = resolve })
		const provisionStarted = new Promise<void>((resolve) => { markProvisionStarted = resolve })
		onProvisionStarted = markProvisionStarted

		const firstRequest = agentRoutes.request('/wallets', { method: 'POST', headers: AUTH_HEADERS })
		await provisionStarted
		const secondRequest = agentRoutes.request('/wallets', { method: 'POST', headers: AUTH_HEADERS })
		await new Promise((resolve) => setTimeout(resolve, 50))

		expect(provisionBodies).toHaveLength(1)
		expect(TEST_AGENT.metadata).toMatchObject({
			wallet_address: ADDRESS,
		})
		expect(typeof (TEST_AGENT.metadata as Record<string, unknown>).managed_wallet_provision_token).toBe('string')

		releaseProvision()
		const [first, second] = await Promise.all([firstRequest, secondRequest])
		expect([first.status, second.status].sort()).toEqual([200, 201])
		expect(createWalletCalls).toBe(1)
		expect(provisionBodies).toHaveLength(2)
		expect((TEST_AGENT.metadata as Record<string, unknown>).managed_wallet_provision_token).toBeUndefined()
	})

	it('rejects an invalid provider address before publishing or calling Python', async () => {
		createdWalletAddress = '0x0000000000000000000000000000000000000000'

		const response = await agentRoutes.request('/wallets', { method: 'POST', headers: AUTH_HEADERS })

		expect(response.status).toBe(502)
		expect(createWalletCalls).toBe(1)
		expect(provisionBodies).toHaveLength(0)
		expect(TEST_AGENT.metadata).not.toHaveProperty('wallet_address')
	})

	it('publishes a newly minted wallet across a concurrent caller metadata update', async () => {
		mutateAfterLeaseClaim = true

		const response = await agentRoutes.request('/wallets', {
			method: 'POST',
			headers: AUTH_HEADERS,
		})

		expect(response.status).toBe(201)
		expect(createWalletCalls).toBe(1)
		expect(TEST_AGENT.metadata).toMatchObject({
			caller_note: 'concurrent-update',
			wallet_address: ADDRESS,
			wallet_sub_org_id: 'turnkey-sub-org-a',
			turnkey_wallet_id: 'turnkey-wallet-a',
		})
	})

	it('repairs legacy A/B metadata by adopting funded wallet A without minting A2', async () => {
		TEST_AGENT.metadata = {
			wallet_address: ADDRESS,
			wallet_sub_org_id: 'legacy-turnkey-sub-org-a',
			internal_user_id: 11,
			internal_wallet_id: 22, // legacy Python wallet B
			managed_wallet_identity_version: 1, // caller-writable before v2
		}

		const response = await agentRoutes.request('/wallets', {
			method: 'POST',
			headers: AUTH_HEADERS,
		})

		expect(response.status).toBe(200)
		expect(createWalletCalls).toBe(0)
		expect(verifyWalletCalls).toBe(1)
		expect(provisionBodies).toHaveLength(1)
		expect(provisionBodies[0]).toEqual({
			agent_uuid: TEST_AGENT.uuid,
			chain_type: 'evm',
			turnkey_wallet_id: 'legacy-wallet-a',
			turnkey_sub_org_id: 'legacy-turnkey-sub-org-a',
			turnkey_account_id: 'legacy-account-a',
			address: ADDRESS,
		})
		expect(TEST_AGENT.metadata).toMatchObject({
			wallet_address: ADDRESS,
			wallet_sub_org_id: 'legacy-turnkey-sub-org-a',
			turnkey_wallet_id: 'legacy-wallet-a',
			turnkey_account_id: 'legacy-account-a',
			internal_user_id: 901,
			internal_wallet_id: 902,
			managed_wallet_identity_version: 2,
		})
	})

	it('overwrites forged v2 internal IDs with Python canonical IDs', async () => {
		TEST_AGENT.metadata = {
			wallet_address: ADDRESS,
			wallet_sub_org_id: 'turnkey-sub-org-a',
			turnkey_wallet_id: 'turnkey-wallet-a',
			turnkey_account_id: 'turnkey-account-a',
			internal_user_id: 666,
			internal_wallet_id: 777,
			managed_wallet_identity_version: 2,
		}

		const response = await agentRoutes.request('/wallets', {
			method: 'POST',
			headers: AUTH_HEADERS,
		})

		expect(response.status).toBe(200)
		expect(verifyWalletCalls).toBe(1)
		expect(provisionBodies).toHaveLength(1)
		expect(TEST_AGENT.metadata).toMatchObject({
			internal_user_id: 901,
			internal_wallet_id: 902,
			managed_wallet_identity_version: 2,
		})
	})

	it('fails closed on a stale pre-mint lease instead of minting another wallet', async () => {
		TEST_AGENT.metadata = {
			managed_wallet_provision_token: 'abandoned-lease',
			managed_wallet_provision_started_at: '2026-01-01T00:00:00.000Z',
		}

		const response = await agentRoutes.request('/wallets', {
			method: 'POST',
			headers: AUTH_HEADERS,
		})

		expect(response.status).toBe(500)
		expect(createWalletCalls).toBe(0)
		expect(provisionBodies).toHaveLength(0)
	})

	it('returns an explicit conflict when another provisioning lease outlives the wait budget', async () => {
		const realNow = Date.now()
		TEST_AGENT.metadata = {
			managed_wallet_provision_token: 'active-lease',
			managed_wallet_provision_started_at: new Date(realNow).toISOString(),
		}
		let simulatedNow = realNow
		const nowSpy = spyOn(Date, 'now').mockImplementation(() => {
			simulatedNow += 1_001
			return simulatedNow
		})

		try {
			const response = await agentRoutes.request('/wallets', {
				method: 'POST',
				headers: AUTH_HEADERS,
			})
			const body = (await response.json()) as Record<string, unknown>

			expect(response.status).toBe(409)
			expect(body.error).toBe('Managed wallet provisioning is already in progress')
			expect(body.retry_after_ms).toBe(1_000)
			expect(createWalletCalls).toBe(0)
			expect(provisionBodies).toHaveLength(0)
		} finally {
			nowSpy.mockRestore()
		}
	})

	it('keeps a newly minted identity pending when Python returns a different address', async () => {
		provisionAddress = '0x0000000000000000000000000000000000000001'

		const failed = await agentRoutes.request('/wallets', {
			method: 'POST',
			headers: AUTH_HEADERS,
		})

		expect(failed.status).toBe(502)
		expect(createWalletCalls).toBe(1)
		expect(TEST_AGENT.metadata).toMatchObject({
			wallet_address: ADDRESS,
			wallet_sub_org_id: 'turnkey-sub-org-a',
			turnkey_wallet_id: 'turnkey-wallet-a',
			turnkey_account_id: 'turnkey-account-a',
		})
		expect((TEST_AGENT.metadata as any).managed_wallet_identity_version).toBeUndefined()

		provisionAddress = ADDRESS
		const retried = await agentRoutes.request('/wallets', {
			method: 'POST',
			headers: AUTH_HEADERS,
		})

		expect(retried.status).toBe(200)
		expect(createWalletCalls).toBe(1)
		expect(provisionBodies).toHaveLength(2)
		expect(TEST_AGENT.metadata).toMatchObject({
			internal_user_id: 901,
			internal_wallet_id: 902,
			managed_wallet_identity_version: 2,
		})
	})
})

describe('managed wallet metadata ownership', () => {
	it('rejects every server-owned key during registration and profile update', () => {
		for (const key of MANAGED_WALLET_METADATA_KEYS) {
			expect(
				RegisterAgentSchema.safeParse({ name: 'safe_agent', metadata: { [key]: 'forged' } })
					.success,
			).toBe(false)
			expect(UpdateAgentSchema.safeParse({ metadata: { [key]: 'forged' } }).success).toBe(false)
		}
	})

	it('preserves server wallet fields when caller metadata is replaced', () => {
		expect(
			preserveManagedWalletMetadata(
				{
					wallet_address: ADDRESS,
					internal_wallet_id: 902,
					walletAddress: 'legacy-forged-address',
					subOrgId: 'legacy-forged-sub-org',
					caller: 'old',
				},
				{ caller: 'new', wallet_sub_org_id: 'forged', internal_user_id: 666 },
			),
		).toEqual({ caller: 'new', wallet_address: ADDRESS, internal_wallet_id: 902 })
	})
})

describe('managed wallet policy ownership', () => {
	const provisionedMetadata = {
		wallet_address: ADDRESS,
		wallet_sub_org_id: 'turnkey-sub-org-a',
		turnkey_wallet_id: 'turnkey-wallet-a',
		turnkey_account_id: 'turnkey-account-a',
		internal_user_id: 901,
		internal_wallet_id: 902,
		managed_wallet_identity_version: 2,
	}

	it('attests canonical ownership before every policy operation', async () => {
		TEST_AGENT.metadata = {
			...provisionedMetadata,
			walletAddress: '0x0000000000000000000000000000000000000001',
			subOrgId: 'forged-camel-case-sub-org',
		}

		const created = await agentRoutes.request('/wallet/policy', {
			method: 'POST',
			headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: 'spending_limit',
				params: { maxAmountWei: '100', timeWindowSeconds: 60 },
			}),
		})
		const listed = await agentRoutes.request('/wallet/policies', { headers: AUTH_HEADERS })
		const deleted = await agentRoutes.request('/wallet/policy/agent-policy-a', {
			method: 'DELETE',
			headers: AUTH_HEADERS,
		})

		expect([created.status, listed.status, deleted.status]).toEqual([200, 200, 200])
		expect(verifiedWalletInputs).toEqual([
			{ agentId: TEST_AGENT.id, subOrgId: 'turnkey-sub-org-a', address: ADDRESS },
			{ agentId: TEST_AGENT.id, subOrgId: 'turnkey-sub-org-a', address: ADDRESS },
			{ agentId: TEST_AGENT.id, subOrgId: 'turnkey-sub-org-a', address: ADDRESS },
		])
		expect(createPolicySubOrgs).toEqual(['turnkey-sub-org-a'])
		expect(listPolicySubOrgs).toEqual(['turnkey-sub-org-a', 'turnkey-sub-org-a'])
		expect(deletePolicySubOrgs).toEqual(['turnkey-sub-org-a'])
	})

	it('fails closed before policy access when provider attestation fails', async () => {
		TEST_AGENT.metadata = { ...provisionedMetadata }
		verifyWalletFailure = true

		const created = await agentRoutes.request('/wallet/policy', {
			method: 'POST',
			headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: 'spending_limit',
				params: { maxAmountWei: '100', timeWindowSeconds: 60 },
			}),
		})
		const listed = await agentRoutes.request('/wallet/policies', { headers: AUTH_HEADERS })
		const deleted = await agentRoutes.request('/wallet/policy/agent-policy-a', {
			method: 'DELETE',
			headers: AUTH_HEADERS,
		})

		expect([created.status, listed.status, deleted.status]).toEqual([502, 502, 502])
		expect(createPolicySubOrgs).toHaveLength(0)
		expect(listPolicySubOrgs).toHaveLength(0)
		expect(deletePolicySubOrgs).toHaveLength(0)
	})
})

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Effect, Layer, Option } from 'effect'
import { EnvService } from '../config/EnvService'
import { AgentService, TurnkeyService } from '../services'
import { CreateWalletSchema } from '../routes/validators'

// Tests for Solana managed-wallet provisioning (POST /v1/agent/wallets
// chain_type=solana): per-chain idempotency, atomic metadata claiming, GET
// listing both wallets, and the extended ownership gates.

const REAL_RUNTIME = { ...(await import('../runtime')) }

// In-memory agent metadata store backing the mocked AgentService.
const EVM_WALLET = '0x955808580ef8A9754CBdDf4f8466E9C041adCa15'
const SOL_WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
const SOL_OTHER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

let store: Record<string, unknown> = {}
let turnkeyCalls: Array<'evm' | 'solana'> = []
const makeAgent = () =>
	({
		id: 7,
		uuid: '22222222-2222-4222-8222-222222222222',
		name: 'wallet_test_agent',
		rateLimitTier: 'pro',
		metadata: { ...store },
		createdAt: new Date('2026-08-01T00:00:00.000Z'),
	}) as any

const envLayer = Layer.succeed(EnvService, {} as any)
const agentLayer = Layer.succeed(
	AgentService,
	{
		getAgentByApiKey: () => Effect.succeed(Option.some(makeAgent())),
		getAgentById: () => Effect.succeed(Option.some(makeAgent())),
		mergeMetadataIfAbsent: (_id: number, key: string, patch: Record<string, unknown>) =>
			Effect.sync(() => {
				if (key in store) return false
				store = { ...store, ...patch }
				return true
			}),
		updateAgent: (_id: number, params: { mergeMetadata?: Record<string, unknown> }) =>
			Effect.sync(() => {
				if (params.mergeMetadata) store = { ...store, ...params.mergeMetadata }
				return makeAgent()
			}),
		incrementAgentStats: () => Effect.void,
	} as any,
)
const turnkeyLayer = Layer.succeed(
	TurnkeyService,
	{
		createAgentWallet: (_agentId: number, chainType: 'evm' | 'solana') => {
			turnkeyCalls.push(chainType)
			return Effect.succeed(
				chainType === 'solana'
					? { address: SOL_WALLET, subOrgId: 'suborg-sol', walletId: 'wk-sol' }
					: { address: EVM_WALLET, subOrgId: 'suborg-evm', walletId: 'wk-evm' },
			)
		},
	} as any,
)
const testLayer = Layer.mergeAll(envLayer, agentLayer, turnkeyLayer)
const runTestEffect = (effect: any) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)))

mock.module('../runtime', () => ({
	runEffect: runTestEffect,
	runEffectEither: (effect: any) => runTestEffect(Effect.either(effect)),
	shutdownRuntime: async () => {},
}))

let agentRoutes: any
let checkSolanaWalletOwnership: any
let checkWalletOwnership: any
let checkEvmWalletOwnership: any
let stopAgentCleanup: any

beforeAll(async () => {
	;({
		agentRoutes,
		checkSolanaWalletOwnership,
		checkWalletOwnership,
		checkEvmWalletOwnership,
		stopAgentCleanup,
	} = await import('../routes/agent'))
})

afterAll(() => {
	stopAgentCleanup?.()
	mock.module('../runtime', () => REAL_RUNTIME)
})

const AUTH_HEADERS = {
	Authorization: 'Bearer ' + 'suwappu_sk_' + 'x'.repeat(32),
	'Content-Type': 'application/json',
}

const reset = () => {
	store = {}
	turnkeyCalls = []
}

const postWallets = (body?: unknown) =>
	agentRoutes.request('/wallets', {
		method: 'POST',
		headers: AUTH_HEADERS,
		body: body === undefined ? undefined : JSON.stringify(body),
	})

describe('Solana ownership helpers', () => {
	const solAgent = (addr?: string) =>
		({ id: 1, metadata: addr ? { wallet_address_solana: addr } : {} }) as any

	it('accepts the agent\u2019s own Solana wallet (exact, case-sensitive)', () => {
		expect(checkSolanaWalletOwnership(solAgent(SOL_WALLET), SOL_WALLET)).toBe(true)
		// base58 is case-sensitive: a case-flipped address is a different address
		expect(checkSolanaWalletOwnership(solAgent(SOL_WALLET), SOL_WALLET.toLowerCase())).toBe(false)
	})

	it('rejects a different Solana address', () => {
		expect(checkSolanaWalletOwnership(solAgent(SOL_WALLET), SOL_OTHER)).toBe(false)
	})

	it('rejects EVM-shaped and malformed addresses', () => {
		expect(checkSolanaWalletOwnership(solAgent(SOL_WALLET), EVM_WALLET)).toBe(false)
		expect(checkSolanaWalletOwnership(solAgent(SOL_WALLET), 'not-an-address')).toBe(false)
		expect(checkSolanaWalletOwnership(solAgent(SOL_WALLET), undefined)).toBe(false)
	})

	it('rejects when the agent has no Solana wallet', () => {
		expect(checkSolanaWalletOwnership(solAgent(undefined), SOL_WALLET)).toBe(false)
	})

	it('checkWalletOwnership accepts either managed wallet', () => {
		const agent = { id: 1, metadata: { wallet_address: EVM_WALLET, wallet_address_solana: SOL_WALLET } } as any
		expect(checkWalletOwnership(agent, EVM_WALLET)).toBe(true)
		expect(checkWalletOwnership(agent, EVM_WALLET.toLowerCase())).toBe(true)
		expect(checkWalletOwnership(agent, SOL_WALLET)).toBe(true)
		expect(checkWalletOwnership(agent, SOL_OTHER)).toBe(false)
		expect(checkWalletOwnership(agent, '0x0000000000000000000000000000000000000001')).toBe(false)
	})

	it('checkEvmWalletOwnership still rejects Solana addresses (regression)', () => {
		const agent = { id: 1, metadata: { wallet_address: EVM_WALLET, wallet_address_solana: SOL_WALLET } } as any
		expect(checkEvmWalletOwnership(agent, SOL_WALLET)).toBe(false)
		expect(checkEvmWalletOwnership(agent, EVM_WALLET)).toBe(true)
	})
})

describe('CreateWalletSchema', () => {
	it('defaults to evm', () => {
		expect(CreateWalletSchema.parse({}).chain_type).toBe('evm')
	})

	it('accepts solana', () => {
		expect(CreateWalletSchema.parse({ chain_type: 'solana' }).chain_type).toBe('solana')
	})

	it('rejects anything else', () => {
		expect(CreateWalletSchema.safeParse({ chain_type: 'bitcoin' }).success).toBe(false)
	})
})

describe('POST /v1/agent/wallets chain_type', () => {
	it('creates a Solana wallet with per-chain metadata keys', async () => {
		reset()
		const res = await postWallets({ chain_type: 'solana' })
		expect(res.status).toBe(201)
		const body = (await res.json()) as any
		expect(body.wallet.address).toBe(SOL_WALLET)
		expect(body.wallet.chain_type).toBe('solana')
		expect(body.wallet.supported_chains).toEqual(['solana'])
		expect(store.wallet_address_solana).toBe(SOL_WALLET)
		expect(store.wallet_sub_org_id_solana).toBe('suborg-sol')
		expect(store.turnkey_wallet_id_solana).toBe('wk-sol')
		// EVM keys untouched
		expect('wallet_address' in store).toBe(false)
		expect(turnkeyCalls).toEqual(['solana'])
	})

	it('is idempotent per chain: second call returns the existing wallet', async () => {
		reset()
		await postWallets({ chain_type: 'solana' })
		const res = await postWallets({ chain_type: 'solana' })
		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.wallet.address).toBe(SOL_WALLET)
		expect(body.wallet.chain_type).toBe('solana')
		expect(body.message).toContain('already has a managed wallet')
		expect(turnkeyCalls).toEqual(['solana'])
	})

	it('EVM and Solana wallets coexist without clobbering', async () => {
		reset()
		const evmRes = await postWallets()
		expect(evmRes.status).toBe(201)
		expect(((await evmRes.json()) as any).wallet.chain_type).toBe('evm')
		const solRes = await postWallets({ chain_type: 'solana' })
		expect(solRes.status).toBe(201)
		expect(store.wallet_address).toBe(EVM_WALLET)
		expect(store.wallet_address_solana).toBe(SOL_WALLET)
		// Idempotent re-call for EVM still returns the EVM wallet
		const again = await postWallets()
		expect(again.status).toBe(200)
		expect(((await again.json()) as any).wallet.address).toBe(EVM_WALLET)
		expect(turnkeyCalls).toEqual(['evm', 'solana'])
	})

	it('rejects an invalid chain_type', async () => {
		reset()
		const res = await postWallets({ chain_type: 'bitcoin' })
		expect(res.status).toBe(400)
		expect(((await res.json()) as any).error_code).toBe('VALIDATION_ERROR')
		expect(turnkeyCalls).toEqual([])
	})

	it('repairs missing internal ids for the Solana wallet without minting', async () => {
		reset()
		store = {
			wallet_address_solana: SOL_WALLET,
			wallet_sub_org_id_solana: 'suborg-sol',
			turnkey_wallet_id_solana: 'wk-sol',
			internal_user_id_solana: null,
			internal_wallet_id_solana: null,
		}
		const res = await postWallets({ chain_type: 'solana' })
		expect(res.status).toBe(200)
		expect(((await res.json()) as any).wallet.address).toBe(SOL_WALLET)
		// No python API configured in test env -> repair is a no-op, but no new
		// Turnkey wallet is minted either.
		expect(turnkeyCalls).toEqual([])
	})
})

describe('GET /v1/agent/wallets', () => {
	const getWallets = () => agentRoutes.request('/wallets', { headers: AUTH_HEADERS })

	it('returns an empty list when no wallet exists', async () => {
		reset()
		const res = await getWallets()
		expect(res.status).toBe(200)
		expect(((await res.json()) as any).wallets).toEqual([])
	})

	it('lists both wallets after provisioning', async () => {
		reset()
		await postWallets()
		await postWallets({ chain_type: 'solana' })
		const res = await getWallets()
		const body = (await res.json()) as any
		expect(body.wallets).toHaveLength(2)
		expect(body.wallets[0]).toMatchObject({ address: EVM_WALLET, chain_type: 'evm' })
		expect(body.wallets[1]).toMatchObject({ address: SOL_WALLET, chain_type: 'solana' })
	})

	it('lists only the Solana wallet when that is all the agent has', async () => {
		reset()
		await postWallets({ chain_type: 'solana' })
		const body = (await (await getWallets()).json()) as any
		expect(body.wallets).toHaveLength(1)
		expect(body.wallets[0].chain_type).toBe('solana')
	})
})

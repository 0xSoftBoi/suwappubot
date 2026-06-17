import { describe, expect, it } from 'bun:test'
import { Effect, Layer } from 'effect'
import type { Env } from '../config/EnvService'
import { EnvService } from '../config/EnvService'
import {
	resolveViemChain,
	SmartAccountService,
	SmartAccountServiceLive,
	SUPPORTED_SMART_ACCOUNT_CHAIN_IDS,
} from '../services/SmartAccountService'

// Build the service over a stubbed EnvService. getConfig/predictAddress only
// read SMART_ACCOUNT_ENABLED + BUNDLER_RPC_URL, so a partial env is sufficient.
function runWithEnv<A, E>(
	env: Partial<Env>,
	eff: (svc: typeof SmartAccountService.Service) => Effect.Effect<A, E>,
) {
	const envLayer = Layer.succeed(EnvService, env as Env)
	const program = Effect.gen(function* () {
		const svc = yield* SmartAccountService
		return yield* eff(svc)
	})
	return Effect.runPromise(
		program.pipe(Effect.provide(SmartAccountServiceLive.pipe(Layer.provide(envLayer)))) as Effect.Effect<A, E>,
	)
}

describe('resolveViemChain', () => {
	it('maps known chain IDs to viem chains', () => {
		expect(resolveViemChain(8453)?.id).toBe(8453) // base
		expect(resolveViemChain(1)?.id).toBe(1) // mainnet
		expect(resolveViemChain(42161)?.id).toBe(42161) // arbitrum
	})

	it('returns null for unsupported chains', () => {
		expect(resolveViemChain(999999)).toBeNull()
		expect(resolveViemChain(324)).toBeNull() // zkSync — not enabled here
	})

	it('exposes the supported chain ID list', () => {
		expect(SUPPORTED_SMART_ACCOUNT_CHAIN_IDS).toContain(8453)
		expect(SUPPORTED_SMART_ACCOUNT_CHAIN_IDS).toContain(1)
		expect(SUPPORTED_SMART_ACCOUNT_CHAIN_IDS).not.toContain(999999)
	})
})

describe('SmartAccountService.getConfig', () => {
	it('reports disabled by default (no bundler configured)', async () => {
		const cfg = await runWithEnv({ SMART_ACCOUNT_ENABLED: 'false' }, (svc) => svc.getConfig())
		expect(cfg.enabled).toBe(false)
		expect(cfg.entryPointVersion).toBe('0.7')
		expect(cfg.kernelVersion).toBe('0.3.1')
		expect(cfg.supportedChainIds.length).toBeGreaterThan(0)
	})

	it('stays disabled when flag is on but bundler URL is missing', async () => {
		const cfg = await runWithEnv({ SMART_ACCOUNT_ENABLED: 'true' }, (svc) => svc.getConfig())
		expect(cfg.enabled).toBe(false)
	})

	it('is enabled only when flag AND bundler URL are both set', async () => {
		const cfg = await runWithEnv(
			{ SMART_ACCOUNT_ENABLED: 'true', BUNDLER_RPC_URL: 'https://bundler.example/rpc' },
			(svc) => svc.getConfig(),
		)
		expect(cfg.enabled).toBe(true)
	})
})

describe('SmartAccountService.predictAddress', () => {
	it('rejects unsupported chains before any network call', async () => {
		const result = await runWithEnv({ SMART_ACCOUNT_ENABLED: 'false' }, (svc) =>
			Effect.either(
				svc.predictAddress({ chainId: 999999, owner: '0x0000000000000000000000000000000000000001' }),
			),
		)
		expect(result._tag).toBe('Left')
		if (result._tag === 'Left') {
			expect(result.left._tag).toBe('ValidationError')
		}
	})
})

describe('SmartAccountService.sendUserOperation', () => {
	it('fails clearly when sending is disabled', async () => {
		const result = await runWithEnv({ SMART_ACCOUNT_ENABLED: 'false' }, (svc) =>
			Effect.either(
				svc.sendUserOperation({
					chainId: 8453,
					ownerPrivateKey: `0x${'1'.repeat(64)}`,
					calls: [{ to: '0x0000000000000000000000000000000000000001' }],
				}),
			),
		)
		expect(result._tag).toBe('Left')
		if (result._tag === 'Left') {
			expect(result.left._tag).toBe('ValidationError')
			expect(result.left.message).toContain('disabled')
		}
	})
})

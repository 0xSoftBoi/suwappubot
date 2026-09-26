/**
 * Live providers: the same DemoProviders interfaces backed by the real
 * modules (World ID, Intercepta, Uniswap, ENSv2). Used by `bun run demo --live`
 * when keys are present in `.env`.
 *
 * Each factory throws a clear error naming the missing env vars — the demo
 * CLI reports which providers are live and which fell back to mocks.
 */
import {
	loadWorldIdConfig,
	isWorldIdConfigured,
} from '../world-id/config.ts'
import {
	startTradeVerification,
	awaitAndVerifyTradeApproval,
	MemoryNullifierStore,
	type TradeIntent,
	type PendingVerification,
} from '../world-id/guardianGate.ts'
import { loadInterceptaConfig, isInterceptaConfigured, scanAddress, scanTransaction, type InterceptaConfig } from '../intercepta/client.ts'
import { UniswapTradingProvider } from '../uniswap/routeAdapter.ts'
import { isTradingApiConfigured } from '../uniswap/tradingApi.ts'
import { resolveAndCheckPolicy } from '../ensv2/resolver.ts'
import type { DemoProviders, WorldIdProvider, ScreenProvider, QuoteProvider, Ensv2Provider } from './providers.ts'
import { mockProviders } from './providers.ts'

class LiveWorldIdProvider implements WorldIdProvider {
	private cfg = loadWorldIdConfig()
	private store = new MemoryNullifierStore()
	private pending = new Map<string, { p: PendingVerification; action: string }>()

	get stepUpAction(): string {
		return this.cfg.stepUpAction
	}

	async start(intent: TradeIntent, action: string = this.cfg.action) {
		const p = await startTradeVerification(this.cfg, intent, action)
		this.pending.set(p.signal, { p, action })
		return { connectorURI: p.connectorURI, signal: p.signal }
	}

	async awaitApproval(signal: string) {
		const entry = this.pending.get(signal)
		if (!entry) return { ok: false as const, reason: 'no pending verification for this signal' }
		const res = await awaitAndVerifyTradeApproval(this.cfg, entry.p, this.store, entry.action)
		this.pending.delete(signal)
		return res.ok
			? { ok: true as const, nullifier: res.nullifier as string }
			: { ok: false as const, reason: res.reason as string }
	}
}

class LiveScreenProvider implements ScreenProvider {
	private cfg: InterceptaConfig = loadInterceptaConfig()
	screenAddress(address: string, chain: string) {
		return scanAddress(this.cfg, address, chain)
	}
	screenTransaction(tx: { from: string; to: string; data?: string; value?: string; chain: string }) {
		return scanTransaction(this.cfg, tx)
	}
}

class LiveQuoteProvider implements QuoteProvider {
	private provider = new UniswapTradingProvider()
	quote(req: { tokenInChainId: number; tokenOutChainId: number; tokenIn: string; tokenOut: string; amount: string }) {
		return this.provider.quote({ ...req, type: 'EXACT_INPUT', routingPreference: 'BEST_PRICE' })
	}
	checkApproval(params: { chainId: number; token: string; wallet: string; amount: string }) {
		return this.provider.ensureApproval(params)
	}
}

class LiveEnsv2Provider implements Ensv2Provider {
	constructor(private rpcUrl: string) {}
	async resolveAndCheck(agentName: string, intent: { valueUsd: number; chain: string }) {
		const { resolved, blockReason } = await resolveAndCheckPolicy(this.rpcUrl, agentName, intent)
		return { blockReason, policy: { maxTxUsd: resolved.policy.maxTxUsd } }
	}
}

export interface LiveStatus {
	worldId: boolean
	intercepta: boolean
	uniswap: boolean
	ensv2: boolean
}

/**
 * Build providers: live where keys exist, mocks elsewhere.
 * `--live` (strict): throw unless ALL providers are live.
 */
export function buildProviders(opts: { strictLive: boolean }, env: NodeJS.ProcessEnv = process.env): { providers: DemoProviders; live: LiveStatus } {
	const live: LiveStatus = {
		worldId: isWorldIdConfigured(env),
		intercepta: isInterceptaConfigured(env),
		uniswap: isTradingApiConfigured(env),
		ensv2: Boolean(env['SEPOLIA_RPC_URL']),
	}
	if (opts.strictLive) {
		const missing = (Object.keys(live) as (keyof LiveStatus)[]).filter((k) => !live[k])
		if (missing.length > 0) {
			throw new Error(`--live requires all providers live; missing keys for: ${missing.join(', ')} (see .env.example)`)
		}
	}
	const mocks = mockProviders()
	const providers: DemoProviders = {
		worldId: live.worldId ? new LiveWorldIdProvider() : mocks.worldId,
		screen: live.intercepta ? new LiveScreenProvider() : mocks.screen,
		quote: live.uniswap ? new LiveQuoteProvider() : mocks.quote,
		ensv2: live.ensv2 ? new LiveEnsv2Provider(env['SEPOLIA_RPC_URL'] as string) : mocks.ensv2,
	}
	return { providers, live }
}

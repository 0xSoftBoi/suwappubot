/**
 * Provider interfaces + mock and live implementations for the demo pipeline.
 *
 * The pipeline (pipeline.ts) orchestrates ONLY through these interfaces and
 * applies the REAL verdict logic (scanResultToPolicySignal, hashIntent,
 * validateWorldIdStepUp). Mocks swap the transport; the decision code paths
 * are identical between mock and live runs.
 */
import type { ScanResult } from '../intercepta/client.ts'
import type { NormalizedQuote } from '../uniswap/routeAdapter.ts'
import type { TradeIntent } from '../world-id/guardianGate.ts'
import { hashIntent, MemoryNullifierStore } from '../world-id/guardianGate.ts'

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface WorldIdProvider {
	/**
	 * World action for step-up re-verifications. Distinct from the gate
	 * action: nullifiers are action-scoped, so the step-up needs its own
	 * namespace or the fresh proof replay-rejects against Gate 1.
	 */
	readonly stepUpAction: string
	start(intent: TradeIntent, action?: string): Promise<{ connectorURI: string; signal: string }>
	awaitApproval(signal: string): Promise<{ ok: true; nullifier: string } | { ok: false; reason: string }>
}

export interface ScreenProvider {
	screenAddress(address: string, chain: string): Promise<ScanResult>
	screenTransaction(tx: { from: string; to: string; data?: string; value?: string; chain: string }): Promise<ScanResult>
}

export interface QuoteProvider {
	quote(req: { tokenInChainId: number; tokenOutChainId: number; tokenIn: string; tokenOut: string; amount: string }): Promise<NormalizedQuote>
	checkApproval(params: { chainId: number; token: string; wallet: string; amount: string }): Promise<{ approved: boolean }>
}

export interface Ensv2Provider {
	resolveAndCheck(
		agentName: string,
		intent: { valueUsd: number; chain: string },
	): Promise<{ blockReason: string | null; policy?: { maxTxUsd: number } }>
}

export interface DemoProviders {
	worldId: WorldIdProvider
	screen: ScreenProvider
	quote: QuoteProvider
	ensv2: Ensv2Provider
}

// ---------------------------------------------------------------------------
// Mock World ID — scenario-driven human behavior
// ---------------------------------------------------------------------------

export type MockHumanBehavior = 'approves' | 'denies' | 'expires'

export class MockWorldIdProvider implements WorldIdProvider {
	readonly stepUpAction = 'suwappu-trade-stepup'
	/** Real store, not a stub — the demo exercises the actual replay defense. */
	private store = new MemoryNullifierStore()
	/** Realistic 0x hex nullifiers per action, like the verifier returns. */
	private nullifiers: Record<string, string> = {
		'suwappu-trade-approval':
			'0x8f3b2a1c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8',
		'suwappu-trade-stepup':
			'0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809',
	}
	private actions = new Map<string, string>()

	constructor(private behavior: MockHumanBehavior = 'approves') {}

	async start(intent: TradeIntent, action = 'suwappu-trade-approval') {
		const signal = hashIntent(intent)
		this.actions.set(signal, action)
		// In the live flow this is the idkit-core connectorURI rendered as a QR.
		return { connectorURI: `worldapp://verify/mock?signal=${signal.slice(0, 18)}`, signal }
	}

	async awaitApproval(signal: string) {
		await new Promise((r) => setTimeout(r, 300)) // simulate the human moment
		switch (this.behavior) {
			case 'denies':
				return { ok: false as const, reason: 'user declined the verification request' }
			case 'expires':
				return { ok: false as const, reason: 'verification request expired (5 min timeout)' }
			case 'approves': {
				const action = this.actions.get(signal) ?? 'suwappu-trade-approval'
				const nullifier = this.nullifiers[action] ?? this.nullifiers['suwappu-trade-approval']!
				// Consume through the real store: a replayed proof is rejected
				// here exactly as the live path rejects it.
				const first = await this.store.consume(action, nullifier)
				if (!first) {
					return { ok: false as const, reason: 'proof already used (replay rejected)' }
				}
				return { ok: true as const, nullifier }
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Mock Intercepta — deterministic address → verdict map
// ---------------------------------------------------------------------------

export const ADDR_CLEAN = '0x1111111111111111111111111111111111111111'
export const ADDR_FLAGGED = '0x2222222222222222222222222222222222222222'
export const ADDR_SUSPICIOUS = '0x3333333333333333333333333333333333333333'
/** Demo agent wallet — the W3A simulation `from` for the swap tx. */
export const ADDR_AGENT = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export class MockScreenProvider implements ScreenProvider {
	async screenAddress(address: string, _chain: string): Promise<ScanResult> {
		const a = address.toLowerCase()
		if (a === ADDR_FLAGGED.toLowerCase()) {
			return {
				target: address,
				verdict: 'malicious',
				riskScore: 96,
				findings: [
					{ code: 'sanctioned_address', risk: 'CRITICAL', description: 'address appears on sanctions lists (OFAC)' },
					{ code: 'mixer_interaction', risk: 'HIGH', description: 'direct interaction with a mixing service within 3 hops' },
				],
			}
		}
		if (a === ADDR_SUSPICIOUS.toLowerCase()) {
			return {
				target: address,
				verdict: 'suspicious',
				riskScore: 58,
				findings: [
					{ code: 'mixer_interaction', risk: 'HIGH', description: 'interaction with a mixing service within 5 hops' },
				],
			}
		}
		return { target: address, verdict: 'safe', riskScore: 4, findings: [] }
	}

	async screenTransaction(tx: { from: string; to: string; chain: string }): Promise<ScanResult> {
		// The prepared tx goes to the Uniswap router — screen the destination.
		return this.screenAddress(tx.to, tx.chain)
	}
}

// ---------------------------------------------------------------------------
// Mock Uniswap — deterministic CLASSIC quote
// ---------------------------------------------------------------------------

const UNISWAP_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'

export class MockQuoteProvider implements QuoteProvider {
	async quote(req: { tokenInChainId: number; tokenOutChainId: number; tokenIn: string; tokenOut: string; amount: string }): Promise<NormalizedQuote> {
		const raw = {
			quote: {
				routeType: 'CLASSIC' as const,
				chainId: req.tokenInChainId,
				tokenIn: req.tokenIn,
				tokenOut: req.tokenOut,
				amountIn: req.amount,
				amountOut: '2985000000', // ~$2,985 per 1.5 ETH — deterministic
				usdValue: 2985,
				gasFeeUsd: 1.24,
			},
			requestId: 'mock-req-1',
		}
		return {
			source: 'uniswap',
			routeType: 'CLASSIC',
			tokenIn: req.tokenIn,
			tokenOut: req.tokenOut,
			chainId: req.tokenInChainId,
			amountIn: req.amount,
			amountOut: '2985000000',
			usdValue: 2985,
			gasFeeUsd: 1.24,
			raw,
		}
	}

	async checkApproval(_params: { chainId: number; token: string; wallet: string; amount: string }) {
		return { approved: true }
	}
}

export { UNISWAP_ROUTER }

// ---------------------------------------------------------------------------
// Mock ENSv2 — onchain caps per agent name
// ---------------------------------------------------------------------------

export class MockEnsv2Provider implements Ensv2Provider {
	/** agent name → maxTxUsd. Missing name = no policy record → fail closed. */
	constructor(private caps: Record<string, number> = { 'agent.demo.suwappu.eth': 500 }) {}

	async resolveAndCheck(agentName: string, intent: { valueUsd: number; chain: string }) {
		const cap = this.caps[agentName]
		if (cap === undefined) {
			return { blockReason: `no suwappu.policy record on ${agentName} — fail closed` }
		}
		if (intent.valueUsd > cap) {
			return {
				blockReason:
					`ENSv2 policy blocked this trade: $${intent.valueUsd.toFixed(2)} exceeds ` +
					`onchain cap $${cap} on ${agentName}`,
				policy: { maxTxUsd: cap },
			}
		}
		return { blockReason: null, policy: { maxTxUsd: cap } }
	}
}

export function mockProviders(human: MockHumanBehavior = 'approves'): DemoProviders {
	return {
		worldId: new MockWorldIdProvider(human),
		screen: new MockScreenProvider(),
		quote: new MockQuoteProvider(),
		ensv2: new MockEnsv2Provider(),
	}
}

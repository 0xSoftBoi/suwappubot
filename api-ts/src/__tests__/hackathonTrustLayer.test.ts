/**
 * HACKATHON (Tokyo 2026) — trust-layer gate tests.
 *
 * Covers the merge discipline (only ever escalates, never downgrades) and the
 * fail-open behavior when providers are unconfigured. Network-touching paths
 * are stubbed with mock.module; the unconfigured paths make no network calls
 * at all.
 */
import { describe, expect, mock, test } from 'bun:test'
import type { PolicyDecisionResult, PolicyIntent } from '../services/PolicyService'

const baseIntent = (over: Partial<PolicyIntent> = {}): PolicyIntent => ({
	organizationId: 'org_1',
	agentId: 'agent_1',
	chain: '1',
	fromToken: null,
	toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
	valueUsd: 100,
	...over,
})

const allowResult: PolicyDecisionResult = { decision: 'allow' }

function setEnv(patch: Record<string, string | undefined>) {
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) delete process.env[k]
		else process.env[k] = v
	}
}

describe('trust layer flags', () => {
	test('everything is off by default', async () => {
		setEnv({
			HACKATHON_TRUST_LAYER: undefined,
			HACKATHON_INTERCEPTA: undefined,
			UNISWAP_COMPARISON_ENABLED: undefined,
		})
		const env = await import('../hackathon/env')
		expect(env.trustLayerEnabled()).toBe(false)
		expect(env.interceptaEnabled()).toBe(false)
		expect(env.uniswapComparisonEnabled()).toBe(false)
	})

	test('master flag enables per-sponsor gates; uniswap stays opt-in', async () => {
		setEnv({ HACKATHON_TRUST_LAYER: 'true' })
		const env = await import('../hackathon/env')
		expect(env.trustLayerEnabled()).toBe(true)
		expect(env.interceptaEnabled()).toBe(true)
		expect(env.ensv2Enabled()).toBe(true)
		// Explicit opt-in, independent of the master flag.
		expect(env.uniswapComparisonEnabled()).toBe(false)
		setEnv({ HACKATHON_TRUST_LAYER: undefined })
	})
})

describe('applyTrustLayerGates', () => {
	test('disabled: returns the base verdict untouched (single boolean check)', async () => {
		setEnv({ HACKATHON_TRUST_LAYER: undefined })
		const { applyTrustLayerGates } = await import('../hackathon/gates')
		const out = await applyTrustLayerGates(
			{ policyIntent: baseIntent(), agentIdentifier: 'agent_1', orgId: 'org_1' },
			allowResult,
		)
		expect(out).toBe(allowResult)
	})

	test('enabled but unconfigured: fails open, no escalation, no network', async () => {
		setEnv({
			HACKATHON_TRUST_LAYER: 'true',
			INTERCEPTA_API_KEY: undefined,
			SEPOLIA_RPC_URL: undefined,
		})
		const { applyTrustLayerGates } = await import('../hackathon/gates')
		const out = await applyTrustLayerGates(
			{ policyIntent: baseIntent(), agentIdentifier: 'agent_1', orgId: 'org_1' },
			allowResult,
		)
		expect(out.decision).toBe('allow')
		setEnv({ HACKATHON_TRUST_LAYER: undefined })
	})

	test('policy block is never downgraded by a clean trust layer', async () => {
		setEnv({ HACKATHON_TRUST_LAYER: 'true', INTERCEPTA_API_KEY: undefined })
		const { applyTrustLayerGates } = await import('../hackathon/gates')
		const blocked: PolicyDecisionResult = { decision: 'block', reason: 'policy: kill switch' }
		const out = await applyTrustLayerGates(
			{ policyIntent: baseIntent(), agentIdentifier: 'agent_1', orgId: 'org_1' },
			blocked,
		)
		expect(out).toBe(blocked)
		setEnv({ HACKATHON_TRUST_LAYER: undefined })
	})

	test('malicious counterparty escalates allow → block', async () => {
		setEnv({ HACKATHON_TRUST_LAYER: 'true', INTERCEPTA_API_KEY: 'test-key' })
		mock.module('../../../hackathon/tokyo2026/src/intercepta/client', () => ({
			isInterceptaConfigured: () => true,
			loadInterceptaConfig: () => ({ apiKey: 'test-key', baseUrl: 'https://x', timeoutMs: 1 }),
			scanAddress: async () => ({
				target: '0xevil',
				verdict: 'malicious',
				riskScore: 95,
				findings: [{ code: 'sanctioned', risk: 'CRITICAL', description: 'sanctioned address' }],
				raw: {},
			}),
			scanToken: async () => ({
				target: '0xtoken',
				verdict: 'safe',
				riskScore: 0,
				findings: [],
				raw: {},
			}),
		}))
		const { applyTrustLayerGates } = await import('../hackathon/gates')
		const out = await applyTrustLayerGates(
			{
				policyIntent: baseIntent({ destinationAddress: '0xevil' }),
				agentIdentifier: 'agent_1',
				orgId: 'org_1',
			},
			allowResult,
		)
		expect(out.decision).toBe('block')
		expect(out.reason).toContain('Intercepta')
		mock.restore()
		setEnv({ HACKATHON_TRUST_LAYER: undefined, INTERCEPTA_API_KEY: undefined })
	})

	test('suspicious counterparty escalates allow → require_approval', async () => {
		setEnv({ HACKATHON_TRUST_LAYER: 'true', INTERCEPTA_API_KEY: 'test-key' })
		mock.module('../../../hackathon/tokyo2026/src/intercepta/client', () => ({
			isInterceptaConfigured: () => true,
			loadInterceptaConfig: () => ({ apiKey: 'test-key', baseUrl: 'https://x', timeoutMs: 1 }),
			scanAddress: async () => ({
				target: '0xshady',
				verdict: 'suspicious',
				riskScore: 55,
				findings: [{ code: 'mixer', risk: 'HIGH', description: 'mixer-adjacent' }],
				raw: {},
			}),
			scanToken: async () => ({
				target: '0xtoken',
				verdict: 'safe',
				riskScore: 0,
				findings: [],
				raw: {},
			}),
		}))
		const { applyTrustLayerGates } = await import('../hackathon/gates')
		const out = await applyTrustLayerGates(
			{
				policyIntent: baseIntent({ destinationAddress: '0xshady' }),
				agentIdentifier: 'agent_1',
				orgId: 'org_1',
			},
			allowResult,
		)
		expect(out.decision).toBe('require_approval')
		mock.restore()
		setEnv({ HACKATHON_TRUST_LAYER: undefined, INTERCEPTA_API_KEY: undefined })
	})
})

describe('screenX402Payer', () => {
	test('returns null when disabled or sender missing', async () => {
		setEnv({ HACKATHON_TRUST_LAYER: undefined })
		const { screenX402Payer } = await import('../hackathon/gates')
		expect(await screenX402Payer(undefined)).toBeNull()
		expect(await screenX402Payer('0xabc')).toBeNull()
	})

	test('returns null when enabled but unconfigured (fail-open)', async () => {
		setEnv({ HACKATHON_TRUST_LAYER: 'true', INTERCEPTA_API_KEY: undefined })
		// mock.module persists for the file after mock.restore() — re-register
		// the unconfigured shape explicitly.
		mock.module('../../../hackathon/tokyo2026/src/intercepta/client', () => ({
			isInterceptaConfigured: () => false,
			loadInterceptaConfig: () => {
				throw new Error('not configured')
			},
			scanAddress: async () => {
				throw new Error('not configured')
			},
			scanToken: async () => {
				throw new Error('not configured')
			},
		}))
		const { screenX402Payer } = await import('../hackathon/gates')
		expect(await screenX402Payer('0xabc')).toBeNull()
		mock.restore()
		setEnv({ HACKATHON_TRUST_LAYER: undefined })
	})
})

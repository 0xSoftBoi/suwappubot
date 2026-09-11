import { describe, expect, it } from 'bun:test'
import {
	BYPASS_TIERS,
	buildX402Challenge,
	COST_WEIGHTS,
	CREDIT_USD_VALUE,
	costForTool,
	creditsToUsdcBaseUnits,
	MCP_TOOL_COSTS,
} from '../middleware/x402Payment'
import {
	crossCheckSignedRequirements,
	facilitatorVerifyAndSettle,
} from '../services/FacilitatorService'

const ENV = {
	FEE_WALLET_EVM: '0xColleCToR0000000000000000000000000000abcd',
	AGENT_METERING_NETWORK: 'base',
	AGENT_METERING_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
}

describe('x402 cost weights', () => {
	it('charges nothing for free discovery MCP tools', () => {
		expect(costForTool('list_chains')).toBe(0)
		expect(costForTool('list_tokens')).toBe(0)
		expect(costForTool('get_tempo_tokens')).toBe(0)
	})

	it('charges more for executable tools than reads', () => {
		expect(costForTool('execute_swap')).toBe(5)
		expect(costForTool('get_quote')).toBe(1)
		expect(costForTool('get_prices')).toBe(1)
	})

	it('defaults unknown tools to 1 credit (fail-safe, never free by accident)', () => {
		expect(costForTool('some_future_tool')).toBe(1)
	})

	it('keeps REST swap/execute weights dear', () => {
		expect(COST_WEIGHTS.swap).toBe(5)
		expect(COST_WEIGHTS.execute).toBe(5)
		expect(COST_WEIGHTS.quote).toBe(1)
	})

	it('exposes a credit→tool map for discovery', () => {
		expect(MCP_TOOL_COSTS.execute_swap).toBeGreaterThan(MCP_TOOL_COSTS.get_quote)
	})
})

describe('credit → USDC base-unit conversion', () => {
	it('converts credits to 6-decimal USDC atomic units', () => {
		// 1 credit = $0.001 = 1000 atomic units (USDC has 6 decimals)
		expect(creditsToUsdcBaseUnits(1)).toBe('1000')
		expect(creditsToUsdcBaseUnits(5)).toBe('5000')
		expect(creditsToUsdcBaseUnits(0)).toBe('0')
	})

	it('matches the documented credit value', () => {
		expect(CREDIT_USD_VALUE).toBe(0.001)
	})
})

describe('x402 challenge builder', () => {
	it('builds a spec-shaped accepts[] entry pointing at the collector', () => {
		const ch = buildX402Challenge(ENV, {
			cost: 5,
			resource: 'mcp://tools/execute_swap',
			description: 'test',
		})
		expect(ch.x402Version).toBe(1)
		const req = ch.accepts[0]
		expect(req.scheme).toBe('exact')
		expect(req.network).toBe('base')
		expect(req.payTo).toBe(ENV.FEE_WALLET_EVM)
		expect(req.asset).toBe(ENV.AGENT_METERING_USDC_ADDRESS)
		// 5 credits → 5000 atomic USDC units
		expect(req.maxAmountRequired).toBe('5000')
		expect(ch.cost_credits).toBe(5)
	})

	it('prefers an explicit collector override over FEE_WALLET_EVM', () => {
		const ch = buildX402Challenge(
			{ ...ENV, AGENT_METERING_COLLECTOR_ADDRESS: '0xOVERRIDE' },
			{ cost: 1, resource: 'r', description: 'd' },
		)
		expect(ch.accepts[0].payTo).toBe('0xOVERRIDE')
	})
})

describe('bypass tiers', () => {
	it('treats paid tiers as metering-exempt and free as metered', () => {
		expect(BYPASS_TIERS.has('pro')).toBe(true)
		expect(BYPASS_TIERS.has('premium')).toBe(true)
		expect(BYPASS_TIERS.has('enterprise')).toBe(true)
		expect(BYPASS_TIERS.has('agent')).toBe(true)
		expect(BYPASS_TIERS.has('free')).toBe(false)
	})
})

describe('facilitator security cross-check (settle-time)', () => {
	const advertised = {
		scheme: 'exact',
		network: 'base',
		payTo: '0xColleCToR0000000000000000000000000000abcd',
		maxAmountRequired: '5000',
	}
	const v1Payload = (
		envelope: Record<string, unknown> = {},
		authorization: Record<string, unknown> = {},
	) => ({
		x402Version: 1,
		scheme: advertised.scheme,
		network: advertised.network,
		payload: {
			authorization: {
				from: '0x000000000000000000000000000000000000bEEF',
				to: advertised.payTo,
				value: advertised.maxAmountRequired,
				validAfter: '0',
				validBefore: '9999999999',
				nonce: `0x${'00'.repeat(32)}`,
				...authorization,
			},
			signature: '0xsigned',
		},
		...envelope,
	})

	it('accepts a valid v1 payload with case-different recipient and overpayment', () => {
		const r = crossCheckSignedRequirements(
			v1Payload({}, { to: advertised.payTo.toUpperCase(), value: '6000' }),
			advertised,
		)
		expect(r.ok).toBe(true)
	})

	it('rejects the wrong x402 protocol version', () => {
		const r = crossCheckSignedRequirements(v1Payload({ x402Version: 2 }), advertised)
		expect(r).toEqual({ ok: false, error: 'version_mismatch' })
	})

	it('rejects a wrong top-level payment scheme', () => {
		const r = crossCheckSignedRequirements(v1Payload({ scheme: 'upto' }), advertised)
		expect(r).toEqual({ ok: false, error: 'scheme_mismatch' })
	})

	it('rejects a foreign top-level network', () => {
		const r = crossCheckSignedRequirements(v1Payload({ network: 'robinhood' }), advertised)
		expect(r).toEqual({ ok: false, error: 'network_mismatch' })
	})

	it('rejects a missing top-level network', () => {
		const r = crossCheckSignedRequirements(v1Payload({ network: undefined }), advertised)
		expect(r).toEqual({ ok: false, error: 'network_mismatch' })
	})

	it('rejects a redirected signed authorization recipient', () => {
		const r = crossCheckSignedRequirements(v1Payload({}, { to: '0xattacker' }), advertised)
		expect(r).toEqual({ ok: false, error: 'payTo_mismatch' })
	})

	it('rejects an underpaying signed authorization', () => {
		const r = crossCheckSignedRequirements(v1Payload({}, { value: '4999' }), advertised)
		expect(r).toEqual({ ok: false, error: 'amount_too_low' })
	})

	it('rejects an unparseable authorization value instead of throwing', () => {
		const r = crossCheckSignedRequirements(v1Payload({}, { value: 'not-a-number' }), advertised)
		expect(r).toEqual({ ok: false, error: 'amount_unparseable' })
	})

	it('passes the canonical advertised requirement to both verify and settle', async () => {
		const requirements = buildX402Challenge(ENV, {
			cost: 5,
			resource: 'mcp://tools/execute_swap',
			description: 'test',
		}).accepts[0]
		const paymentPayload = v1Payload()
		const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')
		const seenRequirements: unknown[] = []
		const seenPayloads: unknown[] = []

		const r = await facilitatorVerifyAndSettle(
			{ X402_FACILITATOR_ENABLED: 'true', X402_FACILITATOR_URL: 'http://127.0.0.1:1' },
			paymentHeader,
			requirements,
			() => ({
				verify: async (payload, canonicalRequirements) => {
					seenPayloads.push(payload)
					seenRequirements.push(canonicalRequirements)
					return { isValid: true }
				},
				settle: async (payload, canonicalRequirements) => {
					seenPayloads.push(payload)
					seenRequirements.push(canonicalRequirements)
					return {
						success: true,
						transaction: '0xtx',
						network: requirements.network,
						payer: '0xpayer',
					}
				},
			}),
		)

		expect(r).toEqual({ ok: true, txHash: '0xtx', network: 'base', payer: '0xpayer' })
		expect(seenPayloads).toEqual([paymentPayload, paymentPayload])
		expect(seenRequirements).toHaveLength(2)
		expect(seenRequirements[0]).toBe(requirements)
		expect(seenRequirements[1]).toBe(requirements)
		expect(requirements.asset).toBe(ENV.AGENT_METERING_USDC_ADDRESS)
	})
})

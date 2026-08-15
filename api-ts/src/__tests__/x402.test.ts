import { describe, expect, it } from 'bun:test'
import {
	BYPASS_TIERS,
	COST_WEIGHTS,
	CREDIT_USD_VALUE,
	MCP_TOOL_COSTS,
	buildX402Challenge,
	costForTool,
	creditsToUsdcBaseUnits,
} from '../middleware/x402Payment'
import { crossCheckSignedRequirements } from '../services/FacilitatorService'

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
		payTo: '0xColleCToR0000000000000000000000000000abcd',
		asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
		maxAmountRequired: '5000',
	}

	it('accepts a matching, case-different, overpaying signed payment', () => {
		const r = crossCheckSignedRequirements(
			{
				payTo: advertised.payTo.toUpperCase(),
				asset: advertised.asset.toUpperCase(),
				amount: '6000', // overpayment OK
			},
			advertised,
		)
		expect(r.ok).toBe(true)
	})

	it('rejects a redirected payTo (fund theft attempt)', () => {
		const r = crossCheckSignedRequirements(
			{ payTo: '0xattacker', asset: advertised.asset, amount: '5000' },
			advertised,
		)
		expect(r).toEqual({ ok: false, error: 'payTo_mismatch' })
	})

	it('rejects a wrong asset', () => {
		const r = crossCheckSignedRequirements(
			{ payTo: advertised.payTo, asset: '0xnotusdc', amount: '5000' },
			advertised,
		)
		expect(r).toEqual({ ok: false, error: 'asset_mismatch' })
	})

	it('rejects underpayment', () => {
		const r = crossCheckSignedRequirements(
			{ payTo: advertised.payTo, asset: advertised.asset, amount: '4999' },
			advertised,
		)
		expect(r).toEqual({ ok: false, error: 'amount_too_low' })
	})

	it('rejects an unparseable amount instead of throwing', () => {
		const r = crossCheckSignedRequirements(
			{ payTo: advertised.payTo, asset: advertised.asset, amount: 'not-a-number' },
			advertised,
		)
		expect(r).toEqual({ ok: false, error: 'amount_unparseable' })
	})
})

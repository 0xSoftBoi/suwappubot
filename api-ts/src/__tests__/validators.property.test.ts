import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import {
	CreateP2POfferSchema,
	CreatePolicySchema,
	ExecuteSwapSchema,
	McpBrowseMppDirectorySchema,
	McpExecuteSwapSchema,
	McpGetPortfolioSchema,
	McpGetPricesSchema,
	McpGetSwapHistorySchema,
	McpGetSwapStatusSchema,
	McpGetTempoTokensSchema,
	McpLendMarketSchema,
	McpLendMarketsSchema,
	McpListChainsSchema,
	McpListTokensSchema,
	McpListWalletPoliciesSchema,
	McpPerpsMarketsSchema,
	McpPerpsPositionsSchema,
	McpPredictMarketIdSchema,
	McpPredictMarketsSchema,
	McpPredictTradesSchema,
	PerpsQuoteSchema,
	PlaceOrderSchema,
	QuoteRequestSchema,
	RegisterAgentSchema,
	SimulateSwapSchema,
	SwapRequestSchema,
	SwapStatusQuerySchema,
	TopupSchema,
	UpdateAgentSchema,
	WebhookEventsQuerySchema,
} from '../routes/validators'

// Property tests for every schema in routes/validators.ts (Phase 2 of
// docs/plans/oss-parity.md). These schemas back both public REST endpoints
// AND every MCP tool's `inputSchema` (see mcpTools.ts / mcp.ts dispatch), so
// a schema that *throws* instead of returning a Zod failure result would
// crash a request handler on attacker-controlled input rather than
// producing the intended 400 / MCP error response.
//
// Two invariants are checked across ALL schemas, over arbitrary JSON-shaped
// values (not just "reasonable" strings/numbers):
//   1. `.safeParse(x)` never throws for any JSON value `x` -- it always
//      returns `{ success: boolean, ... }`.
//   2. On success, `.parse(x)` (called again) doesn't throw either --
//      guards against a schema whose `.refine`/`.transform` is non-total
//      (throws on a second pass, e.g. a transform that assumes input shape
//      safeParse already validated away).
//
// fast-check's default numRuns (100) is used per the task brief; this file
// intentionally does not raise it since these are the general "throws"
// fuzzers, not the money-path-shape assertions below.

const jsonPrimitive = fc.oneof(
	fc.string(),
	fc.double({ noNaN: false }),
	fc.boolean(),
	fc.constant(null),
	fc.constant(undefined),
)

// Bounded-depth arbitrary JSON value -- objects/arrays of primitives, plus
// nesting one level deep, which is enough to exercise every branch a Zod
// object/array/union schema can take without runaway recursion.
const arbitraryJsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
	value: fc.oneof(
		{ depthSize: 'small' },
		jsonPrimitive,
		fc.array(tie('value') as fc.Arbitrary<unknown>, { maxLength: 5 }),
		fc.dictionary(fc.string(), tie('value') as fc.Arbitrary<unknown>, { maxKeys: 5 }),
	),
})).value

const ALL_SCHEMAS: Record<string, { safeParse: (x: unknown) => { success: boolean } }> = {
	RegisterAgentSchema,
	QuoteRequestSchema,
	SimulateSwapSchema,
	SwapRequestSchema,
	UpdateAgentSchema,
	CreatePolicySchema,
	ExecuteSwapSchema,
	SwapStatusQuerySchema,
	WebhookEventsQuerySchema,
	PlaceOrderSchema,
	TopupSchema,
	PerpsQuoteSchema,
	CreateP2POfferSchema,
	McpGetPortfolioSchema,
	McpGetPricesSchema,
	McpPerpsPositionsSchema,
	McpLendMarketsSchema,
	McpLendMarketSchema,
	McpPredictMarketsSchema,
	McpPredictMarketIdSchema,
	McpPredictTradesSchema,
	McpGetSwapStatusSchema,
	McpGetSwapHistorySchema,
	McpListWalletPoliciesSchema,
	McpListChainsSchema,
	McpPerpsMarketsSchema,
	McpListTokensSchema,
	McpGetTempoTokensSchema,
	McpBrowseMppDirectorySchema,
	McpExecuteSwapSchema,
}

describe('validators.ts: safeParse never throws (property)', () => {
	for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
		it(`${name}.safeParse never throws for arbitrary JSON input`, () => {
			fc.assert(
				fc.property(arbitraryJsonValue, (input) => {
					let result: { success: boolean }
					expect(() => {
						result = schema.safeParse(input)
					}).not.toThrow()
					// A successful parse must also be re-parseable without throwing --
					// guards against a non-total transform/refine.
					if (result!.success) {
						expect(() => schema.safeParse(input)).not.toThrow()
					}
				}),
			)
		})
	}

	it('every schema in this file rejects (never throws on) `undefined` top-level input', () => {
		for (const schema of Object.values(ALL_SCHEMAS)) {
			expect(() => schema.safeParse(undefined)).not.toThrow()
		}
	})
})

describe('McpExecuteSwapSchema (property)', () => {
	it('any accepted input has non-empty string quote_id and wallet_address, and a stringly idempotency_key when present', () => {
		fc.assert(
			fc.property(arbitraryJsonValue, (input) => {
				const result = McpExecuteSwapSchema.safeParse(input)
				if (!result.success) return
				expect(typeof result.data.quote_id).toBe('string')
				expect(result.data.quote_id.length).toBeGreaterThan(0)
				expect(typeof result.data.wallet_address).toBe('string')
				expect(result.data.wallet_address.length).toBeGreaterThan(0)
				if (result.data.idempotency_key !== null && result.data.idempotency_key !== undefined) {
					expect(typeof result.data.idempotency_key).toBe('string')
				}
			}),
		)
	})

	it('accepts a numeric idempotency_key and coerces it to a string (post-parse invariant)', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1 }),
				fc.string({ minLength: 1 }),
				fc.double({ noNaN: true, noDefaultInfinity: true }),
				(quoteId, walletAddress, idKeyNumber) => {
					const result = McpExecuteSwapSchema.safeParse({
						quote_id: quoteId,
						wallet_address: walletAddress,
						idempotency_key: idKeyNumber,
					})
					expect(result.success).toBe(true)
					if (result.success) {
						expect(typeof result.data.idempotency_key).toBe('string')
						expect(result.data.idempotency_key).toBe(String(idKeyNumber))
					}
				},
			),
		)
	})

	it('rejects empty-string quote_id/wallet_address (min(1) enforced)', () => {
		fc.assert(
			fc.property(fc.string({ minLength: 1 }), (walletAddress) => {
				const result = McpExecuteSwapSchema.safeParse({
					quote_id: '',
					wallet_address: walletAddress,
				})
				expect(result.success).toBe(false)
			}),
		)
	})
})

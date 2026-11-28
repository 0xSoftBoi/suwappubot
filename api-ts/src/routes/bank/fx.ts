import { Effect } from 'effect'
import { findAsset, toMinor } from '../../services/bank/assets'
import { BankFxService } from '../../services/bank/BankFxService'
import { BankLedgerService } from '../../services/bank/BankLedgerService'
import { bankErr } from '../../services/bank/errors'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'
import { FxExecuteSchema, FxQuoteSchema } from './schemas'

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps

	const resolveAmount = (owner: Parameters<BankLedgerService['Type']['getAccount']>[0], b: { fromAccountId: string; amountMinor?: string | undefined; amount?: string | undefined }) =>
		Effect.gen(function* () {
			if (b.amountMinor) return b.amountMinor
			const ledger = yield* BankLedgerService
			const from = yield* ledger.getAccount(owner, b.fromAccountId)
			const asset = findAsset(from.asset, from.chain)
			if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', 'Unsupported asset'))
			return yield* Effect.try({
				try: () => toMinor(b.amount!, asset.decimals).toString(),
				catch: (e) => bankErr('VALIDATION', (e as Error).message),
			})
		})

	app.post('/fx/quote', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = FxQuoteSchema.safeParse(await readJson(c))
		if (!parsed.success) return c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(parsed.error) }, 400)
		const b = parsed.data
		return run(
			c,
			Effect.gen(function* () {
				const amountMinor = yield* resolveAmount(owner, b)
				const fx = yield* BankFxService
				return { quote: yield* fx.quote({ owner, fromAccountId: b.fromAccountId, toAccountId: b.toAccountId, amountMinor, slippage: b.slippage, requireDirect: b.requireDirect }) }
			}),
		)
	})

	app.post('/fx/execute', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = FxExecuteSchema.safeParse(await readJson(c))
		if (!parsed.success) return c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(parsed.error) }, 400)
		const b = parsed.data
		const idempotencyKey = b.idempotencyKey ?? c.req.header('Idempotency-Key')?.trim()
		if (!idempotencyKey) return c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: { idempotencyKey: 'required (body field or Idempotency-Key header)' } }, 400)
		return run(
			c,
			Effect.gen(function* () {
				const amountMinor = yield* resolveAmount(owner, b)
				const fx = yield* BankFxService
				return yield* fx.execute({ owner, idempotencyKey, fromAccountId: b.fromAccountId, toAccountId: b.toAccountId, amountMinor, slippage: b.slippage, requireDirect: b.requireDirect, minToMinor: b.minToMinor })
			}),
		)
	})
}

import { Effect } from 'effect'
import { z } from 'zod'
import { BankLedgerService } from '../../services/bank/BankLedgerService'
import { SEGMENTS, SEGMENT_PROFILES, effectiveFeatures, setAccountSegment } from '../../services/bank/segments'
import { formatZodErrors } from '../validators'
import { readJson } from './core'
import type { BankRouteApp, BankRouteDeps } from './index'

const SetSegment = z.object({ segment: z.enum(SEGMENTS).nullable() })

export function register(app: BankRouteApp, deps: BankRouteDeps): void {
	const { resolveOwner, run } = deps

	app.get('/segments', (c) => c.json({ success: true, segments: Object.values(SEGMENT_PROFILES) }))

	app.get('/segments/:segment', (c) => {
		const p = SEGMENT_PROFILES[c.req.param('segment') as keyof typeof SEGMENT_PROFILES]
		return p ? c.json({ success: true, profile: p }) : c.json({ success: false, error: 'NOT_FOUND', message: 'Unknown segment' }, 404)
	})

	app.get('/accounts/:id/features', async (c) => {
		const owner = await resolveOwner(c)
		return run(
			c,
			Effect.gen(function* () {
				const ledger = yield* BankLedgerService
				const a = yield* ledger.getAccount(owner, c.req.param('id'))
				return { effective: effectiveFeatures(a) }
			}),
		)
	})

	app.put('/accounts/:id/segment', async (c) => {
		const owner = await resolveOwner(c)
		const parsed = SetSegment.safeParse(await readJson(c))
		if (!parsed.success) return c.json({ error: 'Validation Error', error_code: 'VALIDATION_ERROR', fields: formatZodErrors(parsed.error) }, 400)
		return run(
			c,
			Effect.gen(function* () {
				const a = yield* setAccountSegment(owner, c.req.param('id'), parsed.data.segment)
				return { effective: effectiveFeatures(a) }
			}),
		)
	})
}

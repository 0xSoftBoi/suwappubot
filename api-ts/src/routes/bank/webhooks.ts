/**
 * Provider webhooks: POST /bank/webhooks/:provider (mounted in app.ts, no user auth — authenticity
 * comes from the provider signature over the RAW body). Idempotent per provider event id.
 * Non-2xx makes the provider retry; a duplicate event returns 200.
 */
import { Hono } from 'hono'
import { Effect } from 'effect'
import { BankRampService } from '../../services/bank/BankRampService'
import { BankError } from '../../services/bank/errors'
import { logger } from '../../lib/logger'
import { runEffectEither } from '../../runtime'
import { setRetryAfter } from './retry'

export const bankWebhookRoutes = new Hono()

bankWebhookRoutes.post('/:provider', async (c) => {
	const raw = await c.req.text() // exact bytes the signature covers
	const headers: Record<string, string | undefined> = {}
	c.req.raw.headers.forEach((v, k) => {
		headers[k.toLowerCase()] = v
	})
	const result = await runEffectEither(
		Effect.gen(function* () {
			return yield* (yield* BankRampService).handleWebhook(c.req.param('provider'), headers, raw)
		}),
	)
	if (result._tag === 'Right') return c.json({ success: true, ...result.right })
	const e = result.left
	if (e instanceof BankError) {
		logger.warn({ provider: c.req.param('provider'), code: e.code, err: e.message }, 'bank webhook rejected')
		setRetryAfter(c, e)
		return c.json({ success: false, error_code: e.code, error: e.message, ...(e.missing ? { missing: e.missing } : {}) }, e.status as 400)
	}
	logger.error({ provider: c.req.param('provider'), err: String(e) }, 'bank webhook failed')
	return c.json({ success: false, error_code: 'INTERNAL', error: 'webhook processing failed' }, 500)
})

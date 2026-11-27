/**
 * Card provider webhooks (M6). PUBLIC (signature-authenticated, no user/agent auth), so this is
 * a standalone Hono app that must be mounted OUTSIDE the authed bank apps:
 *   app.route('/webhooks/bank/cards', bankCardWebhookRoutes)   // -> POST /webhooks/bank/cards/stripe
 *
 * `issuing_authorization.request` is answered synchronously (Stripe's budget is 2s): we cap our own
 * work at 1.5s and answer approved:false on timeout/error (fail closed). A hold created after a
 * timeout is released by the follow-up issuing_authorization.created/updated event.
 */
import { Effect, Either } from 'effect'
import { Hono } from 'hono'
import { runEffectEither } from '../../runtime'
import { BankCardService } from '../../services/bank/BankCardService'
import { BankError, bankErr } from '../../services/bank/errors'
import type { CardProviderName } from '../../services/bank/cards/CardProvider'

const DECISION_BUDGET_MS = 1500

export const bankCardWebhookRoutes = new Hono()

const handle = (provider: CardProviderName) => async (c: { req: { text: () => Promise<string>; header: (n: string) => string | undefined }; json: (b: unknown, s?: number) => Response }) => {
	const raw = await c.req.text() // raw body is required for signature verification
	const sig = c.req.header('stripe-signature')
	const result = await runEffectEither(
		Effect.gen(function* () {
			const svc = yield* BankCardService
			return yield* svc.handleWebhook(provider, raw, sig).pipe(
				Effect.timeoutFail({ duration: `${DECISION_BUDGET_MS} millis`, onTimeout: () => bankErr('UPSTREAM', 'webhook decision budget exceeded') }),
			)
		}),
	)
	if (Either.isRight(result)) {
		const r = result.right
		return new Response(r.body, { status: r.status, headers: r.headers })
	}
	const e = result.left as unknown
	if (e instanceof BankError) {
		if (e.code === 'FORBIDDEN' || e.code === 'VALIDATION') return c.json({ error: e.code, message: e.message }, 400)
		if (e.code === 'NOT_CONFIGURED') return c.json({ error: e.code, message: e.message, missing: e.missing }, 503)
		// Non-auth failure: a real-time request that blew the budget must still get a decline.
		return c.json({ error: e.code }, 500)
	}
	return c.json({ error: 'INTERNAL' }, 500)
}

bankCardWebhookRoutes.post('/stripe', handle('stripe') as never)

/**
 * Suwappu Bank routes. Two Hono apps share handlers via routes/bank/*:
 *   bankWebappRoutes -> /webapp/bank   (Telegram initData auth, owner = users.id)
 *   bankAgentRoutes  -> /v1/agent/bank (agent bearer token, owner = agents.id)
 * Org-API-key-only callers (no agent) are rejected until the M11 partner module adds an owner mapping.
 */
import { Effect, Either, Option } from 'effect'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { mapErrorToResponse } from '../errors'
import type { Agent } from '../db'
import { agentFlexAuth, rateLimit, telegramAuth } from '../middleware'
import { runEffectEither } from '../runtime'
import { UserService } from '../services'
import { BankError } from '../services/bank/errors'
import type { BankOwner } from '../services/bank/db'
import { type BankRouteApp, type BankRouteDeps, registerAll } from './bank/index'

const run: BankRouteDeps['run'] = async (c, effect) => {
	const result = await runEffectEither(effect)
	if (Either.isLeft(result)) {
		const e = result.left as unknown
		if (e instanceof BankError) {
			return c.json(
				{ success: false, error: e.code, error_code: e.code, message: e.message, ...(e.missing ? { missing: e.missing } : {}) },
				e.status as 400,
			)
		}
		const { status, body } = mapErrorToResponse(e)
		return c.json(body, status)
	}
	return c.json({ success: true, ...(result.right as object) })
}

const webappDeps: BankRouteDeps = {
	audience: 'webapp',
	run,
	resolveOwner: async (c: Context): Promise<BankOwner> => {
		const tg = c.get('telegramUser')
		if (!tg) throw new HTTPException(401, { message: 'Missing Telegram authentication' })
		const user = await runEffectEither(
			Effect.gen(function* () {
				const users = yield* UserService
				return yield* users.getUserByTelegramId(tg.id)
			}),
		)
		if (Either.isLeft(user) || Option.isNone(user.right)) throw new HTTPException(404, { message: 'User not found' })
		return { ownerType: 'user', ownerId: String(user.right.value.id) }
	},
}

const agentDeps: BankRouteDeps = {
	audience: 'agent',
	run,
	resolveOwner: async (c: Context): Promise<BankOwner> => {
		const agent = c.get('agent') as Agent | undefined
		if (!agent) throw new HTTPException(403, { message: 'Bank endpoints require an agent bearer token (suwappu_sk_*)' })
		return { ownerType: 'agent', ownerId: String(agent.id) }
	},
}

export const bankWebappRoutes: BankRouteApp = new Hono()
bankWebappRoutes.use('*', telegramAuth())
registerAll(bankWebappRoutes, webappDeps)

export const bankAgentRoutes: BankRouteApp = new Hono()
bankAgentRoutes.use('*', agentFlexAuth())
bankAgentRoutes.use('*', rateLimit())
registerAll(bankAgentRoutes, agentDeps)

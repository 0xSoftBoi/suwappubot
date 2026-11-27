/**
 * Bank route registry. A module adds ONE import + ONE entry in `modules`.
 * Each module file exports `register(app, deps)`; handlers are shared by the
 * webapp (/webapp/bank) and agent (/v1/agent/bank) apps via deps.resolveOwner().
 */
import type { Context, Hono } from 'hono'
import type { Effect } from 'effect'
import type { Agent } from '../../db'
import type { MainLayerContext } from '../../services/MainLayer'
import type { BankOwner } from '../../services/bank/db'
import { register as core } from './core'
import { register as fx } from './fx'
import { register as ramps } from './ramps'
import { register as remittance } from './remittance'
import { register as cards } from './cards'
import { register as earn } from './earn'
import { register as credit } from './credit'
import { register as business } from './business'

export type BankRouteApp = Hono<{ Variables: { agent?: Agent } }>

export interface BankRouteDeps {
	/** Resolves the authenticated owner (user via Telegram, agent via bearer). Throws HTTPException 401/403. */
	resolveOwner: (c: Context) => Promise<BankOwner>
	/** Runs an Effect and maps success/errors to a JSON Response. */
	run: <A, E>(c: Context, effect: Effect.Effect<A, E, MainLayerContext>) => Promise<Response>
	/** 'webapp' | 'agent' — for audience-specific behaviour. */
	audience: 'webapp' | 'agent'
}

type Module = (app: BankRouteApp, deps: BankRouteDeps) => void

export const modules: Module[] = [
	core,
	fx,
	ramps,
	remittance,
	cards,
	earn,
	credit,
	business,
	// <module register fns go here, one line each>
]

export function registerAll(app: BankRouteApp, deps: BankRouteDeps): void {
	for (const m of modules) m(app, deps)
}

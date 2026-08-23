/**
 * Declarative agent provisioning.
 *
 * A fresh environment has an empty database, and creating the agent by hand
 * with an admin key after every deploy is how environments drift apart. This
 * lets an environment *declare* the paper agent it should have.
 *
 * Two hard limits, both structural rather than advisory:
 *  - it can only ever create a `paper` agent. A live agent moves real money and
 *    must be a deliberate, authenticated act, not a side effect of a deploy.
 *  - it never touches an agent that already exists. Config is a seed, not a
 *    reconciler: an operator who tuned the rules or paused the agent must not
 *    find a redeploy quietly undoing it.
 */
import { Effect } from 'effect'
import { logger } from '../../lib/logger'
import { runEffect } from '../../runtime'
import { AutopilotService } from '../AutopilotService'
import type { AutopilotRules } from './types'

export interface BootstrapConfig {
	slug: string
	name: string
	chain: string
	baseToken: string
	startingEquityUsd: number
	description?: string | undefined
	baseTokenSymbol?: string | undefined
	thesisEngine?: string | undefined
	rules?: Partial<AutopilotRules> | undefined
	/** Start the agent immediately. Paper only, so the blast radius is a log line. */
	active?: boolean | undefined
}

export type ParseResult = { ok: true; config: BootstrapConfig } | { ok: false; error: string }

/** Strict parse — anything unexpected is refused rather than coerced. */
export function parseBootstrapConfig(raw: string): ParseResult {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return { ok: false, error: 'AUTOPILOT_BOOTSTRAP is not valid JSON' }
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { ok: false, error: 'AUTOPILOT_BOOTSTRAP must be a JSON object' }
	}

	const c = parsed as Record<string, unknown>

	if (c.mode !== undefined && c.mode !== 'paper') {
		return {
			ok: false,
			error: 'bootstrap can only create paper agents — a live agent must be created deliberately',
		}
	}
	if (typeof c.slug !== 'string' || !/^[a-z0-9-]{3,64}$/.test(c.slug)) {
		return { ok: false, error: 'slug must be 3-64 chars of [a-z0-9-]' }
	}
	if (typeof c.name !== 'string' || c.name.length === 0) {
		return { ok: false, error: 'name is required' }
	}
	if (typeof c.chain !== 'string' || c.chain.length === 0) {
		return { ok: false, error: 'chain is required' }
	}
	if (typeof c.baseToken !== 'string' || c.baseToken.length === 0) {
		return { ok: false, error: 'baseToken is required' }
	}
	if (typeof c.startingEquityUsd !== 'number' || !(c.startingEquityUsd > 0)) {
		return { ok: false, error: 'startingEquityUsd must be a positive number' }
	}
	if (c.rules !== undefined && (typeof c.rules !== 'object' || c.rules === null)) {
		return { ok: false, error: 'rules must be an object' }
	}

	return {
		ok: true,
		config: {
			slug: c.slug,
			name: c.name,
			chain: c.chain,
			baseToken: c.baseToken,
			startingEquityUsd: c.startingEquityUsd,
			...(typeof c.description === 'string' ? { description: c.description } : {}),
			...(typeof c.baseTokenSymbol === 'string' ? { baseTokenSymbol: c.baseTokenSymbol } : {}),
			...(typeof c.thesisEngine === 'string' ? { thesisEngine: c.thesisEngine } : {}),
			...(c.rules ? { rules: c.rules as Partial<AutopilotRules> } : {}),
			...(c.active === true ? { active: true } : {}),
		},
	}
}

/**
 * Seed the declared agent if it is missing. Never throws: a bootstrap failure
 * must not stop the API from serving.
 */
export async function runAutopilotBootstrap(raw: string | undefined): Promise<void> {
	if (!raw || raw.trim().length === 0) return

	const parsed = parseBootstrapConfig(raw)
	if (!parsed.ok) {
		logger.error({ reason: parsed.error }, 'autopilot: bootstrap config refused')
		return
	}
	const { config } = parsed

	try {
		const existing = await runEffect(
			Effect.gen(function* () {
				const svc = yield* AutopilotService
				return yield* svc.listAgents()
			}),
		)
		if (existing.some((a) => a.slug === config.slug)) {
			logger.info(
				{ slug: config.slug },
				'autopilot: bootstrap agent already exists, leaving it alone',
			)
			return
		}

		await runEffect(
			Effect.gen(function* () {
				const svc = yield* AutopilotService
				yield* svc.createAgent({
					slug: config.slug,
					name: config.name,
					chain: config.chain,
					baseToken: config.baseToken,
					startingEquityUsd: config.startingEquityUsd,
					mode: 'paper',
					...(config.description ? { description: config.description } : {}),
					...(config.baseTokenSymbol ? { baseTokenSymbol: config.baseTokenSymbol } : {}),
					...(config.thesisEngine ? { thesisEngine: config.thesisEngine } : {}),
					...(config.rules ? { rules: config.rules } : {}),
				})
				if (config.active) {
					yield* svc.setStatus(config.slug, 'active')
				}
			}),
		)

		logger.info(
			{ slug: config.slug, active: config.active === true },
			'autopilot: bootstrapped paper agent',
		)
	} catch (err) {
		logger.error({ err: String(err), slug: config.slug }, 'autopilot: bootstrap failed')
	}
}

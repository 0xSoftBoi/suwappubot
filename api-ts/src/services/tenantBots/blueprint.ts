/**
 * The composer — a natural-language brief becomes a bot blueprint.
 *
 * This is the "agentic" half of the dashboard: a meme-coin team types what they
 * want their bot to do and gets back a configured bot, not a form to fill in.
 *
 * The split is the same one `autopilot/llmThesis.ts` makes, for the same
 * reason. The model chooses *shape* — which skills, what the bot is called, how
 * it talks, roughly how often a burn should run. This file chooses everything
 * that has consequences: which skill keys are real, that a spending automation
 * starts in `simulate` with `enabled: false`, and what the caps are clamped to.
 * A model that hallucinated a `drain_treasury` skill or a $10,000,000 per-run
 * cap cannot express either through `sanitizeBlueprint`.
 *
 * There is a deterministic fallback (`heuristicBlueprint`) that runs when no
 * ANTHROPIC_API_KEY is set or the call fails. The composer is a convenience, so
 * losing the model must degrade the output, never the endpoint.
 */
import Anthropic from '@anthropic-ai/sdk'
import { logger } from '../../lib/logger'

export const MODEL = 'claude-opus-5'

/** Every skill the hosted runtime can actually serve. The allowlist is the
 *  contract — anything outside it is dropped, never passed through. */
export const SKILL_CATALOG = {
	price: 'Answer /price with live price, 24h change and liquidity for the project token.',
	chart: 'Post a price chart image on /chart.',
	buy: 'Let members buy the project token in-chat through Suwappu swap.',
	swap: 'Full cross-chain swap menu (any token, 7+ chains).',
	holders: 'Report holder count, top holders and supply distribution.',
	burn_stats: 'Report total burned, burn rate and circulating supply.',
	welcome: 'Greet new members with the project pitch and links.',
	raid: 'Post raid targets and track engagement.',
	leaderboard: 'Rank members by buy volume over a window.',
	alerts: 'Let members set price alerts on the project token.',
	portfolio: 'Show a member their wallet balances and PnL.',
} as const

export type SkillKey = keyof typeof SKILL_CATALOG

export const AUTOMATION_KINDS = [
	'buy_and_burn',
	'buyback',
	'reward_drip',
	'price_post',
	'holder_report',
] as const
export type AutomationKind = (typeof AUTOMATION_KINDS)[number]

/** Kinds that move funds. These get the strict defaults. */
const SPENDING_KINDS = new Set<AutomationKind>(['buy_and_burn', 'buyback', 'reward_drip'])

/** Hard ceiling on what the composer may propose, whatever the brief says.
 *  Raising a cap past this is a deliberate act in the dashboard, by a human. */
const MAX_COMPOSED_USD_PER_RUN = 500
const MAX_COMPOSED_USD_PER_DAY = 2_000

export interface BlueprintAutomation {
	kind: AutomationKind
	name: string
	cron: string | null
	mode: 'simulate' | 'live'
	enabled: boolean
	maxUsdPerRun: number
	maxUsdPerDay: number
	config: Record<string, unknown>
	/** Plain-English note the dashboard shows under the automation. */
	rationale?: string
}

export interface BotBlueprint {
	name: string
	branding: {
		displayName: string
		tagline?: string
		mark?: string
		footer?: string
		voice?: string
	}
	skills: { key: SkillKey; enabled: boolean; config?: Record<string, unknown> }[]
	automations: BlueprintAutomation[]
	/** Commands the composer intends members to see, for the dashboard preview. */
	commands: { command: string; description: string }[]
	/** What the composer understood the brief to mean. Shown to the operator so
	 *  they can correct it in words instead of guessing at the config. */
	summary: string
	/** Which path produced this — 'llm' or 'heuristic'. Surfaced in the UI. */
	source: 'llm' | 'heuristic'
}

export interface ComposeInput {
	brief: string
	tokenSymbol?: string
	tokenChain?: string
	tokenAddress?: string
	projectName?: string
}

// ── Sanitisation: the part that holds even if the model misbehaves ──────────

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
	const v = typeof n === 'number' ? n : Number.parseFloat(String(n ?? ''))
	if (!Number.isFinite(v)) return fallback
	return Math.max(min, Math.min(max, Math.floor(v)))
}

function str(v: unknown, max: number): string | undefined {
	if (typeof v !== 'string') return undefined
	const s = v.trim()
	return s ? s.slice(0, max) : undefined
}

/** 5-field cron, digits/star/slash/comma/dash only. Anything else becomes null
 *  (trigger-only) rather than reaching a scheduler as an unvalidated string. */
function safeCron(v: unknown): string | null {
	const s = typeof v === 'string' ? v.trim() : ''
	if (!s) return null
	if (!/^[\d*/,\-\s]+$/.test(s)) return null
	if (s.split(/\s+/).length !== 5) return null
	return s.slice(0, 64)
}

export function sanitizeBlueprint(raw: unknown, input: ComposeInput, source: 'llm' | 'heuristic'): BotBlueprint {
	const obj = (raw ?? {}) as Record<string, any>
	const fallbackName =
		input.projectName?.trim() || (input.tokenSymbol ? `${input.tokenSymbol} Bot` : 'Community Bot')

	const seen = new Set<string>()
	const skills = (Array.isArray(obj.skills) ? obj.skills : [])
		.map((s: any) => (typeof s === 'string' ? { key: s, enabled: true } : s))
		.filter((s: any) => s && typeof s.key === 'string' && s.key in SKILL_CATALOG)
		.filter((s: any) => (seen.has(s.key) ? false : (seen.add(s.key), true)))
		.slice(0, 12)
		.map((s: any) => ({
			key: s.key as SkillKey,
			enabled: s.enabled !== false,
			config:
				s.config && typeof s.config === 'object' && !Array.isArray(s.config)
					? (s.config as Record<string, unknown>)
					: undefined,
		}))

	const automations = (Array.isArray(obj.automations) ? obj.automations : [])
		.filter((a: any) => a && AUTOMATION_KINDS.includes(a.kind))
		.slice(0, 6)
		.map((a: any): BlueprintAutomation => {
			const kind = a.kind as AutomationKind
			const spends = SPENDING_KINDS.has(kind)
			const perRun = spends
				? clampInt(a.maxUsdPerRun, 1, MAX_COMPOSED_USD_PER_RUN, 25)
				: 0
			const perDay = spends
				? Math.max(perRun, clampInt(a.maxUsdPerDay, 1, MAX_COMPOSED_USD_PER_DAY, perRun * 4))
				: 0
			return {
				kind,
				name: str(a.name, 120) || kind.replace(/_/g, ' '),
				cron: safeCron(a.cron),
				// Non-negotiable: nothing the composer emits can spend on its own.
				// The operator flips mode and enabled by hand, in the dashboard,
				// after reading the simulated runs.
				mode: 'simulate',
				enabled: false,
				maxUsdPerRun: perRun,
				maxUsdPerDay: perDay,
				config: {
					...(a.config && typeof a.config === 'object' && !Array.isArray(a.config) ? a.config : {}),
					...(input.tokenChain ? { chain: input.tokenChain } : {}),
					...(input.tokenAddress ? { buyToken: input.tokenAddress } : {}),
				},
				rationale: str(a.rationale, 300),
			}
		})

	const commands = (Array.isArray(obj.commands) ? obj.commands : [])
		.slice(0, 15)
		.map((c: any) => ({
			command: (str(c?.command, 32) || '').replace(/^\/*/, '/').toLowerCase(),
			description: str(c?.description, 120) || '',
		}))
		.filter((c: { command: string }) => /^\/[a-z0-9_]{1,30}$/.test(c.command))

	const branding = (obj.branding ?? {}) as Record<string, unknown>
	return {
		name: str(obj.name, 120) || fallbackName,
		branding: {
			displayName: str(branding.displayName, 120) || str(obj.name, 120) || fallbackName,
			tagline: str(branding.tagline, 160),
			mark: str(branding.mark, 8),
			footer: str(branding.footer, 120),
			voice: str(branding.voice, 400),
		},
		skills,
		automations,
		commands,
		summary: str(obj.summary, 800) || 'Composed from the brief.',
		source,
	}
}

// ── Deterministic path ──────────────────────────────────────────────────────

/** Keyword routing. Crude on purpose: it exists so the endpoint keeps working
 *  when the model does not, and so its behaviour is testable without a key. */
export function heuristicBlueprint(input: ComposeInput): BotBlueprint {
	const b = input.brief.toLowerCase()
	const sym = input.tokenSymbol?.toUpperCase()
	const has = (...words: string[]) => words.some((w) => b.includes(w))

	const skills: { key: SkillKey; enabled: boolean }[] = [
		{ key: 'price', enabled: true },
		{ key: 'buy', enabled: true },
	]
	if (has('chart', 'candle')) skills.push({ key: 'chart', enabled: true })
	if (has('holder', 'supply', 'distribution')) skills.push({ key: 'holders', enabled: true })
	if (has('burn')) skills.push({ key: 'burn_stats', enabled: true })
	if (has('welcome', 'onboard', 'new member')) skills.push({ key: 'welcome', enabled: true })
	if (has('raid', 'shill')) skills.push({ key: 'raid', enabled: true })
	if (has('leaderboard', 'top buyer', 'competition')) {
		skills.push({ key: 'leaderboard', enabled: true })
	}
	if (has('alert', 'notify')) skills.push({ key: 'alerts', enabled: true })
	if (has('swap', 'cross-chain', 'bridge')) skills.push({ key: 'swap', enabled: true })

	const automations: BlueprintAutomation[] = []
	if (has('burn')) {
		automations.push({
			kind: 'buy_and_burn',
			name: sym ? `${sym} buy & burn` : 'Buy & burn',
			cron: '0 * * * *',
			mode: 'simulate',
			enabled: false,
			maxUsdPerRun: 25,
			maxUsdPerDay: 100,
			config: {
				...(input.tokenChain ? { chain: input.tokenChain } : {}),
				...(input.tokenAddress ? { buyToken: input.tokenAddress } : {}),
				burnAddress: '0x000000000000000000000000000000000000dEaD',
			},
			rationale: 'Hourly buy-and-burn, simulated until you review the runs and set a budget.',
		})
	} else if (has('buyback')) {
		automations.push({
			kind: 'buyback',
			name: sym ? `${sym} buyback` : 'Buyback',
			cron: '0 */6 * * *',
			mode: 'simulate',
			enabled: false,
			maxUsdPerRun: 50,
			maxUsdPerDay: 200,
			config: {
				...(input.tokenChain ? { chain: input.tokenChain } : {}),
				...(input.tokenAddress ? { buyToken: input.tokenAddress } : {}),
			},
			rationale: 'Buyback every 6h into the treasury wallet.',
		})
	}
	if (has('daily', 'post', 'update', 'report')) {
		automations.push({
			kind: 'price_post',
			name: 'Daily price post',
			cron: '0 13 * * *',
			mode: 'simulate',
			enabled: false,
			maxUsdPerRun: 0,
			maxUsdPerDay: 0,
			config: {},
			rationale: 'Daily price and volume summary to the community chat.',
		})
	}

	const name = input.projectName?.trim() || (sym ? `${sym} Bot` : 'Community Bot')
	return sanitizeBlueprint(
		{
			name,
			branding: {
				displayName: name,
				tagline: sym ? `The official ${sym} community bot` : undefined,
				mark: '🔥',
			},
			skills,
			automations,
			commands: skills.map((s) => ({
				command: `/${s.key === 'buy' ? 'buy' : s.key}`,
				description: SKILL_CATALOG[s.key],
			})),
			summary:
				'Composed without the model (no ANTHROPIC_API_KEY, or the call failed). ' +
				'Skills were matched from keywords in your brief — edit anything that looks wrong.',
		},
		input,
		'heuristic',
	)
}

// ── Model path ──────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You configure white-label Telegram bots for crypto communities.

You are given a project's brief and return a bot configuration. You choose the
bot's name, voice, which skills to enable, and which automations to propose.

Rules you are held to:
- Enable only skills from the catalogue you are shown. A skill you invent is
  discarded, and the community silently loses the feature they asked for.
- Enable the smallest set that serves the brief. A bot with eleven commands is
  worse than one with four that people use.
- Automations that spend money (buy_and_burn, buyback, reward_drip) are
  PROPOSALS. Suggest a conservative cadence and a small per-run USD cap; a human
  reviews simulated runs before anything goes live. Do not propose caps above
  $500 per run.
- The voice field is how the bot talks to its community. Match the brief's
  register — a meme coin is not a bank — without being obnoxious.
- Never promise a price outcome, a return, or that a burn raises the price.
  Describe mechanics, not results.
- The summary is read by the operator to check you understood them. Write it as
  two or three plain sentences, not a feature list.`

const BLUEPRINT_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['name', 'branding', 'skills', 'automations', 'commands', 'summary'],
	properties: {
		name: { type: 'string', maxLength: 120 },
		branding: {
			type: 'object',
			additionalProperties: false,
			required: ['displayName'],
			properties: {
				displayName: { type: 'string', maxLength: 120 },
				tagline: { type: 'string', maxLength: 160 },
				mark: { type: 'string', maxLength: 8 },
				footer: { type: 'string', maxLength: 120 },
				voice: { type: 'string', maxLength: 400 },
			},
		},
		skills: {
			type: 'array',
			maxItems: 12,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['key', 'enabled'],
				properties: {
					key: { type: 'string', enum: Object.keys(SKILL_CATALOG) },
					enabled: { type: 'boolean' },
				},
			},
		},
		automations: {
			type: 'array',
			maxItems: 6,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'name', 'cron', 'rationale'],
				properties: {
					kind: { type: 'string', enum: AUTOMATION_KINDS as unknown as string[] },
					name: { type: 'string', maxLength: 120 },
					cron: { type: 'string', maxLength: 64 },
					maxUsdPerRun: { type: 'number', minimum: 1, maximum: 500 },
					maxUsdPerDay: { type: 'number', minimum: 1, maximum: 2000 },
					rationale: { type: 'string', maxLength: 300 },
				},
			},
		},
		commands: {
			type: 'array',
			maxItems: 15,
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['command', 'description'],
				properties: {
					command: { type: 'string', maxLength: 32 },
					description: { type: 'string', maxLength: 120 },
				},
			},
		},
		summary: { type: 'string', maxLength: 800 },
	},
} as const

export async function composeBlueprint(
	input: ComposeInput,
	opts: { apiKey?: string; model?: string } = {},
): Promise<BotBlueprint> {
	const brief = input.brief.trim()
	if (!brief) return heuristicBlueprint(input)
	if (!opts.apiKey) return heuristicBlueprint(input)

	const catalogue = Object.entries(SKILL_CATALOG)
		.map(([k, v]) => `- ${k}: ${v}`)
		.join('\n')

	const userContent = [
		`Brief from the project:\n"""\n${brief.slice(0, 4000)}\n"""`,
		input.projectName ? `Project name: ${input.projectName}` : null,
		input.tokenSymbol ? `Token symbol: ${input.tokenSymbol}` : null,
		input.tokenChain ? `Chain: ${input.tokenChain}` : null,
		input.tokenAddress ? `Token address: ${input.tokenAddress}` : null,
		`\nSkill catalogue (use these keys only):\n${catalogue}`,
		`\nAutomation kinds: ${AUTOMATION_KINDS.join(', ')}`,
	]
		.filter(Boolean)
		.join('\n')

	try {
		const client = new Anthropic({ apiKey: opts.apiKey })
		const res = await client.messages.create({
			model: opts.model || MODEL,
			max_tokens: 2000,
			system: SYSTEM_PROMPT,
			tools: [
				{
					name: 'emit_blueprint',
					description: 'Return the bot configuration.',
					input_schema: BLUEPRINT_SCHEMA as unknown as Anthropic.Tool['input_schema'],
				},
			],
			tool_choice: { type: 'tool', name: 'emit_blueprint' },
			messages: [{ role: 'user', content: userContent }],
		})

		const block = res.content.find((c) => c.type === 'tool_use')
		if (!block || block.type !== 'tool_use') {
			logger.warn('composeBlueprint: model returned no tool_use block, falling back')
			return heuristicBlueprint(input)
		}
		return sanitizeBlueprint(block.input, input, 'llm')
	} catch (e) {
		logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'composeBlueprint failed')
		return heuristicBlueprint(input)
	}
}

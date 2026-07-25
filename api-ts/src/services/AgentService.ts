import crypto from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { Context, Effect, Layer, Option } from 'effect'
import {
	type Agent,
	agentCredits,
	agents,
	type DrizzleService,
	requireDb,
	requireRow,
	webhookEvents,
} from '../db'
import { DatabaseError } from '../errors'
import { auditLog } from './audit'

/**
 * One-time starter credit grant for newly registered agents. Lets a fresh
 * agent complete its first documented call (POST /v1/agent/quote, etc.)
 * without hitting a 402 before it has ever topped up. 100 credits ≈ $0.10
 * at CREDIT_USD_VALUE = $0.001/credit (see middleware/x402Payment.ts) — enough
 * for the onboarding quick-start flow, not a meaningful giveaway.
 * MONEY-PATH: grants free credits; tune STARTER_CREDITS if abused.
 */
const STARTER_CREDITS = 100

export interface RegisterAgentParams {
	name: string
	description?: string | undefined
	callbackUrl?: string | undefined
	metadata?: Record<string, unknown> | undefined
}

export interface UpdateAgentParams {
	description?: string | undefined
	callbackUrl?: string | null | undefined
	metadata?: Record<string, unknown> | undefined
}

export interface AgentServiceInterface {
	readonly registerAgent: (
		params: RegisterAgentParams,
	) => Effect.Effect<{ agent: Agent; apiKey: string }, DatabaseError, DrizzleService>

	readonly getAgentByApiKey: (
		apiKey: string,
	) => Effect.Effect<Option.Option<Agent>, DatabaseError, DrizzleService>

	readonly getAgentByName: (
		name: string,
	) => Effect.Effect<Option.Option<Agent>, DatabaseError, DrizzleService>

	readonly getAgentById: (
		id: number,
	) => Effect.Effect<Option.Option<Agent>, DatabaseError, DrizzleService>

	readonly updateAgent: (
		agentId: number,
		params: UpdateAgentParams,
	) => Effect.Effect<Agent, DatabaseError, DrizzleService>

	readonly updateAgentActivity: (
		agentId: number,
	) => Effect.Effect<void, DatabaseError, DrizzleService>

	readonly incrementAgentStats: (
		agentId: number,
		type: 'request' | 'swap',
	) => Effect.Effect<void, DatabaseError, DrizzleService>

	readonly rotateApiKey: (
		agentId: number,
	) => Effect.Effect<{ agent: Agent; apiKey: string }, DatabaseError, DrizzleService>

	readonly deactivateAgent: (agentId: number) => Effect.Effect<Agent, DatabaseError, DrizzleService>

	readonly reactivateAgent: (agentId: number) => Effect.Effect<Agent, DatabaseError, DrizzleService>

	readonly deleteAgent: (agentId: number) => Effect.Effect<void, DatabaseError, DrizzleService>

	readonly getAgentByApiKeyIncludingInactive: (
		apiKey: string,
	) => Effect.Effect<Option.Option<Agent>, DatabaseError, DrizzleService>
}

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
	const prefix = 'suwappu_sk_'
	const randomPart = crypto.randomBytes(32).toString('base64url')
	return `${prefix}${randomPart}`
}

/**
 * Hash an API key for storage
 */
function hashApiKey(apiKey: string): string {
	return crypto.createHash('sha256').update(apiKey).digest('hex')
}

export class AgentService extends Context.Tag('AgentService')<
	AgentService,
	AgentServiceInterface
>() {}

export const AgentServiceLive = Layer.succeed(AgentService, {
	registerAgent: (params: RegisterAgentParams) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Generate API key
			const apiKey = generateApiKey()
			const apiKeyHash = hashApiKey(apiKey)

			// Store only last 8 chars for display (like sk_...xxx)
			const apiKeyDisplay = `suwappu_sk_...${apiKey.slice(-8)}`

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.insert(agents)
						.values({
							name: params.name,
							description: params.description || null,
							apiKey: apiKeyDisplay,
							apiKeyHash,
							callbackUrl: params.callbackUrl || null,
							metadata: params.metadata || null,
						})
						.returning(),
				catch: (e) => {
					const errorMsg = String(e)
					if (errorMsg.includes('unique constraint') && errorMsg.includes('name')) {
						return new DatabaseError({ message: `Agent name "${params.name}" is already taken` })
					}
					return new DatabaseError({ message: `Failed to register agent: ${e}`, cause: e })
				},
			})

			// Return agent with full API key (only time it's shown)
			const agent = yield* requireRow(result, 'Failed to register agent: no row returned')

			// Audit the key issuance (agent id reused as userId — see audit.ts).
			yield* auditLog({
				userId: agent.id,
				eventType: 'agent.key_issued',
				details: { agentId: agent.id, name: agent.name },
			})

			// Grant starter credits so the agent's first metered call (quote/swap)
			// doesn't immediately 402. Best-effort: never fails registration.
			yield* Effect.tryPromise({
				try: () =>
					db
						.insert(agentCredits)
						.values({ agentId: agent.id, balance: STARTER_CREDITS })
						.onConflictDoNothing(),
				catch: (e) => new DatabaseError({ message: `Failed to grant starter credits: ${e}`, cause: e }),
			}).pipe(Effect.catchAll(() => Effect.succeed(undefined)))

			return { agent, apiKey }
		}),

	getAgentByApiKey: (apiKey: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const apiKeyHash = hashApiKey(apiKey)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(agents).where(eq(agents.apiKeyHash, apiKeyHash)),
				catch: (e) =>
					new DatabaseError({
						message: `Failed to get agent by API key: ${e}`,
						cause: e,
					}),
			})

			const agent = result[0]
			// Skip missing or inactive agents
			if (!agent || !agent.isActive) {
				return Option.none()
			}

			return Option.some(agent)
		}),

	getAgentByName: (name: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(agents).where(eq(agents.name, name)),
				catch: (e) =>
					new DatabaseError({
						message: `Failed to get agent by name: ${e}`,
						cause: e,
					}),
			})

			return Option.fromNullable(result[0])
		}),

	getAgentById: (id: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(agents).where(eq(agents.id, id)),
				catch: (e) => new DatabaseError({ message: `Failed to get agent: ${e}`, cause: e }),
			})

			return Option.fromNullable(result[0])
		}),

	updateAgent: (agentId: number, params: UpdateAgentParams) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const updates: Record<string, unknown> = { updatedAt: new Date() }
			if (params.description !== undefined) updates.description = params.description
			if (params.callbackUrl !== undefined) updates.callbackUrl = params.callbackUrl
			if (params.metadata !== undefined) updates.metadata = params.metadata

			const result = yield* Effect.tryPromise({
				try: () => db.update(agents).set(updates).where(eq(agents.id, agentId)).returning(),
				catch: (e) => new DatabaseError({ message: `Failed to update agent: ${e}`, cause: e }),
			})

			return yield* requireRow(result, 'Agent not found')
		}),

	updateAgentActivity: (agentId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			yield* Effect.tryPromise({
				try: () =>
					db
						.update(agents)
						.set({ lastActiveAt: new Date(), updatedAt: new Date() })
						.where(eq(agents.id, agentId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to update agent activity: ${e}`, cause: e }),
			})
		}),

	incrementAgentStats: (agentId: number, type: 'request' | 'swap') =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Atomic increment using SQL
			const updates: Record<string, unknown> = { updatedAt: new Date() }
			if (type === 'request') {
				updates.totalRequests = sql`COALESCE(${agents.totalRequests}, 0) + 1`
			} else if (type === 'swap') {
				updates.totalSwaps = sql`COALESCE(${agents.totalSwaps}, 0) + 1`
			}

			yield* Effect.tryPromise({
				try: () => db.update(agents).set(updates).where(eq(agents.id, agentId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to increment agent stats: ${e}`, cause: e }),
			})
		}),

	rotateApiKey: (agentId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const apiKey = generateApiKey()
			const apiKeyHash = hashApiKey(apiKey)
			const apiKeyDisplay = `suwappu_sk_...${apiKey.slice(-8)}`

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(agents)
						.set({ apiKey: apiKeyDisplay, apiKeyHash, updatedAt: new Date() })
						.where(eq(agents.id, agentId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to rotate API key: ${e}`, cause: e }),
			})

			const agent = yield* requireRow(result, 'Agent not found')
			return { agent, apiKey }
		}),

	deactivateAgent: (agentId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(agents)
						.set({ isActive: false, updatedAt: new Date() })
						.where(eq(agents.id, agentId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to deactivate agent: ${e}`, cause: e }),
			})

			return yield* requireRow(result, 'Agent not found')
		}),

	reactivateAgent: (agentId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const result = yield* Effect.tryPromise({
				try: () =>
					db
						.update(agents)
						.set({ isActive: true, updatedAt: new Date() })
						.where(eq(agents.id, agentId))
						.returning(),
				catch: (e) => new DatabaseError({ message: `Failed to reactivate agent: ${e}`, cause: e }),
			})

			return yield* requireRow(result, 'Agent not found')
		}),

	deleteAgent: (agentId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			// Delete webhook events first
			yield* Effect.tryPromise({
				try: () => db.delete(webhookEvents).where(eq(webhookEvents.agentId, agentId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to delete webhook events: ${e}`, cause: e }),
			})

			// Delete agent
			yield* Effect.tryPromise({
				try: () => db.delete(agents).where(eq(agents.id, agentId)),
				catch: (e) => new DatabaseError({ message: `Failed to delete agent: ${e}`, cause: e }),
			})
		}),

	getAgentByApiKeyIncludingInactive: (apiKey: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message })),
			)

			const apiKeyHash = hashApiKey(apiKey)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(agents).where(eq(agents.apiKeyHash, apiKeyHash)),
				catch: (e) =>
					new DatabaseError({
						message: `Failed to get agent by API key: ${e}`,
						cause: e,
					}),
			})

			return Option.fromNullable(result[0])
		}),
})

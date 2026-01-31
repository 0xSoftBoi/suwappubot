import { Context, Effect, Layer, Option } from 'effect'
import { eq } from 'drizzle-orm'
import { DrizzleService, requireDb, agents, type Agent } from '../db'
import { DatabaseError } from '../errors'
import crypto from 'crypto'

export interface RegisterAgentParams {
	name: string
	description?: string
	callbackUrl?: string
	metadata?: Record<string, unknown>
}

export interface AgentServiceInterface {
	readonly registerAgent: (
		params: RegisterAgentParams
	) => Effect.Effect<{ agent: Agent; apiKey: string }, DatabaseError, DrizzleService>
	
	readonly getAgentByApiKey: (
		apiKey: string
	) => Effect.Effect<Option.Option<Agent>, DatabaseError, DrizzleService>
	
	readonly getAgentByName: (
		name: string
	) => Effect.Effect<Option.Option<Agent>, DatabaseError, DrizzleService>
	
	readonly getAgentById: (
		id: number
	) => Effect.Effect<Option.Option<Agent>, DatabaseError, DrizzleService>
	
	readonly updateAgentActivity: (
		agentId: number
	) => Effect.Effect<void, DatabaseError, DrizzleService>
	
	readonly incrementAgentStats: (
		agentId: number,
		type: 'request' | 'swap'
	) => Effect.Effect<void, DatabaseError, DrizzleService>
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
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
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
			return { agent: result[0], apiKey }
		}),

	getAgentByApiKey: (apiKey: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
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

			if (result.length === 0) {
				return Option.none()
			}
			
			// Check if agent is active
			if (!result[0].isActive) {
				return Option.none()
			}

			return Option.some(result[0])
		}),

	getAgentByName: (name: string) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(agents).where(eq(agents.name, name)),
				catch: (e) =>
					new DatabaseError({
						message: `Failed to get agent by name: ${e}`,
						cause: e,
					}),
			})

			return result.length > 0 ? Option.some(result[0]) : Option.none()
		}),

	getAgentById: (id: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			const result = yield* Effect.tryPromise({
				try: () => db.select().from(agents).where(eq(agents.id, id)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to get agent: ${e}`, cause: e }),
			})

			return result.length > 0 ? Option.some(result[0]) : Option.none()
		}),

	updateAgentActivity: (agentId: number) =>
		Effect.gen(function* () {
			const db = yield* requireDb.pipe(
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
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
				Effect.mapError((e) => new DatabaseError({ message: e.message }))
			)

			// Note: In production, use SQL increment for atomicity
			// This is simplified for now
			const agent = yield* Effect.tryPromise({
				try: () => db.select().from(agents).where(eq(agents.id, agentId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to get agent stats: ${e}`, cause: e }),
			})

			if (agent.length === 0) return

			const updates: Record<string, unknown> = { updatedAt: new Date() }
			if (type === 'request') {
				updates.totalRequests = (agent[0].totalRequests || 0) + 1
			} else if (type === 'swap') {
				updates.totalSwaps = (agent[0].totalSwaps || 0) + 1
			}

			yield* Effect.tryPromise({
				try: () => db.update(agents).set(updates).where(eq(agents.id, agentId)),
				catch: (e) =>
					new DatabaseError({ message: `Failed to update agent stats: ${e}`, cause: e }),
			})
		}),
})

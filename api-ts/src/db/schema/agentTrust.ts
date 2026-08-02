import { integer, pgTable, real, serial, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { agents } from './agents'

/**
 * Per-agent trust record — api-ts analogue of the Python
 * `bot/models/aegis_trust.py` (`AegisUserTrust`), Phase 2.3 of
 * docs/plans/aegis-fork-extend.md, adapted for the agent-to-agent surface.
 *
 * RECORD-ONLY: nothing reads this table to gate or throttle anything yet.
 * `getTrust` is not called by any limiter/gate — enforcement is deferred to
 * a later phase after telemetry review (mirrors the Python posture exactly).
 * See services/AgentTrustService.ts for the read/write semantics; this
 * module only defines the row shape.
 *
 * Keyed on the numeric `agents.id` PK (this api-ts stack's agent identity),
 * NOT on (platform, user_id) like the Python table — the two are a SEPARATE
 * concern (bot end-user trust vs. registered-agent trust on the A2A/MCP
 * surface) and are intentionally NOT unified here. See the dual-ORM note in
 * AgentTrustService.ts for whether/how they might converge later.
 */
export const agentTrust = pgTable(
	'agent_trust',
	{
		id: serial('id').primaryKey(),
		agentId: integer('agent_id')
			.references(() => agents.id, { onDelete: 'cascade' })
			.notNull(),

		trustScore: real('trust_score').default(100).notNull(),
		threatCount: integer('threat_count').default(0).notNull(),
		cleanCount: integer('clean_count').default(0).notNull(),

		quarantinedUntil: timestamp('quarantined_until'),
		lastThreatAt: timestamp('last_threat_at'),
		lastSeenAt: timestamp('last_seen_at'),

		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => ({
		agentIdUniqueIdx: uniqueIndex('agent_trust_agent_id_unique_idx').on(table.agentId),
	}),
)

export type AgentTrust = typeof agentTrust.$inferSelect
export type NewAgentTrust = typeof agentTrust.$inferInsert

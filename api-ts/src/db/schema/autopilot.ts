/**
 * Autopilot — autonomous trading agent tables.
 *
 * The loop is `read → think → gate → seal → execute → journal → reveal`, and
 * every stage leaves a row behind so the whole run is reconstructable by an
 * outsider from public data (commitment hashes + on-chain txs) rather than
 * from our word for it.
 */
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	real,
	serial,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/pg-core'

export const autopilotModeEnum = pgEnum('autopilot_mode', ['paper', 'live'])

export const autopilotStatusEnum = pgEnum('autopilot_status', ['active', 'paused', 'stopped'])

export const autopilotCycleStatusEnum = pgEnum('autopilot_cycle_status', [
	'running',
	'completed',
	'failed',
])

export const autopilotActionEnum = pgEnum('autopilot_action', ['buy', 'sell', 'hold'])

export const autopilotDecisionStatusEnum = pgEnum('autopilot_decision_status', [
	'sealed', // commitment published, not yet executed
	'rejected', // failed a gate — never reached execution
	'executing',
	'filled',
	'failed',
	'revealed', // terminal: thesis + nonce are public
])

/** One autonomous agent: its mandate, capital, wallet and risk rules. */
export const autopilotAgents = pgTable(
	'autopilot_agents',
	{
		id: serial('id').primaryKey(),
		slug: varchar('slug', { length: 64 }).notNull().unique(),
		name: varchar('name', { length: 120 }).notNull(),
		description: text('description'),

		mode: autopilotModeEnum('mode').notNull().default('paper'),
		status: autopilotStatusEnum('status').notNull().default('paused'),

		/** Primary execution chain, e.g. 'base', 'solana', 'arbitrum'. */
		chain: varchar('chain', { length: 32 }).notNull(),
		/** Quote asset the agent holds between trades (usually USDC). */
		baseToken: varchar('base_token', { length: 64 }).notNull(),
		baseTokenSymbol: varchar('base_token_symbol', { length: 20 }).notNull().default('USDC'),

		/** Execution wallet. Public — the whole point is that anyone can audit it. */
		walletAddress: varchar('wallet_address', { length: 64 }),
		/** Suwappu agent whose API key the executor uses for managed swaps. */
		executorAgentId: integer('executor_agent_id'),

		startingEquityUsd: real('starting_equity_usd').notNull().default(0),
		/** Thesis engine id: 'rules' (deterministic) or 'llm'. */
		thesisEngine: varchar('thesis_engine', { length: 32 }).notNull().default('rules'),
		/** Risk rules — see AutopilotRules in AutopilotService. */
		rules: jsonb('rules').notNull().default({}),

		lastCycleAt: timestamp('last_cycle_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		statusIdx: index('autopilot_agents_status_idx').on(t.status),
	}),
)

/** One pass of the loop. */
export const autopilotCycles = pgTable(
	'autopilot_cycles',
	{
		id: serial('id').primaryKey(),
		agentId: integer('agent_id')
			.notNull()
			.references(() => autopilotAgents.id),
		status: autopilotCycleStatusEnum('status').notNull().default('running'),
		/** Last stage entered — tells you where a failed cycle died. */
		stage: varchar('stage', { length: 24 }).notNull().default('read'),

		candidatesScanned: integer('candidates_scanned').notNull().default(0),
		thesesFormed: integer('theses_formed').notNull().default(0),
		decisionsSealed: integer('decisions_sealed').notNull().default(0),
		decisionsExecuted: integer('decisions_executed').notNull().default(0),

		equityUsd: real('equity_usd'),
		error: text('error'),
		startedAt: timestamp('started_at').defaultNow().notNull(),
		finishedAt: timestamp('finished_at'),
	},
	(t) => ({
		agentIdx: index('autopilot_cycles_agent_idx').on(t.agentId, t.startedAt),
	}),
)

/**
 * A single decision. `commitment` is published at seal time; `thesis` + `nonce`
 * are only exposed once `revealedAt` is set, which is what makes the
 * commitment worth anything.
 */
export const autopilotDecisions = pgTable(
	'autopilot_decisions',
	{
		id: serial('id').primaryKey(),
		agentId: integer('agent_id')
			.notNull()
			.references(() => autopilotAgents.id),
		cycleId: integer('cycle_id').references(() => autopilotCycles.id),

		action: autopilotActionEnum('action').notNull(),
		chain: varchar('chain', { length: 32 }).notNull(),
		tokenAddress: varchar('token_address', { length: 64 }).notNull(),
		tokenSymbol: varchar('token_symbol', { length: 32 }).notNull(),
		sizeUsd: real('size_usd').notNull().default(0),
		confidence: real('confidence'),

		/** Human-readable one-liner, safe to show before reveal. */
		headline: text('headline'),
		/** Full thesis — NULL until revealed. */
		thesis: jsonb('thesis'),

		// --- seal ---
		sealAlgo: varchar('seal_algo', { length: 32 }).notNull(),
		commitment: varchar('commitment', { length: 64 }).notNull(),
		/** Blinding factor — withheld from the API until revealedAt is set. */
		nonce: varchar('nonce', { length: 64 }).notNull(),
		sealedAt: timestamp('sealed_at').defaultNow().notNull(),
		/** On-chain anchor of the commitment memo, when anchoring is enabled. */
		sealTxHash: varchar('seal_tx_hash', { length: 128 }),
		sealChain: varchar('seal_chain', { length: 32 }),

		// --- gate ---
		gatePassed: boolean('gate_passed').notNull().default(false),
		gates: jsonb('gates').notNull().default([]),
		rejectionReason: text('rejection_reason'),

		// --- execute / journal ---
		status: autopilotDecisionStatusEnum('status').notNull().default('sealed'),
		txHash: varchar('tx_hash', { length: 128 }),
		quoteId: varchar('quote_id', { length: 128 }),
		executedAt: timestamp('executed_at'),
		fillPriceUsd: real('fill_price_usd'),
		fillAmount: varchar('fill_amount', { length: 78 }),
		realizedSlippageBps: integer('realized_slippage_bps'),
		executionError: text('execution_error'),

		revealedAt: timestamp('revealed_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		agentIdx: index('autopilot_decisions_agent_idx').on(t.agentId, t.sealedAt),
		commitmentIdx: index('autopilot_decisions_commitment_idx').on(t.commitment),
		statusIdx: index('autopilot_decisions_status_idx').on(t.status),
	}),
)

/** Open/closed book, derived from filled decisions. */
export const autopilotPositions = pgTable(
	'autopilot_positions',
	{
		id: serial('id').primaryKey(),
		agentId: integer('agent_id')
			.notNull()
			.references(() => autopilotAgents.id),
		chain: varchar('chain', { length: 32 }).notNull(),
		tokenAddress: varchar('token_address', { length: 64 }).notNull(),
		tokenSymbol: varchar('token_symbol', { length: 32 }).notNull(),

		status: varchar('status', { length: 16 }).notNull().default('open'),
		amount: varchar('amount', { length: 78 }).notNull().default('0'),
		costBasisUsd: real('cost_basis_usd').notNull().default(0),
		avgEntryPriceUsd: real('avg_entry_price_usd'),
		lastPriceUsd: real('last_price_usd'),
		unrealizedPnlUsd: real('unrealized_pnl_usd'),
		realizedPnlUsd: real('realized_pnl_usd').notNull().default(0),

		/** Exit plan committed at entry — checked on every later cycle. */
		takeProfitPct: real('take_profit_pct'),
		stopLossPct: real('stop_loss_pct'),
		invalidation: text('invalidation'),

		entryDecisionId: integer('entry_decision_id'),
		exitDecisionId: integer('exit_decision_id'),
		openedAt: timestamp('opened_at').defaultNow().notNull(),
		closedAt: timestamp('closed_at'),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(t) => ({
		agentIdx: index('autopilot_positions_agent_idx').on(t.agentId, t.status),
	}),
)

/** Append-only narrative log — the "journal" stage. */
export const autopilotJournal = pgTable(
	'autopilot_journal',
	{
		id: serial('id').primaryKey(),
		agentId: integer('agent_id')
			.notNull()
			.references(() => autopilotAgents.id),
		cycleId: integer('cycle_id'),
		decisionId: integer('decision_id'),
		stage: varchar('stage', { length: 24 }).notNull(),
		level: varchar('level', { length: 16 }).notNull().default('info'),
		message: text('message').notNull(),
		data: jsonb('data'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(t) => ({
		agentIdx: index('autopilot_journal_agent_idx').on(t.agentId, t.createdAt),
	}),
)

export type AutopilotAgent = typeof autopilotAgents.$inferSelect
export type NewAutopilotAgent = typeof autopilotAgents.$inferInsert
export type AutopilotCycle = typeof autopilotCycles.$inferSelect
export type AutopilotDecision = typeof autopilotDecisions.$inferSelect
export type NewAutopilotDecision = typeof autopilotDecisions.$inferInsert
export type AutopilotPosition = typeof autopilotPositions.$inferSelect
export type AutopilotJournalEntry = typeof autopilotJournal.$inferSelect

/**
 * MONEY-PATH: ops-review visibility for money operations that are stuck. Never auto-resolves money: it only flags
 * (metadata.needsOpsReview = ISO timestamp; no DDL) and logs, and lets owners read their own flagged items.
 *  - transfers flagged reviewRequired, or pending/submitted longer than the threshold
 *  - earn ops / credit ops pending longer than the threshold
 */
import { sql } from 'drizzle-orm'
import { Effect } from 'effect'
import { logger } from '../../lib/logger'
import { bankDb, type BankOwner } from './db'
import { registerBankJob } from './jobs'

const STUCK_MINUTES = 60

export interface OpsAlert {
	kind: 'transfer' | 'earn_op' | 'credit_op'
	id: string
	status: string
	reason: string
	amountMinor: string
	ageMinutes: number
	createdAt: string
}

/** Flags stuck rows (idempotent) and logs them. Returns how many rows were newly flagged. */
export async function flagStuckOps(): Promise<number> {
	const { runEffect } = await import('../../runtime')
	return runEffect(
		bankDb(async (db) => {
			const th = sql.raw(`interval '${STUCK_MINUTES} minutes'`)
			const t = (await db.execute(sql`
				update bank_transfers set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('needsOpsReview', now()::text)
				where status in ('pending','submitted') and not (coalesce(metadata, '{}'::jsonb) ? 'needsOpsReview')
				  and ((coalesce(metadata, '{}'::jsonb) ? 'reviewRequired') or updated_at < now() - ${th})
				returning id, owner_type, owner_id, amount_minor`)) as unknown as Array<Record<string, string>>
			const e = (await db.execute(sql`
				update bank_earn_ops set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('needsOpsReview', now()::text)
				where status = 'pending' and not (coalesce(metadata, '{}'::jsonb) ? 'needsOpsReview') and updated_at < now() - ${th}
				returning id, owner_type, owner_id, assets_minor`)) as unknown as Array<Record<string, string>>
			for (const r of t) logger.warn({ transferId: r.id, owner: `${r.owner_type}:${r.owner_id}`, amountMinor: r.amount_minor }, '[bank] transfer needs ops review')
			for (const r of e) logger.warn({ earnOpId: r.id, owner: `${r.owner_type}:${r.owner_id}`, amountMinor: r.assets_minor }, '[bank] earn op needs ops review')
			return t.length + e.length
		}),
	)
}

registerBankJob('ops-alerts', 300, flagStuckOps)

/** The owner's own stuck items (live query, so it is accurate even before the job has run). */
export const listOpsAlerts = (owner: BankOwner) =>
	bankDb(async (db) => {
		const th = sql.raw(`interval '${STUCK_MINUTES} minutes'`)
		const rows = (await db.execute(sql`
			select 'transfer' as kind, id, status,
				case when coalesce(metadata, '{}'::jsonb) ? 'reviewRequired' then coalesce(metadata->>'reviewReason', 'review required') else 'in flight too long' end as reason,
				amount_minor::text as amount, created_at, updated_at
			from bank_transfers
			where owner_type = ${owner.ownerType} and owner_id = ${owner.ownerId} and status in ('pending','submitted')
			  and ((coalesce(metadata, '{}'::jsonb) ? 'reviewRequired') or updated_at < now() - ${th})
			union all
			select 'earn_op', id, status, 'pending too long', assets_minor::text, created_at, updated_at
			from bank_earn_ops
			where owner_type = ${owner.ownerType} and owner_id = ${owner.ownerId} and status = 'pending' and updated_at < now() - ${th}
			union all
			select 'credit_op', co.id, co.status, 'pending too long', (co.principal_minor + co.interest_minor)::text, co.created_at, co.updated_at
			from bank_credit_ops co join bank_credit_lines cl on cl.id = co.line_id
			where cl.owner_type = ${owner.ownerType} and cl.owner_id = ${owner.ownerId} and co.status = 'pending' and co.updated_at < now() - ${th}
			order by 7 asc limit 200`)) as unknown as Array<{ kind: OpsAlert['kind']; id: string; status: string; reason: string; amount: string; created_at: Date; updated_at: Date }>
		return rows.map(
			(r): OpsAlert => ({
				kind: r.kind,
				id: r.id,
				status: r.status,
				reason: r.reason,
				amountMinor: r.amount,
				ageMinutes: Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 60_000),
				createdAt: new Date(r.created_at).toISOString(),
			}),
		)
	})

export const opsAlertsEffect = (owner: BankOwner) => Effect.map(listOpsAlerts(owner), (alerts) => ({ alerts }))

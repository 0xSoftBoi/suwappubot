/**
 * BankOrgService — organisations, members, roles, invites, org-owned accounts,
 * audit log, corporate-card budgets.
 *
 * AUTHORISATION MODEL: every org-scoped operation goes through `authorize()`,
 * which derives the acting user from the authenticated owner (webapp user, or an
 * agent bound to its linked owner user), loads the membership row for the org id
 * taken from the URL / a DB row (never trusted from a body) and checks
 * `canActor(role, action, via)`. Non-members get NOT_FOUND (no existence leak).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../../config/EnvService'
import {
	type BankAccount,
	type BankOrg,
	type BankOrgRole,
	agents,
	bankOrgAudit,
	bankOrgCardBudgets,
	bankOrgCategories,
	bankOrgInvites,
	bankOrgMembers,
	bankOrgs,
	bankOrgWallets,
	type DrizzleService,
	users,
	wallets,
} from '../../db'
import { findAsset } from './assets'
import { BankLedgerService, verifyOrgCustodyWallet } from './BankLedgerService'
import { TurnkeyService } from '../TurnkeyService'
import {
	type OrgAction,
	type OrgRole,
	ORG_ROLES,
	PERMISSION_MATRIX,
	canActor,
	canGrantRole,
	canManageMember,
	openInvite,
	sha256Hex,
	signInvite,
} from './bankOrgPure'
import { bankDb } from './db'
import { type BankError, bankErr } from './errors'
import { type BankOwner } from './db'
import { randomUUID } from 'node:crypto'

export { can, canActor, PERMISSION_MATRIX, ORG_ROLES, ORG_ACTIONS, type OrgAction, type OrgRole } from './bankOrgPure'

export const orgId = (): string => `org_${randomUUID().replace(/-/g, '')}`
export const nid = (p: string): string => `${p}_${randomUUID().replace(/-/g, '')}`

type Deps = DrizzleService | EnvService
type Fx<A, R = DrizzleService> = Effect.Effect<A, BankError, R>

export interface Actor {
	userId: number
	via: 'user' | 'agent'
	agentId?: string
}
export interface OrgCtx {
	org: BankOrg
	actor: Actor
	role: OrgRole
}

export const DEFAULT_CATEGORIES: Array<{ code: string; name: string; kind: 'asset' | 'income' | 'expense' | 'transfer' }> = [
	{ code: '1000', name: 'Cash and stablecoin balances', kind: 'asset' },
	{ code: '1090', name: 'Transfers between own accounts', kind: 'transfer' },
	{ code: '4000', name: 'Revenue', kind: 'income' },
	{ code: '4900', name: 'Uncategorised income', kind: 'income' },
	{ code: '5000', name: 'Cost of goods sold', kind: 'expense' },
	{ code: '6000', name: 'Payroll and contractors', kind: 'expense' },
	{ code: '6100', name: 'Software and infrastructure', kind: 'expense' },
	{ code: '6200', name: 'Vendors and suppliers', kind: 'expense' },
	{ code: '6300', name: 'Bank and network fees', kind: 'expense' },
	{ code: '6400', name: 'Taxes', kind: 'expense' },
	{ code: '6900', name: 'Uncategorised expense', kind: 'expense' },
]

const one = <T>(rows: T[], what: string): T => {
	const r = rows[0]
	if (!r) throw bankErr('NOT_FOUND', `${what} not found`)
	return r
}

/** Secret for signed org tokens. Typed error naming the missing input. */
export const orgSecret: Effect.Effect<string, BankError, EnvService> = Effect.gen(function* () {
	const env = yield* EnvService
	if (!env.JWT_SECRET) return yield* Effect.fail(bankErr('NOT_CONFIGURED', 'Signing secret is not configured', { missing: 'JWT_SECRET' }))
	return env.JWT_SECRET
})

export const resolveActor = (owner: BankOwner): Fx<Actor> =>
	bankDb(async (db) => {
		if (owner.ownerType === 'user') {
			const id = Number(owner.ownerId)
			if (!Number.isInteger(id) || id <= 0) throw bankErr('VALIDATION', 'Invalid user id')
			return { userId: id, via: 'user' as const }
		}
		if (owner.ownerType === 'agent') {
			const aid = Number(owner.ownerId)
			const [a] = await db.select({ ownerUserId: agents.ownerUserId }).from(agents).where(eq(agents.id, aid)).limit(1)
			if (!a?.ownerUserId)
				throw bankErr('FORBIDDEN', 'Agent is not bound to a member: link the agent to its owner user first (POST /v1/agent/link/code)', { missing: 'agents.owner_user_id' })
			return { userId: a.ownerUserId, via: 'agent' as const, agentId: owner.ownerId }
		}
		throw bankErr('FORBIDDEN', 'Business endpoints require a user or member-bound agent')
	})

/** Membership + role check for an org id that did NOT come from a request body. */
export const authorize = (owner: BankOwner, orgIdValue: string, action: OrgAction): Fx<OrgCtx> =>
	Effect.gen(function* () {
		const actor = yield* resolveActor(owner)
		return yield* authorizeActor(actor, orgIdValue, action)
	})

export const authorizeActor = (actor: Actor, orgIdValue: string, action: OrgAction): Fx<OrgCtx> =>
	bankDb(async (db) => {
		const [m] = await db
			.select()
			.from(bankOrgMembers)
			.where(and(eq(bankOrgMembers.orgId, orgIdValue), eq(bankOrgMembers.userId, actor.userId)))
			.limit(1)
		if (!m) throw bankErr('NOT_FOUND', 'Organisation not found')
		if (!canActor(m.role, action, actor.via))
			throw bankErr('FORBIDDEN', `Role "${m.role}"${actor.via === 'agent' ? ' (via agent)' : ''} may not perform ${action}`)
		const [org] = await db.select().from(bankOrgs).where(eq(bankOrgs.id, orgIdValue)).limit(1)
		if (!org) throw bankErr('NOT_FOUND', 'Organisation not found')
		return { org, actor, role: m.role as OrgRole }
	})

export interface AuditInput {
	orgId: string
	actor: Actor | null
	action: string
	targetType?: string
	targetId?: string
	detail?: Record<string, unknown>
}
export const writeAudit = (a: AuditInput): Fx<void> =>
	bankDb(async (db) => {
		await db.insert(bankOrgAudit).values({
			id: nid('aud'),
			orgId: a.orgId,
			actorUserId: a.actor?.userId ?? null,
			actorKind: a.actor ? a.actor.via : 'system',
			actorAgentId: a.actor?.agentId ?? null,
			action: a.action,
			targetType: a.targetType ?? null,
			targetId: a.targetId ?? null,
			detail: a.detail ?? {},
		})
	})

const CURRENCY_RE = /^[A-Z]{3}$/

export interface CardBudget {
	orgId: string
	memberId: number
	currency: string
	source: 'member' | 'team' | 'none'
	/** Reporting-currency minor units; null = no cap configured. */
	monthlyCapMinor: string | null
	perTxCapMinor: string | null
	categoryBudgets: Record<string, string>
}

/**
 * MONEY-PATH. Returns the org's dedicated custody wallet for a chain family, provisioning it on first use via
 * the same path as agent wallets: Turnkey sub-org (TurnkeyService.createOrgWallet) mirrored into Python's
 * users/wallets through /internal/agent/provision-wallet (synthetic non-person user keyed on a stable org uuid).
 * Fails with NOT_CONFIGURED naming the missing input; never falls back to a member's wallet.
 */
export const ensureOrgCustodyWallet = (org: string, family: 'evm' | 'solana') =>
	Effect.gen(function* () {
		const existing = yield* bankDb((db) =>
			db.select({ id: bankOrgWallets.walletId }).from(bankOrgWallets).where(and(eq(bankOrgWallets.orgId, org), eq(bankOrgWallets.family, family))).limit(1),
		)
		const verify = bankDb((db) => verifyOrgCustodyWallet(db, org, family))
		if (existing[0]) return yield* verify
		const env = yield* EnvService
		const missing = [
			!env.TURNKEY_API_PUBLIC_KEY && 'TURNKEY_API_PUBLIC_KEY',
			!env.TURNKEY_API_PRIVATE_KEY && 'TURNKEY_API_PRIVATE_KEY',
			!env.TURNKEY_ORGANIZATION_ID && 'TURNKEY_ORGANIZATION_ID',
			!env.INTERNAL_API_KEY && 'INTERNAL_API_KEY',
			!env.INTERNAL_API_URL && 'INTERNAL_API_URL',
		].filter(Boolean) as string[]
		if (missing.length)
			return yield* Effect.fail(bankErr('NOT_CONFIGURED', `Org custody wallet provisioning is not configured: ${missing.join(', ')}`, { missing: missing.join(',') }))
		const turnkey = yield* TurnkeyService
		const tk = yield* turnkey.createOrgWallet(org, family).pipe(Effect.mapError((e) => bankErr('WALLET_UNAVAILABLE', `Org wallet creation failed: ${e.message}`)))
		const prov = yield* Effect.tryPromise({
			try: async () => {
				const res = await fetch(`${env.INTERNAL_API_URL}/internal/agent/provision-wallet`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Internal-Key': env.INTERNAL_API_KEY! },
					body: JSON.stringify({ agent_uuid: `bankorg:${org}`, chain_type: family, turnkey_wallet_id: tk.walletId, turnkey_sub_org_id: tk.subOrgId, address: tk.address }),
					signal: AbortSignal.timeout(15_000),
				})
				if (!res.ok) throw new Error(`provision-wallet HTTP ${res.status}`)
				return (await res.json()) as { internal_user_id: number; internal_wallet_id: number }
			},
			catch: (e) => bankErr('WALLET_UNAVAILABLE', `Org wallet mirror into signer failed: ${String(e)}`),
		})
		yield* bankDb(async (db) => {
			await db
				.insert(bankOrgWallets)
				.values({ orgId: org, family, walletId: prov.internal_wallet_id, walletUserId: prov.internal_user_id, address: tk.address, turnkeySubOrgId: tk.subOrgId, turnkeyWalletId: tk.walletId })
				.onConflictDoNothing()
		})
		// Re-read: a concurrent provisioner may have won; its row is authoritative (ours stays unfunded).
		return yield* verify
	})

const impl = {
	createOrg: (i: { owner: BankOwner; name: string; reportingCurrency: string }): Fx<{ org: BankOrg }> =>
		Effect.gen(function* () {
			const actor = yield* resolveActor(i.owner)
			if (actor.via !== 'user') return yield* Effect.fail(bankErr('FORBIDDEN', 'Organisations can only be created by a user session'))
			const cur = i.reportingCurrency.toUpperCase()
			if (!CURRENCY_RE.test(cur)) return yield* Effect.fail(bankErr('VALIDATION', 'reportingCurrency must be an ISO 4217 code'))
			const id = orgId()
			const org = yield* bankDb(async (db) =>
				db.transaction(async (tx) => {
					const [o] = await tx
						.insert(bankOrgs)
						.values({ id, name: i.name.trim(), reportingCurrency: cur, ownerUserId: actor.userId, custodyUserId: actor.userId })
						.returning()
					await tx.insert(bankOrgMembers).values({ id: nid('mem'), orgId: id, userId: actor.userId, role: 'owner' })
					await tx.insert(bankOrgCategories).values(DEFAULT_CATEGORIES.map((c) => ({ id: nid('cat'), orgId: id, ...c })))
					return o!
				}),
			)
			yield* writeAudit({ orgId: id, actor, action: 'org.create', targetType: 'org', targetId: id, detail: { name: org.name, reportingCurrency: cur } })
			return { org }
		}),

	listOrgs: (owner: BankOwner): Fx<{ orgs: Array<BankOrg & { role: BankOrgRole }> }> =>
		Effect.gen(function* () {
			const actor = yield* resolveActor(owner)
			const rows = yield* bankDb((db) =>
				db
					.select({ org: bankOrgs, role: bankOrgMembers.role })
					.from(bankOrgMembers)
					.innerJoin(bankOrgs, eq(bankOrgs.id, bankOrgMembers.orgId))
					.where(eq(bankOrgMembers.userId, actor.userId)),
			)
			return { orgs: rows.map((r) => ({ ...r.org, role: r.role })) }
		}),

	getOrg: (owner: BankOwner, id: string): Fx<{ org: BankOrg; role: OrgRole; permissions: string[] }> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, id, 'org.view')
			const perms = [...PERMISSION_MATRIX[c.role]].filter((a) => canActor(c.role, a, c.actor.via))
			return { org: c.org, role: c.role, permissions: perms }
		}),

	updateOrg: (owner: BankOwner, id: string, patch: { name?: string | undefined; reportingCurrency?: string | undefined }): Fx<{ org: BankOrg }> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, id, 'org.manage')
			const set: Partial<typeof bankOrgs.$inferInsert> = { updatedAt: new Date() }
			if (patch.name) set.name = patch.name.trim()
			if (patch.reportingCurrency) {
				const cur = patch.reportingCurrency.toUpperCase()
				if (!CURRENCY_RE.test(cur)) return yield* Effect.fail(bankErr('VALIDATION', 'reportingCurrency must be an ISO 4217 code'))
				// Books are single-denomination: re-denominating after entries exist would mix rates.
				if (cur !== c.org.reportingCurrency) {
					const n = yield* bankDb(async (db) => {
						const r = await db.execute(sql`select count(*)::int as n from bank_org_books where org_id = ${id}`)
						return (r as unknown as Array<{ n: number }>)[0]?.n ?? 0
					})
					if (n > 0) return yield* Effect.fail(bankErr('CONFLICT', 'reportingCurrency cannot change once books entries exist'))
				}
				set.reportingCurrency = cur
			}
			const org = yield* bankDb(async (db) => one(await db.update(bankOrgs).set(set).where(eq(bankOrgs.id, id)).returning(), 'Organisation'))
			yield* writeAudit({ orgId: id, actor: c.actor, action: 'org.update', targetType: 'org', targetId: id, detail: patch as Record<string, unknown> })
			return { org }
		}),

	listMembers: (owner: BankOwner, id: string) =>
		Effect.gen(function* () {
			yield* authorize(owner, id, 'members.view')
			const members = yield* bankDb((db) => db.select().from(bankOrgMembers).where(eq(bankOrgMembers.orgId, id)))
			return { members }
		}),

	updateMember: (owner: BankOwner, id: string, userId: number, patch: { role?: OrgRole | undefined; team?: string | null | undefined }) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, id, 'members.manage')
			if (userId === c.actor.userId) return yield* Effect.fail(bankErr('FORBIDDEN', 'You cannot change your own role or team'))
			const target = yield* bankDb(async (db) =>
				one(await db.select().from(bankOrgMembers).where(and(eq(bankOrgMembers.orgId, id), eq(bankOrgMembers.userId, userId))).limit(1), 'Member'),
			)
			if (!canManageMember(c.role, target.role as OrgRole)) return yield* Effect.fail(bankErr('FORBIDDEN', `Role "${c.role}" cannot manage a "${target.role}"`))
			if (patch.role && !canGrantRole(c.role, patch.role)) return yield* Effect.fail(bankErr('FORBIDDEN', `Role "${c.role}" cannot grant "${patch.role}"`))
			const set: Partial<typeof bankOrgMembers.$inferInsert> = {}
			if (patch.role) set.role = patch.role
			if (patch.team !== undefined) set.team = patch.team
			if (Object.keys(set).length === 0) return yield* Effect.fail(bankErr('VALIDATION', 'Nothing to update'))
			const member = yield* bankDb(async (db) =>
				one(await db.update(bankOrgMembers).set(set).where(and(eq(bankOrgMembers.orgId, id), eq(bankOrgMembers.userId, userId))).returning(), 'Member'),
			)
			yield* writeAudit({ orgId: id, actor: c.actor, action: 'member.update', targetType: 'member', targetId: String(userId), detail: { from: target.role, ...patch } })
			return { member }
		}),

	removeMember: (owner: BankOwner, id: string, userId: number) =>
		Effect.gen(function* () {
			const actor = yield* resolveActor(owner)
			// Self-leave is allowed for non-owners; otherwise members.manage + hierarchy.
			const self = userId === actor.userId
			const c = yield* authorizeActor(actor, id, self ? 'org.view' : 'members.manage')
			if (self && actor.via === 'agent') return yield* Effect.fail(bankErr('FORBIDDEN', 'Agents cannot remove their owner from an organisation'))
			const target = yield* bankDb(async (db) =>
				one(await db.select().from(bankOrgMembers).where(and(eq(bankOrgMembers.orgId, id), eq(bankOrgMembers.userId, userId))).limit(1), 'Member'),
			)
			if (target.role === 'owner') return yield* Effect.fail(bankErr('FORBIDDEN', 'The owner cannot be removed'))
			if (!self && !canManageMember(c.role, target.role as OrgRole)) return yield* Effect.fail(bankErr('FORBIDDEN', `Role "${c.role}" cannot remove a "${target.role}"`))
			yield* bankDb((db) => db.delete(bankOrgMembers).where(and(eq(bankOrgMembers.orgId, id), eq(bankOrgMembers.userId, userId))))
			yield* writeAudit({ orgId: id, actor: c.actor, action: 'member.remove', targetType: 'member', targetId: String(userId), detail: { role: target.role } })
			return { removed: true }
		}),

	createInvite: (owner: BankOwner, id: string, i: { role: OrgRole; team?: string | undefined; email?: string | undefined; telegramId?: number | undefined; ttlHours: number }) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, id, 'members.invite')
			// MONEY-PATH: invites are bound to the invitee identity (telegram id or email) recorded here; stored in the email column as 'tg:<id>' or the lowercased email.
			const invitee = i.telegramId !== undefined ? `tg:${i.telegramId}` : i.email ? i.email.trim().toLowerCase() : null
			if (!invitee) return yield* Effect.fail(bankErr('VALIDATION', 'An invite must name the invitee (email or telegramId)'))
			if (!canGrantRole(c.role, i.role)) return yield* Effect.fail(bankErr('FORBIDDEN', `Role "${c.role}" cannot invite as "${i.role}"`))
			const secret = yield* orgSecret
			const inv = nid('inv')
			const exp = Date.now() + Math.min(Math.max(i.ttlHours, 1), 168) * 3_600_000
			const token = signInvite(secret, { inv, org: id, role: i.role, exp })
			yield* bankDb((db) =>
				db.insert(bankOrgInvites).values({
					id: inv,
					orgId: id,
					role: i.role,
					team: i.team ?? null,
					email: invitee,
					tokenHash: sha256Hex(token),
					expiresAt: new Date(exp),
					createdBy: c.actor.userId,
				}),
			)
			yield* writeAudit({ orgId: id, actor: c.actor, action: 'invite.create', targetType: 'invite', targetId: inv, detail: { role: i.role, email: i.email ?? null } })
			// The token is shown exactly once; only its hash is stored.
			return { invite: { id: inv, orgId: id, role: i.role, expiresAt: new Date(exp).toISOString() }, token }
		}),

	revokeInvite: (owner: BankOwner, id: string, inviteId: string) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, id, 'members.invite')
			const r = yield* bankDb((db) =>
				db
					.update(bankOrgInvites)
					.set({ revokedAt: new Date() })
					.where(and(eq(bankOrgInvites.id, inviteId), eq(bankOrgInvites.orgId, id), sql`accepted_at is null`, sql`revoked_at is null`))
					.returning({ id: bankOrgInvites.id }),
			)
			if (r.length === 0) return yield* Effect.fail(bankErr('NOT_FOUND', 'Open invite not found'))
			yield* writeAudit({ orgId: id, actor: c.actor, action: 'invite.revoke', targetType: 'invite', targetId: inviteId })
			return { revoked: true }
		}),

	acceptInvite: (owner: BankOwner, token: string) =>
		Effect.gen(function* () {
			const actor = yield* resolveActor(owner)
			if (actor.via !== 'user') return yield* Effect.fail(bankErr('FORBIDDEN', 'Invites must be accepted by the invited user'))
			const secret = yield* orgSecret
			const t = openInvite(secret, token)
			if (!t.ok) return yield* Effect.fail(bankErr('FORBIDDEN', `Invite token ${t.reason.replace('_', ' ')}`))
			const { inv, org, role } = t.claims
			const ident = yield* bankDb(async (db) => {
				const [row] = await db.select({ email: bankOrgInvites.email }).from(bankOrgInvites).where(eq(bankOrgInvites.id, inv)).limit(1)
				const [u] = await db.select({ telegramId: users.telegramId, recoveryEmail: users.recoveryEmail }).from(users).where(eq(users.id, actor.userId)).limit(1)
				const bound = row?.email ?? null
				if (!bound || !u) return false
				return bound.startsWith('tg:') ? u.telegramId !== null && `tg:${u.telegramId}` === bound : !!u.recoveryEmail && u.recoveryEmail.toLowerCase() === bound.toLowerCase()
			})
			if (!ident) return yield* Effect.fail(bankErr('FORBIDDEN', 'This invite was issued to a different invitee'))
			const member = yield* bankDb(async (db) =>
				db.transaction(async (tx) => {
					const [row] = await tx.select().from(bankOrgInvites).where(eq(bankOrgInvites.id, inv)).limit(1)
					if (!row || row.orgId !== org || row.role !== role || row.tokenHash !== sha256Hex(token)) throw bankErr('FORBIDDEN', 'Invite token does not match an invite')
					if (row.expiresAt.getTime() <= Date.now()) throw bankErr('FORBIDDEN', 'Invite expired')
					const claimed = await tx
						.update(bankOrgInvites)
						.set({ acceptedBy: actor.userId, acceptedAt: new Date() })
						.where(and(eq(bankOrgInvites.id, inv), sql`accepted_at is null`, sql`revoked_at is null`))
						.returning({ id: bankOrgInvites.id })
					if (claimed.length === 0) throw bankErr('CONFLICT', 'Invite already used or revoked')
					const dup = await tx.select({ id: bankOrgMembers.id }).from(bankOrgMembers).where(and(eq(bankOrgMembers.orgId, org), eq(bankOrgMembers.userId, actor.userId))).limit(1)
					if (dup.length) throw bankErr('CONFLICT', 'Already a member of this organisation')
					const [m] = await tx
						.insert(bankOrgMembers)
						.values({ id: nid('mem'), orgId: org, userId: actor.userId, role: row.role, team: row.team, invitedBy: row.createdBy })
						.returning()
					return m!
				}),
			)
			yield* writeAudit({ orgId: org, actor, action: 'invite.accept', targetType: 'invite', targetId: inv, detail: { role } })
			return { member }
		}),

	/** Org-owned account on the org's OWN dedicated custody wallet (provisioned on first use; never a member's wallet). */
	openAccount: (
		owner: BankOwner,
		id: string,
		i: { kind: 'checking' | 'savings' | 'treasury'; asset: string; chain: string; label?: string | undefined },
	): Effect.Effect<{ account: BankAccount }, BankError, DrizzleService | BankLedgerService | TurnkeyService | EnvService> =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, id, 'accounts.open')
			const asset = findAsset(i.asset, i.chain)
			if (!asset) return yield* Effect.fail(bankErr('ASSET_UNSUPPORTED', `Unsupported asset ${i.asset} on ${i.chain}`))
			const ledger = yield* BankLedgerService
			const wallet = yield* ensureOrgCustodyWallet(id, asset.family)
			const account = yield* ledger.openAccount({
				owner: { ownerType: 'org', ownerId: id },
				kind: i.kind,
				asset: i.asset,
				chain: i.chain,
				label: i.label,
				wallet,
				metadata: { orgId: id, openedBy: c.actor.userId },
			})
			yield* writeAudit({ orgId: id, actor: c.actor, action: 'account.open', targetType: 'account', targetId: account.id, detail: { asset: i.asset, chain: i.chain, kind: i.kind } })
			return { account }
		}),

	listAccounts: (owner: BankOwner, id: string): Effect.Effect<{ accounts: BankAccount[] }, BankError, DrizzleService | BankLedgerService> =>
		Effect.gen(function* () {
			yield* authorize(owner, id, 'accounts.view')
			const ledger = yield* BankLedgerService
			return { accounts: yield* ledger.getAccounts({ ownerType: 'org', ownerId: id }) }
		}),

	listAudit: (owner: BankOwner, id: string, limit: number) =>
		Effect.gen(function* () {
			yield* authorize(owner, id, 'audit.view')
			const rows = yield* bankDb((db) =>
				db.select().from(bankOrgAudit).where(eq(bankOrgAudit.orgId, id)).orderBy(desc(bankOrgAudit.createdAt)).limit(Math.min(Math.max(limit, 1), 500)),
			)
			return { audit: rows }
		}),

	// ─── Corporate card budgets ─────────────────────────────────────────────
	setCardBudget: (
		owner: BankOwner,
		id: string,
		i: { scope: 'member' | 'team'; scopeId: string; monthlyCapMinor?: string | null | undefined; perTxCapMinor?: string | null | undefined; categoryBudgets?: Record<string, string> | undefined },
	) =>
		Effect.gen(function* () {
			const c = yield* authorize(owner, id, 'cards.budget.manage')
			if (i.scope === 'member') {
				const uid = Number(i.scopeId)
				const m = yield* bankDb((db) => db.select({ id: bankOrgMembers.id }).from(bankOrgMembers).where(and(eq(bankOrgMembers.orgId, id), eq(bankOrgMembers.userId, Number.isInteger(uid) ? uid : -1))).limit(1))
				if (!m.length) return yield* Effect.fail(bankErr('NOT_FOUND', 'Member not found in this organisation'))
			}
			const vals = {
				monthlyCapMinor: i.monthlyCapMinor ?? null,
				perTxCapMinor: i.perTxCapMinor ?? null,
				categoryBudgets: i.categoryBudgets ?? {},
				updatedBy: c.actor.userId,
				updatedAt: new Date(),
			}
			const row = yield* bankDb(async (db) =>
				one(
					await db
						.insert(bankOrgCardBudgets)
						.values({ id: nid('cbg'), orgId: id, scope: i.scope, scopeId: i.scopeId, ...vals })
						.onConflictDoUpdate({ target: [bankOrgCardBudgets.orgId, bankOrgCardBudgets.scope, bankOrgCardBudgets.scopeId], set: vals })
						.returning(),
					'Budget',
				),
			)
			yield* writeAudit({ orgId: id, actor: c.actor, action: 'card_budget.set', targetType: i.scope, targetId: i.scopeId, detail: { ...vals, updatedAt: undefined } })
			return { budget: row }
		}),

	listCardBudgets: (owner: BankOwner, id: string) =>
		Effect.gen(function* () {
			yield* authorize(owner, id, 'cards.budget.view')
			return { budgets: yield* bankDb((db) => db.select().from(bankOrgCardBudgets).where(eq(bankOrgCardBudgets.orgId, id))) }
		}),

	/** Hook for the cards module: member budget, else the member's team budget, else `source: 'none'`. */
	getCardBudget: (orgIdValue: string, memberId: number): Fx<CardBudget> =>
		bankDb(async (db) => {
			const [org] = await db.select().from(bankOrgs).where(eq(bankOrgs.id, orgIdValue)).limit(1)
			if (!org) throw bankErr('NOT_FOUND', 'Organisation not found')
			const [m] = await db
				.select()
				.from(bankOrgMembers)
				.where(and(eq(bankOrgMembers.orgId, orgIdValue), eq(bankOrgMembers.userId, memberId)))
				.limit(1)
			if (!m) throw bankErr('NOT_FOUND', 'Member not found in this organisation')
			const rows = await db.select().from(bankOrgCardBudgets).where(eq(bankOrgCardBudgets.orgId, orgIdValue))
			const mine = rows.find((r) => r.scope === 'member' && r.scopeId === String(memberId))
			const team = m.team ? rows.find((r) => r.scope === 'team' && r.scopeId === m.team) : undefined
			const b = mine ?? team
			return {
				orgId: orgIdValue,
				memberId,
				currency: org.reportingCurrency,
				source: mine ? ('member' as const) : team ? ('team' as const) : ('none' as const),
				monthlyCapMinor: b?.monthlyCapMinor ?? null,
				perTxCapMinor: b?.perTxCapMinor ?? null,
				categoryBudgets: b?.categoryBudgets ?? {},
			}
		}),
}

export class BankOrgService extends Context.Tag('BankOrgService')<BankOrgService, typeof impl>() {}
export const BankOrgServiceLive = Layer.succeed(BankOrgService, impl)

/** Standalone export for the cards module: `getCardBudget(orgId, memberId)`. */
export const getCardBudget = impl.getCardBudget
export type { Deps as BankOrgDeps }

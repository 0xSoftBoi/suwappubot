import { index, integer, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Multi-tenant root for the Enterprise control plane.
 *
 * An organization groups users (with RBAC roles via org_members) and is the
 * scoping anchor for everything that follows: Enterprise desks/sub-accounts,
 * agent orgs, scoped API keys, and the policy layer. Additive — existing
 * single-user resources are unaffected until explicitly scoped to an org.
 */
export const organizations = pgTable('organizations', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	// URL/handle-safe unique identifier for the org.
	slug: varchar('slug', { length: 255 }).notNull().unique(),
	ownerId: integer('owner_id')
		.notNull()
		.references(() => users.id),
	// Org-level plan, mirrors the per-user subscription tiers
	// (free/pro/premium/enterprise).
	plan: varchar('plan', { length: 20 }).default('free'),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
})

/**
 * Org membership + RBAC role. One row per (org, user).
 * Role hierarchy (highest → lowest): owner > admin > member > viewer.
 */
export const orgMembers = pgTable(
	'org_members',
	{
		id: serial('id').primaryKey(),
		orgId: integer('org_id')
			.notNull()
			.references(() => organizations.id),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id),
		role: varchar('role', { length: 20 }).notNull().default('member'),
		createdAt: timestamp('created_at').defaultNow(),
	},
	(table) => ({
		uniqOrgUser: unique('uq_org_members_org_user').on(table.orgId, table.userId),
		orgIdx: index('ix_org_members_org_id').on(table.orgId),
		userIdx: index('ix_org_members_user_id').on(table.userId),
	}),
)

export type Organization = typeof organizations.$inferSelect
export type NewOrganization = typeof organizations.$inferInsert
export type OrgMember = typeof orgMembers.$inferSelect
export type NewOrgMember = typeof orgMembers.$inferInsert

// RBAC role hierarchy — used by org-scoped authorization checks (and, later,
// the shared policy layer). Rank lets callers do `>=` comparisons like the
// tier gating in requireTier.
export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type OrgRole = (typeof ORG_ROLES)[number]
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
	viewer: 0,
	member: 1,
	admin: 2,
	owner: 3,
}

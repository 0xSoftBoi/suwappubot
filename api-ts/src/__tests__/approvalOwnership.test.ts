import { describe, expect, it } from 'bun:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { approvalOwnershipCondition } from '../services/ApprovalService'

// Ownership predicate used by ApprovalService.decide/decideApproveWithStepUp/
// issueStepUpChallenge/listForOwner: a caller may act on an approval_requests
// row iff they own the org it belongs to (organizations.owner_id = userId)
// OR the row's own user_id equals the caller directly. This is what decides
// who may authorize an agent's spend (org-less agents included), so the
// generated SQL shape is asserted directly rather than trusted by inspection.
describe('approvalOwnershipCondition', () => {
	const dialect = new PgDialect()

	it('builds an OR of org-owner match and direct user_id match, parameterized by the caller id', () => {
		const condition = approvalOwnershipCondition(42)
		const query = dialect.sqlToQuery(condition!)

		// Both branches of the OR must reference the SAME caller id — this is
		// what lets an org-less agent's linked owner (approval_requests.user_id)
		// decide/list its own approvals, while an org owner keeps working via
		// organizations.owner_id, without widening to arbitrary org members.
		expect(query.sql).toContain('or')
		expect(query.sql).toMatch(/owner_id/)
		expect(query.sql).toMatch(/user_id/)
		expect(query.params).toEqual([42, 42])
	})

	it('produces a distinct parameter set per caller (no cross-user leakage in the compiled query)', () => {
		const a = dialect.sqlToQuery(approvalOwnershipCondition(1)!)
		const b = dialect.sqlToQuery(approvalOwnershipCondition(2)!)
		expect(a.params).toEqual([1, 1])
		expect(b.params).toEqual([2, 2])
		expect(a.sql).toBe(b.sql)
	})
})

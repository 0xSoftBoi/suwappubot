/**
 * Pure validation for a step-up challenge row presented at approve-decision
 * time. Kept side-effect-free (no DB, no clock reads beyond the passed-in
 * `now`) so it can be unit-tested without a database or transaction — the
 * route/service layer is responsible for loading the row, calling this, and
 * (only on success) marking it consumed inside the same db.transaction as
 * the approval decision UPDATE.
 */

export interface StepUpChallengeRow {
	userId: number
	approvalId: string
	usedAt: Date | null
	expiresAt: Date
}

export interface StepUpValidationContext {
	userId: number
	approvalId: string
	now: Date
}

export type StepUpValidationResult = { valid: true } | { valid: false; reason: string }

export function validateStepUpChallenge(
	row: StepUpChallengeRow | null | undefined,
	ctx: StepUpValidationContext,
): StepUpValidationResult {
	if (!row) {
		return { valid: false, reason: 'Step-up challenge not found' }
	}
	if (row.userId !== ctx.userId) {
		return { valid: false, reason: 'Step-up challenge does not belong to this user' }
	}
	if (row.approvalId !== ctx.approvalId) {
		return { valid: false, reason: 'Step-up challenge is bound to a different approval request' }
	}
	if (row.usedAt !== null) {
		return { valid: false, reason: 'Step-up challenge has already been used' }
	}
	if (row.expiresAt.getTime() <= ctx.now.getTime()) {
		return { valid: false, reason: 'Step-up challenge has expired' }
	}
	return { valid: true }
}

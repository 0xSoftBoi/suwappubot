/**
 * Adapter: a fresh World ID verification satisfies Suwappu's step-up
 * requirement the same way the existing TOTP challenge does.
 *
 * Integration point (api-ts):
 *   api-ts/src/services/ApprovalService.ts → decideApproveWithStepUp
 *   accepts (id, userId, stepUpChallenge). Add a parallel path:
 *   decideApproveWithWorldId(id, userId, worldIdApproval) that runs
 *   validateWorldIdStepUp below, then the SAME decision UPDATE inside the
 *   SAME db.transaction as the approval row. The TTL, ownership binding, and
 *   STEP_UP_REQUIRED surfacing stay untouched.
 *
 * A WorldIdApproval is created by the guardian gate (guardianGate.ts) when a
 * human completes verification for a trade intent. It is single-use: once
 * consumed for an approval decision it can never authorize another.
 */

export interface WorldIdApproval {
	/** Nullifier returned by the verifier — the human's identity for this action. */
	nullifier: string
	/** Signal the proof was bound to — must equal hashIntent(tradeIntent). */
	signal: string
	/** hashIntent() of the trade this approval authorizes. */
	expectedSignal: string
	verifiedAt: Date
	consumedAt: Date | null
	userId: number
	approvalId: string
}

export type StepUpResult = { valid: true } | { valid: false; reason: string }

/**
 * Pure validation, mirroring api-ts/src/lib/stepUpChallenge.ts conventions:
 * no DB, no clock reads beyond `now` — the caller loads the record and marks
 * it consumed inside the approval transaction on success.
 */
export function validateWorldIdStepUp(
	approval: WorldIdApproval | null | undefined,
	ctx: { userId: number; approvalId: string; now: Date; ttlMs: number },
): StepUpResult {
	if (!approval) {
		return { valid: false, reason: 'World ID approval not found' }
	}
	if (approval.userId !== ctx.userId) {
		return { valid: false, reason: 'World ID approval does not belong to this user' }
	}
	if (approval.approvalId !== ctx.approvalId) {
		return { valid: false, reason: 'World ID approval is bound to a different approval request' }
	}
	if (approval.consumedAt !== null) {
		return { valid: false, reason: 'World ID approval has already been used' }
	}
	if (approval.verifiedAt.getTime() + ctx.ttlMs <= ctx.now.getTime()) {
		return { valid: false, reason: 'World ID approval has expired — verify again' }
	}
	if (approval.signal !== approval.expectedSignal) {
		return { valid: false, reason: 'World ID proof is not bound to this trade intent' }
	}
	return { valid: true }
}

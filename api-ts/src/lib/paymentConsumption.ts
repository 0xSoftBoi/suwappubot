/**
 * Shared x402 / on-chain payment redemption guards (SECURITY: payment replay,
 * sender-spoof, cross-table double-redeem).
 *
 * Two orthogonal defenses used by EVERY redemption path (agent topup, agent
 * subscribe, webapp crypto subscribe, mppAuth/internal 402 swap verify):
 *
 *   1. consumePayment(): a SINGLE global consumed-payments ledger keyed by
 *      (chain, txHash). Atomically consume the payment inside the same DB
 *      transaction that credits, BEFORE crediting. Replaces reliance on three
 *      independent per-table unique(tx_hash) guards (which allowed one payment
 *      to be redeemed once per table) and gives the previously-stateless 402
 *      swap verifier real replay protection.
 *
 *   2. assertSenderBound(): the on-chain payer (tx sender / from address, now
 *      returned by the Python verifier) MUST be a wallet bound to the
 *      authenticated caller. Stops an attacker crediting themselves with another
 *      user's inbound payment txHash (sender-spoof).
 */

import { consumedPayments } from '../db/schema'

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/** Canonical (chain, txHash) key — lowercased, trimmed. */
export function paymentKey(chain: string, txHash: string): string {
	return `${chain.trim().toLowerCase()}:${txHash.trim().toLowerCase()}`
}

/**
 * Atomically consume (chain, txHash) in the shared ledger inside an EXISTING
 * transaction (`tx`). INSERT ... ON CONFLICT DO NOTHING on the (chain, txHash)
 * unique constraint.
 *
 * Returns true  → this caller won the consume; it is safe to credit.
 * Returns false → already consumed (replay / cross-path double-redeem, or a lost
 *                 concurrent race) → the caller MUST NOT credit.
 *
 * Typed loosely on `tx` (Drizzle's transaction handle type is internal and
 * differs from the top-level db; both satisfy the `.insert(...)` surface used
 * here). The test suite passes a faithful in-memory fake.
 */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle tx/db handle type is internal.
export async function consumePayment(
	tx: any,
	args: { chain: string; txHash: string; purpose: string; consumedBy?: string | null },
): Promise<boolean> {
	const inserted = await tx
		.insert(consumedPayments)
		.values({
			chain: args.chain.trim().toLowerCase(),
			txHash: args.txHash.trim().toLowerCase(),
			purpose: args.purpose,
			consumedBy: args.consumedBy ?? null,
		})
		.onConflictDoNothing({ target: [consumedPayments.chain, consumedPayments.txHash] })
		.returning({ id: consumedPayments.id })
	return inserted.length > 0
}

/**
 * Sender-spoof defense. `sender` is the on-chain payer (tx `from`) returned by
 * the verifier; `boundWallets` are the EVM addresses bound to the authenticated
 * caller. True only if `sender` is a valid EVM address matching one bound wallet
 * (case-insensitive). If we can't establish the sender, reject (fail closed).
 */
export function assertSenderBound(
	sender: string | null | undefined,
	boundWallets: ReadonlyArray<string | null | undefined>,
): boolean {
	if (typeof sender !== 'string' || !EVM_ADDRESS_RE.test(sender)) return false
	const s = sender.toLowerCase()
	return boundWallets.some(
		(w) => typeof w === 'string' && EVM_ADDRESS_RE.test(w) && w.toLowerCase() === s,
	)
}

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

import { and, eq, inArray } from 'drizzle-orm'
import { consumedPayments } from '../db/schema'
import { rpcTxHash, txHashVariants } from './txHash'

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// Non-hex-prefixed chains: tx hash must NOT get a 0x (TRON bare hex, Solana base58).
const NON_PREFIXED_CHAINS = new Set(['solana', 'tron'])

/**
 * Canonical ledger spelling: lowercase, trimmed, and (for EVM payments) `0x`-prefixed.
 * `abc…` and `0xabc…` are the SAME transaction and must be the same key.
 */
function ledgerTxHash(chain: string, txHash: string): string {
	const c = chain.trim().toLowerCase()
	if (NON_PREFIXED_CHAINS.has(c)) return txHash.trim().toLowerCase()
	return String(rpcTxHash(txHash)).toLowerCase()
}

/**
 * Every lowercase spelling a (chain, txHash) may already be stored under.
 *
 * ADDITIVE / replay-safety: rows consumed BEFORE canonicalization hold the bare
 * (or as-given) form. Switching reads to the canonical key alone would make an
 * already-consumed payment look unconsumed and re-open the replay. So CHECKS match
 * all variants; WRITES use only the canonical form (ledgerTxHash).
 */
function ledgerTxHashVariants(chain: string, txHash: string): string[] {
	const c = chain.trim().toLowerCase()
	if (NON_PREFIXED_CHAINS.has(c)) return [txHash.trim().toLowerCase()]
	return [...new Set(txHashVariants(txHash).map((v) => v.toLowerCase()))]
}

/** Canonical (chain, txHash) key — lowercased, trimmed, 0x-normalized for EVM. */
export function paymentKey(chain: string, txHash: string): string {
	return `${chain.trim().toLowerCase()}:${ledgerTxHash(chain, txHash)}`
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
	const chain = args.chain.trim().toLowerCase()
	// Replay check across spellings (see ledgerTxHashVariants): a legacy bare-form row
	// for the same transaction means it is already consumed. Fail closed.
	const variants = ledgerTxHashVariants(chain, args.txHash)
	if (variants.length > 0) {
		const prior = await tx
			.select({ id: consumedPayments.id })
			.from(consumedPayments)
			.where(and(eq(consumedPayments.chain, chain), inArray(consumedPayments.txHash, variants)))
			.limit(1)
		if (prior.length > 0) return false
	}
	// Write the canonical form only. The unique (chain, txHash) constraint still
	// serializes concurrent same-spelling races (all new rows are canonical).
	const inserted = await tx
		.insert(consumedPayments)
		.values({
			chain,
			txHash: ledgerTxHash(chain, args.txHash),
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

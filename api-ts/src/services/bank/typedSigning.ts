/**
 * Digest signing through the same Turnkey sub-org + wallet row the bank uses for transactions.
 * Turnkey signRawPayload with HASH_FUNCTION_NO_OP signs a pre-computed 32-byte digest, which is
 * how EIP-712 typed data (EIP-3009) and EIP-191 messages are signed. The Python fallback signer
 * only signs transactions, so there is NO fallback here: a Turnkey failure is a typed
 * SIGNING_UNAVAILABLE. The recovered signer is verified against the account address before return.
 */
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { recoverAddress } from 'viem'
import { type BankAccount, type DrizzleService, wallets } from '../../db'
import { TurnkeyService } from '../TurnkeyService'
import { bankDb } from './db'
import { type BankError, bankErr } from './errors'

export const signDigestForAccount = (
	account: Pick<BankAccount, 'walletId' | 'walletUserId' | 'address'>,
	digest: `0x${string}`,
): Effect.Effect<`0x${string}`, BankError, DrizzleService | TurnkeyService> =>
	Effect.gen(function* () {
		const w = yield* bankDb(async (db) => {
			if (account.walletId == null || !account.address) throw bankErr('WALLET_UNAVAILABLE', 'Account has no custody wallet')
			const [row] = await db.select().from(wallets).where(eq(wallets.id, account.walletId)).limit(1)
			if (!row || !row.isActive) throw bankErr('WALLET_UNAVAILABLE', 'Custody wallet not found or inactive')
			if (row.userId !== account.walletUserId || row.address.toLowerCase() !== account.address.toLowerCase())
				throw bankErr('FORBIDDEN', 'Custody wallet no longer matches the account')
			if (row.walletProvider !== 'turnkey' || !row.turnkeySubOrgId)
				throw bankErr('SIGNING_UNAVAILABLE', 'Wallet does not support server-side signing')
			return row
		})
		const turnkey = yield* TurnkeyService
		const sig = yield* turnkey
			.signRawPayload(w.turnkeySubOrgId!, digest.slice(2), w.address, 'HASH_FUNCTION_NO_OP', 'PAYLOAD_ENCODING_HEXADECIMAL')
			.pipe(Effect.mapError((e) => bankErr('SIGNING_UNAVAILABLE', `Typed-data signing failed (no fallback signer for digests): ${e.message}`)))
		const signature = sig.signature as `0x${string}`
		const recovered = yield* Effect.tryPromise({
			try: () => recoverAddress({ hash: digest, signature }),
			catch: (e) => bankErr('SIGNING_UNAVAILABLE', `Signature unrecoverable: ${String(e)}`),
		})
		if (recovered.toLowerCase() !== w.address.toLowerCase())
			return yield* Effect.fail(bankErr('SIGNING_UNAVAILABLE', 'Signer did not recover to the wallet address'))
		return signature
	})

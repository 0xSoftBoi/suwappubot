/**
 * RP request signing — backend only.
 *
 * The signing key authenticates proof requests as ours. v4 requires `rp_context`
 * on every verification request. Never call this on a client, never expose the
 * key as a NEXT_PUBLIC_* var, never log it.
 */
import { signRequest } from '@worldcoin/idkit-core/signing'

export interface RpContext {
	rp_id: string
	nonce: string
	created_at: number
	expires_at: number
	signature: string
}

export function makeRpContext(opts: {
	rpId: string
	signingKeyHex: string
	action: string
	ttlSeconds?: number
}): RpContext {
	// NOTE the camelCase → snake_case mapping: rp_context wants snake_case.
	const { sig, nonce, createdAt, expiresAt } = signRequest({
		signingKeyHex: opts.signingKeyHex, // 0x prefix optional
		action: opts.action,
		ttl: opts.ttlSeconds ?? 300,
	})
	return {
		rp_id: opts.rpId,
		nonce,
		created_at: createdAt,
		expires_at: expiresAt,
		signature: sig,
	}
}

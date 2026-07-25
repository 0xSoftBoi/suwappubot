/**
 * Shared client for the internal Python x402 on-chain payment verifier
 * (`POST /internal/x402/verify`).
 *
 * DEDUPE: the ~30-line fetch+parse block used to be copy-pasted across four
 * redemption sites (agent topup, agent subscribe, webapp billing subscribe, and
 * the mppAuth 402 swap middleware). Each hand-rolled its own response parse, and
 * some omitted the `sender` field — so the sender-spoof defense could silently be
 * skipped wherever the narrower type was used. Centralizing here guarantees every
 * caller parses `sender` identically and can enforce assertSenderBound().
 */

export interface X402VerifyResult {
	verified: boolean
	/** On-chain payer (tx `from`). Undefined if the verifier could not resolve it. */
	sender?: string
	error?: string
}

export interface X402VerifyParams {
	internalUrl: string
	internalKey: string
	txHash: string
	chain: string
	expectedAmount: string
	expectedRecipient: string
	expectedToken?: string
	timeoutMs?: number
}

/**
 * Verify an on-chain payment via the internal Python API. Never throws for the
 * normal failure modes (network error, non-2xx, verifier rejection): returns
 * `{ verified: false, error }` so callers can map it to a 402 uniformly. The
 * `sender` field is always surfaced (when the verifier returns it) so every
 * caller can bind it to the authenticated principal.
 */
export async function verifyX402Payment(params: X402VerifyParams): Promise<X402VerifyResult> {
	const {
		internalUrl,
		internalKey,
		txHash,
		chain,
		expectedAmount,
		expectedRecipient,
		expectedToken = 'USDC',
		timeoutMs = 15_000,
	} = params

	let res: Response
	try {
		res = await fetch(`${internalUrl}/internal/x402/verify`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Internal-Key': internalKey },
			body: JSON.stringify({
				tx_hash: txHash,
				chain,
				expected_amount: expectedAmount,
				expected_token: expectedToken,
				expected_recipient: expectedRecipient,
			}),
			signal: AbortSignal.timeout(timeoutMs),
		})
	} catch (e) {
		return { verified: false, error: e instanceof Error ? e.message : String(e) }
	}

	if (!res.ok) {
		const errText = await res.text().catch(() => res.statusText)
		return { verified: false, error: `Payment verification failed: ${errText}` }
	}

	let v: { verified?: boolean; error?: string; sender?: string | null }
	try {
		v = (await res.json()) as { verified?: boolean; error?: string; sender?: string | null }
	} catch (e) {
		return { verified: false, error: e instanceof Error ? e.message : String(e) }
	}

	if (!v.verified) {
		return { verified: false, error: v.error || 'Payment not verified on-chain' }
	}
	return { verified: true, sender: v.sender ?? undefined }
}

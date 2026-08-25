/**
 * Independent on-chain verification of a burn.
 *
 * Until now the proof page reported a burn as done because *we* broadcast a
 * transaction. That is a self-report, and a self-report is exactly what the
 * research says nobody in this category believes — "the on-chain ledger is the
 * source of truth, announcements are not evidence". A transaction can succeed
 * as a transaction while delivering nothing to the burn address: a swap that
 * routed differently, a fee-on-transfer token that skimmed the amount, a
 * contract that reverted internally without reverting the call. Our records
 * would have called every one of those `succeeded`.
 *
 * So we go and look. Given a tx hash, this asks a block explorer for the ERC-20
 * transfers that transaction actually produced and checks that one of them
 * moved the project's token to the burn address.
 *
 * ## Three outcomes, and the middle one is why this exists
 *
 * - `verified` — the transfer is there. We record the amount the chain says,
 *   not the amount we intended.
 * - `mismatch` — the transaction exists but no transfer of this token to this
 *   burn address is in it. This is a burn that did not happen, and without this
 *   check it would sit on the public page as a success forever.
 * - `not_found` — the explorer has no such transaction. Usually means it never
 *   landed, sometimes means the explorer is behind. Retryable, so it is
 *   distinguished from `mismatch`, which is not.
 *
 * ## On "burned" and total supply
 *
 * Sending a token to `0x…dEaD` is an ordinary transfer, so the contract's
 * `total_supply` does not change — the tokens become unreachable, not
 * destroyed. Confirmed against live Blockscout data while building this. That
 * is why the proof page says "sent to a burn address" and never "supply
 * reduced", and why we report the burn address's balance rather than implying
 * an issuance change we cannot see.
 */
import { logger } from '../../lib/logger'

/** Blockscout instances, keyed by our chain slug.
 *
 * Deliberately a fixed map rather than a guessed hostname: an unknown chain
 * must return `unsupported` and be reported as unverifiable, not silently
 * treated as verified because a URL 404'd. */
const EXPLORERS: Record<string, string> = {
	ethereum: 'https://eth.blockscout.com',
	base: 'https://base.blockscout.com',
	arbitrum: 'https://arbitrum.blockscout.com',
	optimism: 'https://optimism.blockscout.com',
	polygon: 'https://polygon.blockscout.com',
	gnosis: 'https://gnosis.blockscout.com',
}

export type VerificationStatus =
	| 'verified'
	| 'mismatch'
	| 'not_found'
	| 'unsupported_chain'
	| 'unavailable'

export interface VerificationResult {
	status: VerificationStatus
	/** Raw on-chain amount, as a decimal string. Never a float — these are
	 *  18-decimal integers and a float loses the low digits silently. */
	amountRaw?: string
	amountHuman?: string
	decimals?: number
	tokenSymbol?: string
	blockNumber?: number
	confirmedAt?: string
	/** Human-readable, shown on the public page. */
	detail: string
}

/** Shape returned by Blockscout's token-transfers endpoint. Verified against
 *  live mainnet data rather than assumed from docs. */
interface BlockscoutTransfer {
	from?: string
	to?: string
	status?: string
	timestamp?: string
	total?: { value?: string; decimals?: string }
	token?: { address_hash?: string; symbol?: string; decimals?: string }
	block_number?: number
}

const eq = (a?: string | null, b?: string | null): boolean =>
	Boolean(a && b && a.toLowerCase() === b.toLowerCase())

/** Integer→decimal string. Avoids floats entirely: at 18 decimals a Number
 *  cannot hold the value, and a burn total that quietly loses precision is a
 *  number a holder could catch us on. */
export function formatUnits(raw: string, decimals: number): string {
	try {
		const negative = raw.startsWith('-')
		const digits = (negative ? raw.slice(1) : raw).replace(/\D/g, '') || '0'
		if (decimals <= 0) return `${negative ? '-' : ''}${digits}`
		const padded = digits.padStart(decimals + 1, '0')
		const whole = padded.slice(0, padded.length - decimals)
		const frac = padded.slice(padded.length - decimals).replace(/0+$/, '')
		const withSeparators = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

		// Truncating the fraction to 6 places renders a genuinely tiny amount as
		// "0.000000", which reads as nothing happening. On a page whose whole
		// purpose is not overstating a burn, understating one to zero is the same
		// failure wearing different clothes. Show enough digits to be non-zero.
		let shown = frac.slice(0, 6)
		if (frac && /^0*$/.test(shown)) {
			const firstSignificant = frac.search(/[1-9]/)
			shown = firstSignificant === -1 ? '' : frac.slice(0, firstSignificant + 2)
		}
		return `${negative ? '-' : ''}${withSeparators}${shown ? `.${shown}` : ''}`
	} catch {
		return raw
	}
}

export interface VerifyInput {
	chain: string
	txHash: string
	tokenAddress: string
	burnAddress: string
	/** Injected in tests. */
	fetchImpl?: typeof fetch
}

/**
 * Check that `txHash` really delivered `tokenAddress` to `burnAddress`.
 *
 * Never throws: a verification that errors must degrade to `unavailable` and
 * leave the run's own status alone. Failing to verify is not evidence that a
 * burn did not happen, and recording it as such would be its own dishonesty.
 */
export async function verifyBurn(input: VerifyInput): Promise<VerificationResult> {
	const base = EXPLORERS[input.chain.toLowerCase()]
	if (!base) {
		return {
			status: 'unsupported_chain',
			detail: `No block explorer configured for ${input.chain}, so this run cannot be independently checked.`,
		}
	}
	if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) {
		return { status: 'not_found', detail: 'No usable transaction hash was recorded for this run.' }
	}

	const doFetch = input.fetchImpl ?? fetch
	const url = `${base}/api/v2/transactions/${input.txHash}/token-transfers?type=ERC-20`

	let payload: { items?: BlockscoutTransfer[] }
	try {
		const res = await doFetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(12_000),
		})
		if (res.status === 404) {
			return {
				status: 'not_found',
				detail: 'The block explorer has no record of this transaction yet.',
			}
		}
		if (!res.ok) {
			return {
				status: 'unavailable',
				detail: `Block explorer returned ${res.status}; verification will be retried.`,
			}
		}
		payload = (await res.json()) as { items?: BlockscoutTransfer[] }
	} catch (e) {
		logger.warn(
			{ chain: input.chain, txHash: input.txHash, err: e instanceof Error ? e.message : String(e) },
			'burn verification unavailable',
		)
		return { status: 'unavailable', detail: 'Could not reach the block explorer; will retry.' }
	}

	const transfers = Array.isArray(payload.items) ? payload.items : []
	if (transfers.length === 0) {
		return {
			status: 'mismatch',
			detail: 'That transaction moved no ERC-20 tokens at all.',
		}
	}

	const match = transfers.find(
		(t) => eq(t.to, input.burnAddress) && eq(t.token?.address_hash, input.tokenAddress),
	)

	if (!match) {
		// The transaction is real but it did not do what the run claimed. This is
		// the case the whole module exists for, so the message says exactly what
		// was and was not found rather than a vague failure.
		const toBurn = transfers.filter((t) => eq(t.to, input.burnAddress))
		const detail = toBurn.length
			? `The transaction sent tokens to the burn address, but not this project's token.`
			: `The transaction succeeded but sent nothing to the burn address.`
		return { status: 'mismatch', detail }
	}

	const decimals = Number.parseInt(match.total?.decimals ?? match.token?.decimals ?? '18', 10)
	const amountRaw = match.total?.value ?? '0'

	return {
		status: 'verified',
		amountRaw,
		amountHuman: formatUnits(amountRaw, Number.isFinite(decimals) ? decimals : 18),
		decimals: Number.isFinite(decimals) ? decimals : 18,
		tokenSymbol: match.token?.symbol,
		blockNumber: match.block_number,
		confirmedAt: match.timestamp,
		detail: 'Confirmed on-chain.',
	}
}

/** Whether a verification outcome is worth trying again. `mismatch` is a
 *  finding, not a transient failure — retrying it would only overwrite a true
 *  negative with the same true negative. */
export function isRetryable(status: VerificationStatus): boolean {
	return status === 'not_found' || status === 'unavailable'
}

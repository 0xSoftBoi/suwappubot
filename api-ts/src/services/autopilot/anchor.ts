/**
 * On-chain anchoring of decision commitments.
 *
 * A commitment stored only in our database proves ordering only to someone who
 * trusts our database. Anchoring writes the commitment memo into a transaction
 * *before* the trade, so the ordering is witnessed by a block instead of by us.
 *
 * The anchor key is deliberately separate from every trading and fee key: it
 * signs nothing but zero-value self-sends carrying ~80 bytes of calldata, so
 * compromising it buys an attacker the ability to publish junk memos and
 * nothing else.
 */
import { type Address, createWalletClient, type Hex, hexToString, http, stringToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, optimism } from 'viem/chains'
import { getRpcUrl } from '../../config/chains'
import { logger } from '../../lib/logger'
import { parseSealMemo, sealMemo } from '../../lib/seal'

export type AnchorResult =
	| { ok: true; txHash: string; chain: string }
	| { ok: false; error: string }

export interface Anchor {
	readonly chain: string
	readonly enabled: boolean
	/** Publish the commitment. Never throws — a failed anchor is a decision, not a crash. */
	anchor(commitment: string): Promise<AnchorResult>
}

/** No anchoring configured. Decisions are still sealed, just not witnessed on-chain. */
export class NullAnchor implements Anchor {
	readonly chain = 'none'
	readonly enabled = false
	async anchor(): Promise<AnchorResult> {
		return { ok: false, error: 'anchoring not configured' }
	}
}

const CHAINS = { base, arbitrum, optimism } as const
export type AnchorChain = keyof typeof CHAINS

/**
 * Writes the memo as calldata on a zero-value self-send. Any explorer shows the
 * input data; `parseAnchorCalldata` turns it back into the commitment.
 */
export type MemoSender = (params: {
	chain: AnchorChain
	rpcUrl: string
	privateKey: Hex
	data: Hex
}) => Promise<string>

/** The real sender: a zero-value self-send carrying the memo as calldata. */
export const viemMemoSender: MemoSender = async ({ chain, rpcUrl, privateKey, data }) => {
	const account = privateKeyToAccount(privateKey)
	const wallet = createWalletClient({ account, chain: CHAINS[chain], transport: http(rpcUrl) })
	return wallet.sendTransaction({ to: account.address as Address, value: 0n, data })
}

export class EvmMemoAnchor implements Anchor {
	readonly enabled = true

	constructor(
		readonly chain: AnchorChain,
		private readonly privateKey: Hex,
		private readonly send: MemoSender = viemMemoSender,
	) {}

	async anchor(commitment: string): Promise<AnchorResult> {
		try {
			const rpcUrl = getRpcUrl(CHAINS[this.chain].id)
			if (!rpcUrl) return { ok: false, error: `no RPC configured for ${this.chain}` }

			const txHash = await this.send({
				chain: this.chain,
				rpcUrl,
				privateKey: this.privateKey,
				data: encodeAnchorCalldata(commitment),
			})
			return { ok: true, txHash, chain: this.chain }
		} catch (err) {
			logger.error({ err: String(err), chain: this.chain }, 'autopilot: anchor failed')
			return { ok: false, error: String(err) }
		}
	}
}

/** `suwappu-autopilot:v1:<algo>:<commitment>` as UTF-8 hex calldata. */
export function encodeAnchorCalldata(commitment: string): Hex {
	return stringToHex(sealMemo(commitment))
}

/** Recover a commitment from a transaction's input data. Returns null if it is not ours. */
export function parseAnchorCalldata(data: string): string | null {
	if (!data || !data.startsWith('0x') || data.length < 4) return null
	let text: string
	try {
		text = hexToString(data as Hex)
	} catch {
		return null
	}
	return parseSealMemo(text)?.commitment ?? null
}

export interface AnchorEnv {
	AUTOPILOT_ANCHOR_CHAIN?: string | undefined
	AUTOPILOT_ANCHOR_PRIVATE_KEY?: string | undefined
}

/**
 * Anchoring is off unless a key is configured — and when it IS configured, a
 * failed anchor blocks execution (see the cycle). Half-anchored history would
 * be worse than none, because it invites a claim the data cannot support.
 */
export function createAnchor(env: AnchorEnv): Anchor {
	const key = env.AUTOPILOT_ANCHOR_PRIVATE_KEY
	if (!key) return new NullAnchor()

	const chain = (env.AUTOPILOT_ANCHOR_CHAIN ?? 'base').toLowerCase()
	if (!(chain in CHAINS)) {
		logger.warn({ chain }, 'autopilot: unknown anchor chain, anchoring disabled')
		return new NullAnchor()
	}
	if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
		logger.warn('autopilot: AUTOPILOT_ANCHOR_PRIVATE_KEY is malformed, anchoring disabled')
		return new NullAnchor()
	}
	return new EvmMemoAnchor(chain as AnchorChain, key as Hex)
}

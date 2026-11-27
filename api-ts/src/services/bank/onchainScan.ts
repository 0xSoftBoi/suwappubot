/** Read-only on-chain scanning for invoice payment detection (EVM Transfer logs, Solana Pay references). */
import { RPC_ENDPOINTS } from '../../config/chains'
import { fetchWithRetry } from '../../lib/retry'

async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
	const url = RPC_ENDPOINTS[chain]
	if (!url) throw new Error(`No RPC endpoint for chain ${chain}`)
	const res = await fetchWithRetry(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
	const data = (await res.json()) as { result?: T; error?: { message: string } }
	if (data.error) throw new Error(`${chain} ${method}: ${data.error.message}`)
	return data.result as T
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
export const MAX_LOG_RANGE = 2000n

export const evmHead = async (chain: string): Promise<bigint> => BigInt(await rpc<string>(chain, 'eth_blockNumber', []))

export interface EvmTransferLog {
	txHash: string
	logIndex: number
	blockNumber: bigint
	from: string
	value: bigint
}

/** ERC-20 Transfer(to=recipient) logs for `token` in [fromBlock, toBlock] (inclusive, range must be <= MAX_LOG_RANGE). */
export async function evmTransferLogs(p: { chain: string; token: string; to: string; fromBlock: bigint; toBlock: bigint }): Promise<EvmTransferLog[]> {
	const toTopic = `0x${'0'.repeat(24)}${p.to.toLowerCase().replace(/^0x/, '')}`
	const logs = await rpc<Array<{ transactionHash: string; logIndex: string; blockNumber: string; topics: string[]; data: string; removed?: boolean }>>(
		p.chain,
		'eth_getLogs',
		[{ address: p.token, fromBlock: `0x${p.fromBlock.toString(16)}`, toBlock: `0x${p.toBlock.toString(16)}`, topics: [TRANSFER_TOPIC, null, toTopic] }],
	)
	return logs
		.filter((l) => !l.removed && l.topics.length >= 3)
		.map((l) => ({
			txHash: l.transactionHash,
			logIndex: Number(BigInt(l.logIndex)),
			blockNumber: BigInt(l.blockNumber),
			from: `0x${l.topics[1]!.slice(26)}`,
			value: BigInt(l.data),
		}))
}

/** Finalized signatures that reference the Solana Pay `reference` account. */
export async function solReferenceSignatures(reference: string): Promise<string[]> {
	const r = await rpc<Array<{ signature: string; err: unknown }>>('solana', 'getSignaturesForAddress', [reference, { limit: 20, commitment: 'finalized' }])
	return r.filter((s) => s.err == null).map((s) => s.signature)
}

/** Net token received by `owner` (token-account owner) for `mint` in a finalized, successful transaction. */
export async function solReceivedBy(signature: string, owner: string, mint: string): Promise<bigint> {
	const tx = await rpc<{
		meta: {
			err: unknown
			preTokenBalances?: Array<{ mint: string; owner?: string; uiTokenAmount: { amount: string } }>
			postTokenBalances?: Array<{ mint: string; owner?: string; uiTokenAmount: { amount: string } }>
		} | null
	} | null>('solana', 'getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }])
	if (!tx?.meta || tx.meta.err != null) return 0n
	const sum = (xs: Array<{ mint: string; owner?: string; uiTokenAmount: { amount: string } }> | undefined) =>
		(xs ?? []).filter((b) => b.mint === mint && b.owner === owner).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n)
	const d = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances)
	return d > 0n ? d : 0n
}

/**
 * Chain primitives for the bank (promise-based; services wrap them in
 * Effect.tryPromise). EVM: ERC-20 transfer building / receipts / balances.
 * Solana: dependency-free SPL transferChecked legacy-tx builder.
 *
 * Signing is NOT here — it goes through Turnkey + withSigningFallback in
 * BankTransferService (same path as routes/swap.ts:553-584).
 */
import { createHash } from 'node:crypto'
import { keccak256 } from 'viem'
import { RPC_ENDPOINTS } from '../../config/chains'
import { fetchWithRetry } from '../../lib/retry'
import type { BankAsset } from './assets'

// ---------------------------------------------------------------- rpc

async function rpc<T>(chain: string, method: string, params: unknown[]): Promise<T> {
	const url = RPC_ENDPOINTS[chain]
	if (!url) throw new Error(`No RPC endpoint for chain ${chain}`)
	const res = await fetchWithRetry(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	})
	const data = (await res.json()) as { result?: T; error?: { message: string; code: number } }
	if (data.error) throw new RpcError(data.error.message, data.error.code)
	return data.result as T
}

export class RpcError extends Error {
	constructor(
		message: string,
		readonly rpcCode: number,
	) {
		super(message)
	}
}

const hexToBig = (h: string | null | undefined): bigint => (h && h !== '0x' ? BigInt(h) : 0n)
const pad32 = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

// ---------------------------------------------------------------- EVM

export async function evmTokenBalance(asset: BankAsset, owner: string): Promise<bigint> {
	const out = await rpc<string>(asset.chain, 'eth_call', [
		{ to: asset.address, data: `0x70a08231${pad32(owner)}` },
		'latest',
	])
	return hexToBig(out)
}

export interface EvmUnsignedTx {
	type: '0x2'
	chainId: string
	nonce: string
	to: string
	value: '0x0'
	data: string
	maxFeePerGas: string
	maxPriorityFeePerGas: string
	gas: string
}

export const erc20TransferData = (to: string, amountMinor: bigint): string =>
	`0xa9059cbb${pad32(to)}${amountMinor.toString(16).padStart(64, '0')}`

export const erc20ApproveData = (spender: string, amountMinor: bigint): string =>
	`0x095ea7b3${pad32(spender)}${amountMinor.toString(16).padStart(64, '0')}`

export async function evmAllowance(asset: BankAsset, owner: string, spender: string): Promise<bigint> {
	return hexToBig(
		await rpc<string>(asset.chain, 'eth_call', [
			{ to: asset.address, data: `0xdd62ed3e${pad32(owner)}${pad32(spender)}` },
			'latest',
		]),
	)
}

/**
 * Builds an unsigned EIP-1559 contract call (same JSON shape as routes/swap.ts:554).
 * Estimation reverts (e.g. token balance too low on-chain) throw; native-gas
 * shortfall throws GasShortfallError. Nothing is broadcast here.
 */
export async function evmBuildCall(
	chain: string,
	chainId: number,
	from: string,
	to: string,
	data: string,
	valueHex = '0x0',
	gasOverride?: bigint,
): Promise<{ tx: EvmUnsignedTx; nonce: number; maxCostWei: bigint }> {
	const [nonceHex, gasPriceHex, tipHex, gasHex, nativeHex] = await Promise.all([
		rpc<string>(chain, 'eth_getTransactionCount', [from, 'pending']),
		rpc<string>(chain, 'eth_gasPrice', []),
		rpc<string>(chain, 'eth_maxPriorityFeePerGas', []).catch(() => '0x0'),
		gasOverride !== undefined
			? Promise.resolve(`0x${gasOverride.toString(16)}`)
			: rpc<string>(chain, 'eth_estimateGas', [{ from, to, data, value: valueHex }]),
		rpc<string>(chain, 'eth_getBalance', [from, 'latest']),
	])
	const gas = gasOverride !== undefined ? gasOverride : (hexToBig(gasHex) * 12n) / 10n
	const tip = hexToBig(tipHex)
	const maxFee = (hexToBig(gasPriceHex) * 15n) / 10n + tip
	const maxCost = gas * maxFee + hexToBig(valueHex)
	if (hexToBig(nativeHex) < maxCost) {
		throw new GasShortfallError(
			`Wallet ${from} on ${chain} lacks native gas: needs up to ${maxCost} wei, has ${hexToBig(nativeHex)} wei`,
		)
	}
	return {
		nonce: Number(hexToBig(nonceHex)),
		maxCostWei: maxCost,
		tx: {
			type: '0x2',
			chainId: `0x${chainId.toString(16)}`,
			nonce: nonceHex,
			to,
			value: valueHex as '0x0',
			data,
			maxFeePerGas: `0x${maxFee.toString(16)}`,
			maxPriorityFeePerGas: `0x${tip.toString(16)}`,
			gas: `0x${gas.toString(16)}`,
		},
	}
}

export class GasShortfallError extends Error {}

/** Tx hash of a signed raw EVM tx — known before broadcast, so we persist it first. */
export const evmTxHash = (signedRaw: string): string => keccak256(signedRaw as `0x${string}`)

export type BroadcastOutcome =
	| { kind: 'accepted' }
	| { kind: 'rejected'; message: string }
	| { kind: 'ambiguous'; message: string }

export async function evmBroadcast(chain: string, signedRaw: string): Promise<BroadcastOutcome> {
	try {
		await rpc<string>(chain, 'eth_sendRawTransaction', [signedRaw])
		return { kind: 'accepted' }
	} catch (e) {
		if (e instanceof RpcError) {
			// Already in the mempool / mined: the hash we persisted is the truth.
			if (/already known|known transaction|already imported|already in mempool|AlreadyKnown/i.test(e.message))
				return { kind: 'accepted' }
			return { kind: 'rejected', message: e.message }
		}
		return { kind: 'ambiguous', message: e instanceof Error ? e.message : String(e) }
	}
}

export interface EvmReceipt {
	success: boolean
	blockNumber: bigint
	logs: Array<{ address: string; topics: string[]; data: string }>
}

export async function evmReceipt(chain: string, hash: string): Promise<EvmReceipt | null> {
	const r = await rpc<{
		status: string
		blockNumber: string
		logs: Array<{ address: string; topics: string[]; data: string }>
	} | null>(chain, 'eth_getTransactionReceipt', [hash])
	if (!r) return null
	return { success: r.status === '0x1', blockNumber: hexToBig(r.blockNumber), logs: r.logs ?? [] }
}

export const evmBlockNumber = async (chain: string) => hexToBig(await rpc<string>(chain, 'eth_blockNumber', []))

export async function evmTxKnown(chain: string, hash: string): Promise<boolean> {
	return (await rpc<unknown>(chain, 'eth_getTransactionByHash', [hash])) != null
}

export const evmLatestNonce = async (chain: string, addr: string) =>
	Number(hexToBig(await rpc<string>(chain, 'eth_getTransactionCount', [addr, 'latest'])))

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** Sum of ERC-20 Transfer(to=recipient) values for `token` in a receipt. */
export function sumTransfersTo(receipt: EvmReceipt, token: string, recipient: string): bigint {
	let total = 0n
	for (const l of receipt.logs) {
		if (l.address.toLowerCase() !== token.toLowerCase()) continue
		if (l.topics[0] !== TRANSFER_TOPIC || l.topics.length < 3) continue
		if (`0x${l.topics[2]!.slice(26)}`.toLowerCase() !== recipient.toLowerCase()) continue
		total += hexToBig(l.data)
	}
	return total
}

export const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a)

// ---------------------------------------------------------------- Solana

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function b58encode(bytes: Uint8Array): string {
	let n = 0n
	for (const b of bytes) n = (n << 8n) | BigInt(b)
	let out = ''
	while (n > 0n) {
		out = B58[Number(n % 58n)]! + out
		n /= 58n
	}
	for (const b of bytes) {
		if (b !== 0) break
		out = `1${out}`
	}
	return out
}

export function b58decode(s: string): Uint8Array {
	let n = 0n
	for (const ch of s) {
		const i = B58.indexOf(ch)
		if (i < 0) throw new Error('invalid base58')
		n = n * 58n + BigInt(i)
	}
	const bytes: number[] = []
	while (n > 0n) {
		bytes.unshift(Number(n & 0xffn))
		n >>= 8n
	}
	let zeros = 0
	for (const ch of s) {
		if (ch !== '1') break
		zeros++
	}
	return Uint8Array.from([...new Array(zeros).fill(0), ...bytes])
}

export const isSolanaAddress = (a: string): boolean => {
	try {
		return b58decode(a).length === 32
	} catch {
		return false
	}
}

const P = 2n ** 255n - 19n
const modpow = (b: bigint, e: bigint, m: bigint): bigint => {
	let r = 1n
	b %= m
	while (e > 0n) {
		if (e & 1n) r = (r * b) % m
		b = (b * b) % m
		e >>= 1n
	}
	return r
}
const D = (((P - 121665n) % P) * modpow(121666n, P - 2n, P)) % P

function isOnCurve(bytes: Uint8Array): boolean {
	const b = Uint8Array.from(bytes)
	b[31]! &= 0x7f
	let y = 0n
	for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i]!)
	if (y >= P) return false
	const y2 = (y * y) % P
	const u = (y2 - 1n + P) % P
	const v = (D * y2 + 1n) % P
	const x2 = (u * modpow(v, P - 2n, P)) % P
	return x2 === 0n || modpow(x2, (P - 1n) / 2n, P) === 1n
}

const SYSTEM_PROGRAM = '11111111111111111111111111111111'
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

function findProgramAddress(seeds: Uint8Array[], programId: string): string {
	const pid = b58decode(programId)
	for (let bump = 255; bump >= 0; bump--) {
		const h = createHash('sha256')
		for (const s of seeds) h.update(s)
		h.update(Uint8Array.of(bump))
		h.update(pid)
		h.update('ProgramDerivedAddress')
		const out = new Uint8Array(h.digest())
		if (!isOnCurve(out)) return b58encode(out)
	}
	throw new Error('no PDA found')
}

export const deriveAta = (owner: string, mint: string, tokenProgram: string): string =>
	findProgramAddress([b58decode(owner), b58decode(tokenProgram), b58decode(mint)], ATA_PROGRAM)

async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
	return rpc<T>('solana', method, params)
}

export async function solTokenBalance(asset: BankAsset, owner: string): Promise<bigint> {
	const r = await solRpc<{ value: Array<{ account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }> }>(
		'getTokenAccountsByOwner',
		[owner, { mint: asset.address }, { encoding: 'jsonParsed' }],
	)
	return r.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n)
}

const compact = (n: number): number[] => {
	const out: number[] = []
	while (true) {
		const low = n & 0x7f
		n >>= 7
		if (n === 0) {
			out.push(low)
			return out
		}
		out.push(low | 0x80)
	}
}

const u64le = (n: bigint): number[] => {
	const out: number[] = []
	for (let i = 0; i < 8; i++) out.push(Number((n >> BigInt(8 * i)) & 0xffn))
	return out
}

export interface SolanaUnsignedTransfer {
	/** Hex of the serialized tx with a zeroed signature slot — Turnkey's expected input. */
	unsignedHex: string
	lastValidBlockHeight: number
	/** Rent-funded ATA creation for the recipient is included (idempotent). */
	sourceAta: string
	destAta: string
}

export async function solBuildSplTransfer(
	asset: BankAsset,
	owner: string,
	recipient: string,
	amountMinor: bigint,
): Promise<SolanaUnsignedTransfer> {
	const mintInfo = await solRpc<{ value: { owner: string } | null }>('getAccountInfo', [
		asset.address,
		{ encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
	])
	if (!mintInfo.value) throw new Error(`Mint ${asset.address} not found on Solana`)
	const tokenProgram = mintInfo.value.owner
	if (tokenProgram !== TOKEN_PROGRAM && tokenProgram !== TOKEN_2022_PROGRAM)
		throw new Error(`Mint ${asset.address} is owned by unexpected program ${tokenProgram}`)

	const sourceAta = deriveAta(owner, asset.address, tokenProgram)
	const destAta = deriveAta(recipient, asset.address, tokenProgram)
	const bh = await solRpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [
		{ commitment: 'confirmed' },
	])

	// Account table: [payer(ws), sourceAta(w), destAta(w), mint(r), recipient(r), system(r), tokenProg(r), ataProg(r)]
	const keys = [owner, sourceAta, destAta, asset.address, recipient, SYSTEM_PROGRAM, tokenProgram, ATA_PROGRAM]
	const msg: number[] = [1, 0, 5, ...compact(keys.length)]
	for (const k of keys) msg.push(...b58decode(k))
	msg.push(...b58decode(bh.value.blockhash))
	msg.push(...compact(2))
	// 1) CreateIdempotent ATA for recipient: accounts payer, ata, owner, mint, system, token
	msg.push(7, ...compact(6), 0, 2, 4, 3, 5, 6, ...compact(1), 1)
	// 2) TransferChecked: accounts source, mint, dest, authority; data [12, amount u64 LE, decimals]
	msg.push(6, ...compact(4), 1, 3, 2, 0, ...compact(10), 12, ...u64le(amountMinor), asset.decimals)

	const tx = [...compact(1), ...new Array(64).fill(0), ...msg]
	return {
		unsignedHex: Buffer.from(tx).toString('hex'),
		lastValidBlockHeight: bh.value.lastValidBlockHeight,
		sourceAta,
		destAta,
	}
}

/** First signature of a signed serialized tx (hex) as base58 — the Solana tx id. */
export function solSignatureOf(signedHex: string): string {
	const raw = Buffer.from(signedHex.replace(/^0x/, ''), 'hex')
	const nsig = raw[0]!
	if (nsig < 1 || nsig > 127 || raw.length < 1 + 64) throw new Error('malformed signed solana tx')
	return b58encode(raw.subarray(1, 65))
}

export async function solBroadcast(signedHex: string): Promise<BroadcastOutcome> {
	try {
		await solRpc<string>('sendTransaction', [
			Buffer.from(signedHex.replace(/^0x/, ''), 'hex').toString('base64'),
			{ encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
		])
		return { kind: 'accepted' }
	} catch (e) {
		if (e instanceof RpcError) return { kind: 'rejected', message: e.message }
		return { kind: 'ambiguous', message: e instanceof Error ? e.message : String(e) }
	}
}

export type SolStatus =
	| { state: 'finalized' | 'confirmed' }
	| { state: 'processing' }
	| { state: 'failed'; reason: string }
	| { state: 'unknown' }

export async function solSignatureStatus(sig: string): Promise<SolStatus> {
	const r = await solRpc<{
		value: Array<{ err: unknown; confirmationStatus?: string } | null>
	}>('getSignatureStatuses', [[sig], { searchTransactionHistory: true }])
	const s = r.value[0]
	if (!s) return { state: 'unknown' }
	if (s.err) return { state: 'failed', reason: JSON.stringify(s.err) }
	if (s.confirmationStatus === 'finalized') return { state: 'finalized' }
	if (s.confirmationStatus === 'confirmed') return { state: 'confirmed' }
	return { state: 'processing' }
}

export const solBlockHeight = async () => Number(await solRpc<number>('getBlockHeight', [{ commitment: 'confirmed' }]))

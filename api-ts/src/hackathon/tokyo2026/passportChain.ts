/**
 * HACKATHON (ETHGlobal Tokyo 2026) — "Agent Swap Passport" chain adapter.
 *
 * Ties together the three on-chain facts that make a wallet a "passport
 * holder" on Sepolia:
 *  1. An ENSv2 subname `<label>.suwappu-agents.eth` resolves to the wallet
 *     (identity anchor, minted via lib/ensSubname.ts).
 *  2. WorldIdGateHook.isWorldIdVerified(wallet) is true (allowlisted by the
 *     minter/owner key after a real World ID proof).
 *  3. A swap through PoolSwapTest against the hooked pool succeeds — the
 *     hook reads `abi.encode(swapper)` from hookData and reverts
 *     `SwapperNotVerified` for anyone not allowlisted.
 *
 * All writes use the ENS minter key (0x23865aA89E79511950987CC15cd5834BE010E8E7)
 * — it is both the ENS subregistry owner AND the WorldIdGateHook owner AND
 * the wallet that holds/approved the mock tokens for the demo swap. The
 * *passport holder* wallet never signs anything here; the minter executes on
 * its behalf once a real World ID proof has authorized that wallet. This
 * mirrors the gas-sponsorship pattern already used for ENS minting.
 *
 * Every write (mint, allowlist, swap) is awaited on-chain (receipt or
 * simulate-revert) but callers MUST run this from a background task, never
 * inline in a request handler — Sepolia confirmations can take several
 * seconds, well past a reasonable request budget.
 */

import {
	createPublicClient,
	createWalletClient,
	http,
	isAddress,
	namehash,
	type Hex,
	type PublicClient,
	type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { hackathonEnv } from '../env'
import { mintAgentSubname, type EnsSubnameConfig } from '../../lib/ensSubname'
import { resolveAddressWithResolver } from './ensv2/resolver'
import { logger } from '../../lib/logger'

const HOOK_ADDRESS = '0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080' as const
const POOL_SWAP_TEST_ADDRESS = '0x9B6b46e2c869aa39918Db7f52f5557FE577B6eEe' as const
const TOKEN_A = '0x4408c29d4dc2653a3dce5dade8227927bc33f656' as const
const TOKEN_B = '0xcb2e4e474dfc367687a98f731c7e3261c975c382' as const
const PARENT_NAME = 'suwappu-agents.eth'

// PassportResolver — hackathon-scope owned resolver (see contracts-hackathon
// PassportResolver.sol). PublicResolverV2's setAddr() authorization is
// NameWrapper-based and can never be satisfied by ENSv2 registry names, so
// ENS_RESOLVER_ADDRESS is expected to point at PassportResolver for names
// minted after this fix; setAddr is only ever attempted when the name's
// registered resolver matches ENS_RESOLVER_ADDRESS (see provisionPassport).
const RESOLVER_ABI = [
	{
		type: 'function',
		name: 'setAddr',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'node', type: 'bytes32' },
			{ name: 'a', type: 'address' },
		],
		outputs: [],
	},
	{
		type: 'function',
		name: 'addr',
		stateMutability: 'view',
		inputs: [{ name: 'node', type: 'bytes32' }],
		outputs: [{ type: 'address' }],
	},
] as const

const HOOK_ABI = [
	{
		type: 'function',
		name: 'setWorldIdVerified',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'swapper', type: 'address' },
			{ name: 'verified', type: 'bool' },
		],
		outputs: [],
	},
	{
		type: 'function',
		name: 'isWorldIdVerified',
		stateMutability: 'view',
		inputs: [{ name: '', type: 'address' }],
		outputs: [{ type: 'bool' }],
	},
] as const

// v4-core's CustomRevert.bubbleUpAndRevertWith wraps hook reverts (e.g. our
// hook's SwapperNotVerified) in this error before they reach the caller —
// without it in the ABI, viem can't decode the revert and reports a bare,
// undecodable selector.
const WRAPPED_ERROR_ABI = [
	{
		type: 'error',
		name: 'WrappedError',
		inputs: [
			{ name: 'target', type: 'address' },
			{ name: 'selector', type: 'bytes4' },
			{ name: 'reason', type: 'bytes' },
			{ name: 'details', type: 'bytes' },
		],
	},
] as const

const SWAPPER_NOT_VERIFIED_ABI = [
	{
		type: 'error',
		name: 'SwapperNotVerified',
		inputs: [{ name: 'swapper', type: 'address' }],
	},
] as const

// Minimal v4-periphery PoolSwapTest ABI — hand-copied for the two struct
// params it needs (PoolKey, SwapParams) plus TestSettings + hookData.
const POOL_SWAP_TEST_ABI = [
	...WRAPPED_ERROR_ABI,
	...SWAPPER_NOT_VERIFIED_ABI,
	{
		type: 'function',
		name: 'swap',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'key',
				type: 'tuple',
				components: [
					{ name: 'currency0', type: 'address' },
					{ name: 'currency1', type: 'address' },
					{ name: 'fee', type: 'uint24' },
					{ name: 'tickSpacing', type: 'int24' },
					{ name: 'hooks', type: 'address' },
				],
			},
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'zeroForOne', type: 'bool' },
					{ name: 'amountSpecified', type: 'int256' },
					{ name: 'sqrtPriceLimitX96', type: 'uint160' },
				],
			},
			{
				name: 'testSettings',
				type: 'tuple',
				components: [
					{ name: 'takeClaims', type: 'bool' },
					{ name: 'settleUsingBurn', type: 'bool' },
				],
			},
			{ name: 'hookData', type: 'bytes' },
		],
		outputs: [
			{
				name: 'delta',
				type: 'int256',
			},
		],
	},
] as const

const POOL_KEY = {
	currency0: (TOKEN_A < TOKEN_B ? TOKEN_A : TOKEN_B) as Hex,
	currency1: (TOKEN_A < TOKEN_B ? TOKEN_B : TOKEN_A) as Hex,
	fee: 3000,
	tickSpacing: 60,
	hooks: HOOK_ADDRESS as Hex,
}

const SWAP_PARAMS = {
	zeroForOne: true,
	amountSpecified: -1_000_000_000_000_000n, // -1e15
	sqrtPriceLimitX96: 4295128740n,
}

const TEST_SETTINGS = { takeClaims: false, settleUsingBurn: false }

/** wallet → `<label>` for the ENSv2 subname (first 8 hex chars, lowercased). */
export function passportLabel(wallet: string): string {
	return wallet.slice(2, 10).toLowerCase()
}

function minterAccount() {
	const env = hackathonEnv()
	const key = env.ENS_MINTER_PRIVATE_KEY
	if (!key) throw new Error('ens_minter_key_not_configured')
	const privateKey = key.trim().startsWith('0x') ? key.trim() : `0x${key.trim()}`
	return privateKeyToAccount(privateKey as Hex)
}

function publicClient(): PublicClient {
	const env = hackathonEnv()
	return createPublicClient({ chain: sepolia, transport: http(env.ENS_SEPOLIA_RPC_URL) })
}

function walletClient(): WalletClient {
	const env = hackathonEnv()
	return createWalletClient({
		account: minterAccount(),
		chain: sepolia,
		transport: http(env.ENS_SEPOLIA_RPC_URL),
	})
}

function ensSubnameConfig(): EnsSubnameConfig {
	const env = hackathonEnv()
	return {
		rpcUrl: env.ENS_SEPOLIA_RPC_URL,
		minterPrivateKey: env.ENS_MINTER_PRIVATE_KEY,
		subregistryAddress: env.ENS_SUWAPPU_AGENTS_SUBREGISTRY,
		resolverAddress: env.ENS_RESOLVER_ADDRESS,
		parentName: PARENT_NAME,
	}
}

export interface PassportReadResult {
	wallet: string
	label: string
	ensName: string
	ensResolvesToWallet: boolean
	hookAllowlisted: boolean
	/** Resolver address registered for `ensName`, when cheaply readable via
	 * UniversalResolverV2 (omitted on resolution failure). */
	resolver?: string
}

/**
 * Read-only chain state for a wallet's passport. Works from chain reads
 * alone — no in-memory dependency — so it survives a process restart.
 */
export async function readPassport(wallet: string): Promise<PassportReadResult> {
	const label = passportLabel(wallet)
	const ensName = `${label}.${PARENT_NAME}`
	const client = publicClient()

	const [resolved, allowlisted] = await Promise.all([
		resolveAddressWithResolver(client, ensName).catch(() => ({ address: null, resolver: null })),
		client
			.readContract({ address: HOOK_ADDRESS, abi: HOOK_ABI, functionName: 'isWorldIdVerified', args: [wallet as Hex] })
			.catch(() => false),
	])

	return {
		wallet,
		label,
		ensName,
		ensResolvesToWallet: Boolean(resolved.address && resolved.address.toLowerCase() === wallet.toLowerCase()),
		hookAllowlisted: Boolean(allowlisted),
		...(resolved.resolver ? { resolver: resolved.resolver } : {}),
	}
}

/**
 * Idempotent: sets `addr(namehash(ensName))` on the minter-owned
 * PassportResolver (ENS_RESOLVER_ADDRESS) to `wallet`, skipping the write if
 * it already resolves there. Never throws — a setAddr failure is a
 * nice-to-have identity-resolution miss, never a gate on the caller's flow.
 * Returns the tx hash on a fresh write, or null if skipped/unconfigured/failed.
 */
export async function setPassportAddr(ensName: string, wallet: string): Promise<string | null> {
	const env = hackathonEnv()
	const resolverAddress = env.ENS_RESOLVER_ADDRESS
	if (!resolverAddress || !isAddress(resolverAddress)) return null
	try {
		const node = namehash(ensName)
		const client = publicClient()
		const current = await client
			.readContract({ address: resolverAddress as Hex, abi: RESOLVER_ABI, functionName: 'addr', args: [node] })
			.catch(() => '0x0000000000000000000000000000000000000000' as Hex)
		if (current.toLowerCase() === wallet.toLowerCase()) return null
		const wc = walletClient()
		const account = minterAccount()
		const { request } = await client.simulateContract({
			address: resolverAddress as Hex,
			abi: RESOLVER_ABI,
			functionName: 'setAddr',
			args: [node, wallet as Hex],
			account,
		})
		const txHash = await wc.writeContract(request)
		await client.waitForTransactionReceipt({ hash: txHash })
		return txHash
	} catch (e) {
		logger.warn('[hackathon] passport setAddr failed for %s (%s): %s', wallet, ensName, String(e))
		return null
	}
}

export interface ProvisionResult {
	ens: { name: string; txHash: string | null; existing: boolean; addrTx: string | null }
	hook: { allowlistTx: string | null; existing: boolean }
}

/**
 * Idempotent provisioning: mint the ENS subname and/or flip the hook
 * allowlist only if not already done. Safe to call repeatedly (e.g. on
 * nullifier replay / restart-then-retry).
 *
 * When the name is freshly minted, or already exists but doesn't resolve to
 * the wallet AND its registered resolver is our owned PassportResolver
 * (ENS_RESOLVER_ADDRESS), also calls setAddr(node, wallet) on the resolver
 * from the minter wallet — the actual fix that makes the name resolve. Names
 * still pointed at the old PublicResolverV2 (minted before this fix) can't
 * be repaired this way: only the name owner can change a name's resolver,
 * and the minter isn't that owner.
 */
export async function provisionPassport(wallet: string): Promise<ProvisionResult> {
	const label = passportLabel(wallet)
	const ensName = `${label}.${PARENT_NAME}`
	const before = await readPassport(wallet)

	let ensTxHash: string | null = null
	const ensExisting = before.ensResolvesToWallet
	if (!ensExisting) {
		const res = await mintAgentSubname(ensSubnameConfig(), label, wallet)
		if (!res.minted) {
			logger.warn('[hackathon] passport ENS mint failed for %s: %s', wallet, res.error)
			throw new Error(res.error ?? 'ens_mint_failed')
		}
		ensTxHash = res.txHash ?? null
	}

	const env = hackathonEnv()
	const resolverAddress = env.ENS_RESOLVER_ADDRESS
	const usesOwnedResolver =
		!ensExisting || (before.resolver && before.resolver.toLowerCase() === resolverAddress?.toLowerCase())
	const addrTx = usesOwnedResolver ? await setPassportAddr(ensName, wallet) : null

	let allowlistTx: string | null = null
	const hookExisting = before.hookAllowlisted
	if (!hookExisting) {
		const client = publicClient()
		const wc = walletClient()
		const account = minterAccount()
		const { request } = await client.simulateContract({
			address: HOOK_ADDRESS,
			abi: HOOK_ABI,
			functionName: 'setWorldIdVerified',
			args: [wallet as Hex, true],
			account,
		})
		const txHash = await wc.writeContract(request)
		await client.waitForTransactionReceipt({ hash: txHash })
		allowlistTx = txHash
	}

	return {
		ens: { name: ensName, txHash: ensTxHash, existing: ensExisting, addrTx },
		hook: { allowlistTx, existing: hookExisting },
	}
}

export type SwapResult =
	| { status: 'blocked'; reason: 'SwapperNotVerified'; detail: string }
	| {
			status: 'executed'
			txHash: string
			blockNumber: number
			executedBy: string
			swapper: string
	  }

export type SimulateBlocked = { status: 'blocked'; reason: 'SwapperNotVerified'; detail: string }

/**
 * Simulate the hooked swap for `wallet` — free, no gas, no tx. Returns the
 * blocked outcome directly (safe to call inline in a request handler), or
 * `null` when the simulate succeeds, meaning the caller should proceed to
 * `sendSimulatedSwap`.
 */
async function simulateSwap(
	wallet: string,
): Promise<{ blocked: null; request: unknown } | { blocked: SimulateBlocked; request: null }> {
	if (!isAddress(wallet)) throw new Error('invalid_wallet_address')
	const client = publicClient()
	const account = minterAccount()
	const hookData = encodeSwapperHookData(wallet as Hex)

	try {
		const { request } = await client.simulateContract({
			address: POOL_SWAP_TEST_ADDRESS,
			abi: POOL_SWAP_TEST_ABI,
			functionName: 'swap',
			args: [POOL_KEY, SWAP_PARAMS, TEST_SETTINGS, hookData],
			account,
		})
		return { blocked: null, request }
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		// v4-core's CustomRevert wraps hook reverts in WrappedError(...), whose
		// `reason` bytes carry our hook's raw revert data — selector
		// 0x87042740 = keccak256("SwapperNotVerified(address)")[:4]. viem's
		// error message doesn't decode that inner layer (it's opaque bytes to
		// the ABI), so match on the selector rather than the error name.
		if (message.includes('SwapperNotVerified') || message.includes('0x87042740')) {
			return {
				blocked: { status: 'blocked', reason: 'SwapperNotVerified', detail: message.slice(0, 300) },
				request: null,
			}
		}
		throw e
	}
}

/**
 * Attempt a swap through the hooked pool on behalf of `wallet`. Simulates
 * first (free — no gas, no tx) so an unverified wallet is rejected without
 * spending anything; only sends the transaction once the simulate succeeds.
 * Combines simulate+send+wait — callers that need the blocked outcome
 * synchronously (e.g. the /passport/swap route) should use
 * `simulateSwapThroughHook` + `sendSwapThroughHook` instead so the send/wait
 * can run in the background.
 */
export async function swapThroughHook(wallet: string): Promise<SwapResult> {
	const sim = await simulateSwap(wallet)
	if (sim.blocked) return sim.blocked
	return sendSwap(wallet, sim.request)
}

/** Sync-safe half of `swapThroughHook`: simulate only, no tx sent. */
export async function simulateSwapThroughHook(wallet: string): Promise<SimulateBlocked | { blocked: false }> {
	const sim = await simulateSwap(wallet)
	return sim.blocked ? sim.blocked : { blocked: false }
}

/** Async half of `swapThroughHook`: re-simulates (viem's `request` isn't
 * serializable across a request/response boundary) then sends + waits.
 * Intended to run in a background job after `simulateSwapThroughHook`
 * already confirmed the swap won't be blocked. */
export async function sendSwapThroughHook(wallet: string): Promise<SwapResult> {
	const sim = await simulateSwap(wallet)
	if (sim.blocked) return sim.blocked
	return sendSwap(wallet, sim.request)
}

async function sendSwap(wallet: string, request: unknown): Promise<SwapResult> {
	const client = publicClient()
	const account = minterAccount()
	const wc = walletClient()
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const txHash = await wc.writeContract(request as any)
	const receipt = await client.waitForTransactionReceipt({ hash: txHash })
	return {
		status: 'executed',
		txHash,
		blockNumber: Number(receipt.blockNumber),
		executedBy: account.address,
		swapper: wallet,
	}
}

function encodeSwapperHookData(swapper: Hex): Hex {
	// abi.encode(address) — 32-byte left-padded slot.
	return `0x${'0'.repeat(24)}${swapper.slice(2).toLowerCase()}` as Hex
}

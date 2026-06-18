/**
 * Smart-account send-path verification harness.
 *
 * Two modes:
 *
 *  1. NO bundler key (default): builds a Kernel account on a live chain, encodes
 *     a 0-value self-call, fetches the nonce + factory args, signs the
 *     UserOperation, and computes its hash. This proves the entire
 *     build/encode/sign/hash pipeline against real chain state — everything
 *     except the bundler submission. No funds required.
 *
 *  2. WITH bundler key (BUNDLER_RPC_URL set): additionally submits the
 *     UserOperation through the bundler and waits for the receipt — the full
 *     end-to-end send. Requires SA_TEST_PRIVATE_KEY to control a smart account
 *     that either holds native gas or is covered by the bundler's paymaster.
 *
 * Usage:
 *   # Build + sign only (works today, no key):
 *   bun run scripts/verify-smart-account-send.ts
 *
 *   # Full send on Base Sepolia (needs a key + a funded/sponsored account):
 *   SA_CHAIN_ID=84532 \
 *   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org \
 *   BUNDLER_RPC_URL="https://api.pimlico.io/v2/84532/rpc?apikey=YOUR_KEY" \
 *   SA_TEST_PRIVATE_KEY=0x... \
 *   bun run scripts/verify-smart-account-send.ts
 */

import { type Address, createPublicClient, type Hex, http } from 'viem'
import {
	entryPoint07Address,
	getUserOperationHash,
	type UserOperation,
} from 'viem/account-abstraction'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, baseSepolia, bsc, mainnet, optimism, polygon, sepolia } from 'viem/chains'
import { toKernelSmartAccount } from 'permissionless/accounts'
import { createSmartAccountClient } from 'permissionless'

// Must match SmartAccountService.
const ENTRY_POINT = { address: entryPoint07Address, version: '0.7' } as const
const KERNEL_VERSION = '0.3.1' as const

const CHAINS: Record<number, { chain: any; rpc: string }> = {
	1: { chain: mainnet, rpc: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com' },
	10: { chain: optimism, rpc: process.env.OPTIMISM_RPC_URL || 'https://optimism.llamarpc.com' },
	56: { chain: bsc, rpc: process.env.BSC_RPC_URL || 'https://bsc.llamarpc.com' },
	137: { chain: polygon, rpc: process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com' },
	8453: { chain: base, rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org' },
	42161: { chain: arbitrum, rpc: process.env.ARBITRUM_RPC_URL || 'https://arbitrum.llamarpc.com' },
	84532: { chain: baseSepolia, rpc: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org' },
	11155111: { chain: sepolia, rpc: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com' },
}

async function main() {
	const chainId = Number(process.env.SA_CHAIN_ID || 8453)
	const entry = CHAINS[chainId]
	if (!entry) {
		throw new Error(`Unsupported SA_CHAIN_ID ${chainId}. Try one of ${Object.keys(CHAINS).join(', ')}`)
	}
	const { chain, rpc } = entry

	const privateKey = (process.env.SA_TEST_PRIVATE_KEY as Hex) || generatePrivateKey()
	const owner = privateKeyToAccount(privateKey)
	const usingThrowaway = !process.env.SA_TEST_PRIVATE_KEY

	console.log(`Chain:        ${chain.name} (${chainId})`)
	console.log(`RPC:          ${rpc}`)
	console.log(`Owner EOA:    ${owner.address}${usingThrowaway ? ' (throwaway, generated)' : ''}`)

	const publicClient = createPublicClient({ chain, transport: http(rpc) })
	const account = await toKernelSmartAccount({
		client: publicClient,
		owners: [owner],
		entryPoint: ENTRY_POINT,
		version: KERNEL_VERSION,
	})
	console.log(`Smart acct:   ${account.address}`)

	// ── Phase 1: build + sign (no bundler) ──────────────────────────────────
	const callData = await account.encodeCalls([
		{ to: account.address as Address, value: 0n, data: '0x' },
	])
	const nonce = await account.getNonce()
	const { factory, factoryData } = await account.getFactoryArgs()
	const code = await publicClient.getCode({ address: account.address })
	const isDeployed = !!code && code !== '0x'

	// Assemble a UserOperation with placeholder gas (bundler would estimate these).
	const userOperation = {
		sender: account.address,
		nonce,
		...(isDeployed ? {} : { factory, factoryData }),
		callData,
		callGasLimit: 200_000n,
		verificationGasLimit: 500_000n,
		preVerificationGas: 60_000n,
		maxFeePerGas: 1_000_000_000n,
		maxPriorityFeePerGas: 1_000_000_000n,
		signature: '0x' as Hex,
	} as unknown as UserOperation<'0.7'>

	const signature = await account.signUserOperation(userOperation)
	const userOpHash = getUserOperationHash({
		chainId,
		entryPointAddress: ENTRY_POINT.address,
		entryPointVersion: ENTRY_POINT.version,
		userOperation: { ...userOperation, signature },
	})

	console.log('\n── Build + sign pipeline ──')
	console.log(`callData:     ${callData.slice(0, 26)}… (${(callData.length - 2) / 2} bytes)`)
	console.log(`nonce:        ${nonce}`)
	console.log(`isDeployed:   ${isDeployed}`)
	console.log(`factory:      ${factory ?? '(already deployed)'}`)
	console.log(`signature:    ${signature.slice(0, 26)}… (${(signature.length - 2) / 2} bytes)`)
	console.log(`userOpHash:   ${userOpHash}`)
	if (!signature || signature.length < 4) throw new Error('signing produced an empty signature')
	console.log('✅ BUILD+SIGN OK — account, encode, nonce, factory, sign, hash all succeeded.')

	// ── Phase 2: full send (needs bundler) ──────────────────────────────────
	const bundlerUrl = process.env.BUNDLER_RPC_URL
	if (!bundlerUrl) {
		console.log('\nℹ️  BUNDLER_RPC_URL not set — skipping on-chain submission.')
		console.log('   Provide a bundler key + a funded/sponsored SA_TEST_PRIVATE_KEY to send for real.')
		return
	}

	console.log('\n── Submitting UserOperation via bundler ──')
	const smartAccountClient = createSmartAccountClient({
		account,
		chain,
		bundlerTransport: http(bundlerUrl),
		userOperation: {
			estimateFeesPerGas: async () => {
				const fees = await publicClient.estimateFeesPerGas()
				return {
					maxFeePerGas: fees.maxFeePerGas,
					maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
				}
			},
		},
	})
	const hash = await smartAccountClient.sendUserOperation({
		calls: [{ to: account.address as Address, value: 0n, data: '0x' }],
	})
	console.log(`userOpHash (submitted): ${hash}`)
	const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash })
	console.log(`✅ SENT — tx ${receipt.receipt.transactionHash} (success=${receipt.success})`)
}

main().catch((e) => {
	console.error(`❌ ${e instanceof Error ? e.message : String(e)}`)
	process.exit(1)
})

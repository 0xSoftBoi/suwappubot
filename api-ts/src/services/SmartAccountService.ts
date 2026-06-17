import { Context, Effect, Layer } from 'effect'
import { type Address, type Chain, type Hex, createPublicClient, http } from 'viem'
import { entryPoint07Address } from 'viem/account-abstraction'
import { privateKeyToAccount, toAccount } from 'viem/accounts'
import { arbitrum, base, bsc, mainnet, optimism, polygon } from 'viem/chains'
import { toKernelSmartAccount } from 'permissionless/accounts'
import { createSmartAccountClient } from 'permissionless'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { EnvService } from '../config/EnvService'
import { getRpcUrl } from '../config/chains'
import { ExternalServiceError, ValidationError } from '../errors'

// EntryPoint v0.7 + Kernel v0.3.1 — the audited ZeroDev Kernel account driven
// by permissionless.js (MIT). We deliberately do NOT hand-roll UserOperation
// construction or signing; that lives in the audited library.
const ENTRY_POINT = { address: entryPoint07Address, version: '0.7' } as const
const KERNEL_VERSION = '0.3.1' as const

// Chains where the Kernel v0.3.1 factory + EntryPoint v0.7 are deployed AND
// Suwappu already has an RPC endpoint (see config/chains.ts). Internal chainId
// → viem Chain object.
const SUPPORTED_CHAINS: Record<number, Chain> = {
	1: mainnet,
	10: optimism,
	56: bsc,
	137: polygon,
	8453: base,
	42161: arbitrum,
}

export const SUPPORTED_SMART_ACCOUNT_CHAIN_IDS: number[] = Object.keys(SUPPORTED_CHAINS).map(Number)

/** Resolve an internal chainId to its viem Chain, or null if unsupported. */
export function resolveViemChain(chainId: number): Chain | null {
	return SUPPORTED_CHAINS[chainId] ?? null
}

export interface SmartAccountConfig {
	readonly enabled: boolean
	readonly entryPointAddress: Address
	readonly entryPointVersion: string
	readonly kernelVersion: string
	readonly supportedChainIds: number[]
}

export interface PredictAddressParams {
	readonly chainId: number
	readonly owner: Address
}

export interface PredictAddressResult {
	readonly chainId: number
	readonly owner: Address
	readonly smartAccountAddress: Address
	readonly isDeployed: boolean
}

export interface SmartAccountCall {
	readonly to: Address
	readonly value?: bigint
	readonly data?: Hex
}

export interface SendUserOperationParams {
	readonly chainId: number
	readonly ownerPrivateKey: Hex
	readonly calls: ReadonlyArray<SmartAccountCall>
}

export interface SendUserOperationResult {
	readonly userOpHash: Hex
	readonly txHash: Hex
	readonly smartAccountAddress: Address
}

export interface SmartAccountServiceInterface {
	/** Static capability descriptor — what's deployed and whether sending is enabled. */
	readonly getConfig: () => Effect.Effect<SmartAccountConfig>
	/**
	 * Counterfactual Kernel address for `owner` on `chainId`, plus whether it is
	 * already deployed on-chain. Read-only: available on any supported chain with
	 * an RPC, independent of SMART_ACCOUNT_ENABLED.
	 */
	readonly predictAddress: (
		params: PredictAddressParams,
	) => Effect.Effect<PredictAddressResult, ValidationError | ExternalServiceError>
	/**
	 * Build, sign, and submit a UserOperation from the owner's smart account via
	 * the configured bundler, returning once it is mined. Requires
	 * SMART_ACCOUNT_ENABLED=true and BUNDLER_RPC_URL.
	 */
	readonly sendUserOperation: (
		params: SendUserOperationParams,
	) => Effect.Effect<SendUserOperationResult, ValidationError | ExternalServiceError>
}

export class SmartAccountService extends Context.Tag('SmartAccountService')<
	SmartAccountService,
	SmartAccountServiceInterface
>() {}

export const SmartAccountServiceLive = Layer.effect(
	SmartAccountService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const bundlerUrl = env.BUNDLER_RPC_URL
		const sendEnabled = env.SMART_ACCOUNT_ENABLED === 'true' && !!bundlerUrl

		// A non-signing owner built from an address alone, used for read-only
		// address derivation. The Kernel address is a CREATE2 function of the
		// owner's address, so prediction never needs the private key.
		const predictOnlyOwner = (address: Address) =>
			toAccount({
				address,
				async signMessage() {
					throw new Error('prediction-only account cannot sign')
				},
				async signTransaction() {
					throw new Error('prediction-only account cannot sign')
				},
				async signTypedData() {
					throw new Error('prediction-only account cannot sign')
				},
			})

		return {
			getConfig: () =>
				Effect.succeed({
					enabled: sendEnabled,
					entryPointAddress: ENTRY_POINT.address,
					entryPointVersion: ENTRY_POINT.version,
					kernelVersion: KERNEL_VERSION,
					supportedChainIds: SUPPORTED_SMART_ACCOUNT_CHAIN_IDS,
				}),

			predictAddress: ({ chainId, owner }) =>
				Effect.gen(function* () {
					const chain = resolveViemChain(chainId)
					const rpcUrl = getRpcUrl(chainId)
					if (!chain || !rpcUrl) {
						return yield* Effect.fail(
							new ValidationError({
								message: `Smart accounts are not supported on chain ${chainId}`,
								fields: { chainId: 'unsupported' },
							}),
						)
					}

					return yield* Effect.tryPromise({
						try: async () => {
							const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
							const account = await toKernelSmartAccount({
								client: publicClient,
								owners: [predictOnlyOwner(owner)],
								entryPoint: ENTRY_POINT,
								version: KERNEL_VERSION,
							})
							const code = await publicClient.getCode({ address: account.address })
							return {
								chainId,
								owner,
								smartAccountAddress: account.address,
								isDeployed: !!code && code !== '0x',
							}
						},
						catch: (e) =>
							new ExternalServiceError({
								message: `Failed to derive smart-account address: ${e instanceof Error ? e.message : String(e)}`,
								service: 'permissionless',
								cause: e,
							}),
					})
				}),

			sendUserOperation: ({ chainId, ownerPrivateKey, calls }) =>
				Effect.gen(function* () {
					if (!sendEnabled || !bundlerUrl) {
						return yield* Effect.fail(
							new ValidationError({
								message:
									'Smart-account sending is disabled. Set SMART_ACCOUNT_ENABLED=true and BUNDLER_RPC_URL.',
							}),
						)
					}
					const chain = resolveViemChain(chainId)
					const rpcUrl = getRpcUrl(chainId)
					if (!chain || !rpcUrl) {
						return yield* Effect.fail(
							new ValidationError({
								message: `Smart accounts are not supported on chain ${chainId}`,
								fields: { chainId: 'unsupported' },
							}),
						)
					}
					if (calls.length === 0) {
						return yield* Effect.fail(
							new ValidationError({ message: 'At least one call is required' }),
						)
					}

					return yield* Effect.tryPromise({
						try: async () => {
							const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
							const owner = privateKeyToAccount(ownerPrivateKey)
							const account = await toKernelSmartAccount({
								client: publicClient,
								owners: [owner],
								entryPoint: ENTRY_POINT,
								version: KERNEL_VERSION,
							})
							const pimlicoClient = createPimlicoClient({
								transport: http(bundlerUrl),
								entryPoint: ENTRY_POINT,
							})
							const smartAccountClient = createSmartAccountClient({
								account,
								chain,
								bundlerTransport: http(bundlerUrl),
								userOperation: {
									estimateFeesPerGas: async () =>
										(await pimlicoClient.getUserOperationGasPrice()).fast,
								},
							})
							const userOpHash = await smartAccountClient.sendUserOperation({
								calls: calls.map((call) => ({
									to: call.to,
									value: call.value ?? 0n,
									data: call.data ?? '0x',
								})),
							})
							const receipt = await smartAccountClient.waitForUserOperationReceipt({
								hash: userOpHash,
							})
							return {
								userOpHash,
								txHash: receipt.receipt.transactionHash,
								smartAccountAddress: account.address,
							}
						},
						catch: (e) =>
							new ExternalServiceError({
								message: `UserOperation failed: ${e instanceof Error ? e.message : String(e)}`,
								service: 'bundler',
								cause: e,
							}),
					})
				}),
		}
	}),
)

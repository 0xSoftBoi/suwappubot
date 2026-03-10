import { Turnkey } from '@turnkey/sdk-server'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../config/EnvService'

export interface TurnkeyWallet {
	subOrgId: string
	walletId: string
	accountId: string
	address: string
}

export interface TurnkeyServiceInterface {
	readonly createSubOrgForTelegramUser: (
		telegramUserId: number,
		userName?: string,
	) => Effect.Effect<TurnkeyWallet, Error>
	readonly createSubOrgWithOAuth: (
		provider: string,
		oauthToken: string,
		telegramUserId: string
	) => Effect.Effect<TurnkeyWallet, Error>
	readonly signTransactionForAgent: (
		subOrgId: string,
		unsignedTransaction: string,
		signWith: string,
		chainType: 'evm' | 'solana'
	) => Effect.Effect<string, Error>
	readonly createAgentWallet: (
		agentId: number,
		chainType: 'evm' | 'solana'
	) => Effect.Effect<TurnkeyWallet, Error>
	readonly createPolicy: (
		subOrgId: string,
		policyName: string,
		effect: string,
		condition: string,
	) => Effect.Effect<string, Error>
	readonly listPolicies: (
		subOrgId: string,
	) => Effect.Effect<Array<{ policyId: string; policyName: string; effect: string; condition: string }>, Error>
	readonly deletePolicy: (
		subOrgId: string,
		policyId: string,
	) => Effect.Effect<boolean, Error>
}

export class TurnkeyService extends Context.Tag('TurnkeyService')<
	TurnkeyService,
	TurnkeyServiceInterface
>() {}

export const TurnkeyServiceLive = Layer.effect(
	TurnkeyService,
	Effect.gen(function* () {
		const env = yield* EnvService

		const turnkeyClient = new Turnkey({
			apiBaseUrl: env.TURNKEY_BASE_URL || 'https://api.turnkey.com',
			apiPublicKey: env.TURNKEY_API_PUBLIC_KEY || '',
			apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY || '',
			defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID || '',
		})

		const createSubOrgForTelegramUser = (telegramUserId: number, userName?: string) =>
			Effect.gen(function* () {
				if (
					!env.TURNKEY_API_PUBLIC_KEY ||
					!env.TURNKEY_API_PRIVATE_KEY ||
					!env.TURNKEY_ORGANIZATION_ID
				) {
					return yield* Effect.fail(new Error('Turnkey credentials not configured'))
				}

				const subOrgName = userName
					? `telegram-${telegramUserId}-${userName}`
					: `telegram-${telegramUserId}`

				// Create sub-organization with a wallet
				const createSubOrgResult = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().createSubOrganization({
							organizationId: env.TURNKEY_ORGANIZATION_ID!,
							subOrganizationName: subOrgName,
							rootUsers: [],
							rootQuorumThreshold: 1,
							wallet: {
								walletName: 'Default Wallet',
								accounts: [
									{
										curve: 'CURVE_SECP256K1',
										pathFormat: 'PATH_FORMAT_BIP32',
										path: "m/44'/60'/0'/0/0",
										addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
									},
								],
							},
						})
						return response
					},
					catch: (err) => new Error(`Failed to create sub-org: ${err}`),
				})

				const subOrgId = createSubOrgResult.subOrganizationId
				const wallet = createSubOrgResult.wallet

				if (!wallet || !wallet.walletId || !wallet.addresses || wallet.addresses.length === 0) {
					return yield* Effect.fail(new Error('Wallet creation failed - no wallet returned'))
				}

				// addresses is an array of address strings
				const address = wallet.addresses[0]

				return {
					subOrgId,
					walletId: wallet.walletId,
					accountId: wallet.walletId, // Use walletId as accountId for now
					address,
				}
			})

		const createSubOrgWithOAuth = (provider: string, oauthToken: string, telegramUserId: string) =>
			Effect.gen(function* () {
				if (!env.TURNKEY_API_PUBLIC_KEY || !env.TURNKEY_API_PRIVATE_KEY || !env.TURNKEY_ORGANIZATION_ID) {
					return yield* Effect.fail(new Error('Turnkey credentials not configured'))
				}

				const createSubOrgResult = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().createSubOrganization({
							organizationId: env.TURNKEY_ORGANIZATION_ID!,
							subOrganizationName: `suwappu-${telegramUserId}-oauth`,
							rootUsers: [{
								userName: `user-${telegramUserId}`,
								apiKeys: [],
								authenticators: [],
								oauthProviders: [{
									providerName: provider,
									oidcToken: oauthToken,
								}],
							}],
							rootQuorumThreshold: 1,
							wallet: {
								walletName: `wallet-${telegramUserId}`,
								accounts: [
									{
										curve: 'CURVE_SECP256K1',
										pathFormat: 'PATH_FORMAT_BIP32',
										path: "m/44'/60'/0'/0/0",
										addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
									},
								],
							},
						})
						return response
					},
					catch: (err) => new Error(`Failed to create OAuth sub-org: ${err}`),
				})

				const subOrgId = createSubOrgResult.subOrganizationId
				const wallet = createSubOrgResult.wallet

				if (!wallet || !wallet.walletId || !wallet.addresses || wallet.addresses.length === 0) {
					return yield* Effect.fail(new Error('OAuth wallet creation failed - no wallet returned'))
				}

				const address = wallet.addresses[0]

				return {
					subOrgId,
					walletId: wallet.walletId,
					accountId: wallet.walletId,
					address,
				}
			})

		const signTransactionForAgent = (
			subOrgId: string,
			unsignedTransaction: string,
			signWith: string,
			chainType: 'evm' | 'solana'
		) =>
			Effect.gen(function* () {
				const transactionType = chainType === 'solana'
					? 'TRANSACTION_TYPE_SOLANA'
					: 'TRANSACTION_TYPE_ETHEREUM'

				const signResult = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().signTransaction({
							organizationId: subOrgId,
							signWith,
							unsignedTransaction,
							type: transactionType,
						})
						return response
					},
					catch: (err) => new Error(`Failed to sign transaction: ${err}`),
				})

				return signResult.signedTransaction
			})

		const createAgentWallet = (agentId: number, chainType: 'evm' | 'solana') =>
			Effect.gen(function* () {
				if (!env.TURNKEY_API_PUBLIC_KEY || !env.TURNKEY_API_PRIVATE_KEY || !env.TURNKEY_ORGANIZATION_ID) {
					return yield* Effect.fail(new Error('Turnkey credentials not configured'))
				}

				const isEvm = chainType === 'evm'
				const subOrgName = `agent-${agentId}-${chainType}`

				const createSubOrgResult = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().createSubOrganization({
							organizationId: env.TURNKEY_ORGANIZATION_ID!,
							subOrganizationName: subOrgName,
							rootUsers: [],
							rootQuorumThreshold: 1,
							wallet: {
								walletName: `agent-${agentId}-wallet`,
								accounts: [
									isEvm
										? {
											curve: 'CURVE_SECP256K1',
											pathFormat: 'PATH_FORMAT_BIP32',
											path: "m/44'/60'/0'/0/0",
											addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
										}
										: {
											curve: 'CURVE_ED25519',
											pathFormat: 'PATH_FORMAT_BIP32',
											path: "m/44'/501'/0'/0'",
											addressFormat: 'ADDRESS_FORMAT_SOLANA',
										},
								],
							},
						})
						return response
					},
					catch: (err) => new Error(`Failed to create agent wallet: ${err}`),
				})

				const subOrgId = createSubOrgResult.subOrganizationId
				const wallet = createSubOrgResult.wallet

				if (!wallet || !wallet.walletId || !wallet.addresses || wallet.addresses.length === 0) {
					return yield* Effect.fail(new Error('Agent wallet creation failed - no wallet returned'))
				}

				const address = wallet.addresses[0]

				return {
					subOrgId,
					walletId: wallet.walletId,
					accountId: wallet.walletId,
					address,
				}
			})

		const createPolicy = (
			subOrgId: string,
			policyName: string,
			policyEffect: string,
			condition: string,
		) =>
			Effect.gen(function* () {
				const result = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().createPolicy({
							organizationId: subOrgId,
							policyName,
							effect: policyEffect as 'EFFECT_ALLOW' | 'EFFECT_DENY',
							condition,
							notes: `Created via Suwappu Agent API`,
						})
						return response
					},
					catch: (err) => new Error(`Failed to create policy: ${err}`),
				})

				return result.policyId
			})

		const listPolicies = (subOrgId: string) =>
			Effect.gen(function* () {
				const result = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().getPolicies({
							organizationId: subOrgId,
						})
						return response
					},
					catch: (err) => new Error(`Failed to list policies: ${err}`),
				})

				return (result.policies || []).map((p: any) => ({
					policyId: p.policyId,
					policyName: p.policyName,
					effect: p.effect,
					condition: p.condition,
				}))
			})

		const deletePolicy = (subOrgId: string, policyId: string) =>
			Effect.gen(function* () {
				yield* Effect.tryPromise({
					try: async () => {
						await turnkeyClient.apiClient().deletePolicy({
							organizationId: subOrgId,
							policyId,
						})
					},
					catch: (err) => new Error(`Failed to delete policy: ${err}`),
				})

				return true
			})

		return {
			createSubOrgForTelegramUser,
			createSubOrgWithOAuth,
			signTransactionForAgent,
			createAgentWallet,
			createPolicy,
			listPolicies,
			deletePolicy,
		}
	})
)

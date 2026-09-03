import { Turnkey } from '@turnkey/sdk-server'
import { Context, Effect, Layer } from 'effect'
import { EnvService } from '../config/EnvService'

export interface TurnkeyWallet {
	subOrgId: string
	walletId: string
	accountId: string
	address: string
}

export interface RawSignatureResult {
	r: string
	s: string
	v: string
	signature: string
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
	readonly createSubOrgWithPasskey: (
		userName: string,
		telegramUserId: string | number,
		attestation: {
			credentialId: string
			attestationObject: string
			clientDataJson: string
			transports?: string[]
		},
		challenge: string,
	) => Effect.Effect<TurnkeyWallet, Error>
	readonly createWalletInSubOrg: (
		subOrgId: string,
		chainType: 'evm' | 'solana',
	) => Effect.Effect<TurnkeyWallet, Error>
	readonly signTransactionForAgent: (
		subOrgId: string,
		unsignedTransaction: string,
		signWith: string,
		chainType: 'evm' | 'solana'
	) => Effect.Effect<string, Error>
	readonly signRawPayload: (
		subOrgId: string,
		payload: string,
		signWith: string,
		hashFunction: 'HASH_FUNCTION_NO_OP' | 'HASH_FUNCTION_SHA256' | 'HASH_FUNCTION_KECCAK256',
		encoding: 'PAYLOAD_ENCODING_HEXADECIMAL' | 'PAYLOAD_ENCODING_TEXT_UTF8'
	) => Effect.Effect<RawSignatureResult, Error>
	readonly createAgentWallet: (
		agentId: number,
		chainType: 'evm' | 'solana'
	) => Effect.Effect<TurnkeyWallet, Error>
	readonly verifyAgentWallet: (
		agentId: number,
		subOrgId: string,
		address: string,
		chainType: 'evm' | 'solana',
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

type AgentWalletAttestationApi = {
	getSubOrgIds: (input: {
		organizationId: string
		filterType: string
		filterValue: string
		paginationOptions: { limit: string }
	}) => Promise<{ organizationIds: string[] }>
	getWhoami: (input: { organizationId: string }) => Promise<{
		organizationId: string
		organizationName: string
		username: string
	}>
	getWalletAccounts: (input: { organizationId: string }) => Promise<{
		accounts: Array<{
			walletAccountId: string
			organizationId: string
			walletId: string
			address: string
		}>
	}>
}

/** Attest parent membership, deterministic child identity, and account ownership. */
export async function attestAgentWallet(
	api: AgentWalletAttestationApi,
	parentOrgId: string,
	agentId: number,
	subOrgId: string,
	address: string,
	chainType: 'evm' | 'solana',
): Promise<TurnkeyWallet> {
	const expectedOrgName = `agent-${agentId}-${chainType}`
	const expectedUserName = `agent-${agentId}`
	// Limit two is deliberate: zero is missing and two is ambiguous. Because
	// both fail, a truncated multi-match response can never be accepted.
	const membership = await api.getSubOrgIds({
		organizationId: parentOrgId,
		filterType: 'NAME',
		filterValue: expectedOrgName,
		paginationOptions: { limit: '2' },
	})
	if (membership.organizationIds.length !== 1 || membership.organizationIds[0] !== subOrgId) {
		throw new Error('Turnkey sub-organization is not uniquely owned by the configured parent')
	}

	const [whoami, accounts] = await Promise.all([
		api.getWhoami({ organizationId: subOrgId }),
		api.getWalletAccounts({ organizationId: subOrgId }),
	])
	if (
		whoami.organizationId !== subOrgId ||
		whoami.organizationName !== expectedOrgName ||
		whoami.username !== expectedUserName
	) {
		throw new Error('Turnkey sub-organization does not belong to this agent')
	}
	const account = accounts.accounts.find((candidate) =>
		chainType === 'evm'
			? candidate.address.toLowerCase() === address.toLowerCase()
			: candidate.address === address,
	)
	if (!account || account.organizationId !== subOrgId) {
		throw new Error('Turnkey address does not belong to the claimed sub-organization')
	}
	return {
		subOrgId,
		walletId: account.walletId,
		accountId: account.walletAccountId,
		address: account.address,
	}
}

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
							rootUsers: [
								{
									userName: `user-${telegramUserId}`,
									apiKeys: [
										{
											apiKeyName: `key-${telegramUserId}`,
											publicKey: env.TURNKEY_API_PUBLIC_KEY!,
											curveType: 'API_KEY_CURVE_P256' as const,
										},
									],
									authenticators: [],
									oauthProviders: [],
								},
							],
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
				if (!address) {
					return yield* Effect.fail(new Error('Wallet creation failed - no address returned'))
				}

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
								apiKeys: [
									{
										apiKeyName: `server-key-${telegramUserId}`,
										publicKey: env.TURNKEY_API_PUBLIC_KEY!,
										curveType: 'API_KEY_CURVE_P256' as const,
									},
								],
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
				if (!address) {
					return yield* Effect.fail(new Error('OAuth wallet creation failed - no address returned'))
				}

				return {
					subOrgId,
					walletId: wallet.walletId,
					accountId: wallet.walletId,
					address,
				}
			})

		const createSubOrgWithPasskey = (
			userName: string,
			telegramUserId: string | number,
			attestation: {
				credentialId: string
				attestationObject: string
				clientDataJson: string
				transports?: string[]
			},
			challenge: string,
		) =>
			Effect.gen(function* () {
				if (!env.TURNKEY_API_PUBLIC_KEY || !env.TURNKEY_API_PRIVATE_KEY || !env.TURNKEY_ORGANIZATION_ID) {
					return yield* Effect.fail(new Error('Turnkey credentials not configured'))
				}

				const createSubOrgResult = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().createSubOrganization({
							organizationId: env.TURNKEY_ORGANIZATION_ID!,
							subOrganizationName: `suwappu-${telegramUserId}-passkey`,
							rootUsers: [{
								userName,
								apiKeys: [
									{
										apiKeyName: `server-key-${telegramUserId}`,
										publicKey: env.TURNKEY_API_PUBLIC_KEY!,
										curveType: 'API_KEY_CURVE_P256' as const,
									},
								],
								authenticators: [{
									authenticatorName: 'passkey',
									challenge,
									attestation: {
										credentialId: attestation.credentialId,
										clientDataJson: attestation.clientDataJson,
										attestationObject: attestation.attestationObject,
										transports: (attestation.transports ?? []) as Array<
										'AUTHENTICATOR_TRANSPORT_BLE' |
										'AUTHENTICATOR_TRANSPORT_INTERNAL' |
										'AUTHENTICATOR_TRANSPORT_NFC' |
										'AUTHENTICATOR_TRANSPORT_USB' |
										'AUTHENTICATOR_TRANSPORT_HYBRID'
									>,
									},
								}],
								oauthProviders: [],
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
					catch: (err) => new Error(`Failed to create passkey sub-org: ${err}`),
				})

				const subOrgId = createSubOrgResult.subOrganizationId
				const wallet = createSubOrgResult.wallet

				if (!wallet || !wallet.walletId || !wallet.addresses || wallet.addresses.length === 0) {
					return yield* Effect.fail(new Error('Passkey wallet creation failed - no wallet returned'))
				}

				const address = wallet.addresses[0]
				if (!address) {
					return yield* Effect.fail(new Error('Passkey wallet creation failed - no address returned'))
				}

				return {
					subOrgId,
					walletId: wallet.walletId,
					accountId: wallet.walletId,
					address,
				}
			})

		const createWalletInSubOrg = (subOrgId: string, chainType: 'evm' | 'solana') =>
			Effect.gen(function* () {
				const isEvm = chainType === 'evm'

				const result = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().createWallet({
							organizationId: subOrgId,
							walletName: `wallet-${Date.now()}-${chainType}`,
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
						})
						return response
					},
					catch: (err) => new Error(`Failed to create wallet in sub-org: ${err}`),
				})

				if (!result.walletId || !result.addresses || result.addresses.length === 0) {
					return yield* Effect.fail(new Error('Wallet creation failed - no wallet returned'))
				}

				const address = result.addresses[0]
				if (!address) {
					return yield* Effect.fail(new Error('Wallet creation failed - no address returned'))
				}

				return {
					subOrgId,
					walletId: result.walletId,
					accountId: result.walletId,
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
							rootUsers: [
								{
									userName: `agent-${agentId}`,
									apiKeys: [
										{
											apiKeyName: `agent-${agentId}-key`,
											publicKey: env.TURNKEY_API_PUBLIC_KEY!,
											curveType: 'API_KEY_CURVE_P256' as const,
										},
									],
									authenticators: [],
									oauthProviders: [],
								},
							],
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
				if (!address) {
					return yield* Effect.fail(new Error('Agent wallet creation failed - no address returned'))
				}
				const accounts = yield* Effect.tryPromise({
					try: () => turnkeyClient.apiClient().getWalletAccounts({
						organizationId: subOrgId,
						walletId: wallet.walletId,
					}),
					catch: (err) => new Error(`Failed to resolve created agent wallet account: ${err}`),
				})
				const account = accounts.accounts.find((candidate) =>
					isEvm
						? candidate.address.toLowerCase() === address.toLowerCase()
						: candidate.address === address,
				)
				if (!account) {
					return yield* Effect.fail(new Error('Agent wallet creation failed - account not found'))
				}

				return {
					subOrgId,
					walletId: wallet.walletId,
					accountId: account.walletAccountId,
					address,
				}
			})

		const verifyAgentWallet = (
			agentId: number,
			subOrgId: string,
			address: string,
			chainType: 'evm' | 'solana',
		) =>
			Effect.gen(function* () {
				if (!env.TURNKEY_API_PUBLIC_KEY || !env.TURNKEY_API_PRIVATE_KEY || !env.TURNKEY_ORGANIZATION_ID) {
					return yield* Effect.fail(new Error('Turnkey credentials not configured'))
				}
				const verified = yield* Effect.tryPromise({
					try: () => attestAgentWallet(
						turnkeyClient.apiClient(),
						env.TURNKEY_ORGANIZATION_ID!,
						agentId,
						subOrgId,
						address,
						chainType,
					),
					catch: (err) => new Error(`Failed to verify managed wallet ownership: ${err}`),
				})
				return verified
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

		const signRawPayload = (
			subOrgId: string,
			payload: string,
			signWith: string,
			hashFunction: 'HASH_FUNCTION_NO_OP' | 'HASH_FUNCTION_SHA256' | 'HASH_FUNCTION_KECCAK256',
			encoding: 'PAYLOAD_ENCODING_HEXADECIMAL' | 'PAYLOAD_ENCODING_TEXT_UTF8'
		) =>
			Effect.gen(function* () {
				const signResult = yield* Effect.tryPromise({
					try: async () => {
						const response = await turnkeyClient.apiClient().signRawPayload({
							organizationId: subOrgId,
							signWith,
							payload,
							encoding,
							hashFunction,
						})
						return response
					},
					catch: (err) => new Error(`Failed to sign raw payload: ${err}`),
				})

				const r = signResult.r
				const s = signResult.s
				const v = signResult.v

				// Combine into 65-byte hex signature: r (32 bytes) + s (32 bytes) + v (1 byte)
				const rHex = r.startsWith('0x') ? r.slice(2) : r
				const sHex = s.startsWith('0x') ? s.slice(2) : s
				const vInt = parseInt(v, 16) || parseInt(v, 10)
				const vHex = (vInt < 27 ? vInt + 27 : vInt).toString(16).padStart(2, '0')
				const signature = '0x' + rHex.padStart(64, '0') + sHex.padStart(64, '0') + vHex

				return { r, s, v, signature }
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
			createSubOrgWithPasskey,
			createWalletInSubOrg,
			signTransactionForAgent,
			signRawPayload,
			createAgentWallet,
			verifyAgentWallet,
			createPolicy,
			listPolicies,
			deletePolicy,
		}
	})
)

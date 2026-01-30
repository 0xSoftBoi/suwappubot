import { Context, Effect, Layer } from 'effect'
import { Turnkey } from '@turnkey/sdk-server'
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
		userName?: string
	) => Effect.Effect<TurnkeyWallet, Error>
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
				if (!env.TURNKEY_API_PUBLIC_KEY || !env.TURNKEY_API_PRIVATE_KEY || !env.TURNKEY_ORGANIZATION_ID) {
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

		return { createSubOrgForTelegramUser }
	})
)

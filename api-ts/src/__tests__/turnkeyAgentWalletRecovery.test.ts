import { describe, expect, it } from 'bun:test'
import { resolveCreatedAgentWalletAccount } from '../services/TurnkeyService'

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

describe('created Turnkey agent wallet recovery', () => {
	it('retries account lookup while a new wallet becomes visible', async () => {
		let calls = 0
		const api = {
			getWalletAccounts: async () => {
				calls++
				if (calls === 1) throw new Error('not visible yet')
				return {
					accounts: [
						{
							walletAccountId: 'turnkey-account-a',
							address: ADDRESS.toLowerCase(),
						},
					],
				}
			},
		}

		const account = await resolveCreatedAgentWalletAccount(
			api,
			'turnkey-sub-org-a',
			'turnkey-wallet-a',
			ADDRESS,
			'evm',
			{ attempts: 2, delayMs: 0 },
		)

		expect(calls).toBe(2)
		expect(account?.walletAccountId).toBe('turnkey-account-a')
	})

	it('returns a recoverable partial identity when account lookup stays unavailable', async () => {
		const api = {
			getWalletAccounts: async () => {
				throw new Error('temporarily unavailable')
			},
		}

		const account = await resolveCreatedAgentWalletAccount(
			api,
			'turnkey-sub-org-a',
			'turnkey-wallet-a',
			ADDRESS,
			'evm',
			{ attempts: 2, delayMs: 0 },
		)

		expect(account).toBeUndefined()
	})
})

import { describe, expect, it } from 'bun:test'
import { attestAgentWallet } from '../services/TurnkeyService'

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const PARENT_ID = 'configured-parent'
const SUB_ORG_ID = 'agent-child'

function attestationApi(organizationIds: string[] = [SUB_ORG_ID]) {
	const calls: Array<{ method: string; input: unknown }> = []
	return {
		calls,
		api: {
			getSubOrgIds: async (input: unknown) => {
				calls.push({ method: 'getSubOrgIds', input })
				return { organizationIds }
			},
			getWhoami: async (input: { organizationId: string }) => {
				calls.push({ method: 'getWhoami', input })
				return {
					organizationId: SUB_ORG_ID,
					organizationName: 'agent-91-evm',
					username: 'agent-91',
				}
			},
			getWalletAccounts: async (input: { organizationId: string }) => {
				calls.push({ method: 'getWalletAccounts', input })
				return {
					accounts: [
						{
							walletAccountId: 'account-a',
							organizationId: SUB_ORG_ID,
							walletId: 'wallet-a',
							address: ADDRESS,
						},
					],
				}
			},
		},
	}
}

describe('Turnkey managed-agent wallet attestation', () => {
	it('requires exact child membership under the configured parent before child checks', async () => {
		const { api, calls } = attestationApi()

		const wallet = await attestAgentWallet(api, PARENT_ID, 91, SUB_ORG_ID, ADDRESS, 'evm')

		expect(wallet).toEqual({
			subOrgId: SUB_ORG_ID,
			walletId: 'wallet-a',
			accountId: 'account-a',
			address: ADDRESS,
		})
		expect(calls[0]).toEqual({
			method: 'getSubOrgIds',
			input: {
				organizationId: PARENT_ID,
				filterType: 'NAME',
				filterValue: 'agent-91-evm',
				paginationOptions: { limit: '2' },
			},
		})
	})

	it('fails closed on missing, foreign, or ambiguous parent membership', async () => {
		for (const organizationIds of [[], ['foreign-child'], [SUB_ORG_ID, 'duplicate-name']]) {
			const { api, calls } = attestationApi(organizationIds)
			await expect(
				attestAgentWallet(api, PARENT_ID, 91, SUB_ORG_ID, ADDRESS, 'evm'),
			).rejects.toThrow('not uniquely owned by the configured parent')
			expect(calls.map(({ method }) => method)).toEqual(['getSubOrgIds'])
		}
	})

	it('fails closed when child identity or account ownership disagrees', async () => {
		const wrongChild = attestationApi()
		wrongChild.api.getWhoami = async () => ({
			organizationId: 'foreign-child',
			organizationName: 'agent-91-evm',
			username: 'agent-91',
		})
		await expect(
			attestAgentWallet(wrongChild.api, PARENT_ID, 91, SUB_ORG_ID, ADDRESS, 'evm'),
		).rejects.toThrow('does not belong to this agent')

		const wrongAccount = attestationApi()
		wrongAccount.api.getWalletAccounts = async () => ({
			accounts: [
				{
					walletAccountId: 'account-a',
					organizationId: 'foreign-child',
					walletId: 'wallet-a',
					address: ADDRESS,
				},
			],
		})
		await expect(
			attestAgentWallet(wrongAccount.api, PARENT_ID, 91, SUB_ORG_ID, ADDRESS, 'evm'),
		).rejects.toThrow('address does not belong')
	})
})

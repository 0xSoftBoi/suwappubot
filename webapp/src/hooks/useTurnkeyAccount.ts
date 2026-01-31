/**
 * Hook to create a viem LocalAccount backed by Turnkey passkey.
 *
 * Bridges Turnkey SDK session with viem for transaction signing.
 * The account can be used with viem's sendTransaction and signMessage.
 */

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LocalAccount, Address } from 'viem'
import { createAccountWithAddress } from '@turnkey/viem'
import { passkeyClient, getCurrentSession } from '../lib/turnkey-client'
import { getTurnkeyWallets } from '../lib/turnkey-passkey'

// Query keys for Turnkey account
export const turnkeyAccountKeys = {
  all: ['turnkey-account'] as const,
  account: () => [...turnkeyAccountKeys.all, 'account'] as const,
}

/**
 * Hook to get a viem LocalAccount backed by Turnkey.
 * This account can sign transactions using the user's passkey.
 */
export function useTurnkeyAccount() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: turnkeyAccountKeys.account(),
    queryFn: async (): Promise<{
      account: LocalAccount | null
      address: Address | null
      organizationId: string | null
    }> => {
      // Get current Turnkey session
      const session = await getCurrentSession()
      if (!session) {
        return { account: null, address: null, organizationId: null }
      }

      // Get wallets to find the signing address
      const wallets = await getTurnkeyWallets()
      const evmWallet = wallets.find(w => w.chainType === 'evm')

      if (!evmWallet) {
        return { account: null, address: null, organizationId: session.organizationId }
      }

      // Create viem account with Turnkey as signer
      // Use createAccountWithAddress since we already know the address
      const account = createAccountWithAddress({
        client: passkeyClient,
        organizationId: session.organizationId,
        signWith: evmWallet.address,
        ethereumAddress: evmWallet.address,
      })

      return {
        account,
        address: evmWallet.address as Address,
        organizationId: session.organizationId,
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  })

  // Refetch when auth session changes
  const refetchAccount = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    account: data?.account ?? null,
    address: data?.address ?? null,
    organizationId: data?.organizationId ?? null,
    isLoading,
    error: error as Error | null,
    refetch: refetchAccount,
  }
}

/**
 * Hook to get the Turnkey account address without the full account.
 * Useful when you just need the address for display or balance queries.
 */
export function useTurnkeyAddress() {
  const { address, isLoading, error } = useTurnkeyAccount()
  return { address, isLoading, error }
}

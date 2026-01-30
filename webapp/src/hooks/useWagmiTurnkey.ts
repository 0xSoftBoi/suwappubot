/**
 * Combined wagmi + Turnkey hooks for EVM operations.
 *
 * Provides wagmi-style hooks that use Turnkey for signing.
 * All transactions are signed via the user's passkey.
 */

import { useMemo } from 'react'
import {
  useBalance,
  useChainId,
  useSwitchChain,
  usePublicClient,
  useReadContract,
  useBlockNumber,
  useGasPrice,
  useEstimateGas,
} from 'wagmi'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Address, Hash, TransactionRequest } from 'viem'
import { formatEther } from 'viem'
import { useTurnkeyAccount } from './useTurnkeyAccount'
import { supportedChains, getChainById } from '../lib/wagmi-config'

/**
 * Hook for getting native token balance using Turnkey address.
 */
export function useTurnkeyBalance(chainId?: number) {
  const { address } = useTurnkeyAccount()
  const currentChainId = useChainId()
  const targetChainId = chainId ?? currentChainId

  return useBalance({
    address: address ?? undefined,
    chainId: targetChainId,
    query: {
      enabled: !!address,
    },
  })
}

/**
 * Hook for getting ERC20 token balance.
 */
export function useTurnkeyTokenBalance(
  tokenAddress: Address,
  chainId?: number
) {
  const { address } = useTurnkeyAccount()
  const currentChainId = useChainId()
  const targetChainId = chainId ?? currentChainId

  return useReadContract({
    address: tokenAddress,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: 'balance', type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: targetChainId,
    query: {
      enabled: !!address,
    },
  })
}

/**
 * Hook for sending native token transactions signed by Turnkey.
 */
export function useTurnkeySendTransaction() {
  const { account, address } = useTurnkeyAccount()
  const publicClient = usePublicClient()
  const queryClient = useQueryClient()
  const chainId = useChainId()

  return useMutation({
    mutationFn: async ({
      to,
      value,
      data,
    }: {
      to: Address
      value?: bigint
      data?: `0x${string}`
    }): Promise<Hash> => {
      if (!account || !publicClient) {
        throw new Error('Turnkey account not available')
      }

      // Prepare transaction
      const request: TransactionRequest = {
        from: address!,
        to,
        value: value ?? BigInt(0),
        data,
      }

      // Estimate gas
      const gas = await publicClient.estimateGas(request)

      // Get gas price
      const gasPrice = await publicClient.getGasPrice()

      // Get nonce
      const nonce = await publicClient.getTransactionCount({
        address: address!,
      })

      // Sign transaction with Turnkey account
      const signedTx = await account.signTransaction({
        ...request,
        gas,
        gasPrice,
        nonce,
        chainId,
      } as any)

      // Send signed transaction
      const hash = await publicClient.sendRawTransaction({
        serializedTransaction: signedTx,
      })

      return hash
    },
    onSuccess: () => {
      // Invalidate balance queries after successful transaction
      queryClient.invalidateQueries({ queryKey: ['balance'] })
    },
  })
}

/**
 * Hook for signing messages with Turnkey.
 */
export function useTurnkeySignMessage() {
  const { account } = useTurnkeyAccount()

  return useMutation({
    mutationFn: async (message: string): Promise<`0x${string}`> => {
      if (!account) {
        throw new Error('Turnkey account not available')
      }

      const signature = await account.signMessage({
        message,
      })

      return signature
    },
  })
}

/**
 * Hook for signing typed data (EIP-712) with Turnkey.
 */
export function useTurnkeySignTypedData() {
  const { account } = useTurnkeyAccount()

  return useMutation({
    mutationFn: async (typedData: any): Promise<`0x${string}`> => {
      if (!account) {
        throw new Error('Turnkey account not available')
      }

      const signature = await account.signTypedData(typedData)

      return signature
    },
  })
}

/**
 * Hook for getting multi-chain balances.
 */
export function useTurnkeyMultiChainBalances() {
  const { address } = useTurnkeyAccount()

  // Get balances for all supported chains
  const balanceQueries = supportedChains.map(chain => ({
    chainId: chain.id,
    chainName: chain.name,
    ...useBalance({
      address: address ?? undefined,
      chainId: chain.id,
      query: {
        enabled: !!address,
      },
    }),
  }))

  return {
    balances: balanceQueries,
    isLoading: balanceQueries.some(q => q.isLoading),
    totalUsd: 0, // Would need price feeds to calculate
  }
}

/**
 * Combined hook providing full Turnkey + wagmi functionality.
 */
export function useWagmiTurnkey() {
  const turnkeyAccount = useTurnkeyAccount()
  const balance = useTurnkeyBalance()
  const chainId = useChainId()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const sendTransaction = useTurnkeySendTransaction()
  const signMessage = useTurnkeySignMessage()

  const currentChain = useMemo(() => getChainById(chainId), [chainId])

  return {
    // Account info
    address: turnkeyAccount.address,
    account: turnkeyAccount.account,
    organizationId: turnkeyAccount.organizationId,
    isConnected: !!turnkeyAccount.address,
    isLoading: turnkeyAccount.isLoading,

    // Balance
    balance: balance.data,
    balanceFormatted: balance.data ? formatEther(balance.data.value) : '0',
    isBalanceLoading: balance.isLoading,

    // Chain
    chainId,
    chain: currentChain,
    supportedChains,
    switchChain: (chainId: number) => switchChain({ chainId }),
    isSwitching,

    // Actions
    sendTransaction: sendTransaction.mutateAsync,
    isSending: sendTransaction.isPending,
    sendError: sendTransaction.error,

    signMessage: signMessage.mutateAsync,
    isSigning: signMessage.isPending,
    signError: signMessage.error,

    // Refetch
    refetchAccount: turnkeyAccount.refetch,
    refetchBalance: balance.refetch,
  }
}

// Re-export common wagmi hooks for convenience
export {
  useChainId,
  useSwitchChain,
  useBlockNumber,
  useGasPrice,
  useEstimateGas,
  usePublicClient,
}

/**
 * Hook for MetaMask/external wallet connection
 *
 * Provides wallet-specific state and actions for connecting external wallets.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  isWalletAvailable,
  getCurrentAddress,
  connectWallet as connectWalletFn,
  signMessage,
  onAccountsChanged,
  onChainChanged,
  getChainId,
  formatAddress,
} from '../lib/turnkey'
import { api } from '../lib/api'

interface UseWalletConnectionReturn {
  // State
  isAvailable: boolean
  isConnected: boolean
  address: string | null
  chainId: string | null
  isConnecting: boolean
  error: string | null

  // Actions
  connect: () => Promise<string | null>
  connectAndLink: () => Promise<boolean>
  sign: (message: string) => Promise<string | null>
  clearError: () => void

  // Utilities
  formatAddress: (address: string) => string
}

export function useWalletConnection(): UseWalletConnectionReturn {
  const [isAvailable, setIsAvailable] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<string | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize
  useEffect(() => {
    const init = async () => {
      const available = isWalletAvailable()
      setIsAvailable(available)

      if (available) {
        const currentAddress = await getCurrentAddress()
        if (currentAddress) {
          setAddress(currentAddress)
          setIsConnected(true)
        }

        const currentChainId = await getChainId()
        setChainId(currentChainId)
      }
    }

    init()
  }, [])

  // Listen for account changes
  useEffect(() => {
    if (!isAvailable) return

    const unsubscribeAccounts = onAccountsChanged((accounts) => {
      if (accounts.length === 0) {
        setAddress(null)
        setIsConnected(false)
      } else {
        setAddress(accounts[0])
        setIsConnected(true)
      }
    })

    const unsubscribeChain = onChainChanged((newChainId) => {
      setChainId(newChainId)
    })

    return () => {
      unsubscribeAccounts()
      unsubscribeChain()
    }
  }, [isAvailable])

  // Connect wallet
  const connect = useCallback(async (): Promise<string | null> => {
    if (!isAvailable) {
      setError('No Ethereum wallet found. Please install MetaMask.')
      return null
    }

    try {
      setIsConnecting(true)
      setError(null)

      const connectedAddress = await connectWalletFn()
      setAddress(connectedAddress)
      setIsConnected(true)

      return connectedAddress
    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet')
      return null
    } finally {
      setIsConnecting(false)
    }
  }, [isAvailable])

  // Connect and link to Telegram account
  const connectAndLink = useCallback(async (): Promise<boolean> => {
    try {
      setIsConnecting(true)
      setError(null)

      // 1. Connect wallet
      const connectedAddress = await connectWalletFn()
      setAddress(connectedAddress)
      setIsConnected(true)

      // 2. Request challenge
      const { challenge, nonce } = await api.requestWalletChallenge(connectedAddress)

      // 3. Sign challenge
      const signature = await signMessage(connectedAddress, challenge)

      // 4. Link wallet
      const result = await api.linkWallet(connectedAddress, signature, nonce)

      return result.success
    } catch (err: any) {
      setError(err.message || 'Failed to connect and link wallet')
      return false
    } finally {
      setIsConnecting(false)
    }
  }, [])

  // Sign a message
  const sign = useCallback(async (message: string): Promise<string | null> => {
    if (!address) {
      setError('No wallet connected')
      return null
    }

    try {
      setError(null)
      return await signMessage(address, message)
    } catch (err: any) {
      setError(err.message || 'Failed to sign message')
      return null
    }
  }, [address])

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    isAvailable,
    isConnected,
    address,
    chainId,
    isConnecting,
    error,
    connect,
    connectAndLink,
    sign,
    clearError,
    formatAddress,
  }
}

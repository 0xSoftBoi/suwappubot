/**
 * Turnkey/wallet authentication utilities for the webapp.
 * Handles MetaMask wallet connection, challenge signing, and wallet linking.
 */

import type { AuthChallenge, LinkWalletResponse } from '../types/auth'
import { getInitData } from './telegram'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * Check if MetaMask or another Ethereum wallet is available.
 */
export function isWalletAvailable(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window as any).ethereum
}

/**
 * Get the Ethereum provider
 */
function getEthereum(): any {
  if (typeof window === 'undefined') return null
  return (window as any).ethereum
}

/**
 * Request wallet connection and return the connected address.
 */
export async function connectWallet(): Promise<string> {
  const ethereum = getEthereum()

  if (!ethereum) {
    throw new Error('No Ethereum wallet found. Please install MetaMask.')
  }

  try {
    const accounts = await ethereum.request({
      method: 'eth_requestAccounts',
    })

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found')
    }

    return accounts[0]
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error('User rejected the connection request')
    }
    throw error
  }
}

/**
 * Get the current connected wallet address (if any).
 */
export async function getCurrentAddress(): Promise<string | null> {
  const ethereum = getEthereum()

  if (!ethereum) return null

  try {
    const accounts = await ethereum.request({
      method: 'eth_accounts',
    })

    return accounts && accounts.length > 0 ? accounts[0] : null
  } catch {
    return null
  }
}

/**
 * Sign a message using the connected wallet.
 */
export async function signMessage(address: string, message: string): Promise<string> {
  const ethereum = getEthereum()

  if (!ethereum) {
    throw new Error('No Ethereum wallet found')
  }

  try {
    const signature = await ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    })

    return signature
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error('User rejected the signature request')
    }
    throw error
  }
}

/**
 * Request a challenge message for wallet linking.
 */
export async function requestChallenge(address: string): Promise<AuthChallenge> {
  const initData = getInitData()

  const response = await fetch(`${API_BASE}/webapp/challenge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(initData ? { 'X-Telegram-Init-Data': initData } : {}),
    },
    body: JSON.stringify({ address }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to request challenge' }))
    throw new Error(error.detail || 'Failed to request challenge')
  }

  return response.json()
}

/**
 * Link a wallet to the Telegram account by verifying signature.
 */
export async function linkWallet(
  address: string,
  signature: string,
  nonce: string
): Promise<LinkWalletResponse> {
  const initData = getInitData()

  const response = await fetch(`${API_BASE}/webapp/link-wallet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(initData ? { 'X-Telegram-Init-Data': initData } : {}),
    },
    body: JSON.stringify({ address, signature, nonce }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to link wallet' }))
    throw new Error(error.detail || 'Failed to link wallet')
  }

  return response.json()
}

/**
 * Full wallet linking flow: connect, challenge, sign, link.
 */
export async function connectAndLinkWallet(): Promise<LinkWalletResponse> {
  // 1. Connect wallet
  const address = await connectWallet()

  // 2. Request challenge
  const { challenge, nonce } = await requestChallenge(address)

  // 3. Sign challenge
  const signature = await signMessage(address, challenge)

  // 4. Link wallet
  const result = await linkWallet(address, signature, nonce)

  return result
}

/**
 * Subscribe to wallet account changes.
 */
export function onAccountsChanged(callback: (accounts: string[]) => void): () => void {
  const ethereum = getEthereum()

  if (!ethereum) return () => {}

  ethereum.on('accountsChanged', callback)

  return () => {
    ethereum.removeListener('accountsChanged', callback)
  }
}

/**
 * Subscribe to chain/network changes.
 */
export function onChainChanged(callback: (chainId: string) => void): () => void {
  const ethereum = getEthereum()

  if (!ethereum) return () => {}

  ethereum.on('chainChanged', callback)

  return () => {
    ethereum.removeListener('chainChanged', callback)
  }
}

/**
 * Get the current chain ID.
 */
export async function getChainId(): Promise<string | null> {
  const ethereum = getEthereum()

  if (!ethereum) return null

  try {
    return await ethereum.request({ method: 'eth_chainId' })
  } catch {
    return null
  }
}

/**
 * Format address for display (0x1234...5678).
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

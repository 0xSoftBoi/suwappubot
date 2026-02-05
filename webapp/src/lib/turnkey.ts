/**
 * Wallet utilities for the webapp.
 * Handles challenge signing and wallet linking via API.
 */

import type { AuthChallenge, LinkWalletResponse } from '@suwappu/shared'
import { getInitData } from './telegram'

const API_BASE = import.meta.env.VITE_API_URL || ''

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
 * Format address for display (0x1234...5678).
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

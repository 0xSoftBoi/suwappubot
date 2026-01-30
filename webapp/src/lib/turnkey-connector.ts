/**
 * Custom wagmi connector for Turnkey passkey wallets.
 *
 * This connector integrates Turnkey's passkey-based signing with wagmi,
 * allowing use of wagmi hooks with Turnkey wallets.
 */

import { createConnector } from 'wagmi'
import type { Address } from 'viem'
import { createAccountWithAddress } from '@turnkey/viem'
import { passkeyClient, getCurrentSession } from './turnkey-client'
import { getTurnkeyWallets, hasTurnkeySession } from './turnkey-passkey'
import { mainnet } from 'wagmi/chains'

// Store for the current Turnkey account state
let turnkeyState: {
  address: Address | null
  organizationId: string | null
  chainId: number
} = {
  address: null,
  organizationId: null,
  chainId: mainnet.id,
}

/**
 * Turnkey wagmi connector.
 *
 * Usage:
 * ```ts
 * const config = createConfig({
 *   connectors: [turnkeyConnector()],
 *   // ...
 * })
 * ```
 */
export function turnkeyConnector() {
  return createConnector((config) => ({
    id: 'turnkey',
    name: 'Turnkey Passkey',
    type: 'turnkey' as const,

    async setup() {
      // Check if already connected
      const hasSession = await hasTurnkeySession()
      if (hasSession) {
        const session = await getCurrentSession()
        const wallets = await getTurnkeyWallets()
        const evmWallet = wallets.find(w => w.chainType === 'evm')

        if (session && evmWallet) {
          turnkeyState.address = evmWallet.address as Address
          turnkeyState.organizationId = session.organizationId
        }
      }
    },

    // @ts-expect-error - wagmi withCapabilities generic typing
    async connect({ chainId } = {}) {
      // Try to get address from Turnkey session
      const session = await getCurrentSession()
      if (!session) {
        throw new Error('No Turnkey session. Please login first.')
      }

      const wallets = await getTurnkeyWallets()
      const evmWallet = wallets.find(w => w.chainType === 'evm')

      if (!evmWallet) {
        throw new Error('No EVM wallet available. Please create a wallet first.')
      }

      turnkeyState.address = evmWallet.address as Address
      turnkeyState.organizationId = session.organizationId

      const targetChainId = chainId ?? turnkeyState.chainId

      return {
        accounts: [turnkeyState.address] as readonly Address[],
        chainId: targetChainId,
      }
    },

    async disconnect() {
      turnkeyState.address = null
      turnkeyState.organizationId = null
    },

    async getAccounts() {
      if (!turnkeyState.address) {
        return []
      }
      return [turnkeyState.address] as readonly Address[]
    },

    async getChainId() {
      return turnkeyState.chainId
    },

    async getProvider() {
      // Return a minimal provider that delegates signing to Turnkey
      return {
        request: async ({ method, params }: { method: string; params?: any[] }) => {
          switch (method) {
            case 'eth_accounts':
            case 'eth_requestAccounts':
              return turnkeyState.address ? [turnkeyState.address] : []

            case 'eth_chainId':
              return `0x${turnkeyState.chainId.toString(16)}`

            case 'personal_sign': {
              if (!turnkeyState.organizationId || !turnkeyState.address) {
                throw new Error('Not connected to Turnkey')
              }

              const [message] = params as [string]
              const account = createAccountWithAddress({
                client: passkeyClient,
                organizationId: turnkeyState.organizationId,
                signWith: turnkeyState.address,
                ethereumAddress: turnkeyState.address,
              })

              const messageToSign = message.startsWith('0x')
                ? { raw: message as `0x${string}` }
                : message

              return account.signMessage({ message: messageToSign })
            }

            case 'eth_signTypedData_v4': {
              if (!turnkeyState.organizationId || !turnkeyState.address) {
                throw new Error('Not connected to Turnkey')
              }

              const [, typedDataStr] = params as [Address, string]
              const account = createAccountWithAddress({
                client: passkeyClient,
                organizationId: turnkeyState.organizationId,
                signWith: turnkeyState.address,
                ethereumAddress: turnkeyState.address,
              })

              const typedData = JSON.parse(typedDataStr)
              return account.signTypedData(typedData)
            }

            default:
              throw new Error(`Method ${method} not supported`)
          }
        },
      }
    },

    async isAuthorized() {
      const hasSession = await hasTurnkeySession()
      if (!hasSession) return false

      const wallets = await getTurnkeyWallets()
      return wallets.some(w => w.chainType === 'evm')
    },

    async switchChain({ chainId }) {
      turnkeyState.chainId = chainId
      const chain = config.chains.find(c => c.id === chainId)

      if (!chain) {
        throw new Error(`Chain ${chainId} not configured`)
      }

      config.emitter.emit('change', { chainId })

      return chain
    },

    onAccountsChanged(accounts) {
      if (accounts.length === 0) {
        this.disconnect()
      } else {
        turnkeyState.address = accounts[0] as Address
        config.emitter.emit('change', { accounts: accounts as readonly Address[] })
      }
    },

    onChainChanged(chainId) {
      const id = Number(chainId)
      turnkeyState.chainId = id
      config.emitter.emit('change', { chainId: id })
    },

    onDisconnect() {
      this.disconnect()
    },
  }))
}

/**
 * Update Turnkey state after authentication.
 * Call this after successful passkey login/registration.
 */
export async function syncTurnkeyConnector(): Promise<void> {
  const session = await getCurrentSession()
  if (!session) {
    turnkeyState.address = null
    turnkeyState.organizationId = null
    return
  }

  const wallets = await getTurnkeyWallets()
  const evmWallet = wallets.find(w => w.chainType === 'evm')

  if (evmWallet) {
    turnkeyState.address = evmWallet.address as Address
    turnkeyState.organizationId = session.organizationId
  }
}

/**
 * Get current Turnkey connector state.
 */
export function getTurnkeyConnectorState() {
  return { ...turnkeyState }
}

/**
 * Get a Turnkey viem account for direct signing.
 * Useful when you need to sign outside of wagmi hooks.
 */
export function getTurnkeyAccount() {
  if (!turnkeyState.organizationId || !turnkeyState.address) {
    return null
  }

  return createAccountWithAddress({
    client: passkeyClient,
    organizationId: turnkeyState.organizationId,
    signWith: turnkeyState.address,
    ethereumAddress: turnkeyState.address,
  })
}

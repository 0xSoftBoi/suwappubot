// Ledger hardware-wallet connector for wagmi v2, built on Ledger's official
// Connect Kit loader (@ledgerhq/connect-kit-loader). This is the "Tier 2" Ledger
// integration: Connect Kit decides at runtime between the Ledger browser Extension
// (when installed) and opening Ledger Live desktop/mobile — the device always holds
// the keys and signs every SIWE challenge and swap itself.
//
// We hand-roll the wagmi v2 connector because Ledger's own @ledgerhq/ledger-wagmi-
// connector is still pinned to wagmi v1 (@wagmi/core@0.5.x + ethers@5) and there is
// no first-party Ledger connector in @wagmi/connectors v6. Connect Kit returns a
// standard EIP-1193 provider, so this wrapper only does connection plumbing — all
// actual signing flows through the unchanged wagmi sign/sendTransaction path.

import {
  loadConnectKit,
  SupportedProviders,
  type EthereumProvider,
} from '@ledgerhq/connect-kit-loader'
import type { Wallet, WalletDetailsParams } from '@rainbow-me/rainbowkit'
import { ChainNotConfiguredError, createConnector, type CreateConnectorFn } from 'wagmi'
import {
  getAddress,
  numberToHex,
  SwitchChainError,
  UserRejectedRequestError,
  type Address,
  type ProviderRpcError,
} from 'viem'

// Ledger brand mark (same asset RainbowKit ships) so the modal entry looks native.
const LEDGER_ICON =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2228%22%20height%3D%2228%22%20fill%3D%22none%22%3E%3Cpath%20fill%3D%22%23000%22%20d%3D%22M0%200h28v28H0z%22%2F%3E%3Cpath%20fill%3D%22%23fff%22%20fill-rule%3D%22evenodd%22%20d%3D%22M11.65%204.4H4.4V9h1.1V5.5l6.15-.04V4.4Zm.05%205.95v7.25h4.6v-1.1h-3.5l-.04-6.15H11.7ZM4.4%2023.6h7.25v-1.06L5.5%2022.5V19H4.4v4.6ZM16.35%204.4h7.25V9h-1.1V5.5l-6.15-.04V4.4Zm7.25%2019.2h-7.25v-1.06l6.15-.04V19h1.1v4.6Z%22%20clip-rule%3D%22evenodd%22%2F%3E%3C%2Fsvg%3E'

export const LEDGER_CONNECTOR_ID = 'ledgerConnectKit'

export type LedgerConnectKitParameters = {
  projectId?: string
}

// Base wagmi v2 connector. Returns a CreateConnectorFn; RainbowKit wraps it below.
export function ledgerConnectKit(parameters: LedgerConnectKitParameters = {}) {
  let provider_: EthereumProvider | undefined

  let accountsChanged: ((accounts: string[]) => void) | undefined
  let chainChanged: ((chainId: string) => void) | undefined
  let disconnected: ((error: ProviderRpcError) => void) | undefined

  // Build the connector as a self-typed object literal, then cast once on return.
  // wagmi's connect() is generic over `withCapabilities`, which a plain literal
  // can't satisfy structurally, and we add a private cleanupListeners() helper — both
  // would error under createConnector's contextual type. As a freestanding `const`,
  // the literal types `this.getProvider()` as EthereumProvider in every method; the
  // single cast on return reconciles it with wagmi's Connector interface.
  return createConnector((config) => {
    const connector = {
      id: LEDGER_CONNECTOR_ID,
      name: 'Ledger',
      type: 'ledgerConnectKit' as const,

      async connect({ chainId }: { chainId?: number; isReconnecting?: boolean } = {}) {
        const provider = (await this.getProvider()) as EthereumProvider
        const accounts = await provider.request<string[]>({
          method: 'eth_requestAccounts',
        })

        if (!accountsChanged) {
          accountsChanged = this.onAccountsChanged.bind(this)
          provider.on('accountsChanged', accountsChanged)
        }
        if (!chainChanged) {
          chainChanged = this.onChainChanged.bind(this)
          provider.on('chainChanged', chainChanged)
        }
        if (!disconnected) {
          disconnected = this.onDisconnect.bind(this)
          provider.on('disconnect', disconnected)
        }

        let currentChainId = await this.getChainId()
        if (chainId && currentChainId !== chainId) {
          const chain = await this.switchChain!({ chainId }).catch((error: ProviderRpcError) => {
            if (error.code === UserRejectedRequestError.code) throw error
            return { id: currentChainId }
          })
          currentChainId = chain?.id ?? currentChainId
        }

        return {
          accounts: accounts.map((x) => getAddress(x)) as readonly Address[],
          chainId: currentChainId,
        }
      },

      async disconnect() {
        const provider = (await this.getProvider()) as EthereumProvider
        this.cleanupListeners(provider)
        await provider.disconnect?.()
        provider_ = undefined
      },

      async getAccounts() {
        const provider = (await this.getProvider()) as EthereumProvider
        const accounts = await provider.request<string[]>({
          method: 'eth_accounts',
        })
        return accounts.map((x) => getAddress(x))
      },

      async getChainId() {
        const provider = (await this.getProvider()) as EthereumProvider
        const chainId = await provider.request<string>({
          method: 'eth_chainId',
        })
        return Number(chainId)
      },

      async getProvider() {
        if (provider_) return provider_
        const connectKit = await loadConnectKit()
        if (import.meta.env.DEV) connectKit.enableDebugLogs()
        connectKit.checkSupport({
          providerType: SupportedProviders.Ethereum,
          walletConnectVersion: 2,
          projectId: parameters.projectId,
          chains: config.chains.map((c) => c.id),
          rpcMap: Object.fromEntries(
            config.chains.map((c) => [String(c.id), c.rpcUrls.default.http[0]]),
          ),
        })
        const provider = await connectKit.getProvider()
        provider_ = provider
        return provider
      },

      async isAuthorized() {
        try {
          const accounts = await this.getAccounts()
          return accounts.length > 0
        } catch {
          return false
        }
      },

      async switchChain({ chainId }: { chainId: number }) {
        const chain = config.chains.find((c) => c.id === chainId)
        if (!chain) throw new SwitchChainError(new ChainNotConfiguredError())
        const provider = (await this.getProvider()) as EthereumProvider
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: numberToHex(chainId) }],
        })
        return chain
      },

      onAccountsChanged(accounts: string[]) {
        if (accounts.length === 0) this.onDisconnect()
        else
          config.emitter.emit('change', {
            accounts: accounts.map((x) => getAddress(x)) as readonly Address[],
          })
      },

      onChainChanged(chain: string) {
        config.emitter.emit('change', { chainId: Number(chain) })
      },

      async onDisconnect() {
        config.emitter.emit('disconnect')
        if (provider_) this.cleanupListeners(provider_)
      },

      // Helper (not part of the wagmi Connector interface) to detach our listeners.
      cleanupListeners(provider: EthereumProvider) {
        if (accountsChanged) {
          provider.removeListener('accountsChanged', accountsChanged)
          accountsChanged = undefined
        }
        if (chainChanged) {
          provider.removeListener('chainChanged', chainChanged)
          chainChanged = undefined
        }
        if (disconnected) {
          provider.removeListener('disconnect', disconnected)
          disconnected = undefined
        }
      },
    }
    return connector as unknown as ReturnType<CreateConnectorFn<EthereumProvider>>
  })
}

// RainbowKit custom-wallet wrapper so Ledger appears in the standard connect modal
// alongside MetaMask/WalletConnect, reusing the existing SIWE auth + build/record
// swap flow with no further changes.
export const ledgerConnectKitWallet = ({ projectId }: { projectId?: string }): Wallet => ({
  id: 'ledger-connect-kit',
  name: 'Ledger',
  iconUrl: async () => LEDGER_ICON,
  iconBackground: '#000',
  downloadUrls: {
    android: 'https://play.google.com/store/apps/details?id=com.ledger.live',
    ios: 'https://apps.apple.com/app/ledger-live-web3-wallet/id1361671700',
    qrCode: 'https://www.ledger.com/ledger-live',
  },
  createConnector: (walletDetails: WalletDetailsParams) =>
    createConnector((config) => ({
      ...ledgerConnectKit({ projectId })(config),
      ...walletDetails,
    })),
})

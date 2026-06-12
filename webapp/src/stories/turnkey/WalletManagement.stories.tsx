import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Turnkey Account/Wallet Management',
  parameters: {
    layout: 'centered',
    backgrounds: {
      default: 'suwappu',
      values: [
        { name: 'suwappu', value: '#FFFBFC' },
        { name: 'dark', value: '#1A1625' },
      ],
    },
  },
}

export default meta
type Story = StoryObj

// Mock wallet data
const mockWallets = [
  { address: '0x7a3b8f2e9c1d4a5b6c7d8e9f0a1b2c3d4e5f6789', chain: 'evm', provider: 'turnkey', name: 'Main Wallet' },
  { address: '0x1234567890abcdef1234567890abcdef12345678', chain: 'evm', provider: 'external', name: 'Linked Wallet' },
  { address: 'HN7cABqLq46Es1jh92dQQisAr1v36mrBJ6dBfdkxyS3x', chain: 'solana', provider: 'turnkey', name: 'Solana Wallet' },
]

function formatAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export const WalletCard: Story = {
  render: () => (
    <div className="p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 w-80">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-suwappu-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.5 11.75L18.75 9l1-3.5-2.25.75L15 4l-3 2.5L9 4 6.5 6.25l-2.25-.75 1 3.5L2.5 11.75l2.75 2.75-.5 3.25 3-1 2.25 2 2-1.5 2 1.5 2.25-2 3 1-.5-3.25 2.75-2.75z" />
            </svg>
          </div>
          <div>
            <div className="font-heading font-bold text-suwappu-text">Main Wallet</div>
            <div className="font-mono text-sm text-suwappu-text-secondary">0x7a3b...6789</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 text-xs font-heading font-semibold bg-suwappu-success/20 text-green-700 rounded-full">
            Active
          </span>
        </div>
      </div>
    </div>
  ),
}

export const WalletCardVariants: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      {/* Turnkey Wallet */}
      <div className="p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-suwappu-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-heading font-bold text-suwappu-text">Secure Wallet</span>
                <span className="px-2 py-0.5 text-xs font-heading bg-suwappu-petal text-suwappu-purple-deep rounded-full">
                  Turnkey
                </span>
              </div>
              <div className="font-mono text-sm text-suwappu-text-secondary">0x7a3b...6789</div>
            </div>
          </div>
        </div>
      </div>

      {/* External Wallet */}
      <div className="p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-500 rounded-suwappu-lg flex items-center justify-center">
              <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.5 11.75L18.75 9l1-3.5-2.25.75L15 4l-3 2.5L9 4 6.5 6.25l-2.25-.75 1 3.5L2.5 11.75l2.75 2.75-.5 3.25 3-1 2.25 2 2-1.5 2 1.5 2.25-2 3 1-.5-3.25 2.75-2.75z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-heading font-bold text-suwappu-text">Linked Wallet</span>
                <span className="px-2 py-0.5 text-xs font-heading bg-orange-100 text-orange-700 rounded-full">
                  External
                </span>
              </div>
              <div className="font-mono text-sm text-suwappu-text-secondary">0x1234...5678</div>
            </div>
          </div>
        </div>
      </div>

      {/* Solana Wallet */}
      <div className="p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-green-400 rounded-suwappu-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">S</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-heading font-bold text-suwappu-text">Solana Wallet</span>
                <span className="px-2 py-0.5 text-xs font-heading bg-purple-100 text-purple-700 rounded-full">
                  SOL
                </span>
              </div>
              <div className="font-mono text-sm text-suwappu-text-secondary">HN7c...yS3x</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ),
}

export const WalletList: Story = {
  render: () => (
    <div className="p-6 bg-white rounded-suwappu-xxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 w-96">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-bold text-suwappu-purple-deep">My Wallets</h3>
        <span className="text-sm text-suwappu-text-secondary">{mockWallets.length} wallets</span>
      </div>

      <div className="space-y-3">
        {mockWallets.map((wallet, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-3 bg-suwappu-sakura-light/20 rounded-suwappu-lg hover:bg-suwappu-sakura-light/40 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-suwappu-md flex items-center justify-center ${
                wallet.provider === 'turnkey'
                  ? 'bg-gradient-to-br from-suwappu-purple to-suwappu-magenta-mid'
                  : 'bg-gradient-to-br from-orange-400 to-orange-500'
              }`}>
                {wallet.chain === 'solana' ? (
                  <span className="text-white font-bold">S</span>
                ) : (
                  <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                  </svg>
                )}
              </div>
              <div>
                <div className="font-heading font-semibold text-suwappu-text text-sm">{wallet.name}</div>
                <div className="font-mono text-xs text-suwappu-text-secondary">{formatAddress(wallet.address)}</div>
              </div>
            </div>
            <svg className="w-5 h-5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        ))}
      </div>

      <button className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-suwappu-sakura-mid/50 rounded-suwappu-lg text-suwappu-magenta-mid font-heading font-semibold hover:bg-suwappu-sakura-light/30 hover:border-suwappu-magenta-mid transition-all">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
        Add Wallet
      </button>
    </div>
  ),
}

export const WalletDetails: Story = {
  render: () => (
    <div className="p-6 bg-white rounded-suwappu-xxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 w-96">
      <div className="text-center mb-6">
        <div className="w-20 h-20 mx-auto mb-3 bg-gradient-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-full flex items-center justify-center shadow-suwappu-glow">
          <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
          </svg>
        </div>
        <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep">Main Wallet</h3>
        <span className="px-3 py-1 text-xs font-heading font-semibold bg-suwappu-petal text-suwappu-purple-deep rounded-full">
          Turnkey Secure
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-heading text-suwappu-text-secondary uppercase tracking-wide">Address</label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg font-mono text-sm text-suwappu-text truncate">
              0x7a3b8f2e9c1d4a5b...5f6789
            </code>
            <button className="p-2 text-suwappu-magenta-mid hover:bg-suwappu-sakura-light/50 rounded-suwappu-md transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
            <div className="text-xs font-heading text-suwappu-text-secondary">Chain</div>
            <div className="font-heading font-semibold text-suwappu-text">Ethereum</div>
          </div>
          <div className="p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
            <div className="text-xs font-heading text-suwappu-text-secondary">Created</div>
            <div className="font-heading font-semibold text-suwappu-text">Jan 15, 2024</div>
          </div>
        </div>

        <div className="pt-4 border-t border-suwappu-sakura-mid/20">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-suwappu-text-secondary">Balance</span>
            <span className="font-heading font-bold text-suwappu-text">2.45 ETH</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-suwappu-text-secondary">USD Value</span>
            <span className="font-heading font-bold text-suwappu-success">$4,532.18</span>
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button className="flex-1 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover text-sm">
          Send
        </button>
        <button className="flex-1 px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1 transition-all duration-300 hover:bg-suwappu-sakura-light/30 text-sm">
          Receive
        </button>
      </div>
    </div>
  ),
}

export const AddWalletOptions: Story = {
  render: () => (
    <div className="p-6 bg-white rounded-suwappu-xxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 w-96">
      <h3 className="font-heading text-lg font-bold text-suwappu-purple-deep mb-4 text-center">
        Add New Wallet
      </h3>

      <div className="space-y-3">
        <button className="w-full flex items-center gap-4 p-4 bg-gradient-to-r from-suwappu-sakura-light/50 to-suwappu-rose/30 rounded-suwappu-xl border border-suwappu-sakura-mid/30 hover:border-suwappu-magenta-mid/50 hover:shadow-suwappu-2 transition-all group">
          <div className="w-12 h-12 bg-gradient-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-suwappu-lg flex items-center justify-center group-hover:scale-110 transition-transform">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="font-heading font-bold text-suwappu-purple-deep">Create Secure Wallet</div>
            <div className="text-sm text-suwappu-text-secondary">Use Face ID or Touch ID</div>
          </div>
          <span className="px-2 py-1 text-xs font-heading bg-suwappu-success/20 text-green-700 rounded-full">
            Recommended
          </span>
        </button>

        <button className="w-full flex items-center gap-4 p-4 bg-white rounded-suwappu-xl border border-suwappu-sakura-mid/30 hover:border-suwappu-magenta-mid/50 hover:shadow-suwappu-2 transition-all group">
          <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-orange-500 rounded-suwappu-lg flex items-center justify-center group-hover:scale-110 transition-transform">
            <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.5 11.75L18.75 9l1-3.5-2.25.75L15 4l-3 2.5L9 4 6.5 6.25l-2.25-.75 1 3.5L2.5 11.75l2.75 2.75-.5 3.25 3-1 2.25 2 2-1.5 2 1.5 2.25-2 3 1-.5-3.25 2.75-2.75z" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="font-heading font-bold text-suwappu-text">Link External Wallet</div>
            <div className="text-sm text-suwappu-text-secondary">Connect existing wallet</div>
          </div>
        </button>

        <button className="w-full flex items-center gap-4 p-4 bg-white rounded-suwappu-xl border border-suwappu-sakura-mid/30 hover:border-suwappu-magenta-mid/50 hover:shadow-suwappu-2 transition-all group">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-suwappu-lg flex items-center justify-center group-hover:scale-110 transition-transform">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="font-heading font-bold text-suwappu-text">WalletConnect</div>
            <div className="text-sm text-suwappu-text-secondary">Scan QR code</div>
          </div>
        </button>
      </div>
    </div>
  ),
}

export const EmptyState: Story = {
  render: () => (
    <div className="p-8 bg-white rounded-suwappu-xxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 w-96 text-center">
      <div className="w-24 h-24 mx-auto mb-4 bg-suwappu-sakura-light/50 rounded-full flex items-center justify-center">
        <svg className="w-12 h-12 text-suwappu-sakura-mid" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
        </svg>
      </div>
      <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
        No Wallets Yet
      </h3>
      <p className="font-body text-sm text-suwappu-text-secondary mb-6">
        Create a secure wallet or connect an existing one to get started
      </p>
      <button className="px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
        Add Your First Wallet
      </button>
    </div>
  ),
}

export const DeleteConfirmation: Story = {
  render: () => {
    const [showModal, setShowModal] = useState(true)

    return (
      <>
        {showModal && (
          <div className="fixed inset-0 flex items-center justify-center bg-suwappu-purple-deep/50 backdrop-blur-sm">
            <div className="p-6 bg-white rounded-suwappu-xxl shadow-suwappu-4 max-w-sm mx-4">
              <div className="text-center mb-4">
                <div className="w-16 h-16 mx-auto mb-3 bg-suwappu-error/20 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">
                  Remove Wallet?
                </h3>
                <p className="font-body text-sm text-suwappu-text-secondary">
                  This will unlink <strong>0x7a3b...6789</strong> from your account. You can always add it back later.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-3 bg-white text-suwappu-text font-heading font-bold rounded-suwappu-pill border border-suwappu-sakura-mid/50 hover:bg-suwappu-sakura-light/30 transition-colors"
                >
                  Cancel
                </button>
                <button className="flex-1 px-4 py-3 bg-red-500 text-white font-heading font-bold rounded-suwappu-pill shadow-lg hover:bg-red-600 transition-colors">
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  },
}

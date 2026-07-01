import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Turnkey Account/Wallet Connect',
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

// Reusable wallet icon
function WalletIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  )
}

// External Wallet fox icon (simplified)
function ExternalWalletIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.5 11.75L18.75 9l1-3.5-2.25.75L15 4l-3 2.5L9 4 6.5 6.25l-2.25-.75 1 3.5L2.5 11.75l2.75 2.75-.5 3.25 3-1 2.25 2 2-1.5 2 1.5 2.25-2 3 1-.5-3.25 2.75-2.75z" />
    </svg>
  )
}

export const DefaultButton: Story = {
  render: () => (
    <button className="flex items-center justify-center gap-3 px-8 py-4 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover active:translate-y-0">
      <WalletIcon className="w-5 h-5" />
      Connect Wallet
    </button>
  ),
}

export const ExternalWalletButton: Story = {
  render: () => (
    <button className="flex items-center justify-center gap-3 px-8 py-4 bg-linear-to-r from-orange-400 to-orange-500 text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover active:translate-y-0">
      <ExternalWalletIcon className="w-6 h-6" />
      Connect External Wallet
    </button>
  ),
}

export const SecondaryButton: Story = {
  render: () => (
    <button className="flex items-center justify-center gap-3 px-8 py-4 bg-transparent text-suwappu-magenta-mid font-heading font-semibold rounded-suwappu-pill border-2 border-suwappu-sakura-mid transition-all duration-300 hover:bg-suwappu-sakura-light/30 hover:border-suwappu-magenta-mid">
      <WalletIcon className="w-5 h-5" />
      Connect Wallet
    </button>
  ),
}

export const GlassButton: Story = {
  parameters: {
    backgrounds: { default: 'dark' },
  },
  render: () => (
    <button className="flex items-center justify-center gap-3 px-8 py-4 bg-white/10 backdrop-blur-md text-white font-heading font-bold rounded-suwappu-pill border border-suwappu-sakura-mid/30 shadow-suwappu-glow transition-all duration-300 hover:bg-white/20 hover:shadow-suwappu-button-hover">
      <WalletIcon className="w-5 h-5" />
      Connect Wallet
    </button>
  ),
}

export const LoadingState: Story = {
  render: () => (
    <button className="flex items-center justify-center gap-3 px-8 py-4 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button cursor-wait" disabled>
      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      Connecting...
    </button>
  ),
}

export const ConnectedState: Story = {
  render: () => (
    <div className="flex items-center gap-3 px-6 py-3 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20">
      <div className="w-3 h-3 rounded-full bg-suwappu-success animate-pulse" />
      <span className="font-heading font-semibold text-suwappu-text">0x1234...5678</span>
      <button className="p-1.5 text-suwappu-text-secondary hover:text-suwappu-error transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  ),
}

export const ButtonSizes: Story = {
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <button className="flex items-center justify-center gap-2 px-4 py-2 text-sm bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
        <WalletIcon className="w-4 h-4" />
        Small
      </button>
      <button className="flex items-center justify-center gap-3 px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
        <WalletIcon className="w-5 h-5" />
        Medium
      </button>
      <button className="flex items-center justify-center gap-3 px-8 py-4 text-lg bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
        <WalletIcon className="w-6 h-6" />
        Large
      </button>
    </div>
  ),
}

export const WithDropdown: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false)

    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-center gap-3 px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover"
        >
          <WalletIcon className="w-5 h-5" />
          Connect Wallet
          <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 p-2 bg-white rounded-suwappu-xl shadow-suwappu-3 border border-suwappu-sakura-mid/20 z-10">
            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors">
              <ExternalWalletIcon className="w-6 h-6 text-orange-500" />
              <span className="font-heading font-semibold text-suwappu-text">External Wallet</span>
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors">
              <svg className="w-6 h-6 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
              </svg>
              <span className="font-heading font-semibold text-suwappu-text">WalletConnect</span>
            </button>
            <button className="w-full flex items-center gap-3 px-4 py-3 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors">
              <svg className="w-6 h-6 text-suwappu-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
              <span className="font-heading font-semibold text-suwappu-text">Passkey</span>
            </button>
          </div>
        )}
      </div>
    )
  },
}

export const ErrorState: Story = {
  render: () => (
    <div className="space-y-3 w-72">
      <button className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-suwappu-gradient text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover">
        <WalletIcon className="w-5 h-5" />
        Try Again
      </button>
      <div className="flex items-start gap-2 px-4 py-3 bg-suwappu-error/20 border border-suwappu-error/30 rounded-suwappu-lg">
        <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-body text-red-700">User rejected the connection request</span>
      </div>
    </div>
  ),
}

export const InstallPrompt: Story = {
  render: () => (
    <div className="p-6 bg-white rounded-suwappu-xxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 max-w-sm text-center">
      <div className="w-16 h-16 mx-auto mb-4 bg-linear-to-br from-orange-400 to-orange-500 rounded-suwappu-xl flex items-center justify-center">
        <ExternalWalletIcon className="w-10 h-10 text-white" />
      </div>
      <h3 className="font-heading text-xl font-bold text-suwappu-purple-deep mb-2">Install External Wallet</h3>
      <p className="font-body text-sm text-suwappu-text-secondary mb-4">
        To connect your wallet, please install the External Wallet browser extension.
      </p>
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-linear-to-r from-orange-400 to-orange-500 text-white font-heading font-bold rounded-suwappu-pill shadow-suwappu-button transition-all duration-300 hover:-translate-y-0.5 hover:shadow-suwappu-button-hover"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download External Wallet
      </a>
    </div>
  ),
}

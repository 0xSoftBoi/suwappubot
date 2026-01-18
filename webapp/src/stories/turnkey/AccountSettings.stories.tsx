import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import '../../theme/suwappu.css'

const meta: Meta = {
  title: 'Turnkey Account/Account Settings',
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

export const UserProfile: Story = {
  render: () => (
    <div className="p-6 bg-white rounded-suwappu-xxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 w-96">
      <div className="flex items-center gap-4 mb-6 pb-6 border-b border-suwappu-sakura-mid/20">
        <div className="relative">
          <img
            src="https://i.pravatar.cc/80?img=5"
            alt="User"
            className="w-16 h-16 rounded-full border-4 border-suwappu-sakura-mid shadow-suwappu-glow"
          />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-suwappu-success rounded-full border-2 border-white flex items-center justify-center">
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        </div>
        <div>
          <h3 className="font-heading text-lg font-bold text-suwappu-purple-deep">Sakura Chan</h3>
          <p className="text-sm text-suwappu-text-secondary">@sakura_chan</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-heading bg-suwappu-petal text-suwappu-purple-deep rounded-full mt-1">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Verified
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-heading text-suwappu-text-secondary uppercase tracking-wide">Telegram ID</label>
          <div className="flex items-center gap-2 mt-1">
            <svg className="w-5 h-5 text-suwappu-info" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2s-.16-.05-.23-.03c-.1.03-1.62 1.03-4.58 3.03-.43.3-.82.44-1.17.43-.39-.01-1.13-.22-1.68-.4-.68-.22-1.22-.34-1.17-.72.02-.2.31-.4.85-.61 3.35-1.46 5.59-2.42 6.72-2.89 3.2-1.33 3.87-1.56 4.3-1.57.1 0 .31.02.45.13.11.09.14.21.16.35-.01.06.01.24 0 .38z" />
            </svg>
            <span className="font-mono text-suwappu-text">123456789</span>
          </div>
        </div>

        <div>
          <label className="text-xs font-heading text-suwappu-text-secondary uppercase tracking-wide">Member Since</label>
          <p className="mt-1 font-body text-suwappu-text">January 15, 2024</p>
        </div>

        <div>
          <label className="text-xs font-heading text-suwappu-text-secondary uppercase tracking-wide">Connected Wallets</label>
          <p className="mt-1 font-heading font-semibold text-suwappu-magenta-mid">3 wallets</p>
        </div>
      </div>
    </div>
  ),
}

export const SettingsDrawer: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(true)

    return (
      <div className="relative w-80 h-[600px] bg-suwappu-bg rounded-suwappu-xxl overflow-hidden shadow-suwappu-4">
        {/* Backdrop */}
        {isOpen && (
          <div className="absolute inset-0 bg-black/30 z-10" onClick={() => setIsOpen(false)} />
        )}

        {/* Drawer */}
        <div className={`absolute top-0 right-0 h-full w-72 bg-white shadow-xl z-20 transform transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-suwappu-sakura-mid/20">
            <h2 className="font-heading text-lg font-bold text-suwappu-purple-deep">Settings</h2>
            <button onClick={() => setIsOpen(false)} className="p-2 text-suwappu-text-secondary hover:text-suwappu-text transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-6 overflow-y-auto h-[calc(100%-60px)]">
            {/* User */}
            <div className="flex items-center gap-3 p-3 bg-suwappu-sakura-light/30 rounded-suwappu-lg">
              <img
                src="https://i.pravatar.cc/48?img=5"
                alt="User"
                className="w-12 h-12 rounded-full border-2 border-suwappu-sakura-mid"
              />
              <div>
                <div className="font-heading font-bold text-suwappu-text">Sakura Chan</div>
                <div className="text-sm text-suwappu-text-secondary">@sakura_chan</div>
              </div>
            </div>

            {/* Wallets */}
            <div>
              <h3 className="text-xs font-heading text-suwappu-text-secondary uppercase tracking-wide mb-3">Linked Wallets</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-white rounded-suwappu-lg border border-suwappu-sakura-mid/20">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-suwappu-gradient rounded-suwappu-sm flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3" />
                      </svg>
                    </div>
                    <span className="font-mono text-sm text-suwappu-text">0x7a3b...6789</span>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-suwappu-success" />
                </div>
                <div className="flex items-center justify-between p-3 bg-white rounded-suwappu-lg border border-suwappu-sakura-mid/20">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-orange-500 rounded-suwappu-sm flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M21.5 11.75L18.75 9l1-3.5-2.25.75L15 4l-3 2.5L9 4 6.5 6.25l-2.25-.75 1 3.5L2.5 11.75l2.75 2.75-.5 3.25 3-1 2.25 2 2-1.5 2 1.5 2.25-2 3 1-.5-3.25 2.75-2.75z" />
                      </svg>
                    </div>
                    <span className="font-mono text-sm text-suwappu-text">0x1234...5678</span>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-suwappu-success" />
                </div>
              </div>
            </div>

            {/* Add Wallet */}
            <div>
              <h3 className="text-xs font-heading text-suwappu-text-secondary uppercase tracking-wide mb-3">Add Wallet</h3>
              <div className="space-y-2">
                <button className="w-full flex items-center gap-3 p-3 bg-gradient-to-r from-suwappu-purple/10 to-suwappu-magenta-mid/10 rounded-suwappu-lg border border-suwappu-purple/20 hover:border-suwappu-purple/50 transition-colors">
                  <svg className="w-5 h-5 text-suwappu-purple" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3" />
                  </svg>
                  <span className="font-heading font-semibold text-sm text-suwappu-purple">Create Secure Wallet</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 bg-white rounded-suwappu-lg border border-suwappu-sakura-mid/20 hover:border-suwappu-sakura-mid/50 transition-colors">
                  <svg className="w-5 h-5 text-suwappu-magenta-mid" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  <span className="font-heading font-semibold text-sm text-suwappu-text">Connect Wallet</span>
                </button>
              </div>
            </div>

            {/* App Info */}
            <div className="pt-4 border-t border-suwappu-sakura-mid/20 text-center">
              <p className="text-xs text-suwappu-text-secondary">Suwappu v1.0</p>
              <p className="text-xs text-suwappu-text-secondary">Cross-chain DEX Bot</p>
            </div>
          </div>
        </div>
      </div>
    )
  },
}

export const SettingsMenu: Story = {
  render: () => (
    <div className="p-4 bg-white rounded-suwappu-xxl shadow-suwappu-3 border border-suwappu-sakura-mid/20 w-80">
      <div className="space-y-1">
        <button className="w-full flex items-center gap-3 p-3 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors group">
          <div className="w-10 h-10 bg-suwappu-sakura-light/50 rounded-suwappu-md flex items-center justify-center group-hover:bg-suwappu-sakura-light transition-colors">
            <svg className="w-5 h-5 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="font-heading font-semibold text-suwappu-text">Wallets</div>
            <div className="text-xs text-suwappu-text-secondary">Manage your wallets</div>
          </div>
          <svg className="w-5 h-5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button className="w-full flex items-center gap-3 p-3 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors group">
          <div className="w-10 h-10 bg-suwappu-sakura-light/50 rounded-suwappu-md flex items-center justify-center group-hover:bg-suwappu-sakura-light transition-colors">
            <svg className="w-5 h-5 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="font-heading font-semibold text-suwappu-text">Security</div>
            <div className="text-xs text-suwappu-text-secondary">Passkey & auth settings</div>
          </div>
          <svg className="w-5 h-5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button className="w-full flex items-center gap-3 p-3 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors group">
          <div className="w-10 h-10 bg-suwappu-sakura-light/50 rounded-suwappu-md flex items-center justify-center group-hover:bg-suwappu-sakura-light transition-colors">
            <svg className="w-5 h-5 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5zM4 19h6v2H4a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v6h-2V5H4v14z" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="font-heading font-semibold text-suwappu-text">Notifications</div>
            <div className="text-xs text-suwappu-text-secondary">Alerts & updates</div>
          </div>
          <svg className="w-5 h-5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button className="w-full flex items-center gap-3 p-3 rounded-suwappu-lg hover:bg-suwappu-sakura-light/30 transition-colors group">
          <div className="w-10 h-10 bg-suwappu-sakura-light/50 rounded-suwappu-md flex items-center justify-center group-hover:bg-suwappu-sakura-light transition-colors">
            <svg className="w-5 h-5 text-suwappu-magenta-mid" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="font-heading font-semibold text-suwappu-text">Help & Support</div>
            <div className="text-xs text-suwappu-text-secondary">FAQ & contact</div>
          </div>
          <svg className="w-5 h-5 text-suwappu-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  ),
}

export const QuickActions: Story = {
  render: () => (
    <div className="flex gap-3">
      <button className="flex flex-col items-center gap-2 p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 hover:shadow-suwappu-3 hover:-translate-y-0.5 transition-all w-24">
        <div className="w-12 h-12 bg-gradient-to-br from-suwappu-sakura-light to-suwappu-rose rounded-suwappu-lg flex items-center justify-center">
          <svg className="w-6 h-6 text-suwappu-purple-deep" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </div>
        <span className="font-heading font-semibold text-sm text-suwappu-text">Send</span>
      </button>

      <button className="flex flex-col items-center gap-2 p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 hover:shadow-suwappu-3 hover:-translate-y-0.5 transition-all w-24">
        <div className="w-12 h-12 bg-gradient-to-br from-suwappu-cyan to-suwappu-blue rounded-suwappu-lg flex items-center justify-center">
          <svg className="w-6 h-6 text-suwappu-navy" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
        </div>
        <span className="font-heading font-semibold text-sm text-suwappu-text">Receive</span>
      </button>

      <button className="flex flex-col items-center gap-2 p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 hover:shadow-suwappu-3 hover:-translate-y-0.5 transition-all w-24">
        <div className="w-12 h-12 bg-gradient-to-br from-suwappu-success to-green-400 rounded-suwappu-lg flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
        <span className="font-heading font-semibold text-sm text-suwappu-text">Swap</span>
      </button>

      <button className="flex flex-col items-center gap-2 p-4 bg-white rounded-suwappu-xl shadow-suwappu-2 border border-suwappu-sakura-mid/20 hover:shadow-suwappu-3 hover:-translate-y-0.5 transition-all w-24">
        <div className="w-12 h-12 bg-gradient-to-br from-suwappu-purple to-suwappu-magenta-mid rounded-suwappu-lg flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <span className="font-heading font-semibold text-sm text-suwappu-text">Stats</span>
      </button>
    </div>
  ),
}

export const ConnectionStatus: Story = {
  render: () => (
    <div className="space-y-3 w-80">
      {/* Connected */}
      <div className="flex items-center gap-3 p-4 bg-suwappu-success/10 border border-suwappu-success/30 rounded-suwappu-xl">
        <div className="w-10 h-10 bg-suwappu-success/20 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="font-heading font-semibold text-green-800">Connected</div>
          <div className="text-sm text-green-700">Wallet linked to your account</div>
        </div>
      </div>

      {/* Pending */}
      <div className="flex items-center gap-3 p-4 bg-suwappu-warning/10 border border-suwappu-warning/30 rounded-suwappu-xl">
        <div className="w-10 h-10 bg-suwappu-warning/20 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-orange-600 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="font-heading font-semibold text-orange-800">Connecting...</div>
          <div className="text-sm text-orange-700">Please approve in your wallet</div>
        </div>
      </div>

      {/* Error */}
      <div className="flex items-center gap-3 p-4 bg-suwappu-error/10 border border-suwappu-error/30 rounded-suwappu-xl">
        <div className="w-10 h-10 bg-suwappu-error/20 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="font-heading font-semibold text-red-800">Connection Failed</div>
          <div className="text-sm text-red-700">User rejected the request</div>
        </div>
      </div>
    </div>
  ),
}

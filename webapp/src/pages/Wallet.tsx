import { useState, useCallback, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AppLayout, AppHeader } from '../components/layout'
import { AddressCard, TokenItem } from '../components/cards'
import { ChainSelector, Toast } from '../components/ui'
import { useHaptic } from '../hooks/useHaptic'
import { useAuth } from '../contexts/AuthContext'
import { useWallet, chains as walletChains, chainMeta } from '../hooks/useWallet'
import { usePortfolio } from '../hooks/usePortfolio'
import type { Token } from '../types/api'

// Chain options for the selector - aligned with useWallet
const chains = [
  { id: 'all', name: 'All', icon: '●' },
  { id: '1', name: 'Ethereum', icon: 'Ξ' },
  { id: '56', name: 'BSC', icon: '🔶' },
  { id: '137', name: 'Polygon', icon: '⬡' },
  { id: '42161', name: 'Arbitrum', icon: '🔷' },
]

// Token icon mapping
const tokenIcons: Record<string, string> = {
  ETH: 'Ξ',
  WETH: 'Ξ',
  USDC: '💵',
  USDT: '💵',
  DAI: '◇',
  MATIC: '⬡',
  BNB: '🔶',
  ARB: '🔷',
  PEPE: '🐸',
  SOL: '◎',
}

function getTokenIcon(symbol: string): string {
  return tokenIcons[symbol.toUpperCase()] || '●'
}

function formatTokenBalance(balance: string): string {
  const num = parseFloat(balance)
  if (isNaN(num)) return '0'
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(2) + 'K'
  if (num >= 1) return num.toFixed(4)
  return num.toFixed(6)
}

function formatUsdValue(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

type WalletView = 'overview' | 'receive' | 'send' | 'connect'

// Loading skeleton for balances
function BalancesSkeleton() {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
      <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
        <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Balances</span>
      </div>
      <div className="divide-y divide-suwappu-sakura-mid/10">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 p-2 animate-pulse">
            <div className="w-9 h-9 rounded-full bg-suwappu-sakura-light" />
            <div className="flex-1">
              <div className="h-4 bg-suwappu-sakura-light rounded w-16 mb-1" />
              <div className="h-3 bg-suwappu-sakura-light/50 rounded w-24" />
            </div>
            <div className="text-right">
              <div className="h-4 bg-suwappu-sakura-light rounded w-20 mb-1" />
              <div className="h-3 bg-suwappu-sakura-light/50 rounded w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Empty state when no tokens
function EmptyBalances({ selectedChain }: { selectedChain: string }) {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-6 text-center">
      <div className="w-12 h-12 mx-auto mb-2 bg-suwappu-sakura-light rounded-full flex items-center justify-center">
        <span className="text-2xl">💰</span>
      </div>
      <p className="font-heading font-semibold text-suwappu-purple-deep mb-1">No tokens found</p>
      <p className="text-xs text-suwappu-text-secondary">
        {selectedChain === 'all' ? 'Your wallet is empty. Deposit some tokens to get started!' : `No tokens on this chain`}
      </p>
    </div>
  )
}

// Connect wallet prompt
function ConnectWalletPrompt({ 
  onCreatePasskey, 
  isLoading,
  isPlatformAuthAvailable,
  isPasskeySupported,
}: { 
  onCreatePasskey: () => void
  isLoading: boolean
  isPlatformAuthAvailable: boolean
  isPasskeySupported: boolean
}) {
  return (
    <div className="p-3 pb-20 space-y-4">
      <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
        <div className="w-16 h-16 mx-auto mb-3 bg-suwappu-gradient rounded-full flex items-center justify-center">
          <span className="text-white text-2xl">🔐</span>
        </div>
        <h2 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">
          Create Your Wallet
        </h2>
        <p className="text-sm text-suwappu-text-secondary mb-3">
          Secure your funds with a passkey wallet
        </p>
        
        {/* Provider badges */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 rounded-full">
            <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.41 16.09l-4.24-4.24 1.41-1.41 2.83 2.83 5.66-5.66 1.41 1.41-7.07 7.07z"/>
            </svg>
            <span className="text-xs font-semibold text-blue-600">Telegram</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 bg-purple-50 rounded-full">
            <svg className="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
            </svg>
            <span className="text-xs font-semibold text-purple-600">Turnkey</span>
          </div>
        </div>

        {isPasskeySupported && isPlatformAuthAvailable ? (
          <button
            onClick={onCreatePasskey}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
                Create Passkey Wallet
              </>
            )}
          </button>
        ) : (
          <div className="bg-suwappu-warning/10 border border-suwappu-warning/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-warning">
              {!isPasskeySupported 
                ? 'Passkeys are not supported in this browser.'
                : 'Face ID / Touch ID not available on this device.'}
            </p>
          </div>
        )}
      </div>

      <div className="bg-suwappu-sakura-light/50 rounded-suwappu-lg p-3 space-y-2">
        <p className="text-xs text-suwappu-text">
          <strong>🔐 How it works:</strong>
        </p>
        <ul className="text-xs text-suwappu-text-secondary space-y-1 ml-4 list-disc">
          <li><strong>Telegram</strong> — Your identity & login</li>
          <li><strong>Turnkey</strong> — Secure key management (TEE-backed)</li>
          <li><strong>Passkey</strong> — Face ID / Touch ID protection</li>
        </ul>
        <p className="text-xs text-suwappu-text-secondary italic">
          No seed phrases. Your keys never leave secure hardware.
        </p>
      </div>
    </div>
  )
}

// Receive view with QR code
function ReceiveView({ 
  address, 
  chainId,
  onBack 
}: { 
  address: string
  chainId: number
  onBack: () => void 
}) {
  const [copied, setCopied] = useState(false)
  const [showToast, setShowToast] = useState(false)
  const haptic = useHaptic()
  const chain = walletChains.find(c => c.id === chainId)
  const meta = chainMeta[chainId]

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address)
      haptic.success()
      setCopied(true)
      setShowToast(true)
      setTimeout(() => {
        setCopied(false)
        setShowToast(false)
      }, 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = address
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      haptic.success()
      setCopied(true)
      setShowToast(true)
      setTimeout(() => {
        setCopied(false)
        setShowToast(false)
      }, 2000)
    }
  }

  return (
    <AppLayout
      header={<AppHeader title="Receive" showBack onBack={onBack} />}
      activeNav="wallet"
    >
      <Toast 
        message="Address copied to clipboard!" 
        isVisible={showToast} 
        type="success"
        onClose={() => setShowToast(false)}
      />
      <div className="p-3 pb-20 space-y-4">
        <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
          {/* Chain indicator */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-suwappu-sakura-light rounded-full mb-3">
            <span className="text-sm">{meta?.icon || 'Ξ'}</span>
            <span className="text-xs font-heading font-medium text-suwappu-text">
              {chain?.name || 'Ethereum'}
            </span>
          </div>

          {/* QR Code */}
          <div className="w-48 h-48 mx-auto mb-4 bg-white rounded-suwappu-lg p-3 shadow-suwappu-1">
            <QRCodeSVG
              value={address}
              size={168}
              level="M"
              includeMargin={false}
              bgColor="#FFFFFF"
              fgColor="#1a1a2e"
            />
          </div>

          {/* Address */}
          <p className="font-mono text-xs text-suwappu-text break-all mb-4 px-4">
            {address}
          </p>

          {/* Copy button */}
          <button
            onClick={copyAddress}
            className="px-6 py-2.5 bg-suwappu-gradient text-white font-heading font-semibold text-sm rounded-suwappu-pill shadow-suwappu-button flex items-center justify-center gap-2 mx-auto"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Address
              </>
            )}
          </button>
        </div>

        <div className="bg-suwappu-info/10 border border-suwappu-info/20 rounded-suwappu-lg p-3">
          <p className="text-xs text-suwappu-info">
            <strong>⚠️ Important:</strong> Only send {chain?.name || 'Ethereum'} compatible tokens to this address. 
            Sending tokens from other networks may result in permanent loss.
          </p>
        </div>
      </div>
    </AppLayout>
  )
}

// Send view
function SendView({ 
  address: _fromAddress, // Used when implementing actual send transaction
  chainId,
  tokens,
  onBack,
}: { 
  address: string
  chainId: number
  tokens: Token[]
  onBack: () => void 
}) {
  const [toAddress, setToAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [selectedToken, setSelectedToken] = useState<Token | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showTokenSelect, setShowTokenSelect] = useState(false)

  // Filter tokens for current chain
  const chainTokens = tokens.filter(t => t.chain === String(chainId) || t.chain === 'ethereum')

  // Select first token by default
  useEffect(() => {
    if (chainTokens.length > 0 && !selectedToken) {
      setSelectedToken(chainTokens[0])
    }
  }, [chainTokens, selectedToken])

  const handleMax = () => {
    if (selectedToken) {
      setAmount(selectedToken.balance)
    }
  }

  const handleSend = async () => {
    if (!toAddress || !amount || !selectedToken) {
      setError('Please fill in all fields')
      return
    }

    // Basic validation
    if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress)) {
      setError('Invalid address format')
      return
    }

    const amountNum = parseFloat(amount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Invalid amount')
      return
    }

    if (amountNum > parseFloat(selectedToken.balance)) {
      setError('Insufficient balance')
      return
    }

    setError(null)
    setIsSending(true)

    try {
      // TODO: Implement actual send transaction via Turnkey
      // Will use _fromAddress as the sender, toAddress as recipient
      // For now, show a coming soon message
      console.log('Send from:', _fromAddress, 'to:', toAddress, 'amount:', amount, selectedToken?.symbol)
      alert('Send functionality coming soon! This will use Turnkey to sign and broadcast the transaction.')
    } catch (err: any) {
      setError(err.message || 'Failed to send transaction')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <AppLayout
      header={<AppHeader title="Send" showBack onBack={onBack} />}
      activeNav="wallet"
    >
      <div className="p-3 pb-20 space-y-4">
        {/* To Address */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <label className="text-xs text-suwappu-text-secondary mb-1 block">To Address</label>
          <input
            type="text"
            value={toAddress}
            onChange={(e) => setToAddress(e.target.value)}
            placeholder="0x..."
            className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
          />
        </div>

        {/* Amount */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-suwappu-text-secondary">Amount</label>
            <span className="text-xs text-suwappu-text-secondary">
              Balance: {selectedToken ? formatTokenBalance(selectedToken.balance) : '0'} {selectedToken?.symbol || ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="flex-1 px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-suwappu-magenta-mid/30"
            />
            <button 
              onClick={() => setShowTokenSelect(!showTokenSelect)}
              className="px-3 py-2 bg-suwappu-sakura-light rounded-suwappu-lg flex items-center gap-1.5"
            >
              <span>{selectedToken ? getTokenIcon(selectedToken.symbol) : '●'}</span>
              <span className="text-sm font-heading font-semibold">{selectedToken?.symbol || 'Select'}</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          <button 
            onClick={handleMax}
            className="text-xs text-suwappu-magenta-mid font-medium mt-2"
          >
            Max
          </button>

          {/* Token selector dropdown */}
          {showTokenSelect && chainTokens.length > 0 && (
            <div className="mt-2 border-t border-suwappu-sakura-mid/20 pt-2 space-y-1">
              {chainTokens.map((token) => (
                <button
                  key={`${token.chain}-${token.address}`}
                  onClick={() => {
                    setSelectedToken(token)
                    setShowTokenSelect(false)
                  }}
                  className={`w-full flex items-center gap-2 p-2 rounded-suwappu-lg transition-colors ${
                    selectedToken?.address === token.address 
                      ? 'bg-suwappu-gradient text-white' 
                      : 'hover:bg-suwappu-sakura-light/50'
                  }`}
                >
                  <span className="text-lg">{getTokenIcon(token.symbol)}</span>
                  <span className="font-heading font-medium text-sm">{token.symbol}</span>
                  <span className="ml-auto text-xs opacity-75">{formatTokenBalance(token.balance)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Network Fee */}
        <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-suwappu-text-secondary">Estimated Network Fee</span>
            <span className="text-suwappu-text">~$2.50</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-error">{error}</p>
          </div>
        )}

        {/* Send button */}
        <button 
          onClick={handleSend}
          disabled={isSending || !toAddress || !amount || !selectedToken}
          className="w-full px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSending ? (
            <>
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Sending...
            </>
          ) : (
            'Review Transaction'
          )}
        </button>
      </div>
    </AppLayout>
  )
}

export function Wallet() {
  const [view, setView] = useState<WalletView>('overview')
  const [selectedChain, setSelectedChain] = useState('all')
  
  // Get auth context for wallet creation
  const { 
    linkedWallets,
    isLoading: authLoading, 
    error: authError,
    createPasskeyWallet,
    isPasskeySupported,
    isPlatformAuthAvailable,
    walletInfo,
  } = useAuth()

  // Get wallet state from useWallet hook
  const {
    address,
    isConnected,
    isLoading: walletLoading,
    chainId,
    switchChain,
  } = useWallet()

  // Get portfolio data
  const { 
    data: portfolio, 
    isLoading: portfolioLoading, 
    error: portfolioError,
    refetch: refetchPortfolio,
  } = usePortfolio()

  // Determine the wallet address to display
  const displayAddress = address || linkedWallets?.[0]?.address || walletInfo?.address || null

  // Check if we have a wallet
  const hasWallet = isConnected || linkedWallets?.length > 0 || !!walletInfo

  // Handle creating passkey wallet
  const handleCreatePasskey = useCallback(async () => {
    await createPasskeyWallet()
    // Refetch portfolio after wallet creation
    refetchPortfolio()
  }, [createPasskeyWallet, refetchPortfolio])

  // Filter tokens based on selected chain
  const filteredTokens = portfolio?.tokens?.filter(token => {
    if (selectedChain === 'all') return true
    return token.chain === selectedChain
  }) || []

  // Handle chain selection
  const handleChainSelect = (chainIdStr: string) => {
    setSelectedChain(chainIdStr)
    if (chainIdStr !== 'all') {
      const chainIdNum = parseInt(chainIdStr, 10)
      if (!isNaN(chainIdNum)) {
        switchChain(chainIdNum)
      }
    }
  }

  // Loading state
  const isLoading = authLoading || walletLoading

  // Show receive view
  if (view === 'receive' && displayAddress) {
    return (
      <ReceiveView 
        address={displayAddress} 
        chainId={chainId}
        onBack={() => setView('overview')} 
      />
    )
  }

  // Show send view
  if (view === 'send' && displayAddress) {
    return (
      <SendView 
        address={displayAddress}
        chainId={chainId}
        tokens={portfolio?.tokens || []}
        onBack={() => setView('overview')} 
      />
    )
  }

  // Main overview
  return (
    <AppLayout header={<AppHeader title="Wallet" />} activeNav="wallet">
      {isLoading ? (
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1 animate-pulse">
            <div className="h-4 bg-suwappu-sakura-light rounded w-24 mb-2" />
            <div className="h-5 bg-suwappu-sakura-light rounded w-40" />
          </div>
          <BalancesSkeleton />
        </div>
      ) : !hasWallet ? (
        <ConnectWalletPrompt 
          onCreatePasskey={handleCreatePasskey}
          isLoading={authLoading}
          isPlatformAuthAvailable={isPlatformAuthAvailable}
          isPasskeySupported={isPasskeySupported}
        />
      ) : (
        <div className="p-3 pb-20 space-y-4 overflow-hidden">
          {/* Wallet address card */}
          {displayAddress && (
            <AddressCard address={displayAddress} label="Your Wallet" />
          )}

          {/* Chain selector */}
          <ChainSelector
            chains={chains}
            selected={selectedChain}
            onSelect={handleChainSelect}
          />

          {/* Portfolio total value */}
          {portfolio && (
            <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
              <p className="text-xs text-suwappu-text-secondary mb-1">Total Balance</p>
              <p className="font-heading font-bold text-xl text-suwappu-purple-deep">
                {formatUsdValue(portfolio.totalUsdValue)}
              </p>
            </div>
          )}

          {/* Balances */}
          {portfolioLoading ? (
            <BalancesSkeleton />
          ) : portfolioError ? (
            <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-xl p-4 text-center">
              <p className="text-sm font-heading font-semibold text-suwappu-error mb-2">
                Failed to load balances
              </p>
              <button
                onClick={() => refetchPortfolio()}
                className="px-4 py-2 bg-suwappu-gradient text-white text-sm font-heading font-bold rounded-suwappu-pill"
              >
                Try Again
              </button>
            </div>
          ) : filteredTokens.length === 0 ? (
            <EmptyBalances selectedChain={selectedChain} />
          ) : (
            <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 overflow-hidden">
              <div className="px-3 py-2 border-b border-suwappu-sakura-mid/10">
                <span className="font-heading font-semibold text-sm text-suwappu-purple-deep">Balances</span>
              </div>
              <div className="divide-y divide-suwappu-sakura-mid/10">
                {filteredTokens.map((token) => (
                  <TokenItem
                    key={`${token.chain}-${token.address}`}
                    symbol={token.symbol}
                    name={token.name}
                    balance={formatTokenBalance(token.balance)}
                    value={formatUsdValue(token.usdValue)}
                    icon={getTokenIcon(token.symbol)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setView('receive')}
              disabled={!displayAddress}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              Receive
            </button>
            <button
              onClick={() => setView('send')}
              disabled={!displayAddress || filteredTokens.length === 0}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold text-sm rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1 disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              Send
            </button>
          </div>

          {/* Error display */}
          {authError && (
            <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-suwappu-error">{authError}</p>
            </div>
          )}
        </div>
      )}
    </AppLayout>
  )
}

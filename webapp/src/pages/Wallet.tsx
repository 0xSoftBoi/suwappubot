import { useState, useCallback, useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  isAddress,
  getAddress,
  keccak256,
  encodeFunctionData,
} from 'viem'
import { AppLayout, AppHeader } from '../components/layout'
import { AddressCard, TokenItem } from '../components/cards'
import { ChainSelector } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useWallet, chains as walletChains, chainMeta, getRpcUrl } from '../hooks/useWallet'
import { usePortfolio } from '../hooks/usePortfolio'
import { useTurnkeyAccount } from '../hooks/useTurnkeyAccount'
import { getExplorerTxUrl } from '../lib/chains'
import type { Token } from '../types/api'
import a11yToast from '../lib/a11yToast'

// chainId -> explorer chain key (must match webapp/src/lib/chains.ts CHAIN_DISPLAY)
const CHAIN_ID_TO_EXPLORER_KEY: Record<number, string> = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  137: 'polygon',
  8453: 'base',
  42161: 'arbitrum',
  11155111: 'sepolia',
}

// Portfolio token.chain values are chain *names* (e.g. "ethereum", "bsc"), not
// numeric chainIds — this maps them onto the numeric chainId the send tx is
// actually built for, so token lists never silently mismatch the active chain.
const CHAIN_NAME_TO_ID: Record<string, number> = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  sepolia: 11155111,
}

function nameToChainId(name: string): number | null {
  return CHAIN_NAME_TO_ID[(name || '').toLowerCase().trim()] ?? null
}

// Minimal ERC-20 ABI for balance-precise transfers
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ETH_SENTINEL_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

// Allowlist-only nativeness check. Symbol matching is deliberately NOT used —
// a scam/fake ERC-20 token that names itself "BNB" would otherwise be routed
// through a native-currency transfer instead of an ERC-20 transfer.
function isNativeToken(token: Token): boolean {
  const addr = (token.address || '').toLowerCase().trim()
  return addr === '' || addr === ZERO_ADDRESS || addr === ETH_SENTINEL_ADDRESS
}

// Strict decimal string: digits, optional single ".", no scientific notation,
// no trailing garbage (rejects "1e5", "1.5abc", "", ".", "1.2.3").
const STRICT_DECIMAL_RE = /^\d+(\.\d+)?$/

function isStrictDecimal(value: string): boolean {
  return STRICT_DECIMAL_RE.test(value.trim())
}

// Per-chain fee floors so low-fee EVM chains don't get stuck with an
// under-priced tx that never confirms. Applied to the actual send, not just
// the preview estimate.
async function getFeeOverrides(
  publicClient: ReturnType<typeof createPublicClient>,
  chainId: number
): Promise<{ gasPrice?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> {
  if (chainId === 56) {
    // BSC: legacy gasPrice floor of 0.1 gwei.
    const floor = parseUnits('0.1', 9)
    const estimate = await publicClient.getGasPrice().catch(() => 0n)
    return { gasPrice: estimate > floor ? estimate : floor }
  }
  if (chainId === 137) {
    // Polygon: EIP-1559 priority fee floor of 30 gwei (chain-specific norm).
    const floor = parseUnits('30', 9)
    const fees = await publicClient.estimateFeesPerGas().catch(() => null)
    const maxPriorityFeePerGas =
      fees?.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > floor ? fees.maxPriorityFeePerGas : floor
    const maxFeePerGas =
      fees?.maxFeePerGas && fees.maxFeePerGas > maxPriorityFeePerGas
        ? fees.maxFeePerGas
        : maxPriorityFeePerGas * 2n
    return { maxFeePerGas, maxPriorityFeePerGas }
  }
  return {}
}

// Errors that mean the transaction is already on its way to (or in) the
// mempool — a retry here would double-send, so these are treated as success,
// not failure.
function isAlreadySubmittedError(message: string): boolean {
  return /already known|nonce too low|already exists|replacement transaction underpriced/i.test(message)
}

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

        {isPasskeySupported ? (
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
              Passkeys are not supported in this browser.
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
          <li><strong>Passkey</strong> — Device-level authentication</li>
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
  const chain = walletChains.find(c => c.id === chainId)
  const meta = chainMeta[chainId]

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = address
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <AppLayout
      header={<AppHeader title="Receive" showBack onBack={onBack} />}
      activeNav="wallet"
    >
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
type SendStep = 'form' | 'confirm' | 'success'

function SendView({
  address: fromAddress,
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

  const [step, setStep] = useState<SendStep>('form')
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  const [isEstimatingFee, setIsEstimatingFee] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  // 'ok' = confirmed submitted; 'uncertain' = signed + hash known but the
  // broadcast RPC call itself errored, so we genuinely don't know if it made
  // it to the mempool. Never treated the same as a clean failure.
  const [broadcastStatus, setBroadcastStatus] = useState<'ok' | 'uncertain' | null>(null)
  const [decimals, setDecimals] = useState<number>(18)

  const { account: turnkeyAccount, isLoading: isAccountLoading, error: accountError } = useTurnkeyAccount()

  // Guards against a double "Confirm & Send" tap firing two in-flight signs.
  const inFlightRef = useRef(false)

  // C2: token.chain is a chain *name* ("ethereum"/"bsc"/...), not a numeric
  // chainId — map it before comparing. No "|| ethereum" fallback: a token
  // that doesn't resolve to the active chain must never show up here.
  const chainTokens = tokens.filter(t => nameToChainId(t.chain) === chainId)
  const chain = walletChains.find(c => c.id === chainId)

  // Select first token by default
  useEffect(() => {
    if (chainTokens.length > 0 && !selectedToken) {
      setSelectedToken(chainTokens[0])
    }
  }, [chainTokens, selectedToken])

  // C1: the portfolio API currently returns a literal "0x..." placeholder
  // contract address for every ERC-20 token (api/webapp.py get_my_portfolio),
  // which is not a valid address. Sending would build a tx to a garbage
  // address and throw only after the user has already confirmed. Gate it
  // here instead: any non-native token with an unusable address is disabled
  // in the picker and blocks review. Native tokens don't need a token
  // contract address at all, so they're unaffected.
  function tokenIsSendable(token: Token): boolean {
    if (isNativeToken(token)) return true
    return isAddress(token.address, { strict: false })
  }

  // Fetch on-chain decimals whenever the selected token changes, so amount
  // validation and Max both use the real precision instead of assuming 18.
  useEffect(() => {
    let cancelled = false
    async function loadDecimals() {
      if (!selectedToken || !chain) return
      if (isNativeToken(selectedToken)) {
        if (!cancelled) setDecimals(chain.nativeCurrency.decimals ?? 18)
        return
      }
      if (!tokenIsSendable(selectedToken)) {
        if (!cancelled) setDecimals(18)
        return
      }
      try {
        const publicClient = createPublicClient({ chain, transport: http(getRpcUrl(chainId)) })
        const d = await publicClient.readContract({
          address: getAddress(selectedToken.address),
          abi: ERC20_ABI,
          functionName: 'decimals',
        })
        if (!cancelled) setDecimals(d)
      } catch {
        if (!cancelled) setDecimals(18)
      }
    }
    loadDecimals()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToken?.address, selectedToken?.chain, chain?.id])

  // H4: for native tokens "Max" must reserve enough for gas, otherwise the
  // send always fails with insufficient-funds. For ERC-20s the balance is
  // paid in the token itself (gas comes from the separate native balance),
  // so the full balance is a valid Max.
  const handleMax = async () => {
    if (!selectedToken) return
    if (!isNativeToken(selectedToken) || !chain) {
      setAmount(selectedToken.balance)
      return
    }
    try {
      const publicClient = createPublicClient({ chain, transport: http(getRpcUrl(chainId)) })
      const balanceWei = parseUnits(selectedToken.balance, decimals)
      const gasPrice = await publicClient.getGasPrice()
      const gasLimit = 21000n
      const buffer = (gasPrice * gasLimit * 3n) / 2n // 1.5x buffer
      const maxSendable = balanceWei > buffer ? balanceWei - buffer : 0n
      setAmount(formatUnits(maxSendable, decimals))
    } catch {
      // Fee data unavailable — fall back to full balance rather than blocking Max entirely.
      setAmount(selectedToken.balance)
    }
  }

  function validate(signerAddress: string | null): string | null {
    if (!toAddress || !amount || !selectedToken) {
      return 'Please fill in all fields'
    }
    if (!isAddress(toAddress, { strict: false })) {
      return 'Invalid address format'
    }
    if (!tokenIsSendable(selectedToken)) {
      return 'Token contract unavailable for this token.'
    }
    if (!isStrictDecimal(amount)) {
      return 'Enter a plain decimal amount (e.g. 1.5) — no scientific notation.'
    }
    const compareAddress = signerAddress || fromAddress
    if (toAddress.toLowerCase() === compareAddress.toLowerCase()) {
      return "You can't send to your own address"
    }
    let amountUnits: bigint
    let balanceUnits: bigint
    try {
      amountUnits = parseUnits(amount, decimals)
      balanceUnits = parseUnits(selectedToken.balance, decimals)
    } catch {
      return 'Invalid amount'
    }
    if (amountUnits <= 0n) {
      return 'Invalid amount'
    }
    if (amountUnits > balanceUnits) {
      return 'Insufficient balance'
    }
    return null
  }

  // Move from the form to the confirmation step and estimate the network fee.
  const handleReview = async () => {
    const validationError = validate(turnkeyAccount?.address ?? null)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setStep('confirm')
    setEstimatedFee(null)

    if (!chain || !selectedToken) return
    setIsEstimatingFee(true)
    try {
      const publicClient = createPublicClient({ chain, transport: http(getRpcUrl(chainId)) })
      const native = isNativeToken(selectedToken)
      const signerAddress = (turnkeyAccount?.address ?? fromAddress) as `0x${string}`
      const [gasPrice, gasEstimate] = await Promise.all([
        publicClient.getGasPrice(),
        native
          ? publicClient.estimateGas({
              account: signerAddress,
              to: toAddress as `0x${string}`,
              value: 1n, // preview only — the actual send re-estimates gas itself
            }).catch(() => 21000n)
          : Promise.resolve(65000n), // typical ERC-20 transfer gas; the actual send re-estimates
      ])
      const feeWei = gasPrice * gasEstimate
      setEstimatedFee(`~${formatEther(feeWei)} ${chain.nativeCurrency.symbol}`)
    } catch {
      setEstimatedFee('Unknown (network unavailable)')
    } finally {
      setIsEstimatingFee(false)
    }
  }

  // Actually sign + broadcast, using the Turnkey-backed viem account (self-custody —
  // the server never sees or holds this key; signing happens client-side via passkey).
  const handleConfirmSend = async () => {
    // H2: hard reentrancy guard — a double tap on "Confirm & Send" must never
    // fire two signs. isSending alone isn't enough (it's async-set via React
    // state and can lag a fast double-click).
    if (inFlightRef.current) return
    inFlightRef.current = true

    try {
      // H3: previously a silent `return` — dead button with no feedback.
      if (!selectedToken || !chain) {
        setError("This network isn't supported for sending yet.")
        return
      }

      if (!turnkeyAccount) {
        a11yToast.error('Wallet signer unavailable. Please reconnect your wallet and try again.')
        return
      }

      // C3: the address shown/validated in the UI comes from the portfolio's
      // wallet record, but signing uses the Turnkey account. If they ever
      // diverge (stale session, multi-wallet edge case), refuse rather than
      // silently sign with a different key than the one the user reviewed.
      if (turnkeyAccount.address.toLowerCase() !== fromAddress.toLowerCase()) {
        a11yToast.error("Signing wallet doesn't match the wallet shown. Please reload and try again.")
        setStep('form')
        return
      }

      const validationError = validate(turnkeyAccount.address)
      if (validationError) {
        setError(validationError)
        setStep('form')
        return
      }

      setError(null)
      setIsSending(true)

      const walletClient = createWalletClient({
        account: turnkeyAccount,
        chain,
        transport: http(getRpcUrl(chainId)),
      })
      const publicClient = createPublicClient({ chain, transport: http(getRpcUrl(chainId)) })

      const native = isNativeToken(selectedToken)
      const toAddr = getAddress(toAddress)
      const feeOverrides = await getFeeOverrides(publicClient, chainId)

      let serializedTransaction: `0x${string}`
      try {
        // H1: sign and broadcast as two explicit steps. We compute the tx
        // hash from the signed payload BEFORE broadcasting, so if the RPC
        // call to broadcast itself errors (timeout, dropped connection) we
        // still know the real hash and can tell the user to check the
        // explorer instead of silently letting them retry into a double-send.
        if (native) {
          const value = parseUnits(amount, decimals)
          const request = await walletClient.prepareTransactionRequest({
            account: turnkeyAccount,
            chain,
            to: toAddr,
            value,
            ...feeOverrides,
          })
          serializedTransaction = await walletClient.signTransaction(request as any)
        } else {
          const tokenAddress = getAddress(selectedToken.address)
          const value = parseUnits(amount, decimals)
          const data = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [toAddr, value],
          })
          const request = await walletClient.prepareTransactionRequest({
            account: turnkeyAccount,
            chain,
            to: tokenAddress,
            data,
            ...feeOverrides,
          })
          serializedTransaction = await walletClient.signTransaction(request as any)
        }
      } catch (signErr: any) {
        const message: string = signErr?.shortMessage || signErr?.message || 'Failed to sign transaction'
        if (/user rejected|denied/i.test(message)) {
          a11yToast.error('Signing was cancelled.')
        } else if (/insufficient funds/i.test(message)) {
          a11yToast.error("You don't have enough balance to cover this send plus network fees.")
        } else {
          a11yToast.error(message)
        }
        setStep('confirm')
        return
      }

      const hash = keccak256(serializedTransaction)
      setTxHash(hash)

      try {
        await publicClient.sendRawTransaction({ serializedTransaction })
        setBroadcastStatus('ok')
        setStep('success')
        a11yToast.success('Transaction submitted.')
      } catch (broadcastErr: any) {
        const message: string = broadcastErr?.shortMessage || broadcastErr?.message || 'Broadcast failed'
        if (isAlreadySubmittedError(message)) {
          // The node is telling us it already has this tx — that's success, not failure.
          setBroadcastStatus('ok')
          setStep('success')
          a11yToast.success('Transaction submitted.')
        } else {
          // Genuinely unknown outcome — we have a real signed hash but no
          // confirmation the network received it. Surface the hash and stop;
          // do NOT re-enable Confirm (leaving the confirm step re-mounted
          // would invite a duplicate signed transaction with the same nonce).
          setBroadcastStatus('uncertain')
          setStep('success')
          a11yToast.warning('Your transaction may already have been broadcast — check the explorer before retrying.')
        }
      }
    } finally {
      setIsSending(false)
      inFlightRef.current = false
    }
  }

  // Success / uncertain-broadcast view
  if (step === 'success' && txHash && selectedToken) {
    const explorerKey = chain ? CHAIN_ID_TO_EXPLORER_KEY[chain.id] || 'ethereum' : 'ethereum'
    const uncertain = broadcastStatus === 'uncertain'
    return (
      <AppLayout header={<AppHeader title="Send" showBack onBack={onBack} />} activeNav="wallet">
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 text-center">
            <div
              className={`w-14 h-14 mx-auto mb-3 rounded-full flex items-center justify-center ${
                uncertain ? 'bg-suwappu-warning/15' : 'bg-suwappu-success/15'
              }`}
            >
              {uncertain ? (
                <svg className="w-7 h-7 text-suwappu-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-8.99 3.75h.008v.008h-.008v-.008z" />
                </svg>
              ) : (
                <svg className="w-7 h-7 text-suwappu-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <h2 className="font-heading font-bold text-lg text-suwappu-purple-deep mb-1">
              {uncertain ? 'Broadcast Status Unknown' : 'Transaction Submitted'}
            </h2>
            <p className="text-sm text-suwappu-text-secondary mb-3">
              {uncertain
                ? `Your transaction was signed but we couldn't confirm it reached the network. It may already have been broadcast — check the explorer before retrying.`
                : `Sent ${amount} ${selectedToken.symbol} to ${toAddress.slice(0, 6)}...${toAddress.slice(-4)}`}
            </p>
            <p className="font-mono text-xs text-suwappu-text break-all mb-4 px-2">{txHash}</p>
            {(() => {
              const explorerHref = getExplorerTxUrl(explorerKey, txHash)
              return explorerHref ? (
                <a
                  href={explorerHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-6 py-2.5 bg-suwappu-gradient text-white font-heading font-semibold text-sm rounded-suwappu-pill shadow-suwappu-button"
                >
                  View on Explorer
                </a>
              ) : null
            })()}
          </div>
          {uncertain && (
            <div className="bg-suwappu-warning/10 border border-suwappu-warning/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-suwappu-warning">
                Do not retry this send until you've confirmed on the explorer whether it went through — retrying
                could send funds twice.
              </p>
            </div>
          )}
          <button
            onClick={onBack}
            className="w-full px-4 py-3 bg-white text-suwappu-magenta-mid font-heading font-bold text-sm rounded-suwappu-pill border-2 border-suwappu-sakura-mid shadow-suwappu-1"
          >
            Done
          </button>
          {!uncertain && (
            <div className="bg-suwappu-info/10 border border-suwappu-info/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-suwappu-info">
                It may take a minute for the transaction to confirm and for balances to update.
              </p>
            </div>
          )}
        </div>
      </AppLayout>
    )
  }

  // Confirmation view
  if (step === 'confirm' && selectedToken) {
    return (
      <AppLayout header={<AppHeader title="Confirm Send" showBack onBack={() => setStep('form')} />} activeNav="wallet">
        <div className="p-3 pb-20 space-y-4">
          <div className="bg-white rounded-suwappu-xl p-4 shadow-suwappu-1 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-suwappu-text-secondary">Sending</span>
              <span className="font-heading font-bold text-suwappu-purple-deep">
                {amount} {selectedToken.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-suwappu-text-secondary">To</span>
              <span className="font-mono text-xs text-suwappu-text">
                {toAddress.slice(0, 8)}...{toAddress.slice(-6)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-suwappu-text-secondary">Network</span>
              <span className="text-suwappu-text">{chain?.name || 'Ethereum'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-suwappu-text-secondary">Estimated Network Fee</span>
              <span className="text-suwappu-text">
                {isEstimatingFee ? 'Estimating...' : estimatedFee || 'Unknown'}
              </span>
            </div>
          </div>

          <div className="bg-suwappu-warning/10 border border-suwappu-warning/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-warning">
              Double-check the recipient address. Crypto transactions can't be reversed once confirmed.
            </p>
          </div>

          {error && (
            <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
              <p className="text-xs text-suwappu-error">{error}</p>
            </div>
          )}

          <button
            onClick={handleConfirmSend}
            disabled={isSending || isAccountLoading || !turnkeyAccount}
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
              'Confirm & Send'
            )}
          </button>
          <button
            onClick={() => setStep('form')}
            disabled={isSending}
            className="w-full px-4 py-3 bg-white text-suwappu-text-secondary font-heading font-medium text-sm rounded-suwappu-pill border border-suwappu-sakura-mid disabled:opacity-50"
          >
            Back
          </button>
        </div>
      </AppLayout>
    )
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
            className="w-full px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-suwappu-magenta-mid/30"
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
              className="flex-1 px-3 py-2 bg-suwappu-sakura-light/50 rounded-suwappu-lg text-sm font-mono focus:outline-hidden focus:ring-2 focus:ring-suwappu-magenta-mid/30"
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
          {showTokenSelect && (
            <div className="mt-2 border-t border-suwappu-sakura-mid/20 pt-2 space-y-1">
              {chainTokens.length === 0 && (
                <p className="text-xs text-suwappu-text-secondary p-2">No tokens on this chain.</p>
              )}
              {chainTokens.map((token) => {
                const sendable = tokenIsSendable(token)
                // M6: compare full identity (chain + symbol + address), not just
                // address — every placeholder "0x..." token would otherwise
                // collide and all highlight simultaneously.
                const isSelected =
                  selectedToken?.chain === token.chain &&
                  selectedToken?.symbol === token.symbol &&
                  selectedToken?.address === token.address
                return (
                  <button
                    key={`${token.chain}-${token.symbol}-${token.address}`}
                    onClick={() => {
                      if (!sendable) return
                      setSelectedToken(token)
                      setShowTokenSelect(false)
                    }}
                    disabled={!sendable}
                    title={sendable ? undefined : 'Token contract unavailable for this token.'}
                    aria-disabled={!sendable}
                    className={`w-full flex items-center gap-2 p-2 rounded-suwappu-lg transition-colors ${
                      !sendable
                        ? 'opacity-40 cursor-not-allowed'
                        : isSelected
                          ? 'bg-suwappu-gradient text-white'
                          : 'hover:bg-suwappu-sakura-light/50'
                    }`}
                  >
                    <span className="text-lg">{getTokenIcon(token.symbol)}</span>
                    <span className="font-heading font-medium text-sm">{token.symbol}</span>
                    {!sendable && <span className="text-[10px] text-suwappu-error">unavailable</span>}
                    <span className="ml-auto text-xs opacity-75">{formatTokenBalance(token.balance)}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Signer status */}
        {!isAccountLoading && !turnkeyAccount && (
          <div className="bg-suwappu-warning/10 border border-suwappu-warning/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-warning">
              {accountError
                ? 'Wallet signer unavailable. Please reconnect your wallet.'
                : 'Sign in with your passkey to enable sending.'}
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-suwappu-error/10 border border-suwappu-error/20 rounded-suwappu-lg p-3">
            <p className="text-xs text-suwappu-error">{error}</p>
          </div>
        )}

        {/* Send button */}
        <button
          onClick={handleReview}
          disabled={
            isSending ||
            !toAddress ||
            !amount ||
            !selectedToken ||
            (selectedToken ? !tokenIsSendable(selectedToken) : false)
          }
          className="w-full px-4 py-3 bg-suwappu-gradient text-white font-heading font-bold text-sm rounded-suwappu-pill shadow-suwappu-button disabled:opacity-50 flex items-center justify-center gap-2"
        >
          Review Transaction
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

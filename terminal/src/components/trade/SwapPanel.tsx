import { useState } from 'react'
import { OrderTabs } from './OrderTabs'
import { TokenInput } from '../swap/TokenInput'
import { QuoteComparison } from '../swap/QuoteComparison'
import { SlippageControl } from '../swap/SlippageControl'
import { LimitOrderPanel } from './LimitOrderPanel'
import { DCAPanel } from './DCAPanel'
import { useSwapQuote } from '../../hooks/useSwapQuote'
import { useSwapExecute } from '../../hooks/useSwapExecute'
import { useAuth } from '../../contexts/AuthContext'
import type { SwapToken, SwapQuoteRequest } from '../../types/api'
import toast from 'react-hot-toast'

type OrderTab = 'swap' | 'limit' | 'dca'

export function SwapPanel() {
  const { isAuthenticated } = useAuth()
  const [activeTab, setActiveTab] = useState<OrderTab>('swap')
  const [fromToken, setFromToken] = useState<SwapToken | null>(null)
  const [toToken, setToToken] = useState<SwapToken | null>(null)
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(0.5)

  const quoteRequest: Partial<SwapQuoteRequest> | null = fromToken && toToken && amount ? {
    fromToken: fromToken.address,
    toToken: toToken.address,
    fromChain: fromToken.chain,
    toChain: toToken.chain,
    amount,
    fromDecimals: fromToken.decimals,
    slippage,
  } : null

  const { data: quote, isLoading: quoteLoading, error: quoteError } = useSwapQuote(quoteRequest)
  const { mutate: executeSwap, isPending: executing } = useSwapExecute()

  const handleSwap = () => {
    if (!quote) return
    executeSwap(
      { quoteId: quote.id },
      {
        onSuccess: (result) => {
          toast.success(`Swap ${result.status}: ${result.swap.fromAmount} ${result.swap.fromToken} → ${result.swap.expectedToAmount} ${result.swap.toToken}`)
          setAmount('')
        },
        onError: (err: unknown) => {
          const message = err && typeof err === 'object' && 'detail' in err
            ? (err as { detail: string }).detail
            : 'Swap failed'
          toast.error(message)
        },
      }
    )
  }

  const flipTokens = () => {
    const temp = fromToken
    setFromToken(toToken)
    setToToken(temp)
    setAmount('')
  }

  if (activeTab === 'limit') {
    return (
      <div className="p-4">
        <OrderTabs active={activeTab} onSelect={setActiveTab} />
        <LimitOrderPanel />
      </div>
    )
  }

  if (activeTab === 'dca') {
    return (
      <div className="p-4">
        <OrderTabs active={activeTab} onSelect={setActiveTab} />
        <DCAPanel />
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <OrderTabs active={activeTab} onSelect={setActiveTab} />

      {/* From Token */}
      <TokenInput
        label="From"
        token={fromToken}
        amount={amount}
        onAmountChange={setAmount}
        onTokenSelect={setFromToken}
        showBalance
      />

      {/* Flip button */}
      <div className="flex justify-center -my-1">
        <button
          onClick={flipTokens}
          className="w-8 h-8 rounded-full bg-terminal-bg-tertiary border border-terminal-border
                     flex items-center justify-center text-terminal-text-secondary
                     hover:text-sakura-400 hover:border-sakura-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        </button>
      </div>

      {/* To Token */}
      <TokenInput
        label="To"
        token={toToken}
        amount={quote?.toAmount || ''}
        onTokenSelect={setToToken}
        readOnly
      />

      {/* Slippage */}
      <SlippageControl value={slippage} onChange={setSlippage} />

      {/* Quote details */}
      {quote && <QuoteComparison quote={quote} />}

      {/* Quote error */}
      {quoteError && (
        <div className="text-sm text-red-400 bg-bear-dim rounded px-3 py-2">
          {(quoteError as { detail?: string }).detail || 'Failed to get quote'}
        </div>
      )}

      {/* Execute button */}
      <button
        onClick={handleSwap}
        disabled={!quote || executing || !isAuthenticated}
        className={`terminal-button w-full py-3 text-base font-semibold ${
          !isAuthenticated ? 'bg-terminal-bg-tertiary text-terminal-text-muted' : ''
        }`}
      >
        {!isAuthenticated
          ? 'Connect Wallet'
          : executing
            ? 'Executing...'
            : quoteLoading
              ? 'Getting Quote...'
              : quote
                ? `Swap ${fromToken?.symbol} → ${toToken?.symbol}`
                : 'Enter Amount'
        }
      </button>
    </div>
  )
}

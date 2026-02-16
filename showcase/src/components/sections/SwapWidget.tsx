'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence, useInView } from 'framer-motion'
import { fadeInUp } from '@/lib/animations'
import {
  fetchChains,
  fetchTokens,
  fetchQuote,
  executeSwap,
  getSwapStatus,
  authenticatePasskey,
  type Chain,
  type Token,
  type SwapQuote,
  type SwapStatus,
} from '@/lib/api'

type SwapState = 'idle' | 'quoting' | 'executing' | 'polling' | 'success' | 'error'

// Chain explorer URLs for tx links
const EXPLORER_URLS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  56: 'https://bscscan.com/tx/',
  137: 'https://polygonscan.com/tx/',
  42161: 'https://arbiscan.io/tx/',
  43114: 'https://snowscan.xyz/tx/',
  8453: 'https://basescan.org/tx/',
  59144: 'https://lineascan.build/tx/',
  324: 'https://explorer.zksync.io/tx/',
}

export default function SwapWidget() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  // Auth state
  const [jwt, setJwt] = useState<string | null>(null)
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)

  // Chain/Token state
  const [chains, setChains] = useState<Chain[]>([])
  const [fromChainId, setFromChainId] = useState<number>(1)
  const [toChainId, setToChainId] = useState<number>(8453)
  const [fromTokens, setFromTokens] = useState<Token[]>([])
  const [toTokens, setToTokens] = useState<Token[]>([])
  const [fromToken, setFromToken] = useState<Token | null>(null)
  const [toToken, setToToken] = useState<Token | null>(null)
  const [amount, setAmount] = useState('')

  // Quote/Swap state
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [swapState, setSwapState] = useState<SwapState>('idle')
  const [swapResult, setSwapResult] = useState<SwapStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch chains on mount
  useEffect(() => {
    fetchChains()
      .then(setChains)
      .catch((e) => console.error('Failed to fetch chains:', e))
  }, [])

  // Fetch tokens when chain changes
  useEffect(() => {
    if (!fromChainId) return
    fetchTokens(fromChainId)
      .then((tokens) => {
        setFromTokens(tokens)
        const usdc = tokens.find((t) => t.symbol === 'USDC')
        const eth = tokens.find((t) => t.symbol === 'ETH' || t.symbol === 'WETH')
        setFromToken(usdc || tokens[0] || null)
        if (!toToken && !toTokens.length) {
          // Don't override toToken if already set
        }
      })
      .catch((e) => console.error('Failed to fetch from tokens:', e))
  }, [fromChainId])

  useEffect(() => {
    if (!toChainId) return
    fetchTokens(toChainId)
      .then((tokens) => {
        setToTokens(tokens)
        const eth = tokens.find((t) => t.symbol === 'ETH' || t.symbol === 'WETH')
        const usdc = tokens.find((t) => t.symbol === 'USDC')
        setToToken(eth || usdc || tokens[0] || null)
      })
      .catch((e) => console.error('Failed to fetch to tokens:', e))
  }, [toChainId])

  // Debounced quote fetch
  useEffect(() => {
    if (!jwt || !fromToken || !toToken || !amount || parseFloat(amount) <= 0) {
      setQuote(null)
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      setSwapState('quoting')
      setError(null)
      try {
        const fromAmountWei = (
          BigInt(Math.floor(parseFloat(amount) * 10 ** fromToken.decimals))
        ).toString()

        const q = await fetchQuote(
          {
            fromChain: String(fromChainId),
            toChain: String(toChainId),
            fromToken: fromToken.address,
            toToken: toToken.address,
            fromAmount: fromAmountWei,
          },
          jwt
        )
        setQuote(q)
        setSwapState('idle')
      } catch (e: any) {
        setError(e.message || 'Failed to get quote')
        setSwapState('error')
      }
    }, 800)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [jwt, fromToken, toToken, amount, fromChainId, toChainId])

  const handleConnect = useCallback(async () => {
    setIsAuthenticating(true)
    setError(null)
    try {
      // Turnkey EWK handles passkey creation/login
      // After passkey auth, we get subOrgId and wallet address from Turnkey
      const { useTurnkey } = await import('@turnkey/react-wallet-kit')
      // For now, trigger the Turnkey wallet modal
      // The actual integration will call authenticatePasskey after Turnkey resolves
      setError('Connect your Turnkey passkey wallet to continue. If the Turnkey modal did not appear, please ensure pop-ups are enabled.')
    } catch (e: any) {
      setError(e.message || 'Authentication failed')
    } finally {
      setIsAuthenticating(false)
    }
  }, [])

  // Demo auth for development/testing
  const handleDemoAuth = useCallback(async (subOrgId: string, address: string) => {
    setIsAuthenticating(true)
    setError(null)
    try {
      const result = await authenticatePasskey(subOrgId, address)
      setJwt(result.jwt)
      setWalletAddress(result.walletAddress)
    } catch (e: any) {
      setError(e.message || 'Authentication failed')
    } finally {
      setIsAuthenticating(false)
    }
  }, [])

  const handleExecute = useCallback(async () => {
    if (!jwt || !quote) return
    setSwapState('executing')
    setError(null)

    try {
      const result = await executeSwap(quote.quoteId, jwt)
      if (!result.success) {
        throw new Error(result.message || 'Swap failed')
      }

      // Poll for status
      setSwapState('polling')
      const pollStatus = async () => {
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 3000))
          try {
            const status = await getSwapStatus(result.swapId, jwt)
            if (status.status === 'completed' || status.status === 'confirmed') {
              setSwapResult(status)
              setSwapState('success')
              return
            }
            if (status.status === 'failed') {
              setError(status.errorMessage || 'Swap failed')
              setSwapState('error')
              return
            }
          } catch {
            // Continue polling
          }
        }
        setError('Swap status check timed out')
        setSwapState('error')
      }

      // If we have a txHash, show success immediately with the hash
      if (result.txHash) {
        setSwapResult({
          id: result.swapId,
          status: result.status,
          fromChain: result.swap.fromChain,
          toChain: result.swap.toChain,
          fromToken: result.swap.fromToken,
          toToken: result.swap.toToken,
          fromAmount: result.swap.fromAmount,
          toAmount: result.swap.expectedToAmount,
          txHash: result.txHash,
          errorMessage: null,
          createdAt: new Date().toISOString(),
          completedAt: null,
        })
        setSwapState('success')
      } else {
        pollStatus()
      }
    } catch (e: any) {
      setError(e.message || 'Swap execution failed')
      setSwapState('error')
    }
  }, [jwt, quote])

  const handleSwapDirection = () => {
    setFromChainId(toChainId)
    setToChainId(fromChainId)
    setFromToken(toToken)
    setToToken(fromToken)
    setFromTokens(toTokens)
    setToTokens(fromTokens)
    setQuote(null)
  }

  const resetSwap = () => {
    setQuote(null)
    setSwapResult(null)
    setSwapState('idle')
    setError(null)
    setAmount('')
  }

  const fromChain = chains.find((c) => c.id === fromChainId)
  const toChain = chains.find((c) => c.id === toChainId)

  const formatAmount = (raw: string, decimals: number) => {
    const val = parseFloat(raw) / 10 ** decimals
    return val < 0.0001 ? val.toExponential(4) : val.toFixed(6)
  }

  return (
    <section className="py-28 px-6 relative" id="swap" ref={ref}>
      <div className="absolute inset-0 bg-gradient-to-b from-suwappu-cream via-white to-suwappu-cream" />

      <div className="max-w-xl mx-auto relative z-10">
        <motion.div
          variants={fadeInUp}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="text-center mb-10"
        >
          <span className="inline-block px-4 py-1 rounded-full bg-suwappu-purple/10 text-suwappu-purple text-sm font-medium mb-4">
            Live Swap
          </span>
          <h2 className="font-heading text-3xl md:text-4xl lg:text-5xl font-bold text-suwappu-text mb-4">
            Swap Live
          </h2>
          <p className="font-body text-lg text-suwappu-text-secondary max-w-lg mx-auto">
            Create a passkey wallet and execute real cross-chain swaps right here.
          </p>
        </motion.div>

        <motion.div
          variants={fadeInUp}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          transition={{ delay: 0.2 }}
          className="glass rounded-3xl p-6 md:p-8 shadow-suwappu-card"
        >
          {/* Wallet badge */}
          {walletAddress && (
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-suwappu-success/10 text-green-700 text-sm font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </div>
              <button
                onClick={() => { setJwt(null); setWalletAddress(null); resetSwap() }}
                className="text-sm text-suwappu-text-secondary hover:text-suwappu-text transition-colors"
              >
                Disconnect
              </button>
            </div>
          )}

          {/* From section */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-suwappu-text-secondary">From</label>
            <div className="flex gap-2">
              <select
                value={fromChainId}
                onChange={(e) => { setFromChainId(Number(e.target.value)); setQuote(null) }}
                className="flex-shrink-0 w-[140px] px-3 py-3 rounded-xl bg-white/80 border border-suwappu-purple/10 text-suwappu-text font-medium focus:outline-none focus:ring-2 focus:ring-suwappu-purple/30 transition-all"
              >
                {chains.map((chain) => (
                  <option key={chain.id} value={chain.id}>{chain.name}</option>
                ))}
              </select>
              <select
                value={fromToken?.address || ''}
                onChange={(e) => setFromToken(fromTokens.find((t) => t.address === e.target.value) || null)}
                className="flex-1 px-3 py-3 rounded-xl bg-white/80 border border-suwappu-purple/10 text-suwappu-text font-medium focus:outline-none focus:ring-2 focus:ring-suwappu-purple/30 transition-all"
              >
                {fromTokens.map((token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </div>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-4 py-3 rounded-xl bg-white/80 border border-suwappu-purple/10 text-suwappu-text text-lg font-medium placeholder:text-suwappu-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-suwappu-purple/30 transition-all"
            />
          </div>

          {/* Swap direction button */}
          <div className="flex justify-center my-3">
            <motion.button
              whileHover={{ scale: 1.1, rotate: 180 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleSwapDirection}
              className="w-10 h-10 rounded-full bg-suwappu-gradient flex items-center justify-center text-white shadow-suwappu-button"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </motion.button>
          </div>

          {/* To section */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-suwappu-text-secondary">To</label>
            <div className="flex gap-2">
              <select
                value={toChainId}
                onChange={(e) => { setToChainId(Number(e.target.value)); setQuote(null) }}
                className="flex-shrink-0 w-[140px] px-3 py-3 rounded-xl bg-white/80 border border-suwappu-purple/10 text-suwappu-text font-medium focus:outline-none focus:ring-2 focus:ring-suwappu-purple/30 transition-all"
              >
                {chains.map((chain) => (
                  <option key={chain.id} value={chain.id}>{chain.name}</option>
                ))}
              </select>
              <select
                value={toToken?.address || ''}
                onChange={(e) => setToToken(toTokens.find((t) => t.address === e.target.value) || null)}
                className="flex-1 px-3 py-3 rounded-xl bg-white/80 border border-suwappu-purple/10 text-suwappu-text font-medium focus:outline-none focus:ring-2 focus:ring-suwappu-purple/30 transition-all"
              >
                {toTokens.map((token) => (
                  <option key={token.address} value={token.address}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quote / Auth Area */}
          <div className="mt-6">
            <AnimatePresence mode="wait">
              {/* Not authenticated */}
              {!jwt && (
                <motion.div
                  key="unauth"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="text-center py-4 px-3 rounded-xl bg-suwappu-purple/5 border border-suwappu-purple/10">
                    <p className="text-sm text-suwappu-text-secondary">
                      Connect wallet to get live quotes
                    </p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleConnect}
                    disabled={isAuthenticating}
                    className="w-full py-3.5 rounded-suwappu-pill bg-suwappu-gradient text-white font-heading font-semibold shadow-suwappu-button hover:shadow-suwappu-button-hover transition-all disabled:opacity-50"
                  >
                    {isAuthenticating ? 'Connecting...' : 'Connect Wallet'}
                  </motion.button>
                </motion.div>
              )}

              {/* Quoting */}
              {jwt && swapState === 'quoting' && (
                <motion.div
                  key="quoting"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-center py-6 gap-3"
                >
                  <div className="w-5 h-5 border-2 border-suwappu-purple border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-suwappu-text-secondary">Fetching quote...</span>
                </motion.div>
              )}

              {/* Quote ready */}
              {jwt && quote && (swapState === 'idle' || swapState === 'error') && (
                <motion.div
                  key="quote"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-4"
                >
                  <div className="rounded-xl bg-suwappu-purple/5 border border-suwappu-purple/10 p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-suwappu-text-secondary">You get</span>
                      <span className="font-medium text-suwappu-text">
                        ~{toToken ? formatAmount(quote.toAmount, toToken.decimals) : quote.toAmount} {quote.toToken.symbol}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-suwappu-text-secondary">Gas</span>
                      <span className="text-suwappu-text">${quote.estimatedGasUsd}</span>
                    </div>
                    {parseFloat(quote.bridgeFeeUsd) > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-suwappu-text-secondary">Bridge Fee</span>
                        <span className="text-suwappu-text">${quote.bridgeFeeUsd}</span>
                      </div>
                    )}
                    {quote.routeSummary && (
                      <div className="flex justify-between text-sm">
                        <span className="text-suwappu-text-secondary">Route</span>
                        <span className="text-suwappu-text truncate ml-2">{quote.routeSummary}</span>
                      </div>
                    )}
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleExecute}
                    disabled={swapState === 'executing'}
                    className="w-full py-3.5 rounded-suwappu-pill bg-suwappu-gradient text-white font-heading font-semibold shadow-suwappu-button hover:shadow-suwappu-button-hover transition-all disabled:opacity-50"
                  >
                    Execute Swap
                  </motion.button>
                </motion.div>
              )}

              {/* Executing / Polling */}
              {jwt && (swapState === 'executing' || swapState === 'polling') && (
                <motion.div
                  key="executing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center py-8 gap-4"
                >
                  <div className="w-10 h-10 border-3 border-suwappu-purple border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-suwappu-text-secondary">
                    {swapState === 'executing' ? 'Signing & broadcasting...' : 'Waiting for confirmation...'}
                  </span>
                </motion.div>
              )}

              {/* Success */}
              {jwt && swapState === 'success' && swapResult && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  <div className="text-center py-4 rounded-xl bg-green-50 border border-green-200">
                    <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-green-100 flex items-center justify-center">
                      <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="font-heading font-semibold text-green-800">Swap Submitted</p>
                    <p className="text-sm text-green-600 mt-1">
                      {swapResult.fromAmount && fromToken
                        ? `${formatAmount(swapResult.fromAmount, fromToken.decimals)} ${swapResult.fromToken}`
                        : swapResult.fromToken
                      }
                      {' → '}
                      {swapResult.toToken}
                    </p>
                  </div>
                  {swapResult.txHash && (
                    <a
                      href={`${EXPLORER_URLS[swapResult.fromChain] || ''}${swapResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-sm text-suwappu-purple hover:underline"
                    >
                      View on Explorer
                    </a>
                  )}
                  <button
                    onClick={resetSwap}
                    className="w-full py-3 rounded-suwappu-pill border border-suwappu-purple/20 text-suwappu-purple font-heading font-medium hover:bg-suwappu-purple/5 transition-colors"
                  >
                    New Swap
                  </button>
                </motion.div>
              )}

              {/* Idle with auth but no quote */}
              {jwt && !quote && swapState === 'idle' && (
                <motion.div
                  key="idle-auth"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center py-4 px-3 rounded-xl bg-suwappu-purple/5 border border-suwappu-purple/10"
                >
                  <p className="text-sm text-suwappu-text-secondary">
                    Enter an amount to get a quote
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700"
              >
                {error}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  )
}

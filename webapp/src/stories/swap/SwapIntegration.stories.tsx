import React, { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { ChainBadge } from '../../components/swap/ChainBadge'
import { TokenPair } from '../../components/swap/TokenPair'
import { AnimatedNumber } from '../../components/swap/AnimatedNumber'
import { SlippageControl, type SwapSettings } from '../../components/swap/SlippageControl'
import { QuoteComparison, type SwapQuoteResult } from '../../components/swap/QuoteComparison'
import { TransactionTracker, type TransactionStep } from '../../components/swap/TransactionTracker'
import { SwapConfirmation } from '../../components/swap/SwapConfirmation'
import { SwapRouteVisualizer, type RouteHop } from '../../components/swap/SwapRouteVisualizer'
import { SwapHistory, type SwapHistoryEntry, type ChainFilter, type StatusFilter } from '../../components/swap/SwapHistory'
import { LimitOrderPanel, type LimitOrder } from '../../components/swap/LimitOrderPanel'
import { PriceAlertCard, type PriceAlert } from '../../components/swap/PriceAlertCard'
import { DCAScheduler, type DCAPosition } from '../../components/swap/DCAScheduler'
import { SwapImpactGauge } from '../../components/swap/SwapImpactGauge'
import { TokenDiscovery } from '../../components/swap/TokenDiscovery'
import { CopyTradeCard, type Trader } from '../../components/swap/CopyTradeCard'

// ────────────────────────────────────────────────
// Meta
// ────────────────────────────────────────────────

const meta = {
  title: 'Swap/Integration',
  component: () => null,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// ────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────

const now = Date.now()
const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString()
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString()
const hoursFromNow = (h: number) => new Date(now + h * 3600_000).toISOString()

function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-suwappu-bg p-4 font-body">
      {children}
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-heading font-semibold text-suwappu-text text-lg mb-3">
      {children}
    </h2>
  )
}

function SectionSubHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-heading font-semibold text-suwappu-text text-sm mb-2">
      {children}
    </h3>
  )
}

// ────────────────────────────────────────────────
// Shared mock data
// ────────────────────────────────────────────────

const defaultSlippageSettings: SwapSettings = {
  slippage: 0.5,
  slippageMode: 'custom',
  mevProtection: true,
  gasPriority: 'normal',
  deadline: 20,
}

const mockQuotes: SwapQuoteResult[] = [
  {
    id: 'q1',
    provider: 'cow',
    receiveAmount: 3412.57,
    receiveToken: 'USDC',
    rate: 3412.57,
    priceImpact: 0.08,
    gasCostUsd: 1.24,
    estimatedTime: '~15s',
    route: 'ETH > USDC (CoW Batch)',
    badges: ['best-price'],
  },
  {
    id: 'q2',
    provider: 'lifi',
    receiveAmount: 3408.12,
    receiveToken: 'USDC',
    rate: 3408.12,
    priceImpact: 0.12,
    gasCostUsd: 2.15,
    estimatedTime: '~20s',
    route: 'ETH > WETH > USDC',
    badges: ['lowest-gas'],
  },
  {
    id: 'q3',
    provider: 'socket',
    receiveAmount: 3405.89,
    receiveToken: 'USDC',
    rate: 3405.89,
    priceImpact: 0.15,
    gasCostUsd: 3.40,
    estimatedTime: '~5s',
    route: 'ETH > USDC (Uniswap V3)',
    badges: ['fastest'],
  },
]

const mockHistoryEntries: SwapHistoryEntry[] = [
  {
    id: 'h1',
    fromToken: { symbol: 'ETH' },
    toToken: { symbol: 'USDC' },
    fromChain: 'ethereum',
    toChain: 'ethereum',
    fromAmount: 1.5,
    toAmount: 5118.85,
    fromAmountUsd: 5085.0,
    toAmountUsd: 5118.85,
    status: 'completed',
    provider: 'CoW Protocol',
    txHash: '0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    explorerUrl: 'https://etherscan.io/tx/0xa1b2',
    pnl: 33.85,
    pnlPercent: 0.67,
    createdAt: hoursAgo(1),
    completedAt: hoursAgo(0.98),
  },
  {
    id: 'h2',
    fromToken: { symbol: 'USDC' },
    toToken: { symbol: 'SOL' },
    fromChain: 'ethereum',
    toChain: 'solana',
    fromAmount: 2000,
    toAmount: 13.48,
    fromAmountUsd: 2000,
    toAmountUsd: 1996.5,
    status: 'completed',
    provider: 'Wormhole',
    txHash: '0xdef456789...',
    explorerUrl: 'https://etherscan.io/tx/0xdef4',
    pnl: -3.5,
    pnlPercent: -0.18,
    createdAt: hoursAgo(6),
    completedAt: hoursAgo(5.92),
  },
  {
    id: 'h3',
    fromToken: { symbol: 'ARB' },
    toToken: { symbol: 'ETH' },
    fromChain: 'arbitrum',
    toChain: 'arbitrum',
    fromAmount: 800,
    toAmount: 0.285,
    fromAmountUsd: 992.0,
    toAmountUsd: 968.55,
    status: 'completed',
    provider: 'Uniswap V3',
    txHash: '0xarb789abc...',
    explorerUrl: 'https://arbiscan.io/tx/0xarb789',
    pnl: -23.45,
    pnlPercent: -2.36,
    createdAt: daysAgo(1),
    completedAt: new Date(new Date(daysAgo(1)).getTime() + 6000).toISOString(),
  },
  {
    id: 'h4',
    fromToken: { symbol: 'ETH' },
    toToken: { symbol: 'OP' },
    fromChain: 'optimism',
    toChain: 'optimism',
    fromAmount: 0.25,
    toAmount: 475.2,
    fromAmountUsd: 853.14,
    toAmountUsd: 865.61,
    status: 'pending',
    provider: 'Velodrome',
    txHash: '0xop1234...',
    createdAt: hoursAgo(0.05),
  },
  {
    id: 'h5',
    fromToken: { symbol: 'MATIC' },
    toToken: { symbol: 'USDT' },
    fromChain: 'polygon',
    toChain: 'polygon',
    fromAmount: 2000,
    toAmount: 0,
    fromAmountUsd: 1740,
    toAmountUsd: 0,
    status: 'failed',
    provider: 'QuickSwap',
    txHash: '0xfailed...',
    explorerUrl: 'https://polygonscan.com/tx/0xfailed',
    createdAt: daysAgo(2),
  },
  {
    id: 'h6',
    fromToken: { symbol: 'WETH' },
    toToken: { symbol: 'DAI' },
    fromChain: 'base',
    toChain: 'base',
    fromAmount: 0.5,
    toAmount: 1706.25,
    fromAmountUsd: 1700,
    toAmountUsd: 1706.25,
    status: 'completed',
    provider: 'Aerodrome',
    txHash: '0xbase456...',
    explorerUrl: 'https://basescan.org/tx/0xbase456',
    pnl: 6.25,
    pnlPercent: 0.37,
    createdAt: daysAgo(3),
    completedAt: new Date(new Date(daysAgo(3)).getTime() + 9000).toISOString(),
  },
]

const mockLimitOrders: LimitOrder[] = [
  {
    id: 'lo1',
    type: 'buy',
    fromToken: 'USDC',
    toToken: 'ETH',
    price: 3100,
    amount: 1000,
    filled: 0,
    expiry: '7d',
    status: 'active',
    createdAt: hoursAgo(12),
  },
  {
    id: 'lo2',
    type: 'sell',
    fromToken: 'ETH',
    toToken: 'USDC',
    price: 3800,
    amount: 0.5,
    filled: 0.15,
    expiry: '30d',
    status: 'active',
    createdAt: daysAgo(2),
  },
  {
    id: 'lo3',
    type: 'buy',
    fromToken: 'USDC',
    toToken: 'SOL',
    price: 120,
    amount: 500,
    filled: 500,
    expiry: '24h',
    status: 'filled',
    createdAt: daysAgo(1),
  },
]

const mockDCAPositions: DCAPosition[] = [
  {
    id: 'dca1',
    buyToken: 'ETH',
    spendToken: 'USDC',
    amountPerInterval: 100,
    frequency: 'daily',
    completedIntervals: 18,
    totalIntervals: 30,
    totalSpent: 1800,
    totalReceived: 0.534,
    avgPrice: 3370.79,
    currentPrice: 3412.57,
    status: 'active',
    nextExecution: hoursFromNow(6),
    createdAt: daysAgo(18),
  },
  {
    id: 'dca2',
    buyToken: 'SOL',
    spendToken: 'USDC',
    amountPerInterval: 50,
    frequency: 'weekly',
    completedIntervals: 8,
    totalIntervals: 12,
    totalSpent: 400,
    totalReceived: 2.78,
    avgPrice: 143.88,
    currentPrice: 148.32,
    status: 'paused',
    createdAt: daysAgo(56),
  },
]

const mockAlerts: PriceAlert[] = [
  {
    id: 'alert1',
    token: 'Ethereum',
    tokenSymbol: 'ETH',
    currentPrice: 3412.57,
    targetPrice: 3600,
    condition: 'above',
    notifyVia: ['app', 'telegram'],
    repeat: false,
    status: 'active',
    createdAt: daysAgo(3),
  },
  {
    id: 'alert2',
    token: 'Solana',
    tokenSymbol: 'SOL',
    currentPrice: 148.32,
    targetPrice: 130,
    condition: 'below',
    notifyVia: ['telegram'],
    repeat: true,
    status: 'paused',
    createdAt: daysAgo(5),
  },
  {
    id: 'alert3',
    token: 'Bitcoin',
    tokenSymbol: 'BTC',
    currentPrice: 62450.0,
    targetPrice: 65000,
    condition: 'above',
    notifyVia: ['app'],
    repeat: false,
    status: 'triggered',
    createdAt: daysAgo(10),
    triggeredAt: daysAgo(2),
  },
  {
    id: 'alert4',
    token: 'Arbitrum',
    tokenSymbol: 'ARB',
    currentPrice: 1.24,
    targetPrice: 1.50,
    condition: 'above',
    notifyVia: ['app', 'telegram'],
    repeat: false,
    status: 'expired',
    createdAt: daysAgo(14),
  },
]

const mockTraders: Trader[] = [
  {
    id: 'trader1',
    displayName: 'SakuraWhale',
    address: '0x1a2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B',
    verified: true,
    pnl30d: 42580,
    pnlPercent30d: 34.2,
    winRate: 78,
    totalTrades: 342,
    avgTradeSize: 2500,
    riskLevel: 'moderate',
    topTokens: [
      { symbol: 'ETH', chainId: 'ethereum' },
      { symbol: 'SOL', chainId: 'solana' },
      { symbol: 'ARB', chainId: 'arbitrum' },
      { symbol: 'PEPE', chainId: 'ethereum' },
    ],
    recentTrades: [
      { id: 't1', fromToken: 'ETH', toToken: 'USDC', chainId: 'ethereum', amount: 5000, pnl: 320, timestamp: hoursAgo(2) },
      { id: 't2', fromToken: 'SOL', toToken: 'BONK', chainId: 'solana', amount: 1200, pnl: -85, timestamp: hoursAgo(8) },
      { id: 't3', fromToken: 'USDC', toToken: 'ARB', chainId: 'arbitrum', amount: 3000, pnl: 450, timestamp: daysAgo(1) },
    ],
    followers: 1842,
  },
  {
    id: 'trader2',
    displayName: 'DeFi Ronin',
    address: '0x9f8E7d6C5b4A3f2E1d0C9b8A7f6E5d4C3b2A1f0E',
    verified: true,
    pnl30d: 28150,
    pnlPercent30d: 22.8,
    winRate: 72,
    totalTrades: 518,
    avgTradeSize: 1800,
    riskLevel: 'aggressive',
    topTokens: [
      { symbol: 'PEPE', chainId: 'ethereum' },
      { symbol: 'BONK', chainId: 'solana' },
      { symbol: 'WIF', chainId: 'solana' },
    ],
    recentTrades: [
      { id: 't4', fromToken: 'USDC', toToken: 'PEPE', chainId: 'ethereum', amount: 2000, pnl: 680, timestamp: hoursAgo(4) },
      { id: 't5', fromToken: 'SOL', toToken: 'WIF', chainId: 'solana', amount: 800, pnl: 120, timestamp: hoursAgo(12) },
    ],
    followers: 956,
  },
  {
    id: 'trader3',
    displayName: 'Steady Gains',
    address: '0x3a4B5c6D7e8F9a0B1c2D3e4F5a6B7c8D9e0F1a2B',
    verified: false,
    pnl30d: 15420,
    pnlPercent30d: 12.1,
    winRate: 85,
    totalTrades: 156,
    avgTradeSize: 5000,
    riskLevel: 'conservative',
    topTokens: [
      { symbol: 'ETH', chainId: 'ethereum' },
      { symbol: 'USDC', chainId: 'ethereum' },
      { symbol: 'WBTC', chainId: 'ethereum' },
    ],
    recentTrades: [
      { id: 't6', fromToken: 'ETH', toToken: 'WBTC', chainId: 'ethereum', amount: 8000, pnl: 240, timestamp: daysAgo(1) },
      { id: 't7', fromToken: 'USDC', toToken: 'ETH', chainId: 'ethereum', amount: 10000, pnl: 580, timestamp: daysAgo(3) },
    ],
    followers: 2341,
  },
]

const crossChainRouteHops: RouteHop[] = [
  {
    fromToken: 'ETH',
    toToken: 'WETH',
    fromChain: 'ethereum',
    toChain: 'ethereum',
    provider: 'Uniswap V3',
    type: 'swap',
    fee: 0.85,
    estimatedTime: '~15s',
    poolInfo: 'Uniswap V3 0.05%',
  },
  {
    fromToken: 'WETH',
    toToken: 'WETH',
    fromChain: 'ethereum',
    toChain: 'arbitrum',
    provider: 'across',
    type: 'bridge',
    fee: 1.20,
    estimatedTime: '~2min',
  },
  {
    fromToken: 'WETH',
    toToken: 'USDC',
    fromChain: 'arbitrum',
    toChain: 'arbitrum',
    provider: 'Camelot',
    type: 'swap',
    fee: 0.45,
    estimatedTime: '~5s',
    poolInfo: 'Camelot V3 0.3%',
  },
]

// ────────────────────────────────────────────────
// 1. SwapPage
// ────────────────────────────────────────────────

function SwapPageRender() {
  const [settings, setSettings] = useState<SwapSettings>(defaultSlippageSettings)
  const [selectedQuote, setSelectedQuote] = useState('q1')

  return (
    <PageWrapper>
      <div className="max-w-md mx-auto">
        {/* Sakura gradient top bar */}
        <div className="h-1.5 w-full bg-suwappu-gradient rounded-full mb-6" />

        <SectionHeader>Swap</SectionHeader>

        {/* Token Pair */}
        <div className="flex justify-center mb-6">
          <TokenPair
            fromToken={{ symbol: 'ETH', name: 'Ethereum' }}
            toToken={{ symbol: 'USDC', name: 'USD Coin' }}
            fromChain="ethereum"
            toChain="ethereum"
            size="lg"
            showNames
            showArrow
          />
        </div>

        {/* Amount display */}
        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-suwappu-text">
            1.0 ETH
          </div>
          <div className="text-sm text-suwappu-text-secondary mt-1">
            ~ <AnimatedNumber value={3412.57} format="currency" prefix="$" size="sm" />
          </div>
        </div>

        {/* Quote Comparison */}
        <div className="mb-4">
          <SectionSubHeader>Best Routes</SectionSubHeader>
          <QuoteComparison
            quotes={mockQuotes}
            isLoading={false}
            selectedQuoteId={selectedQuote}
            onSelect={setSelectedQuote}
            fromTokenSymbol="ETH"
            toTokenSymbol="USDC"
          />
        </div>

        {/* Slippage Control */}
        <div className="mb-4">
          <SlippageControl
            settings={settings}
            onChange={setSettings}
            chainType="evm"
          />
        </div>

        {/* Swap Impact Gauge compact */}
        <div className="mb-6">
          <SwapImpactGauge
            overallScore={82}
            priceImpact={0.08}
            gasCostUsd={1.24}
            slippageRisk="low"
            liquidityDepth="deep"
            estimatedSavings={2.15}
            variant="compact"
          />
        </div>

        {/* Swap button */}
        <button
          type="button"
          className="w-full rounded-suwappu-pill bg-suwappu-gradient py-3.5 text-base font-heading font-bold text-white shadow-suwappu-button transition-shadow hover:shadow-suwappu-button-hover"
        >
          Swap
        </button>
      </div>
    </PageWrapper>
  )
}

export const SwapPage: Story = {
  args: {} as any,
  render: () => <SwapPageRender />,
}

// ────────────────────────────────────────────────
// 2. SwapWithConfirmation
// ────────────────────────────────────────────────

function SwapWithConfirmationRender() {
  const [settings, setSettings] = useState<SwapSettings>(defaultSlippageSettings)
  const [selectedQuote, setSelectedQuote] = useState('q1')

  return (
    <PageWrapper>
      <div className="max-w-md mx-auto">
        {/* Sakura gradient top bar */}
        <div className="h-1.5 w-full bg-suwappu-gradient rounded-full mb-6" />

        <SectionHeader>Swap</SectionHeader>

        <div className="flex justify-center mb-6">
          <TokenPair
            fromToken={{ symbol: 'ETH', name: 'Ethereum' }}
            toToken={{ symbol: 'USDC', name: 'USD Coin' }}
            fromChain="ethereum"
            toChain="ethereum"
            size="lg"
            showNames
            showArrow
          />
        </div>

        <div className="text-center mb-6">
          <div className="text-2xl font-bold text-suwappu-text">1.0 ETH</div>
          <div className="text-sm text-suwappu-text-secondary mt-1">
            ~ <AnimatedNumber value={3412.57} format="currency" prefix="$" size="sm" />
          </div>
        </div>

        <div className="mb-4">
          <QuoteComparison
            quotes={mockQuotes}
            isLoading={false}
            selectedQuoteId={selectedQuote}
            onSelect={setSelectedQuote}
            fromTokenSymbol="ETH"
            toTokenSymbol="USDC"
          />
        </div>

        <div className="mb-4">
          <SlippageControl settings={settings} onChange={setSettings} chainType="evm" />
        </div>

        <div className="mb-6">
          <SwapImpactGauge
            overallScore={82}
            priceImpact={0.08}
            gasCostUsd={1.24}
            slippageRisk="low"
            liquidityDepth="deep"
            variant="compact"
          />
        </div>

        <button
          type="button"
          className="w-full rounded-suwappu-pill bg-suwappu-gradient py-3.5 text-base font-heading font-bold text-white shadow-suwappu-button"
        >
          Swap
        </button>
      </div>

      {/* Confirmation overlay */}
      <SwapConfirmation
        isOpen={true}
        onConfirm={() => {}}
        onCancel={() => {}}
        fromToken={{ symbol: 'ETH', name: 'Ethereum' }}
        toToken={{ symbol: 'USDC', name: 'USD Coin' }}
        fromChain="ethereum"
        toChain="ethereum"
        fromAmount={1.0}
        toAmount={3412.57}
        fromAmountUsd={3400.0}
        toAmountUsd={3412.57}
        priceImpact={0.08}
        networkFeeUsd={1.24}
        route="ETH > USDC"
        provider="CoW Protocol"
        mevProtected={true}
        slippage={0.5}
        minReceived={3395.5}
        estimatedTime="15s"
        quoteExpiresIn={28}
      />
    </PageWrapper>
  )
}

export const SwapWithConfirmation: Story = {
  args: {} as any,
  render: () => <SwapWithConfirmationRender />,
}

// ────────────────────────────────────────────────
// 3. TransactionInProgress
// ────────────────────────────────────────────────

const midBridgeSteps: TransactionStep[] = [
  {
    id: 'submitting',
    label: 'Transaction Submitted',
    description: 'Swap from ETH to WETH on Ethereum',
    status: 'complete',
    txHash: '0xabc123def456789abc123def456789abc123def456789abc123def456789abcd',
    chainId: 'ethereum',
    explorerUrl: 'https://etherscan.io/tx/0xabc123',
    elapsedSeconds: 18,
  },
  {
    id: 'confirming',
    label: 'Confirmed on Ethereum',
    description: 'Transaction confirmed in 2 blocks',
    status: 'complete',
    chainId: 'ethereum',
    elapsedSeconds: 32,
  },
  {
    id: 'bridging',
    label: 'Bridging to Arbitrum',
    description: 'Transferring WETH via Across Protocol...',
    status: 'active',
    chainId: 'arbitrum',
    elapsedSeconds: 45,
  },
  {
    id: 'destination',
    label: 'Swap on Arbitrum',
    description: 'WETH to USDC via Camelot V3',
    status: 'pending',
    chainId: 'arbitrum',
  },
  {
    id: 'complete',
    label: 'Complete',
    description: 'Tokens delivered to your wallet',
    status: 'pending',
  },
]

export const TransactionInProgress: Story = {
  args: {} as any,
  render: () => (
    <PageWrapper>
      <div className="max-w-md mx-auto space-y-6">
        <SectionHeader>Transaction In Progress</SectionHeader>

        <TransactionTracker
          steps={midBridgeSteps}
          isCrossChain={true}
          fromToken={{ symbol: 'ETH', amount: 1.0 }}
          toToken={{ symbol: 'USDC', amount: 3412.57 }}
          onRetry={() => {}}
          onSwapAgain={() => {}}
          onViewPortfolio={() => {}}
        />

        <div>
          <SectionSubHeader>Route Details</SectionSubHeader>
          <div className="bg-white rounded-suwappu-lg shadow-suwappu-2 border border-suwappu-sakura-200/20 p-4">
            <SwapRouteVisualizer
              hops={crossChainRouteHops}
              mode="expanded"
            />
          </div>
        </div>
      </div>
    </PageWrapper>
  ),
}

// ────────────────────────────────────────────────
// 4. HistoryPage
// ────────────────────────────────────────────────

function HistoryPageRender() {
  const [chainFilter, setChainFilter] = useState<ChainFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  return (
    <PageWrapper>
      <div className="max-w-lg mx-auto">
        <SectionHeader>Swap History</SectionHeader>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-white rounded-suwappu-lg shadow-suwappu-1 p-3 text-center">
            <div className="text-xs text-suwappu-text-secondary mb-1">Total Swaps</div>
            <div className="text-lg font-bold text-suwappu-text">6</div>
          </div>
          <div className="bg-white rounded-suwappu-lg shadow-suwappu-1 p-3 text-center">
            <div className="text-xs text-suwappu-text-secondary mb-1">Volume</div>
            <div className="text-lg font-bold text-suwappu-text">$12.4K</div>
          </div>
          <div className="bg-white rounded-suwappu-lg shadow-suwappu-1 p-3 text-center">
            <div className="text-xs text-suwappu-text-secondary mb-1">Total PnL</div>
            <div className="text-lg font-bold text-green-500">+$13.15</div>
          </div>
        </div>

        <SwapHistory
          entries={mockHistoryEntries}
          chainFilter={chainFilter}
          statusFilter={statusFilter}
          onChainFilterChange={setChainFilter}
          onStatusFilterChange={setStatusFilter}
        />
      </div>
    </PageWrapper>
  )
}

export const HistoryPage: Story = {
  args: {} as any,
  render: () => <HistoryPageRender />,
}

// ────────────────────────────────────────────────
// 5. LimitOrderPage
// ────────────────────────────────────────────────

export const LimitOrderPage: Story = {
  args: {} as any,
  render: () => (
    <PageWrapper>
      <div className="max-w-md mx-auto">
        <SectionHeader>Limit Orders</SectionHeader>

        {/* Market price context */}
        <div className="bg-white rounded-suwappu-lg shadow-suwappu-1 p-4 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TokenPair
              fromToken={{ symbol: 'ETH' }}
              toToken={{ symbol: 'USDC' }}
              fromChain="ethereum"
              toChain="ethereum"
              size="md"
            />
            <span className="text-sm font-medium text-suwappu-text">ETH/USDC</span>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold text-suwappu-text">
              <AnimatedNumber value={3412.57} format="currency" prefix="$" size="sm" />
            </div>
            <div className="text-xs text-green-500 font-medium">+2.34%</div>
          </div>
        </div>

        <LimitOrderPanel
          currentPrice={3412.57}
          fromToken="ETH"
          toToken="USDC"
          onSubmit={() => {}}
          onCancel={() => {}}
          activeOrders={mockLimitOrders}
        />
      </div>
    </PageWrapper>
  ),
}

// ────────────────────────────────────────────────
// 6. DCADashboard
// ────────────────────────────────────────────────

export const DCADashboard: Story = {
  args: {} as any,
  render: () => (
    <PageWrapper>
      <div className="max-w-md mx-auto">
        <SectionHeader>Dollar Cost Average</SectionHeader>

        {/* Performance metrics */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-white rounded-suwappu-lg shadow-suwappu-1 p-3">
            <div className="text-xs text-suwappu-text-secondary mb-1">Total Invested</div>
            <div className="text-lg font-bold text-suwappu-text">$2,200</div>
            <div className="text-xs text-suwappu-text-secondary mt-0.5">across 2 positions</div>
          </div>
          <div className="bg-white rounded-suwappu-lg shadow-suwappu-1 p-3">
            <div className="text-xs text-suwappu-text-secondary mb-1">Unrealized PnL</div>
            <div className="text-lg font-bold text-green-500">+$87.42</div>
            <div className="text-xs text-green-500 font-medium">+3.97%</div>
          </div>
        </div>

        <SectionSubHeader>Active Positions</SectionSubHeader>

        <DCAScheduler
          positions={mockDCAPositions}
          onCreateDCA={() => {}}
          onPauseDCA={() => {}}
          onResumeDCA={() => {}}
          onCancelDCA={() => {}}
        />
      </div>
    </PageWrapper>
  ),
}

// ────────────────────────────────────────────────
// 7. AlertsPage
// ────────────────────────────────────────────────

export const AlertsPage: Story = {
  args: {} as any,
  render: () => (
    <PageWrapper>
      <div className="max-w-md mx-auto">
        <SectionHeader>Price Alerts</SectionHeader>

        <PriceAlertCard
          alerts={mockAlerts}
          onCreateAlert={() => {}}
          onDeleteAlert={() => {}}
          onToggleAlert={() => {}}
        />
      </div>
    </PageWrapper>
  ),
}

// ────────────────────────────────────────────────
// 8. DiscoveryPage
// ────────────────────────────────────────────────

export const DiscoveryPage: Story = {
  args: {} as any,
  render: () => (
    <PageWrapper>
      <div className="max-w-lg mx-auto">
        <SectionHeader>Token Discovery</SectionHeader>

        <TokenDiscovery
          onSelectToken={() => {}}
          onFavorite={() => {}}
          favorites={['eth-1', 'sol-1']}
        />
      </div>
    </PageWrapper>
  ),
}

// ────────────────────────────────────────────────
// 9. CopyTradingPage
// ────────────────────────────────────────────────

export const CopyTradingPage: Story = {
  args: {} as any,
  render: () => (
    <PageWrapper>
      <div className="max-w-lg mx-auto">
        <SectionHeader>Copy Trading</SectionHeader>

        {/* Leaderboard */}
        <SectionSubHeader>Top Traders - 30d</SectionSubHeader>
        <div className="space-y-2 mb-8">
          {mockTraders.map((trader, index) => (
            <CopyTradeCard
              key={trader.id}
              trader={trader}
              variant="leaderboard"
              rank={index + 1}
              isFollowing={index === 0}
              onFollow={() => {}}
              onUnfollow={() => {}}
            />
          ))}
        </div>

        {/* Expanded #1 trader */}
        <SectionSubHeader>Featured Trader</SectionSubHeader>
        <CopyTradeCard
          trader={mockTraders[0]}
          variant="full"
          isFollowing={true}
          onFollow={() => {}}
          onUnfollow={() => {}}
          onConfigureCopy={() => {}}
        />
      </div>
    </PageWrapper>
  ),
}

// ────────────────────────────────────────────────
// 10. FullDashboard
// ────────────────────────────────────────────────

function FullDashboardRender() {
  const [chainFilter, setChainFilter] = useState<ChainFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const connectedChains = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'solana']

  return (
    <PageWrapper>
      <div className="max-w-2xl mx-auto">
        {/* Top bar: Portfolio value + mini gauge */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-suwappu-text-secondary mb-1">Portfolio Value</div>
            <AnimatedNumber
              value={24831.42}
              format="currency"
              prefix="$"
              size="lg"
              colorChange
            />
            <div className="text-xs text-green-500 font-medium mt-0.5">+$412.30 (1.69%) today</div>
          </div>
          <SwapImpactGauge
            overallScore={76}
            priceImpact={0.35}
            gasCostUsd={2.10}
            slippageRisk="low"
            liquidityDepth="moderate"
            variant="mini"
          />
        </div>

        {/* Connected chains row */}
        <div className="mb-6">
          <SectionSubHeader>Connected Chains</SectionSubHeader>
          <div className="flex items-center gap-2 flex-wrap">
            {connectedChains.map((chain) => (
              <ChainBadge key={chain} chainId={chain} size="lg" showLabel />
            ))}
          </div>
        </div>

        {/* 2-column grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: Recent Swaps */}
          <div>
            <SectionSubHeader>Recent Swaps</SectionSubHeader>
            <SwapHistory
              entries={mockHistoryEntries.slice(0, 3)}
              chainFilter={chainFilter}
              statusFilter={statusFilter}
              onChainFilterChange={setChainFilter}
              onStatusFilterChange={setStatusFilter}
            />
          </div>

          {/* Right: Price Alerts */}
          <div>
            <SectionSubHeader>Active Alerts</SectionSubHeader>
            <PriceAlertCard
              alerts={mockAlerts.filter((a) => a.status === 'active' || a.status === 'paused')}
              onCreateAlert={() => {}}
              onDeleteAlert={() => {}}
              onToggleAlert={() => {}}
            />
          </div>
        </div>
      </div>
    </PageWrapper>
  )
}

export const FullDashboard: Story = {
  args: {} as any,
  render: () => <FullDashboardRender />,
}

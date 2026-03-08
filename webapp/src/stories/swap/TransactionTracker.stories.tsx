import type { Meta, StoryObj } from '@storybook/react'
import { TransactionTracker, TransactionStep } from '../../components/swap/TransactionTracker'

const meta = {
  title: 'Swap/TransactionTracker',
  component: TransactionTracker,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TransactionTracker>

export default meta
type Story = StoryObj<typeof meta>

// --- Helper step factories ---

const sameChainSteps = (overrides: Partial<Record<number, Partial<TransactionStep>>>): TransactionStep[] => {
  const base: TransactionStep[] = [
    { id: 'submitting', label: 'Submitting', description: 'Sending to CoW network', status: 'pending' },
    { id: 'confirming', label: 'Confirming', description: 'Waiting for block confirmation...', status: 'pending', chainId: 'ethereum' },
    { id: 'complete', label: 'Complete', description: 'Swap settled on-chain', status: 'pending' },
  ]
  for (const [idx, patch] of Object.entries(overrides)) {
    base[Number(idx)] = { ...base[Number(idx)], ...patch }
  }
  return base
}

const crossChainSteps = (overrides: Partial<Record<number, Partial<TransactionStep>>>): TransactionStep[] => {
  const base: TransactionStep[] = [
    { id: 'submitting', label: 'Submitting', description: 'Sending to CoW network', status: 'pending', chainId: 'ethereum' },
    { id: 'confirming', label: 'Confirming', description: 'Waiting for block confirmation...', status: 'pending', chainId: 'ethereum' },
    { id: 'bridging', label: 'Bridging', description: 'Via Across (~2 min)', status: 'pending' },
    { id: 'destination', label: 'Destination', description: 'Confirming on Arbitrum', status: 'pending', chainId: 'arbitrum' },
    { id: 'complete', label: 'Complete', description: 'Cross-chain swap settled', status: 'pending' },
  ]
  for (const [idx, patch] of Object.entries(overrides)) {
    base[Number(idx)] = { ...base[Number(idx)], ...patch }
  }
  return base
}

// --- Stories ---

export const SameChainSubmitting: Story = {
  args: {
    steps: sameChainSteps({
      0: { status: 'active', elapsedSeconds: 3 },
    }),
    isCrossChain: false,
    fromToken: { symbol: 'ETH', amount: 0.5 },
    toToken: { symbol: 'USDC', amount: 1245.67 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const SameChainConfirming: Story = {
  args: {
    steps: sameChainSteps({
      0: { status: 'complete', elapsedSeconds: 12 },
      1: {
        status: 'active',
        elapsedSeconds: 5,
        txHash: '0x1234567890abcdef1234567890abcdef12345678',
        explorerUrl: 'https://etherscan.io/tx/0x1234567890abcdef',
      },
    }),
    isCrossChain: false,
    fromToken: { symbol: 'ETH', amount: 0.5 },
    toToken: { symbol: 'USDC', amount: 1245.67 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const SameChainSuccess: Story = {
  args: {
    steps: sameChainSteps({
      0: { status: 'complete', elapsedSeconds: 12 },
      1: {
        status: 'complete',
        elapsedSeconds: 24,
        txHash: '0x1234567890abcdef1234567890abcdef12345678',
        explorerUrl: 'https://etherscan.io/tx/0x1234567890abcdef',
      },
      2: { status: 'complete' },
    }),
    isCrossChain: false,
    fromToken: { symbol: 'ETH', amount: 0.5 },
    toToken: { symbol: 'USDC', amount: 1245.67 },
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const CrossChainBridging: Story = {
  args: {
    steps: crossChainSteps({
      0: { status: 'complete', elapsedSeconds: 8 },
      1: {
        status: 'complete',
        elapsedSeconds: 22,
        txHash: '0xaabbccdd11223344aabbccdd11223344aabbccdd',
        explorerUrl: 'https://etherscan.io/tx/0xaabbccdd',
      },
      2: { status: 'active', description: 'Via Across (~2 min)', elapsedSeconds: 45 },
    }),
    isCrossChain: true,
    fromToken: { symbol: 'ETH', amount: 1.0 },
    toToken: { symbol: 'ARB', amount: 3200.0 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const CrossChainSuccess: Story = {
  args: {
    steps: crossChainSteps({
      0: { status: 'complete', elapsedSeconds: 8 },
      1: {
        status: 'complete',
        elapsedSeconds: 22,
        txHash: '0xaabbccdd11223344aabbccdd11223344aabbccdd',
        explorerUrl: 'https://etherscan.io/tx/0xaabbccdd',
      },
      2: { status: 'complete', elapsedSeconds: 130 },
      3: {
        status: 'complete',
        elapsedSeconds: 15,
        txHash: '0x9988776655443322119988776655443322119988',
        explorerUrl: 'https://arbiscan.io/tx/0x99887766',
      },
      4: { status: 'complete' },
    }),
    isCrossChain: true,
    fromToken: { symbol: 'ETH', amount: 1.0 },
    toToken: { symbol: 'ARB', amount: 3200.0 },
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const FailedAtConfirm: Story = {
  args: {
    steps: sameChainSteps({
      0: { status: 'complete', elapsedSeconds: 10 },
      1: {
        status: 'failed',
        description: 'Insufficient liquidity for this trade',
        txHash: '0xdeadbeef00000000deadbeef00000000deadbeef',
        explorerUrl: 'https://etherscan.io/tx/0xdeadbeef',
      },
    }),
    isCrossChain: false,
    fromToken: { symbol: 'PEPE', amount: 50000000 },
    toToken: { symbol: 'ETH', amount: 0.42 },
    onRetry: () => alert('Retry'),
  },
}

export const FailedAtBridge: Story = {
  args: {
    steps: crossChainSteps({
      0: { status: 'complete', elapsedSeconds: 8 },
      1: {
        status: 'complete',
        elapsedSeconds: 22,
        txHash: '0xaabbccdd11223344aabbccdd11223344aabbccdd',
        explorerUrl: 'https://etherscan.io/tx/0xaabbccdd',
      },
      2: { status: 'failed', description: 'Bridge timeout - relayer did not fill within 30 min' },
    }),
    isCrossChain: true,
    fromToken: { symbol: 'USDC', amount: 5000 },
    toToken: { symbol: 'USDC', amount: 4985 },
    onRetry: () => alert('Retry'),
  },
}

export const WithTxHashes: Story = {
  args: {
    steps: crossChainSteps({
      0: {
        status: 'complete',
        elapsedSeconds: 8,
        txHash: '0x1111111111111111111111111111111111111111',
        explorerUrl: 'https://etherscan.io/tx/0x11111111',
      },
      1: {
        status: 'complete',
        elapsedSeconds: 22,
        txHash: '0x2222222222222222222222222222222222222222',
        explorerUrl: 'https://etherscan.io/tx/0x22222222',
      },
      2: {
        status: 'active',
        elapsedSeconds: 60,
        txHash: '0x3333333333333333333333333333333333333333',
        explorerUrl: 'https://across.to/tx/0x33333333',
      },
    }),
    isCrossChain: true,
    fromToken: { symbol: 'WETH', amount: 2.5 },
    toToken: { symbol: 'WETH', amount: 2.497 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const ElapsedTimers: Story = {
  args: {
    steps: sameChainSteps({
      0: { status: 'complete', elapsedSeconds: 45 },
      1: {
        status: 'active',
        elapsedSeconds: 0,
        description: 'Waiting for block confirmation... (watch the timer tick)',
        txHash: '0xabcdef1234567890abcdef1234567890abcdef12',
        explorerUrl: 'https://etherscan.io/tx/0xabcdef',
      },
    }),
    isCrossChain: false,
    fromToken: { symbol: 'DAI', amount: 1000 },
    toToken: { symbol: 'USDT', amount: 999.5 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const MobileViewport: Story = {
  render: (args) => (
    <div className="max-w-[360px] mx-auto">
      <TransactionTracker {...args} />
    </div>
  ),
  args: {
    steps: crossChainSteps({
      0: { status: 'complete', elapsedSeconds: 8 },
      1: {
        status: 'complete',
        elapsedSeconds: 22,
        txHash: '0xaabbccdd11223344aabbccdd11223344aabbccdd',
        explorerUrl: 'https://etherscan.io/tx/0xaabbccdd',
      },
      2: { status: 'active', elapsedSeconds: 90 },
    }),
    isCrossChain: true,
    fromToken: { symbol: 'ETH', amount: 0.1 },
    toToken: { symbol: 'MATIC', amount: 245.8 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const MultiHopCrossChain: Story = {  args: {
    steps: [
      { id: 'submitting', label: 'Token Approval', description: 'Approving USDC spend on Ethereum', status: 'complete', chainId: 'ethereum', elapsedSeconds: 14, txHash: '0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', explorerUrl: 'https://etherscan.io/tx/0xa1b2c3d4e5f6a1b2' },
      { id: 'confirming', label: 'Swap on Source', description: 'Swapping USDC → WETH on Uniswap', status: 'complete', chainId: 'ethereum', elapsedSeconds: 32, txHash: '0xd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5', explorerUrl: 'https://etherscan.io/tx/0xd4e5f6a1b2c3' },
      { id: 'bridging', label: 'Bridging', description: 'Bridging WETH via Stargate (~3 min)', status: 'active', elapsedSeconds: 87 },
      { id: 'destination', label: 'Swap on Destination', description: 'WETH → ARB on Arbitrum', status: 'pending', chainId: 'arbitrum' },
    ] as TransactionStep[],
    isCrossChain: true,
    fromToken: { symbol: 'USDC', amount: 10000 },
    toToken: { symbol: 'ARB', amount: 8450.32 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const SuccessWithConfetti: Story = {  args: {
    steps: [
      { id: 'submitting', label: 'Submitting', description: 'Sending to 1inch aggregator', status: 'complete', elapsedSeconds: 6, chainId: 'ethereum' },
      { id: 'confirming', label: 'Confirming', description: 'Confirmed in block #19,482,117', status: 'complete', elapsedSeconds: 18, chainId: 'ethereum', txHash: '0x7f8e9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f', explorerUrl: 'https://etherscan.io/tx/0x7f8e9a0b1c2d3e4f' },
      { id: 'complete', label: 'Complete', description: 'Swap settled on-chain', status: 'complete' },
    ] as TransactionStep[],
    isCrossChain: false,
    fromToken: { symbol: 'WBTC', amount: 1.85 },
    toToken: { symbol: 'USDC', amount: 52437.90 },
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const FailedAtApproval: Story = {  args: {
    steps: [
      { id: 'submitting', label: 'Token Approval', description: 'Insufficient allowance', status: 'failed', chainId: 'ethereum', txHash: '0xbadcafe000000000badcafe000000000badcafe00', explorerUrl: 'https://etherscan.io/tx/0xbadcafe0000' },
      { id: 'confirming', label: 'Confirming', description: 'Waiting for block confirmation...', status: 'pending', chainId: 'ethereum' },
      { id: 'complete', label: 'Complete', description: 'Swap settled on-chain', status: 'pending' },
    ] as TransactionStep[],
    isCrossChain: false,
    fromToken: { symbol: 'SHIB', amount: 250000000 },
    toToken: { symbol: 'ETH', amount: 1.23 },
    onRetry: () => alert('Retry'),
  },
}

export const SlowBridge: Story = {  args: {
    steps: [
      { id: 'submitting', label: 'Submitting', description: 'Sent to CoW network', status: 'complete', elapsedSeconds: 9, chainId: 'ethereum' },
      { id: 'confirming', label: 'Confirming', description: 'Confirmed on Ethereum', status: 'complete', elapsedSeconds: 26, chainId: 'ethereum', txHash: '0x44556677889900aabbccddeeff44556677889900', explorerUrl: 'https://etherscan.io/tx/0x445566778899' },
      { id: 'bridging', label: 'Bridging', description: 'Via Across — taking longer than usual', status: 'active', elapsedSeconds: 900 },
      { id: 'destination', label: 'Destination', description: 'Confirming on Optimism', status: 'pending', chainId: 'optimism' },
      { id: 'complete', label: 'Complete', description: 'Cross-chain swap settled', status: 'pending' },
    ] as TransactionStep[],
    isCrossChain: true,
    fromToken: { symbol: 'USDC', amount: 25000 },
    toToken: { symbol: 'USDC', amount: 24975 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const RetryAfterFailure: Story = {  args: {
    steps: sameChainSteps({
      0: { status: 'complete', elapsedSeconds: 11 },
      1: {
        status: 'failed',
        description: 'Gas estimation failed: execution reverted',
        txHash: '0xfailed00gas00estimation00reverted00000000',
        explorerUrl: 'https://etherscan.io/tx/0xfailed00gas00',
      },
    }),
    isCrossChain: false,
    fromToken: { symbol: 'UNI', amount: 350 },
    toToken: { symbol: 'WETH', amount: 0.87 },
    onRetry: () => alert('Retry'),
  },
}

export const SolanaSwap: Story = {  args: {
    steps: [
      { id: 'submitting', label: 'Submitting', description: 'Sending to Jupiter aggregator', status: 'complete', elapsedSeconds: 2, chainId: 'solana' },
      { id: 'confirming', label: 'Confirmed', description: 'Finalized in slot #254,891,002', status: 'complete', elapsedSeconds: 4, chainId: 'solana', txHash: '0x5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b', explorerUrl: 'https://solscan.io/tx/5a4b3c2d1e0f9a8b' },
    ] as TransactionStep[],
    isCrossChain: false,
    fromToken: { symbol: 'SOL', amount: 12.5 },
    toToken: { symbol: 'BONK', amount: 48750000 },
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

export const BatchSwaps: Story = {
  args: {} as any,
  render: () => (
    <div className="flex flex-col gap-4">
      <TransactionTracker
        steps={[
          { id: 'submitting', label: 'Submitting', description: 'Sending to CoW network', status: 'complete', elapsedSeconds: 7, chainId: 'ethereum' },
          { id: 'confirming', label: 'Confirming', description: 'Waiting for block confirmation...', status: 'active', elapsedSeconds: 14, chainId: 'ethereum', txHash: '0xbatch01aa11bb22cc33dd44ee55ff66batch01aa', explorerUrl: 'https://etherscan.io/tx/0xbatch01aa11bb22' },
          { id: 'complete', label: 'Complete', description: 'Swap settled on-chain', status: 'pending' },
        ]}
        isCrossChain={false}
        fromToken={{ symbol: 'ETH', amount: 2.0 }}
        toToken={{ symbol: 'USDC', amount: 4891.20 }}
        onRetry={() => alert('Retry')}
        onSwapAgain={() => alert('Swap Again')}
        onViewPortfolio={() => alert('View Portfolio')}
      />
      <TransactionTracker
        steps={[
          { id: 'submitting', label: 'Submitting', description: 'Sending to 1inch aggregator', status: 'complete', elapsedSeconds: 5, chainId: 'arbitrum' },
          { id: 'confirming', label: 'Confirming', description: 'Confirmed in block #192,004,517', status: 'complete', elapsedSeconds: 3, chainId: 'arbitrum', txHash: '0xbatch02ff99ee88dd77cc66bb55aa44batch02ff', explorerUrl: 'https://arbiscan.io/tx/0xbatch02ff99ee88' },
          { id: 'complete', label: 'Complete', description: 'Swap settled on-chain', status: 'complete' },
        ]}
        isCrossChain={false}
        fromToken={{ symbol: 'ARB', amount: 5000 }}
        toToken={{ symbol: 'USDC', amount: 3742.50 }}
        onSwapAgain={() => alert('Swap Again')}
        onViewPortfolio={() => alert('View Portfolio')}
      />
    </div>
  ),
}

export const AllStepStates: Story = {  args: {
    steps: [
      { id: 'submitting', label: 'Token Approval', description: 'Approved LINK spend', status: 'complete', elapsedSeconds: 10, chainId: 'ethereum', txHash: '0xaa00bb11cc22dd33ee44ff55aa00bb11cc22dd33', explorerUrl: 'https://etherscan.io/tx/0xaa00bb11cc22dd33' },
      { id: 'confirming', label: 'Swap Submitted', description: 'Sent to aggregator', status: 'complete', elapsedSeconds: 18, chainId: 'ethereum', txHash: '0xee44ff55aa00bb11cc22dd33ee44ff55aa00bb11', explorerUrl: 'https://etherscan.io/tx/0xee44ff55aa00bb11' },
      { id: 'bridging', label: 'Bridging', description: 'Via Across (~2 min)', status: 'active', elapsedSeconds: 42 },
      { id: 'destination', label: 'Destination Swap', description: 'Will swap on Polygon', status: 'pending', chainId: 'polygon' },
      { id: 'complete', label: 'Complete', description: 'Cross-chain swap settled', status: 'pending' },
    ] as TransactionStep[],
    isCrossChain: true,
    fromToken: { symbol: 'LINK', amount: 500 },
    toToken: { symbol: 'MATIC', amount: 8920.15 },
    onRetry: () => alert('Retry'),
    onSwapAgain: () => alert('Swap Again'),
    onViewPortfolio: () => alert('View Portfolio'),
  },
}

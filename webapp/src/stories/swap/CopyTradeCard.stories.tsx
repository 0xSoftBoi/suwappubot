import type { Meta, StoryObj } from '@storybook/react'
import { CopyTradeCard, type Trader, type TraderTrade } from '../../components/swap/CopyTradeCard'

const meta = {
  title: 'Swap/CopyTradeCard',
  component: CopyTradeCard,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof CopyTradeCard>

export default meta
type Story = StoryObj<typeof meta>

// --- Mock data helpers ---

const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString()
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString()

const makeTrade = (overrides: Partial<TraderTrade> & Pick<TraderTrade, 'id'>): TraderTrade => ({
  fromToken: 'ETH',
  toToken: 'USDC',
  chainId: 'ethereum',
  amount: 2500,
  pnl: 180,
  timestamp: hoursAgo(2),
  ...overrides,
})

const makeTrader = (overrides: Partial<Trader> & Pick<Trader, 'id'>): Trader => ({
  displayName: 'CryptoWhale',
  address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD68',
  verified: true,
  pnl30d: 24500,
  pnlPercent30d: 34.2,
  winRate: 72,
  totalTrades: 342,
  avgTradeSize: 1850,
  riskLevel: 'moderate',
  followers: 1243,
  topTokens: [
    { symbol: 'ETH', chainId: 'ethereum' },
    { symbol: 'ARB', chainId: 'arbitrum' },
    { symbol: 'SOL', chainId: 'solana' },
    { symbol: 'MATIC', chainId: 'polygon' },
  ],
  recentTrades: [
    makeTrade({ id: 't1', fromToken: 'USDC', toToken: 'ETH', amount: 3200, pnl: 420, timestamp: hoursAgo(1) }),
    makeTrade({ id: 't2', fromToken: 'ETH', toToken: 'ARB', chainId: 'arbitrum', amount: 1800, pnl: -95, timestamp: hoursAgo(5) }),
    makeTrade({ id: 't3', fromToken: 'SOL', toToken: 'USDC', chainId: 'solana', amount: 2100, pnl: 310, timestamp: hoursAgo(12) }),
    makeTrade({ id: 't4', fromToken: 'MATIC', toToken: 'ETH', chainId: 'polygon', amount: 950, pnl: 65, timestamp: daysAgo(1) }),
  ],
  ...overrides,
})

const logAction = (name: string) => (...args: unknown[]) => console.log(name, ...args)

// --- Top traders for leaderboard ---

const topTrader = makeTrader({
  id: 'top1',
  displayName: 'SakuraAlpha',
  address: '0xAbC1230000000000000000000000000000000001',
  pnl30d: 82300,
  pnlPercent30d: 127.5,
  winRate: 81,
  totalTrades: 589,
  avgTradeSize: 4200,
  followers: 5820,
})

const secondTrader = makeTrader({
  id: 'top2',
  displayName: 'DeFi Sensei',
  address: '0xDeF4560000000000000000000000000000000002',
  pnl30d: 45200,
  pnlPercent30d: 68.3,
  winRate: 74,
  totalTrades: 412,
  avgTradeSize: 3100,
  followers: 3140,
})

const thirdTrader = makeTrader({
  id: 'top3',
  displayName: 'ChainHopper',
  address: '0x1234560000000000000000000000000000000003',
  pnl30d: 31800,
  pnlPercent30d: 52.1,
  winRate: 69,
  totalTrades: 278,
  avgTradeSize: 2700,
  followers: 2010,
  riskLevel: 'aggressive',
})

// --- Stories ---

export const TopTrader: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <CopyTradeCard
        trader={topTrader}
        onFollow={logAction('onFollow')}
        onUnfollow={logAction('onUnfollow')}
        onConfigureCopy={logAction('onConfigureCopy')}
      />
    </div>
  ),
}

export const NewTrader: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <CopyTradeCard
        trader={makeTrader({
          id: 'new1',
          displayName: 'NewbieDegen',
          address: '0x9876540000000000000000000000000000000099',
          verified: false,
          pnl30d: 1250,
          pnlPercent30d: 8.4,
          winRate: 55,
          totalTrades: 28,
          avgTradeSize: 320,
          riskLevel: 'moderate',
          followers: 12,
          topTokens: [
            { symbol: 'ETH', chainId: 'ethereum' },
            { symbol: 'USDC', chainId: 'base' },
          ],
          recentTrades: [
            makeTrade({ id: 'nt1', fromToken: 'USDC', toToken: 'ETH', amount: 400, pnl: 35, timestamp: hoursAgo(3) }),
            makeTrade({ id: 'nt2', fromToken: 'ETH', toToken: 'USDC', amount: 280, pnl: -12, timestamp: daysAgo(1) }),
          ],
        })}
        onFollow={logAction('onFollow')}
      />
    </div>
  ),
}

export const LosingTrader: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <CopyTradeCard
        trader={makeTrader({
          id: 'loser1',
          displayName: 'PaperHands Pete',
          address: '0xBAD0000000000000000000000000000000000BAD',
          verified: false,
          pnl30d: -8420,
          pnlPercent30d: -42.1,
          winRate: 31,
          totalTrades: 156,
          avgTradeSize: 890,
          riskLevel: 'aggressive',
          followers: 45,
          topTokens: [
            { symbol: 'PEPE', chainId: 'ethereum' },
            { symbol: 'DOGE', chainId: 'bsc' },
            { symbol: 'SHIB', chainId: 'ethereum' },
          ],
          recentTrades: [
            makeTrade({ id: 'lt1', fromToken: 'USDC', toToken: 'PEPE', chainId: 'ethereum', amount: 1200, pnl: -480, timestamp: hoursAgo(2) }),
            makeTrade({ id: 'lt2', fromToken: 'ETH', toToken: 'DOGE', chainId: 'bsc', amount: 800, pnl: -220, timestamp: hoursAgo(8) }),
            makeTrade({ id: 'lt3', fromToken: 'SHIB', toToken: 'USDC', chainId: 'ethereum', amount: 600, pnl: -95, timestamp: daysAgo(1) }),
          ],
        })}
        onFollow={logAction('onFollow')}
      />
    </div>
  ),
}

export const Following: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <CopyTradeCard
        trader={topTrader}
        isFollowing={true}
        onFollow={logAction('onFollow')}
        onUnfollow={logAction('onUnfollow')}
        onConfigureCopy={logAction('onConfigureCopy')}
      />
    </div>
  ),
}

export const CompactVariant: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-sm space-y-2">
      <CopyTradeCard
        trader={topTrader}
        variant="compact"
        onFollow={logAction('onFollow')}
      />
      <CopyTradeCard
        trader={secondTrader}
        variant="compact"
        isFollowing={true}
        onUnfollow={logAction('onUnfollow')}
      />
      <CopyTradeCard
        trader={makeTrader({
          id: 'comp3',
          displayName: 'LossyLarry',
          address: '0xLOSS000000000000000000000000000000000000',
          verified: false,
          pnl30d: -3200,
          pnlPercent30d: -18.5,
          winRate: 38,
          totalTrades: 89,
          avgTradeSize: 500,
          followers: 7,
          riskLevel: 'aggressive',
          topTokens: [],
          recentTrades: [],
        })}
        variant="compact"
        onFollow={logAction('onFollow')}
      />
    </div>
  ),
}

export const LeaderboardVariant: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-lg">
      <CopyTradeCard
        trader={topTrader}
        variant="leaderboard"
        rank={1}
        onFollow={logAction('onFollow')}
      />
    </div>
  ),
}

export const LeaderboardTop3: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-lg space-y-2">
      <CopyTradeCard
        trader={topTrader}
        variant="leaderboard"
        rank={1}
        onFollow={logAction('onFollow')}
      />
      <CopyTradeCard
        trader={secondTrader}
        variant="leaderboard"
        rank={2}
        isFollowing={true}
        onUnfollow={logAction('onUnfollow')}
      />
      <CopyTradeCard
        trader={thirdTrader}
        variant="leaderboard"
        rank={3}
        onFollow={logAction('onFollow')}
      />
    </div>
  ),
}

export const AggressiveRisk: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <CopyTradeCard
        trader={makeTrader({
          id: 'agg1',
          displayName: 'YOLO Trader',
          address: '0xAGG0000000000000000000000000000000000001',
          verified: true,
          pnl30d: 67800,
          pnlPercent30d: 215.3,
          winRate: 58,
          totalTrades: 723,
          avgTradeSize: 8500,
          riskLevel: 'aggressive',
          followers: 4210,
          topTokens: [
            { symbol: 'PEPE', chainId: 'ethereum' },
            { symbol: 'WIF', chainId: 'solana' },
            { symbol: 'BONK', chainId: 'solana' },
            { symbol: 'FLOKI', chainId: 'bsc' },
            { symbol: 'TURBO', chainId: 'ethereum' },
          ],
          recentTrades: [
            makeTrade({ id: 'ag1', fromToken: 'SOL', toToken: 'WIF', chainId: 'solana', amount: 12000, pnl: 4800, timestamp: hoursAgo(1) }),
            makeTrade({ id: 'ag2', fromToken: 'ETH', toToken: 'PEPE', chainId: 'ethereum', amount: 8500, pnl: -3200, timestamp: hoursAgo(4) }),
            makeTrade({ id: 'ag3', fromToken: 'BONK', toToken: 'SOL', chainId: 'solana', amount: 5000, pnl: 2100, timestamp: hoursAgo(9) }),
            makeTrade({ id: 'ag4', fromToken: 'BNB', toToken: 'FLOKI', chainId: 'bsc', amount: 6200, pnl: 1850, timestamp: daysAgo(1) }),
            makeTrade({ id: 'ag5', fromToken: 'TURBO', toToken: 'USDC', chainId: 'ethereum', amount: 3800, pnl: -1400, timestamp: daysAgo(2) }),
          ],
        })}
        onFollow={logAction('onFollow')}
        onConfigureCopy={logAction('onConfigureCopy')}
      />
    </div>
  ),
}

export const ConservativeRisk: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <CopyTradeCard
        trader={makeTrader({
          id: 'con1',
          displayName: 'SteadyEddie',
          address: '0xCON0000000000000000000000000000000000001',
          verified: true,
          pnl30d: 4850,
          pnlPercent30d: 6.8,
          winRate: 88,
          totalTrades: 94,
          avgTradeSize: 950,
          riskLevel: 'conservative',
          followers: 892,
          topTokens: [
            { symbol: 'ETH', chainId: 'ethereum' },
            { symbol: 'WBTC', chainId: 'ethereum' },
            { symbol: 'USDC', chainId: 'arbitrum' },
          ],
          recentTrades: [
            makeTrade({ id: 'cn1', fromToken: 'USDC', toToken: 'ETH', amount: 1000, pnl: 45, timestamp: hoursAgo(6) }),
            makeTrade({ id: 'cn2', fromToken: 'ETH', toToken: 'WBTC', amount: 800, pnl: 32, timestamp: daysAgo(1) }),
            makeTrade({ id: 'cn3', fromToken: 'WBTC', toToken: 'USDC', amount: 1200, pnl: 68, timestamp: daysAgo(3) }),
          ],
        })}
        isFollowing={true}
        onUnfollow={logAction('onUnfollow')}
        onConfigureCopy={logAction('onConfigureCopy')}
      />
    </div>
  ),
}

export const MobileLayout: Story = {
  args: {} as any,
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
  render: () => (
    <div className="max-w-[360px]">
      <CopyTradeCard
        trader={topTrader}
        isFollowing={true}
        onFollow={logAction('onFollow')}
        onUnfollow={logAction('onUnfollow')}
        onConfigureCopy={logAction('onConfigureCopy')}
      />
    </div>
  ),
}

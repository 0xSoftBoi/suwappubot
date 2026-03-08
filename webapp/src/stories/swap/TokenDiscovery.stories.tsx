import type { Meta, StoryObj } from '@storybook/react'
import { TokenDiscovery, MOCK_TOKENS, type DiscoveryToken } from '../../components/swap/TokenDiscovery'

const meta = {
  title: 'Swap/TokenDiscovery',
  component: TokenDiscovery,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TokenDiscovery>

export default meta
type Story = StoryObj<typeof meta>

const logAction = (name: string) => (...args: unknown[]) => console.log(name, ...args)

const recentTokens: DiscoveryToken[] = [
  MOCK_TOKENS[0], // ETH
  MOCK_TOKENS[2], // SOL
  MOCK_TOKENS[5], // USDC
  MOCK_TOKENS[3], // PEPE
  MOCK_TOKENS[9], // AAVE
]

// --- Stories ---

export const Default: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
      />
    </div>
  ),
}

export const SearchResults: Story = {
  args: {} as any,
  render: () => {
    const SearchDemo = () => {
      const ethTokens = MOCK_TOKENS.filter(
        (t) => t.symbol.toLowerCase().includes('eth') || t.name.toLowerCase().includes('eth'),
      )
      return (
        <div className="max-w-md">
          <TokenDiscovery
            onSelectToken={logAction('onSelectToken')}
            onFavorite={logAction('onFavorite')}
          />
          <p className="text-xs text-gray-400 mt-2 px-1">
            Type &quot;ETH&quot; in the search box to see filtered results ({ethTokens.length} matches)
          </p>
        </div>
      )
    }
    return <SearchDemo />
  },
}

export const TrendingTokens: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
      />
      <p className="text-xs text-gray-400 mt-2 px-1">
        Click the &quot;Trending&quot; category pill to filter
      </p>
    </div>
  ),
}

export const MemeTokens: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
      />
      <p className="text-xs text-gray-400 mt-2 px-1">
        Click the &quot;Meme&quot; category pill to see PEPE, DOGE, BONK
      </p>
    </div>
  ),
}

export const StableCoins: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
      />
      <p className="text-xs text-gray-400 mt-2 px-1">
        Click the &quot;Stables&quot; category pill to see USDC, USDT, DAI
      </p>
    </div>
  ),
}

export const WithFavorites: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
        favorites={['eth-1', 'sol-1', 'pepe-1', 'aave-1']}
      />
    </div>
  ),
}

export const RecentlyTraded: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
        recentTokens={recentTokens}
      />
    </div>
  ),
}

export const ChainFiltered: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
      />
      <p className="text-xs text-gray-400 mt-2 px-1">
        Click the &quot;Ethereum&quot; chain pill to filter to ETH-chain tokens only
      </p>
    </div>
  ),
}

export const EmptySearch: Story = {
  args: {} as any,
  render: () => (
    <div className="max-w-md">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
      />
      <p className="text-xs text-gray-400 mt-2 px-1">
        Type a nonsense query like &quot;xyz123&quot; to see the empty state
      </p>
    </div>
  ),
}

export const MobileLayout: Story = {
  args: {} as any,
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  render: () => (
    <div className="max-w-[360px]">
      <TokenDiscovery
        onSelectToken={logAction('onSelectToken')}
        onFavorite={logAction('onFavorite')}
        favorites={['eth-1', 'sol-1']}
        recentTokens={recentTokens.slice(0, 3)}
      />
    </div>
  ),
}

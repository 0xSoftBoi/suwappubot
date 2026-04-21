import { useMemo, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { TerminalButton, TerminalIconButton, TerminalSegmentedTabs, TerminalTextField } from '../../components/foundation/TerminalControls'
import { TerminalKeyValueRow } from '../../components/foundation/TerminalDataDisplay'
import {
  TerminalEmptyState,
  TerminalInset,
  TerminalMetricCard,
  TerminalPage,
  TerminalPanel,
  TerminalPanelHeader,
  TerminalStatusPill,
} from '../../components/foundation/TerminalPrimitives'
import { TerminalWatchlistRow } from '../../components/watchlist/TerminalWatchlistRow'
import type { WatchlistToken } from '../../hooks/useWatchlist'
import type { TokenPriceData } from '../../hooks/useWatchlistPrices'

type WatchlistRow = { token: WatchlistToken; priceData: TokenPriceData }
type LabState = 'populated' | 'empty'

const seedRows: WatchlistRow[] = [
  {
    token: {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      chain: 'ethereum',
    },
    priceData: { price: 3521.15, change24h: 3.42, loading: false },
  },
  {
    token: {
      symbol: 'SOL',
      name: 'Solana',
      address: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
    },
    priceData: { price: 181.82, change24h: -1.34, loading: false },
  },
  {
    token: {
      symbol: 'JUP',
      name: 'Jupiter',
      address: 'JUP111111111111111111111111111111111111111',
      chain: 'solana',
    },
    priceData: { price: 1.24, change24h: 12.18, loading: false },
  },
  {
    token: {
      symbol: 'USDC',
      name: 'USD Coin',
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      chain: 'ethereum',
    },
    priceData: { price: 1, change24h: 0.01, loading: false },
  },
]

function WatchlistLab({ state }: { state: LabState }) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState('active')
  const [selectedAddress, setSelectedAddress] = useState(seedRows[0].token.address)
  const [rows, setRows] = useState<WatchlistRow[]>(state === 'empty' ? [] : seedRows)

  const filteredRows = useMemo(() => {
    if (!query.trim()) return rows
    const q = query.trim().toLowerCase()
    return rows.filter(
      ({ token }) =>
        token.symbol.toLowerCase().includes(q) ||
        token.name.toLowerCase().includes(q) ||
        token.chain.toLowerCase().includes(q),
    )
  }, [query, rows])

  const activeCount = rows.filter((row) => (row.priceData.change24h ?? 0) >= 0).length

  return (
    <TerminalPage>
      <div className="mx-auto grid max-w-7xl gap-4">
        <TerminalPanel elevated>
          <TerminalPanelHeader
            eyebrow={<TerminalStatusPill tone="warm">watchlist slice</TerminalStatusPill>}
            title="Provider-free watchlist rebuild lab"
            description="This is the watchlist rebuilt on top of the new terminal atoms. It avoids live storage and hooks so we can redesign structure, density, and state behavior first."
            meta={<TerminalMetricCard label="Rows" value={String(rows.length)} tone="sky" />}
          />

          <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
            <TerminalInset>
              <div className="flex flex-col gap-3 border-b border-terminal-border pb-4 md:flex-row md:items-center md:justify-between">
                <TerminalTextField
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search watchlist"
                  className="md:w-[260px]"
                  prefix={
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <TerminalIconButton label="Refresh">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </TerminalIconButton>
                  <TerminalButton variant="secondary">Add token</TerminalButton>
                </div>
              </div>

              <div className="mt-4">
                <TerminalSegmentedTabs
                  activeId={view}
                  onChange={setView}
                  options={[
                    { id: 'active', label: 'Active', meta: `${rows.length} rows` },
                    { id: 'gainers', label: 'Gainers', meta: `${activeCount} up` },
                    { id: 'alerts', label: 'Alerts', meta: 'next pass' },
                  ]}
                />
              </div>

              <div className="mt-4 grid gap-3">
                {filteredRows.length === 0 ? (
                  <TerminalEmptyState
                    title="No watchlist tokens yet"
                    description="Use one shared empty-state pattern here instead of custom panel copy. Search and add controls can stay visible while the list is empty."
                    action={<TerminalButton variant="secondary">Seed sample list</TerminalButton>}
                  />
                ) : (
                  filteredRows.map((row) => (
                    <TerminalWatchlistRow
                      key={`${row.token.chain}-${row.token.address}`}
                      token={row.token}
                      priceData={row.priceData}
                      selected={selectedAddress === row.token.address}
                      onOpen={(token) => setSelectedAddress(token.address)}
                      onRemove={(token) =>
                        setRows((current) =>
                          current.filter(
                            (entry) =>
                              !(
                                entry.token.address === token.address &&
                                entry.token.chain === token.chain
                              ),
                          ),
                        )
                      }
                    />
                  ))
                )}
              </div>
            </TerminalInset>

            <TerminalInset>
              <div className="text-[10px] uppercase tracking-[0.22em] text-terminal-text-muted">
                Inspector
              </div>
              <div className="mt-3 grid gap-3">
                <TerminalMetricCard
                  label="Selected"
                  value={
                    filteredRows.find((row) => row.token.address === selectedAddress)?.token.symbol ?? '--'
                  }
                  tone="warm"
                />
                <TerminalKeyValueRow
                  label="Build lesson"
                  value="rows before panel"
                  detail="The old watchlist panel mixed search, row styling, and empty-state treatment in one component."
                />
                <TerminalKeyValueRow
                  label="What is now reusable"
                  value="search, tabs, rows"
                  detail="These parts should be portable into discovery rails and market lists too."
                />
                <TerminalKeyValueRow
                  label="Next extraction"
                  value="detail drawer"
                  detail="Once the row language is stable, build the selected-token side panel with the same primitives."
                />
              </div>
            </TerminalInset>
          </div>
        </TerminalPanel>
      </div>
    </TerminalPage>
  )
}

const meta = {
  title: 'Workbench/Watchlist Rebuild Lab',
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    state: 'populated' as LabState,
  },
  render: ({ state }) => <WatchlistLab state={state} />,
} satisfies Meta<{ state: LabState }>

export default meta

type Story = StoryObj<typeof meta>

export const Populated: Story = {}

export const Empty: Story = {
  args: {
    state: 'empty',
  },
}

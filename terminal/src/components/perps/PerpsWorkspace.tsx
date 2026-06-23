import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { api } from '../../lib/api'
import { useIsMobile } from '../../hooks/useIsMobile'
import { PerpsMarketsBoard } from './PerpsMarketsBoard'
import { PerpsPanel } from './PerpsPanel'
import { PerpsChart } from './PerpsChart'
import { PerpsPositions } from './PositionsTable'
import { PerpsOpenOrders } from './OpenOrdersTable'

// The HyperLiquid perps desk. Markets board (left) + order ticket (right) share a
// single selected market; live positions span the bottom. Desktop uses resizable
// panes; mobile stacks board → ticket → positions.
export function PerpsWorkspace() {
  const isMobile = useIsMobile()
  const [selectedMarket, setSelectedMarket] = useState('ETH-USD')

  const [bottomTab, setBottomTab] = useState<'positions' | 'orders'>('positions')

  const { data: markets } = useQuery({
    queryKey: ['perps-markets'],
    queryFn: () => api.getPerpsMarkets(),
    staleTime: 15_000,
  })

  // Shared bottom panel: tab between live positions and resting open orders.
  const bottomTabBar = (
    <div role="tablist" aria-label="Perps activity" className="flex shrink-0 border-b border-terminal-border">
      {(['positions', 'orders'] as const).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={bottomTab === t}
          onClick={() => setBottomTab(t)}
          className={`px-3 py-2 text-sm font-semibold transition-colors ${
            bottomTab === t
              ? 'border-b-2 border-sakura-500 text-terminal-text'
              : 'text-terminal-text-secondary hover:text-terminal-text'
          }`}
        >
          {t === 'positions' ? 'Positions' : 'Open Orders'}
        </button>
      ))}
    </div>
  )
  const bottomBody = bottomTab === 'positions' ? <PerpsPositions /> : <PerpsOpenOrders />

  if (isMobile) {
    return (
      <div className="flex h-full flex-col divide-y divide-terminal-border overflow-y-auto terminal-panel">
        <div className="min-h-[220px] shrink-0">
          <PerpsMarketsBoard selectedMarket={selectedMarket} onSelectMarket={setSelectedMarket} />
        </div>
        <div className="h-[320px] shrink-0">
          <PerpsChart market={selectedMarket} />
        </div>
        <div className="shrink-0">
          <PerpsPanel
            markets={markets}
            selectedMarket={selectedMarket}
            onSelectMarket={setSelectedMarket}
          />
        </div>
        <div className="flex min-h-[240px] shrink-0 flex-col overflow-hidden">
          {bottomTabBar}
          <div className="min-h-0 flex-1 overflow-auto">{bottomBody}</div>
        </div>
      </div>
    )
  }

  return (
    <Allotment vertical>
      <Allotment.Pane preferredSize="62%" minSize={240}>
        <Allotment>
          <Allotment.Pane preferredSize="30%" minSize={240}>
            <div className="h-full terminal-panel">
              <PerpsMarketsBoard
                selectedMarket={selectedMarket}
                onSelectMarket={setSelectedMarket}
              />
            </div>
          </Allotment.Pane>
          <Allotment.Pane preferredSize="42%" minSize={320}>
            <div className="h-full terminal-panel">
              <PerpsChart market={selectedMarket} />
            </div>
          </Allotment.Pane>
          <Allotment.Pane preferredSize="28%" minSize={300} maxSize={460}>
            <div className="h-full terminal-panel overflow-y-auto">
              <PerpsPanel
                markets={markets}
                selectedMarket={selectedMarket}
                onSelectMarket={setSelectedMarket}
              />
            </div>
          </Allotment.Pane>
        </Allotment>
      </Allotment.Pane>
      <Allotment.Pane preferredSize="38%" minSize={120}>
        <div className="h-full terminal-panel flex flex-col">
          {bottomTabBar}
          <div className="min-h-0 flex-1 overflow-auto">{bottomBody}</div>
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}

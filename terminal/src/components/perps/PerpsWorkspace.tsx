import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { api } from '../../lib/api'
import { useIsMobile } from '../../hooks/useIsMobile'
import { PerpsMarketsBoard } from './PerpsMarketsBoard'
import { PerpsPanel } from './PerpsPanel'
import { PerpsPositions } from './PositionsTable'

// The HyperLiquid perps desk. Markets board (left) + order ticket (right) share a
// single selected market; live positions span the bottom. Desktop uses resizable
// panes; mobile stacks board → ticket → positions.
export function PerpsWorkspace() {
  const isMobile = useIsMobile()
  const [selectedMarket, setSelectedMarket] = useState('ETH-USD')

  const { data: markets } = useQuery({
    queryKey: ['perps-markets'],
    queryFn: () => api.getPerpsMarkets(),
    staleTime: 15_000,
  })

  if (isMobile) {
    return (
      <div className="flex h-full flex-col divide-y divide-terminal-border overflow-y-auto terminal-panel">
        <div className="min-h-[220px] shrink-0">
          <PerpsMarketsBoard selectedMarket={selectedMarket} onSelectMarket={setSelectedMarket} />
        </div>
        <div className="shrink-0">
          <PerpsPanel
            markets={markets}
            selectedMarket={selectedMarket}
            onSelectMarket={setSelectedMarket}
          />
        </div>
        <div className="min-h-[200px] shrink-0 overflow-x-auto">
          <PerpsPositions />
        </div>
      </div>
    )
  }

  return (
    <Allotment vertical>
      <Allotment.Pane preferredSize="62%" minSize={240}>
        <Allotment>
          <Allotment.Pane preferredSize="58%" minSize={320}>
            <div className="h-full terminal-panel">
              <PerpsMarketsBoard
                selectedMarket={selectedMarket}
                onSelectMarket={setSelectedMarket}
              />
            </div>
          </Allotment.Pane>
          <Allotment.Pane preferredSize="42%" minSize={320} maxSize={460}>
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
          <div className="border-b border-terminal-border px-3 py-2 shrink-0">
            <h3 className="text-sm font-semibold text-terminal-text">Positions</h3>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <PerpsPositions />
          </div>
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}

import { useState } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import type { PredictionMarket } from '../../types/api'
import { useIsMobile } from '../../hooks/useIsMobile'
import { PredictionPanel } from './PredictionPanel'
import { PredictTradeTicket } from './PredictTradeTicket'
import { ProbabilityChart } from './ProbabilityChart'
import { PredictPositions } from './PredictPositions'

// The Polymarket prediction desk. Browse (left) + trade ticket for the selected
// market (right); held positions span the bottom. Desktop uses resizable panes;
// mobile stacks browse → ticket → positions.
export function PredictWorkspace() {
  const isMobile = useIsMobile()
  const [selected, setSelected] = useState<PredictionMarket | null>(null)

  if (isMobile) {
    return (
      <div className="flex h-full flex-col divide-y divide-terminal-border overflow-y-auto terminal-panel">
        <div className="min-h-[300px] shrink-0">
          <PredictionPanel selectedId={selected?.id} onSelect={setSelected} />
        </div>
        {selected && (
          <>
            <div className="h-[300px] shrink-0">
              <ProbabilityChart market={selected} />
            </div>
            <div className="shrink-0">
              <PredictTradeTicket market={selected} />
            </div>
          </>
        )}
        <div className="min-h-[200px] shrink-0 overflow-x-auto">
          <PredictPositions />
        </div>
      </div>
    )
  }

  return (
    <Allotment vertical>
      <Allotment.Pane preferredSize="64%" minSize={260}>
        <Allotment>
          <Allotment.Pane preferredSize="34%" minSize={260}>
            <div className="h-full terminal-panel">
              <PredictionPanel selectedId={selected?.id} onSelect={setSelected} />
            </div>
          </Allotment.Pane>
          <Allotment.Pane preferredSize="38%" minSize={300}>
            <div className="h-full terminal-panel">
              <ProbabilityChart market={selected} />
            </div>
          </Allotment.Pane>
          <Allotment.Pane preferredSize="28%" minSize={300} maxSize={460}>
            <div className="h-full terminal-panel overflow-y-auto">
              <PredictTradeTicket market={selected} />
            </div>
          </Allotment.Pane>
        </Allotment>
      </Allotment.Pane>
      <Allotment.Pane preferredSize="36%" minSize={120}>
        <div className="h-full terminal-panel flex flex-col">
          <div className="hairline-b shrink-0 px-3 py-2">
            <h3 className="text-sm font-semibold text-terminal-text">Positions</h3>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <PredictPositions />
          </div>
        </div>
      </Allotment.Pane>
    </Allotment>
  )
}

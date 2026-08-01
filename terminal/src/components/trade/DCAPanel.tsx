import { TerminalEmptyState } from '../foundation'

// DCA scheduling is coming soon — honest §3.6 treatment instead of a
// 40%-opacity ghost form with a permanently-disabled submit button.
export function DCAPanel() {
  return (
    <div className="mt-3">
      <TerminalEmptyState
        kicker="In development"
        title="DCA scheduling is coming soon"
        description="Set a total budget, a cadence (hourly, daily or weekly) and a number of orders — the terminal will split it into a recurring schedule automatically. Ships once the DCA execution backend lands."
      />
    </div>
  )
}

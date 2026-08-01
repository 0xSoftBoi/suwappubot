import { TerminalEmptyState } from '../foundation'

// NOTE: The /webapp/dca/orders endpoint does not exist in api-ts yet, so this
// surface is gated as an honest "coming soon" empty state (§3.6) rather than a
// disabled ghost form or a panel that silently 404s. DCAOrderCard/CreateDCAForm
// stay in the module and get their own register sweep so re-wiring them once
// the backend route lands is a one-line swap, not a rebuild.
export function DCAManager() {
  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <h3 className="text-sm font-semibold text-terminal-text">DCA Orders</h3>
      <TerminalEmptyState
        kicker="In development"
        title="Recurring DCA schedules are coming soon"
        description="Automate a token buy over time — set a total budget, a cadence, and a number of orders. Ships once the DCA execution backend lands; your swaps in the meantime work exactly as they do today."
      />
    </div>
  )
}

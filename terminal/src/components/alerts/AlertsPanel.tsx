import { TerminalEmptyState } from '../foundation'

// NOTE: The /webapp/alerts endpoint does not exist in api-ts yet, so this
// surface is gated as an honest "coming soon" empty state (§3.6) rather than a
// disabled ghost form or a panel that silently 404s. AlertCard/CreateAlertForm
// stay in the module and get their own register sweep so re-wiring them once
// the backend route lands is a one-line swap, not a rebuild.
export function AlertsPanel() {
  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <h3 className="text-sm font-semibold text-terminal-text">Alerts</h3>
      <TerminalEmptyState
        kicker="In development"
        title="Price and volume alerts are coming soon"
        description="Get notified the moment a token crosses a target price or spikes in volume — above, below, or on a sudden move. Ships once the alerts backend lands."
      />
    </div>
  )
}

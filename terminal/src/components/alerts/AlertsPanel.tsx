import { useAlerts } from '../../hooks/useAlerts'
import { AlertCard } from './AlertCard'
import { CreateAlertForm } from './CreateAlertForm'

// NOTE: The /webapp/alerts endpoint does not exist in api-ts. This panel is gated
// as "coming soon" so users see a clear message instead of silent 404 failures.
// Remove this gate once the backend route is implemented.
const COMING_SOON = true

export function AlertsPanel() {
  const { alerts, createAlert, deleteAlert } = useAlerts()

  const activeCount = alerts.data?.filter(a => a.status === 'active').length ?? 0

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Alerts
          {activeCount > 0 && (
            <span className="ml-2 text-xs text-terminal-text-muted font-normal">
              {activeCount} active
            </span>
          )}
        </h3>
      </div>

      {COMING_SOON && (
        <div className="rounded-lg border border-terminal-border bg-terminal-bg px-3 py-3 text-sm text-terminal-text-muted">
          <span className="font-semibold text-terminal-text">Coming soon</span> — Alerts are not yet available.
          The backend endpoint is under development.
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2">
        {!COMING_SOON && alerts.isLoading ? (
          <div className="text-center text-terminal-text-muted text-sm animate-pulse py-8">
            Loading alerts...
          </div>
        ) : !COMING_SOON && alerts.data?.length === 0 ? (
          <div className="text-center text-terminal-text-muted text-sm py-8">
            No alerts set
          </div>
        ) : !COMING_SOON ? (
          alerts.data?.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onDelete={id => deleteAlert.mutate(id)}
            />
          ))
        ) : null}
      </div>

      <div className="border-t border-terminal-border pt-3">
        <fieldset disabled={COMING_SOON} className="disabled:opacity-40 disabled:pointer-events-none">
          <CreateAlertForm
            onSubmit={data => createAlert.mutate(data)}
            isLoading={createAlert.isPending}
          />
        </fieldset>
      </div>
    </div>
  )
}

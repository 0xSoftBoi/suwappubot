import { useAlerts } from '../../hooks/useAlerts'
import { AlertCard } from './AlertCard'
import { CreateAlertForm } from './CreateAlertForm'

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

      <div className="flex-1 overflow-y-auto space-y-2">
        {alerts.isLoading ? (
          <div className="text-center text-terminal-text-muted text-sm animate-pulse py-8">
            Loading alerts...
          </div>
        ) : alerts.data?.length === 0 ? (
          <div className="text-center text-terminal-text-muted text-sm py-8">
            No alerts set
          </div>
        ) : (
          alerts.data?.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onDelete={id => deleteAlert.mutate(id)}
            />
          ))
        )}
      </div>

      <div className="border-t border-terminal-border pt-3">
        <CreateAlertForm
          onSubmit={data => createAlert.mutate(data)}
          isLoading={createAlert.isPending}
        />
      </div>
    </div>
  )
}

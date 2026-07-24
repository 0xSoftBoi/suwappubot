import { useDCA } from '../../hooks/useDCA'
import { DCAOrderCard } from './DCAOrderCard'
import { CreateDCAForm } from './CreateDCAForm'

export function DCAManager() {
  const { orders, createOrder, cancelOrder, pauseOrder } = useDCA()

  const totalInvested = orders.data?.reduce((sum, o) => sum + o.totalInvested, 0) ?? 0
  const activeCount = orders.data?.filter(o => o.status === 'active').length ?? 0

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          DCA Orders
          {activeCount > 0 && (
            <span className="ml-2 text-xs text-terminal-text-muted font-normal">
              {activeCount} active
            </span>
          )}
        </h3>
        {totalInvested > 0 && (
          <span className="text-xs text-terminal-text-muted">
            Total invested: <span className="font-mono text-terminal-text">${totalInvested.toLocaleString()}</span>
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {orders.isLoading ? (
          <div className="text-center text-terminal-text-muted text-sm animate-pulse py-8">
            Loading DCA orders...
          </div>
        ) : orders.data?.length === 0 ? (
          <div className="text-center text-terminal-text-muted text-sm py-8">
            No DCA orders
          </div>
        ) : (
          orders.data?.map(order => (
            <DCAOrderCard
              key={order.id}
              order={order}
              onPause={id => pauseOrder.mutate(id)}
              onCancel={id => cancelOrder.mutate(id)}
            />
          ))
        )}
      </div>

      <div className="border-t border-terminal-border pt-3">
        <CreateDCAForm
          onSubmit={data => createOrder.mutate(data)}
          isLoading={createOrder.isPending}
        />
      </div>
    </div>
  )
}

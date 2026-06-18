export interface SwapDetailsProps {
  rate?: string
  priceImpact?: string
  networkFee?: string
  route?: string
  bridgeFee?: string
  estimatedTime?: string
}

export function SwapDetails({
  rate,
  priceImpact,
  networkFee,
  route,
  bridgeFee,
  estimatedTime,
}: SwapDetailsProps) {
  const items = [
    { label: 'Rate', value: rate },
    { label: 'Price Impact', value: priceImpact, highlight: priceImpact && parseFloat(priceImpact) < 0.1 },
    { label: 'Network Fee', value: networkFee },
    { label: 'Route', value: route, isRoute: true },
    { label: 'Bridge Fee', value: bridgeFee },
    { label: 'Est. Time', value: estimatedTime },
  ].filter(item => item.value)

  if (items.length === 0) return null

  return (
    <div className="bg-white rounded-suwappu-xl p-3 shadow-suwappu-1">
      <div className="space-y-2 text-xs">
        {items.map(({ label, value, highlight, isRoute }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-suwappu-text-secondary">{label}</span>
            <span className={
              highlight ? 'text-suwappu-success' :
              isRoute ? 'text-suwappu-magenta-mid' :
              'text-suwappu-text'
            }>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

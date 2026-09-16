interface EmptyDatasetProps {
  icon?: string
  title?: string
  message?: string
}

/** Friendly empty state for datasets the capture service hasn't populated yet. */
export function EmptyDataset({
  icon = '\u{1F4E1}',
  title = 'No data yet',
  message = "This dataset is not populated yet. This is expected before full deploy, check back soon.",
}: EmptyDatasetProps) {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
      <span className="text-4xl block mb-2">{icon}</span>
      <p className="font-heading font-semibold text-suwappu-text mb-1">{title}</p>
      <p className="text-xs text-suwappu-text-secondary">{message}</p>
    </div>
  )
}

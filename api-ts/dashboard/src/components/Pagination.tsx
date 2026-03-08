interface PaginationProps {
  total: number
  limit: number
  offset: number
  onPageChange: (offset: number) => void
}

export default function Pagination({ total, limit, offset, onPageChange }: PaginationProps) {
  const currentPage = Math.floor(offset / limit) + 1
  const totalPages = Math.ceil(total / limit)

  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between py-3 px-4">
      <p className="text-xs text-suwappu-text-secondary dark:text-gray-400">
        Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
      </p>
      <div className="flex gap-1">
        <button
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="px-3 py-1 text-sm rounded-suwappu-md border border-suwappu-sakura-light/30 dark:border-dark-border disabled:opacity-40 hover:bg-suwappu-sakura-light/10 dark:hover:bg-dark-border/50 transition-colors"
        >
          Prev
        </button>
        <span className="px-3 py-1 text-sm text-suwappu-text-secondary dark:text-gray-400">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(offset + limit)}
          disabled={offset + limit >= total}
          className="px-3 py-1 text-sm rounded-suwappu-md border border-suwappu-sakura-light/30 dark:border-dark-border disabled:opacity-40 hover:bg-suwappu-sakura-light/10 dark:hover:bg-dark-border/50 transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  )
}

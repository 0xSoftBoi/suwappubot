/**
 * SkeletonCard - Loading placeholder for token cards and lists
 */

interface SkeletonCardProps {
  /** Number of skeleton rows to show */
  rows?: number
  /** Variant style */
  variant?: 'token' | 'quote' | 'compact'
}

/** Single skeleton row mimicking a token item */
function TokenRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 animate-pulse">
      {/* Token icon */}
      <div className="w-10 h-10 rounded-full bg-suwappu-sakura-mid/50" />
      
      {/* Token info */}
      <div className="flex-1 space-y-2">
        <div className="h-4 w-16 bg-suwappu-sakura-mid/50 rounded" />
        <div className="h-3 w-24 bg-suwappu-sakura-mid/30 rounded" />
      </div>
      
      {/* Balance */}
      <div className="text-right space-y-2">
        <div className="h-4 w-14 bg-suwappu-sakura-mid/50 rounded ml-auto" />
        <div className="h-3 w-10 bg-suwappu-sakura-mid/30 rounded ml-auto" />
      </div>
    </div>
  )
}

/** Compact skeleton for inline token selectors */
function CompactRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 animate-pulse">
      <div className="w-8 h-8 rounded-full bg-suwappu-sakura-mid/50" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 w-12 bg-suwappu-sakura-mid/50 rounded" />
        <div className="h-2.5 w-20 bg-suwappu-sakura-mid/30 rounded" />
      </div>
    </div>
  )
}

/** Quote loading skeleton */
function QuoteSkeleton() {
  return (
    <div className="animate-pulse space-y-3 p-4">
      <div className="flex justify-between items-center">
        <div className="h-3 w-16 bg-suwappu-sakura-mid/40 rounded" />
        <div className="h-3 w-32 bg-suwappu-sakura-mid/40 rounded" />
      </div>
      <div className="flex justify-between items-center">
        <div className="h-3 w-20 bg-suwappu-sakura-mid/40 rounded" />
        <div className="h-3 w-24 bg-suwappu-sakura-mid/40 rounded" />
      </div>
      <div className="flex justify-between items-center">
        <div className="h-3 w-14 bg-suwappu-sakura-mid/40 rounded" />
        <div className="h-3 w-12 bg-suwappu-sakura-mid/40 rounded" />
      </div>
    </div>
  )
}

export function SkeletonCard({ rows = 3, variant = 'token' }: SkeletonCardProps) {
  if (variant === 'quote') {
    return <QuoteSkeleton />
  }

  const RowComponent = variant === 'compact' ? CompactRowSkeleton : TokenRowSkeleton

  return (
    <div className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <RowComponent key={i} />
      ))}
    </div>
  )
}

export { TokenRowSkeleton, CompactRowSkeleton, QuoteSkeleton }

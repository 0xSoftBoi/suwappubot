/**
 * RegionRestrictedNotice - shown in place of page content when the API
 * returns HTTP 451 / REGION_RESTRICTED for perps or prediction-market
 * endpoints (US compliance gate). Styled to match the existing
 * geo-block notice used on the xStocks page.
 */
export interface RegionRestrictedNoticeProps {
  /** What's unavailable, e.g. "Futures" or "Prediction markets" */
  feature?: string
}

export function RegionRestrictedNotice({ feature = 'Futures and prediction markets' }: RegionRestrictedNoticeProps) {
  return (
    <div className="bg-white rounded-suwappu-xl shadow-suwappu-1 p-8 text-center">
      <span className="text-4xl block mb-3">🚫</span>
      <p className="font-heading font-bold text-base text-suwappu-text mb-2">
        Not available in your region
      </p>
      <p className="text-sm text-suwappu-text-secondary leading-relaxed">
        {feature} aren't available where you are for regulatory reasons. Swapping and bridging
        are fully available.
      </p>
    </div>
  )
}

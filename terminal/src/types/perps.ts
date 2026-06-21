// Perps-panel-local types. These live here (not src/types/api.ts) so the perps
// UI work doesn't collide with other agents editing the shared API types.

export type MarginMode = 'cross' | 'isolated'

// A normalized view of a market's funding situation, derived from the real
// HLMarket.fundingRate field plus HyperLiquid's fixed hourly funding schedule.
export interface FundingInfo {
  // Funding rate for the current interval. On HyperLiquid this is the hourly
  // rate as a decimal (e.g. 0.0000125 == 0.00125% / hr). Source: HLMarket.fundingRate.
  hourlyRate: number
  // Same rate annualized (hourlyRate * 24 * 365), purely for display.
  annualizedRate: number
  // ms remaining until the next funding event (next top of the hour, UTC).
  // Derived from the clock, not the API — HyperLiquid funds hourly on the hour.
  msUntilNextFunding: number
}
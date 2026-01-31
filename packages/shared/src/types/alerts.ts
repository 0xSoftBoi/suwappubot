/**
 * Price alert types
 */

export type AlertType = 'price_above' | 'price_below' | 'percent_change'

export interface PriceAlert {
  id: number
  tokenSymbol: string
  tokenAddress: string
  chain: string
  alertType: AlertType
  targetPrice?: number
  percentChange?: number
  currentPrice?: number
  isActive: boolean
  isTriggered: boolean
  triggeredAt?: string
  triggeredPrice?: number
  createdAt: string
}

export interface CreateAlertRequest {
  tokenSymbol: string
  tokenAddress: string
  chain: string
  alertType: AlertType
  targetPrice?: number
  percentChange?: number
}

export interface UpdateAlertRequest {
  targetPrice?: number
  percentChange?: number
  isActive?: boolean
}

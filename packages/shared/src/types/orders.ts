/**
 * Limit order and DCA types
 */

export type OrderType = 'limit_buy' | 'limit_sell' | 'stop_loss' | 'take_profit'
export type OrderStatus = 'pending' | 'triggered' | 'executed' | 'cancelled' | 'expired' | 'failed'
export type DCAStatus = 'active' | 'paused' | 'completed' | 'cancelled'

export interface LimitOrder {
  id: number
  orderType: OrderType
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amount: string
  triggerPrice: number
  currentPrice?: number
  slippage: number
  status: OrderStatus
  executedAt?: string
  expiresAt?: string
  txHash?: string
  createdAt: string
}

export interface CreateOrderRequest {
  orderType: OrderType
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amount: string
  triggerPrice: number
  slippage?: number
  expiresInHours?: number
}

export interface DCAOrder {
  id: number
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amountPerExecution: string
  intervalHours: number
  maxExecutions?: number
  executionCount: number
  totalAmountSpent: string
  totalAmountReceived: string
  averagePrice?: number
  status: DCAStatus
  nextExecutionAt?: string
  createdAt: string
}

export interface CreateDCARequest {
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amountPerExecution: string
  intervalHours: number
  maxExecutions?: number
  maxTotalAmount?: string
}

export interface DCAExecution {
  id: number
  dcaOrderId: number
  executionNumber: number
  fromAmount: string
  toAmount: string
  price: number
  txHash?: string
  status: 'completed' | 'failed'
  executedAt: string
}

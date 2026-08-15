/**
 * P2P marketplace types — aggregates offers from Suwappu native on-chain
 * escrow, NoOnes, and P2P.me.
 */

export type P2PSource = 'native' | 'noones' | 'p2p_me'

/**
 * offerType is from the MAKER's perspective:
 *  - `sell_crypto` → maker sells crypto (a user who wants to BUY crypto browses these)
 *  - `buy_crypto`  → maker buys crypto  (a user who wants to SELL crypto browses these)
 */
export type P2POfferType = 'sell_crypto' | 'buy_crypto'

export interface P2POffer {
  source: P2PSource
  offerId: string
  offerType: P2POfferType
  fiatCurrency: string
  cryptoAsset: string
  cryptoChain: string
  /** 0 means "live rate at checkout". */
  pricePerUnit: number
  minFiatAmount: number
  maxFiatAmount: number
  paymentMethods: string[]
  region: string
  makerHandle: string
  /** 0..1 */
  completionRate: number
  tradeCount: number
  /** When set, the trade completes off-platform — open this URL. */
  executionUrl: string | null
}

export interface P2POffersResponse {
  offers: P2POffer[]
}

export interface P2POffersQuery {
  fiatCurrency: string
  cryptoAsset: string
  offerType: P2POfferType
  fiatAmount?: number
  region?: string
}

export interface P2PTrade {
  tradeId: string
  offerId: string
  source: P2PSource
  offerType: P2POfferType
  fiatCurrency: string
  cryptoAsset: string
  cryptoChain: string
  fiatAmount: number
  cryptoAmount: number
  pricePerUnit: number
  paymentMethod: string
  counterpartyHandle: string
  status: string
  createdAt: string
}

export interface P2PTradesResponse {
  trades: P2PTrade[]
}

export interface P2PMyOffersResponse {
  offers: P2POffer[]
}

/** Request body to start a native (in-app escrow) trade. */
export interface P2PStartTradeRequest {
  offerId: string
  fiatAmount: number
  paymentMethod: string
}

export interface P2PStartTradeResult {
  tradeId: string
  status: string
}

/** Request body to create a native offer. */
export interface P2PCreateOfferRequest {
  offerType: P2POfferType
  fiatCurrency: string
  cryptoAsset: string
  cryptoChain: string
  pricePerUnit: number
  minFiatAmount: number
  maxFiatAmount: number
  paymentMethods: string[]
  region: string
}

export interface P2PCreateOfferResult {
  offerId: string
  status: string
}

export interface Token {
  symbol: string
  name: string
  address: string
  chain: string
  balance: string
  usdValue: number
  logoUrl?: string
}

export interface Portfolio {
  totalUsdValue: number
  tokens: Token[]
  lastUpdated: string
}

export interface ApiError {
  detail: string
  status: number
}

export interface SwapToken {
  symbol: string
  name: string
  address: string
  chain: string
  decimals: number
  logoUrl?: string
  balance?: string
  balanceUsd?: number
}

export interface SwapQuoteRequest {
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amount: string
  fromDecimals: number
  slippage?: number
}

export interface SwapQuote {
  id: string
  fromToken: SwapToken
  toToken: SwapToken
  fromAmount: string
  toAmount: string
  fromAmountUsd: number
  toAmountUsd: number
  exchangeRate: number
  priceImpact: number
  estimatedGas: string
  gasUsd: number
  route: string
  expiresAt: string
  minReceived: string
  slippage: number
  estimatedDuration?: number
}

export interface SwapExecuteRequest {
  quoteId: string
}

export interface SwapExecuteResult {
  success: boolean
  swapId: number
  status: 'signed' | 'submitted' | 'completed' | 'failed'
  txHash?: string
  explorerUrl?: string
  swap: {
    fromChain: string
    toChain: string
    fromToken: string
    toToken: string
    fromAmount: string
    expectedToAmount: string
  }
}

// --- Non-custodial (external wallet) swaps ---

export interface UnsignedTx {
  to: string
  data: string
  value: string // hex quantity, e.g. "0x0"
  chainId: number
  gas?: string // hex quantity; absent => wallet estimates
}

export type SolanaPriorityTier = 'normal' | 'fast' | 'turbo'

export interface SwapBuildRequest {
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amount: string
  slippage?: number
  fromAddress: string
  // Solana priority-fee tier (landing speed). EVM swaps ignore it.
  priority?: SolanaPriorityTier
  // Live per-CU priority price (micro-lamports) from the client; overrides the
  // tier's cap on the non-Jito path. EVM swaps ignore it.
  computeUnitPriceMicroLamports?: number
}

export interface SwapBuildResult {
  quoteId: string
  chain: 'evm' | 'solana'
  // EVM (MetaMask / WalletConnect)
  chainId?: number
  tx?: UnsignedTx
  approval?: UnsignedTx | null
  spender?: string
  // Solana (Phantom): base64 VersionedTransaction
  swapTransaction?: string
  // When true (turbo tier), submit the signed tx to the Jito block engine via
  // /swap/submit-jito instead of broadcasting through Phantom's RPC.
  jito?: boolean
  fromToken: SwapToken
  toToken: SwapToken
  fromAmount: string
  toAmount: string
  minReceived: string
  priceImpact: number
  gasUsd: number
  route: string
  expiresAt: string
}

export interface SwapRecordRequest {
  quoteId: string
  txHash: string
}

export interface SwapRecordResult {
  success: boolean
  swapId: number
  status: string
  txHash: string
  explorerUrl?: string
}

export interface TerminalSwap {
  id: string
  fromChain: string
  toChain: string
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount?: string
  fromAmountUsd?: number
  toAmountUsd?: number
  status: string
  txHash?: string
  bridgeTxHash?: string
  destinationTxHash?: string
  createdAt: string
  completedAt?: string
  errorMessage?: string
}

export interface CopilotResponse {
  type: 'text' | 'quote' | 'portfolio' | 'error'
  content: string
  data?: Record<string, unknown>
}

export interface PasskeyAuthInitResponse {
  challenge: string
  rpId: string
  allowCredentials?: Array<{
    id: string
    type: 'public-key'
    transports?: string[]
  }> | null
}

export interface PasskeyAuthCompleteResponse {
  success: boolean
  userId: number
  walletAddress: string
  token: string
  expiresAt: string
}

export interface SwapStatusResponse {
  id: number
  status: 'pending' | 'signed' | 'submitted' | 'completed' | 'failed'
  fromChain: string
  toChain: string
  fromToken: string
  toToken: string
  fromAmount: string
  toAmount: string | null
  txHash: string | null
  bridgeTxHash: string | null
  destinationTxHash: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface ChainInfo {
  id: string
  name: string
  chainId: number
  nativeCurrency: string
  explorerUrl: string
}

export interface OHLCVCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface OrderBookLevel {
  price: number
  size: number
  total: number
}

export interface OrderBookData {
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  spread: number
  spreadPercent: number
  midPrice: number
}

export interface TerminalTrade {
  id: string
  price: number
  size: number
  side: 'buy' | 'sell'
  time: number
  isNew?: boolean
}

export interface HLMarket {
  name: string
  asset: string
  szDecimals: number
  maxLeverage: number
  markPrice: number
  fundingRate: number
}

export interface HLPositionQuote {
  market: string
  side: 'long' | 'short'
  size: number
  leverage: number
  entryPrice: number
  margin: number
  liquidationPrice: number
  fundingRate: number
  fee: number
}

export interface HLPosition {
  id: string
  market: string
  side: 'long' | 'short'
  size: number
  leverage: number
  entryPrice: number
  markPrice: number
  margin: number
  unrealizedPnl: number
  liquidationPrice: number
  fundingRate: number
}

export interface PoolToken {
  symbol: string
  address: string
}

export interface Pool {
  name: string
  address: string
  createdAt: string
  baseToken: PoolToken
  quoteToken: PoolToken
  priceUsd: string | null
  fdvUsd: string | null
  volumeH24: string | null
  reserveUsd: string | null
  priceChangeH1: number | null
  priceChangeH24: number | null
}

export interface TokenSecurity {
  isHoneypot: boolean
  ownerRenounced: boolean
  lpBurned: number
  topHolderPercent: number
  mintAuthority: boolean
  riskLevel: 'safe' | 'caution' | 'danger'
  trustScore?: number
  devHoldingsPercent?: number
}

// One tradeable outcome of a prediction market — the CLOB tokenId is what an
// order is placed against.
export interface MarketToken {
  tokenId: string
  outcome: string
}

export interface PredictionMarket {
  id: string
  // On-chain CTF condition id (0x… hash). Required for resolution/settlement —
  // sent as the order's marketId so predict_monitor can settle the position.
  conditionId?: string
  question: string
  description?: string
  outcomes: string[]
  outcomePrices: number[]
  tokens?: MarketToken[]
  volume: number
  liquidity: number
  endDate?: string
  active: boolean
}

// === Terminal trading (Python /terminal/* execution routes) ===

// HyperLiquid connection status + live account health for the signed-in user.
// Financial fields are best-effort (null when the live HL fetch fails).
export interface PerpsAccountStatus {
  connected: boolean
  address: string | null
  accountValue?: number | null // equity
  maintenanceMarginUsed?: number | null // cross maintenance margin in use now
  totalMarginUsed?: number | null // initial margin in use now
  withdrawable?: number | null
}

// A live open perp position as returned by /terminal/perps/positions. `id` is
// the local PerpPosition row id used to close; it's null when a live HL position
// has no matching local row (e.g. opened outside Suwappu).
export interface TerminalPerpsPosition {
  id: number | null
  market: string
  side: 'long' | 'short'
  size: number
  leverage: number
  entryPrice: number
  markPrice: number
  unrealizedPnl: number
  liquidationPrice: number
}

export interface PerpsExecuteParams {
  market: string
  side: 'long' | 'short'
  size: number
  leverage: number
  tpPrice?: number
  slPrice?: number
}

export interface PerpsExecuteResult {
  ok: boolean
  position: {
    id: number
    market: string
    side: 'long' | 'short'
    size: number
    entryPrice: number
    leverage: number
  }
}

// A held prediction-market position as returned by /terminal/predict/positions.
export interface PredictionPositionRow {
  id: string
  marketId: string
  question: string
  outcome: string
  tokenId: string
  shares: number
  avgPrice: number
  currentPrice: number
  unrealizedPnl: number
  isResolved: boolean
  claimable: boolean
}

export interface PredictOrderParams {
  tokenId: string
  marketId: string
  question: string
  outcome: string
  side: 'BUY' | 'SELL'
  amount: number
  price: number
}

export interface PredictOrderResult {
  ok: boolean
  orderId?: string
  error?: string
}

export interface PredictRedeemResult {
  ok: boolean
  // True when the redeem tx was broadcast but hasn't confirmed yet.
  pending?: boolean
  txHash?: string | null
  message?: string
  category?: string | null
}

// === Copy Trading ===

export type CopyMode = 'notify' | 'fixed' | 'percentage'

export interface FollowSettings {
  copyMode: CopyMode
  fixedAmount?: number
  percentageAmount?: number
  maxPerTrade?: number
  dailyLimit?: number
  autoSellEnabled?: boolean
  stopLossPercent?: number
  takeProfitPercent?: number
  chainFilter?: string[]
  maxSlippage?: number
}

export interface TopTrader {
  id: string
  address: string
  name?: string
  pnl7d: number
  pnl30d: number
  winRate: number
  followers: number
  copiers?: number
  totalTrades: number
}

export interface TraderProfile {
  id: string
  address: string
  name?: string
  pnl7d: number
  pnl30d: number
  winRate: number
  followers: number
  totalTrades: number
  bestTrade: number
  worstTrade: number
  avgTradeSize: number
  isFollowing: boolean
}

export interface FollowedTrader {
  traderId: string
  address: string
  name?: string
  copyMode: CopyMode
  dailyPnl: number
  totalPnl: number
  settings: FollowSettings
}

export interface CopyTrade {
  id: string
  traderAddress: string
  action: 'buy' | 'sell'
  tokenPair: string
  amount: number
  pnl: number
  status?: 'pending' | 'notified' | 'copied' | 'skipped' | 'failed'
  timestamp: string
}

// === Points / Gamification ===

export type TierName = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond'

export interface PointsProfile {
  xp: number
  level: number
  tier: TierName
  nextLevelXp: number
  currentLevelXp: number
  streak: number
  longestStreak: number
  lastCheckin: string | null
  rank: number
}

export interface CheckinResponse {
  success: boolean
  xpEarned: number
  newStreak: number
  totalXp: number
}

export interface Milestone {
  id: string
  title: string
  description: string
  icon: string
  category: string
  progress: number
  target: number
  completed: boolean
  xpReward: number
  completedAt?: string
}

export interface Reward {
  id: string
  name: string
  description: string
  cost: number
  stock: number
  category: string
  imageUrl?: string
}

export interface RewardStoreResponse {
  rewards: Reward[]
  userXp: number
}

export interface RedeemRewardResponse {
  success: boolean
  remainingXp: number
  message: string
}

export interface LeaderboardEntry {
  rank: number
  address: string
  xp: number
  level: number
  tier: TierName
}

// === Alerts ===

export type AlertType = 'price_above' | 'price_below' | 'volume_spike'
export type AlertStatus = 'active' | 'inactive' | 'triggered'

export interface Alert {
  id: string
  tokenSymbol: string
  tokenAddress?: string
  chain?: string
  alertType: AlertType
  targetValue: number
  currentPrice?: number
  status: AlertStatus
  createdAt: string
  triggeredAt?: string
}

export interface CreateAlertParams {
  tokenSymbol: string
  tokenAddress?: string
  chain?: string
  alertType: AlertType
  targetValue: number
}

// === DCA ===

export type DCAFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly'
export type DCAStatus = 'active' | 'paused' | 'completed' | 'cancelled'

export interface DCAOrder {
  id: string
  fromToken: string
  toToken: string
  amountPerOrder: number
  totalAmount: number
  totalInvested: number
  frequency: DCAFrequency
  totalOrders: number
  completedOrders: number
  status: DCAStatus
  nextExecution?: string
  createdAt: string
}

export interface CreateDCAParams {
  fromToken: string
  toToken: string
  totalAmount: number
  frequency: DCAFrequency
  numberOfOrders: number
}

// === Limit Orders ===

export type LimitOrderType = 'limit_buy' | 'limit_sell' | 'stop_loss' | 'take_profit'
export type LimitOrderStatus = 'pending' | 'triggered' | 'executed' | 'cancelled' | 'expired' | 'failed'

export interface LimitOrder {
  id: string
  orderType: LimitOrderType
  status: LimitOrderStatus
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amountRaw: string
  triggerPrice: number
  executionPrice?: number | null
  slippage: number
  expiresAt?: string | null
  executedAt?: string | null
  txHash?: string | null
  createdAt: string
}

export interface CreateLimitOrderParams {
  orderType: LimitOrderType
  fromToken: string
  toToken: string
  fromChain: string
  toChain: string
  amount: number
  triggerPrice: number
  slippage: number
  expiresInHours?: number | null
}

// === Lending ===

export interface LendingMarket {
  id: string
  asset: string
  chain: string
  supplyAPY: number
  borrowAPY: number
  utilization: number
  totalSupplied: number
  totalBorrowed: number
  lltv: number
}

// === Wallet Tracker ===

export interface TrackedWallet {
  address: string
  label?: string
  chain: string
  addedAt: string
}

export interface WalletActivity {
  id: string
  walletAddress: string
  walletLabel?: string
  action: 'buy' | 'sell'
  tokenSymbol: string
  tokenAddress: string
  amount: number
  priceUsd: number
  chain: string
  timestamp: string
  txHash?: string
}

export interface WalletStats {
  address: string
  pnl7d: number
  pnl30d: number
  winRate: number
  totalTrades: number
  topHoldings: { symbol: string; valueUsd: number }[]
}

// === Tweet Monitor ===

export interface TrackedTwitterAccount {
  handle: string
  displayName: string
  avatarColor: string
  addedAt: string
}

export interface TweetData {
  id: string
  authorHandle: string
  authorName: string
  authorAvatarColor: string
  content: string
  tokenMentions: string[]
  sentiment: 'bullish' | 'bearish' | 'neutral'
  likes: number
  retweets: number
  timestamp: string
}

// === Pulse (Token Lifecycle Discovery) ===

export interface PulseToken {
  address: string
  symbol: string
  name: string
  chain: string
  stage: 'new' | 'final_stretch' | 'migrated'
  createdAt: string
  marketCap: number
  volume24h: number
  holders: number
  topHolderPercent: number
  devPercent: number
  sniperPercent: number
  bondingProgress?: number // 0-100 for final_stretch
  liquidityUsd: number
  priceUsd: number
  // 24h transaction activity (real, from DexScreener).
  txns24h?: number
  buys24h?: number
  sells24h?: number
  priceChange5m: number
  trustScore?: number
  riskLevel?: 'safe' | 'caution' | 'danger'
  isBundled?: boolean
  bundleCount?: number
  priceChange1h?: number
  priceChange6h?: number
  priceChange24h?: number
}

export interface PulseFilters {
  minMarketCap: number | null
  maxMarketCap: number | null
  minLiquidity: number | null
  minVolume: number | null
  minTxns: number | null
  maxAgeMinutes: number | null
  maxTopHolderPercent: number | null
  maxDevPercent: number | null
  maxSniperPercent: number | null
  maxBundleCount: number | null
  minHolders: number | null
}

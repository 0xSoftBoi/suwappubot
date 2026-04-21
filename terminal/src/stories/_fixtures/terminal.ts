import type {
  SwapQuote,
  SwapToken,
  TokenSecurity,
  TrackedWallet,
  WalletActivity,
  WalletStats,
} from "../../types/api";

export const ethToken: SwapToken = {
  symbol: "ETH",
  name: "Ethereum",
  address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  chain: "ethereum",
  decimals: 18,
  balance: "2.4312",
  balanceUsd: 8518.31,
};

export const usdcToken: SwapToken = {
  symbol: "USDC",
  name: "USD Coin",
  address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  chain: "ethereum",
  decimals: 6,
  balance: "12450.22",
  balanceUsd: 12450.22,
};

export const solToken: SwapToken = {
  symbol: "SOL",
  name: "Solana",
  address: "So11111111111111111111111111111111111111112",
  chain: "solana",
  decimals: 9,
  balance: "82.114",
  balanceUsd: 14988.61,
};

export const kazeToken: SwapToken = {
  symbol: "KAZE",
  name: "Kaze Finance",
  address: "0x4f3b0f0edcd61ee3f6b8f7f7f6e35653ad9bdf11",
  chain: "ethereum",
  decimals: 18,
  balance: "0",
  balanceUsd: 0,
};

export const ethToUsdcQuote: SwapQuote = {
  id: "quote-eth-usdc",
  fromToken: ethToken,
  toToken: usdcToken,
  fromAmount: "0.75",
  toAmount: "2618.42",
  fromAmountUsd: 2615.18,
  toAmountUsd: 2618.42,
  exchangeRate: 3491.226667,
  priceImpact: 0.38,
  estimatedGas: "0.0031",
  gasUsd: 8.27,
  route: "Uniswap v3 -> CCTP settlement",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  minReceived: "2608.96",
  slippage: 0.5,
  estimatedDuration: 42,
};

export const solToUsdcQuote: SwapQuote = {
  ...ethToUsdcQuote,
  id: "quote-sol-usdc",
  fromToken: solToken,
  toToken: usdcToken,
  fromAmount: "18",
  toAmount: "3278.52",
  fromAmountUsd: 3282.12,
  toAmountUsd: 3278.52,
  exchangeRate: 182.14,
  priceImpact: 1.74,
  gasUsd: 1.19,
  route: "Jupiter -> Wormhole route",
  minReceived: "3221.12",
  slippage: 1.0,
  estimatedDuration: 95,
};

export const ethToKazeQuote: SwapQuote = {
  ...ethToUsdcQuote,
  id: "quote-eth-kaze",
  toToken: kazeToken,
  toAmount: "18420",
  toAmountUsd: 2611.64,
  exchangeRate: 24560,
  priceImpact: 0.18,
  gasUsd: 9.42,
  route: "Uniswap v3 -> Suwappu route guard",
  minReceived: "18336",
  slippage: 0.45,
  estimatedDuration: 37,
};

export const solToKazeQuote: SwapQuote = {
  ...solToUsdcQuote,
  id: "quote-sol-kaze",
  toToken: kazeToken,
  toAmount: "22780",
  toAmountUsd: 3231.62,
  exchangeRate: 1265.555556,
  priceImpact: 1.62,
  gasUsd: 2.04,
  route: "Jupiter -> Wormhole -> Suwappu route guard",
  minReceived: "22411",
  slippage: 1.2,
  estimatedDuration: 92,
};

type StorySecurity = TokenSecurity & {
  trustScore: number;
  devHoldingsPercent: number;
};

export const safeSecurity: StorySecurity = {
  isHoneypot: false,
  ownerRenounced: true,
  lpBurned: 96.4,
  topHolderPercent: 14.2,
  mintAuthority: false,
  riskLevel: "safe",
  trustScore: 92,
  devHoldingsPercent: 3.1,
};

export const cautionSecurity: StorySecurity = {
  isHoneypot: false,
  ownerRenounced: false,
  lpBurned: 72.8,
  topHolderPercent: 28.4,
  mintAuthority: true,
  riskLevel: "caution",
  trustScore: 61,
  devHoldingsPercent: 11.7,
};

export const dangerSecurity: StorySecurity = {
  isHoneypot: true,
  ownerRenounced: false,
  lpBurned: 22.5,
  topHolderPercent: 67.3,
  mintAuthority: true,
  riskLevel: "danger",
  trustScore: 18,
  devHoldingsPercent: 32.4,
};

export const trackedWallet: TrackedWallet = {
  address: "0x3b6d7d2f8f6f3a9f2b4f7a1b3c6d8e9f1a2b3c4d",
  label: "Treasury lane",
  chain: "ethereum",
  addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
};

export const signalGreenhouseWallet: TrackedWallet = {
  address: "0x9f8f7d6c5b4a39281716151413121110fedcba98",
  label: "Signal greenhouse",
  chain: "solana",
  addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
};

export const baseRelayWallet: TrackedWallet = {
  address: "0x4c3d2b1a0f9e8d7c6b5a49382716151413121110",
  label: "Base relay",
  chain: "base",
  addedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
};

export const trackedWallets: TrackedWallet[] = [
  trackedWallet,
  signalGreenhouseWallet,
  baseRelayWallet,
];

export const walletStats: WalletStats = {
  address: trackedWallet.address,
  pnl7d: 42350,
  pnl30d: 121400,
  winRate: 68.4,
  totalTrades: 173,
  topHoldings: [
    { symbol: "ETH", valueUsd: 42852 },
    { symbol: "SOL", valueUsd: 16300 },
    { symbol: "JUP", valueUsd: 4280 },
  ],
};

export const signalGreenhouseStats: WalletStats = {
  address: signalGreenhouseWallet.address,
  pnl7d: 12840,
  pnl30d: 46820,
  winRate: 61.2,
  totalTrades: 96,
  topHoldings: [
    { symbol: "SOL", valueUsd: 22140 },
    { symbol: "JUP", valueUsd: 7480 },
    { symbol: "PYTH", valueUsd: 3320 },
  ],
};

export const baseRelayStats: WalletStats = {
  address: baseRelayWallet.address,
  pnl7d: -2840,
  pnl30d: 9640,
  winRate: 54.9,
  totalTrades: 58,
  topHoldings: [
    { symbol: "ETH", valueUsd: 11820 },
    { symbol: "USDC", valueUsd: 7420 },
    { symbol: "KAZE", valueUsd: 2460 },
  ],
};

export const walletStatsMap: Record<string, WalletStats> = {
  [trackedWallet.address]: walletStats,
  [signalGreenhouseWallet.address]: signalGreenhouseStats,
  [baseRelayWallet.address]: baseRelayStats,
};

export const walletActivities: WalletActivity[] = [
  {
    id: "wa-1",
    walletAddress: trackedWallet.address,
    walletLabel: trackedWallet.label,
    action: "buy",
    tokenSymbol: "ETH",
    tokenAddress: ethToken.address,
    amount: 4280,
    priceUsd: 3492.12,
    chain: "ethereum",
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    txHash: "0xaaa111",
  },
  {
    id: "wa-2",
    walletAddress: trackedWallet.address,
    walletLabel: trackedWallet.label,
    action: "sell",
    tokenSymbol: "SOL",
    tokenAddress: solToken.address,
    amount: 1920,
    priceUsd: 181.18,
    chain: "solana",
    timestamp: new Date(Date.now() - 1000 * 60 * 47).toISOString(),
    txHash: "0xbbb222",
  },
  {
    id: "wa-3",
    walletAddress: signalGreenhouseWallet.address,
    walletLabel: signalGreenhouseWallet.label,
    action: "buy",
    tokenSymbol: "JUP",
    tokenAddress: "JUP111111111111111111111111111111111111111",
    amount: 860,
    priceUsd: 1.24,
    chain: "solana",
    timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    txHash: "0xccc333",
  },
  {
    id: "wa-4",
    walletAddress: trackedWallet.address,
    walletLabel: trackedWallet.label,
    action: "buy",
    tokenSymbol: "USDC",
    tokenAddress: usdcToken.address,
    amount: 2500,
    priceUsd: 1,
    chain: "ethereum",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    txHash: "0xddd444",
  },
  {
    id: "wa-5",
    walletAddress: baseRelayWallet.address,
    walletLabel: baseRelayWallet.label,
    action: "sell",
    tokenSymbol: "ETH",
    tokenAddress: ethToken.address,
    amount: 3180,
    priceUsd: 3478.42,
    chain: "base",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    txHash: "0xeee555",
  },
  {
    id: "wa-6",
    walletAddress: baseRelayWallet.address,
    walletLabel: baseRelayWallet.label,
    action: "buy",
    tokenSymbol: "KAZE",
    tokenAddress: kazeToken.address,
    amount: 1840,
    priceUsd: 0.14,
    chain: "base",
    timestamp: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
    txHash: "0xfff666",
  },
];

export const portfolioSummaryData = {
  totalUsdValue: 74218.43,
  tokens: [
    { symbol: "ETH", balance: "8.2501", usdValue: 28792.35 },
    { symbol: "SOL", balance: "74.44", usdValue: 13561.91 },
    { symbol: "USDC", balance: "22114.04", usdValue: 22114.04 },
    { symbol: "JUP", balance: "3180.50", usdValue: 3942.55 },
  ],
};

export const copilotQuoteCardData = {
  fromToken: { symbol: ethToken.symbol },
  toToken: { symbol: usdcToken.symbol },
  fromAmount: ethToUsdcQuote.fromAmount,
  toAmount: ethToUsdcQuote.toAmount,
  exchangeRate: ethToUsdcQuote.exchangeRate,
  priceImpact: ethToUsdcQuote.priceImpact,
  gasUsd: ethToUsdcQuote.gasUsd,
};

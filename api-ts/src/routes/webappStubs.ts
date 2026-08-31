/**
 * Webapp feature stubs: intentional placeholders for in-development features.
 * These return proper error responses instead of 404s, allowing the webapp to fail gracefully.
 */

import { Hono } from 'hono'
import { telegramAuth } from '../middleware'

export const webappStubs = new Hono()

// Terminal compatibility: the standalone terminal predates the Mini App's
// /webapp/swap/chains envelope and expects a bare ChainInfo[]. Keep this public
// read-only alias stable so chain selectors cannot take the trading UI down.
webappStubs.get('/chains', (c) => c.json([
  { id: 'ethereum', name: 'Ethereum', chainId: 1, nativeCurrency: 'ETH', explorerUrl: 'https://etherscan.io' },
  { id: 'optimism', name: 'Optimism', chainId: 10, nativeCurrency: 'ETH', explorerUrl: 'https://optimistic.etherscan.io' },
  { id: 'bsc', name: 'BNB Chain', chainId: 56, nativeCurrency: 'BNB', explorerUrl: 'https://bscscan.com' },
  { id: 'polygon', name: 'Polygon', chainId: 137, nativeCurrency: 'POL', explorerUrl: 'https://polygonscan.com' },
  { id: 'arbitrum', name: 'Arbitrum', chainId: 42161, nativeCurrency: 'ETH', explorerUrl: 'https://arbiscan.io' },
  { id: 'avalanche', name: 'Avalanche', chainId: 43114, nativeCurrency: 'AVAX', explorerUrl: 'https://snowtrace.io' },
  { id: 'base', name: 'Base', chainId: 8453, nativeCurrency: 'ETH', explorerUrl: 'https://basescan.org' },
  { id: 'linea', name: 'Linea', chainId: 59144, nativeCurrency: 'ETH', explorerUrl: 'https://lineascan.build' },
  { id: 'zksync', name: 'zkSync Era', chainId: 324, nativeCurrency: 'ETH', explorerUrl: 'https://explorer.zksync.io' },
  { id: 'solana', name: 'Solana', chainId: 1151111081099710, nativeCurrency: 'SOL', explorerUrl: 'https://solscan.io' },
]))

// Copy trading endpoints (currently stubbed; feature in development)
webappStubs.get('/copy/following', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Copy trading is not yet enabled' }, 501),
)
webappStubs.get('/copy/my-stats', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Copy trading is not yet enabled' }, 501),
)
webappStubs.post('/copy/follow', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Copy trading is not yet enabled' }, 501),
)
webappStubs.post('/copy/visibility', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Copy trading is not yet enabled' }, 501),
)
webappStubs.get('/me/copy/following', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Copy trading is not yet enabled' }, 501),
)
webappStubs.post('/me/copy/follow', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Copy trading is not yet enabled' }, 501),
)

// Prediction market endpoints (CLOB V2 signed; feature in development)
webappStubs.get('/predict/markets', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Prediction markets not yet enabled' }, 501),
)
webappStubs.post('/predict/order', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Prediction markets not yet enabled' }, 501),
)
webappStubs.get('/me/predict/positions', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Prediction markets not yet enabled' }, 501),
)
webappStubs.post('/me/predict/order', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Prediction markets not yet enabled' }, 501),
)
webappStubs.get('/predict/order', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Prediction markets not yet enabled' }, 501),
)

// Referral endpoints
webappStubs.get('/referrals', telegramAuth(), (c) =>
  c.json({ error: 'NOT_IMPLEMENTED', message: 'Referrals endpoint under development' }, 501),
)
webappStubs.get('/referrals/code', telegramAuth(), (c) =>
  c.json({ error: 'NOT_IMPLEMENTED', message: 'Referrals endpoint under development' }, 501),
)
webappStubs.get('/referrals/leaderboard', telegramAuth(), (c) =>
  c.json({ error: 'NOT_IMPLEMENTED', message: 'Referrals endpoint under development' }, 501),
)
webappStubs.get('/referrals/stats', telegramAuth(), (c) =>
  c.json({ error: 'NOT_IMPLEMENTED', message: 'Referrals endpoint under development' }, 501),
)

// Battle/competition endpoints (feature in development)
webappStubs.get('/battle/config', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Battles not yet enabled' }, 501),
)
webappStubs.get('/battle/list', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Battles not yet enabled' }, 501),
)
webappStubs.post('/battle/open', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Battles not yet enabled' }, 501),
)

// Alerts endpoint (feature in development)
webappStubs.get('/alerts', telegramAuth(), (c) =>
  c.json({ error: 'NOT_IMPLEMENTED', message: 'Alerts endpoint under development' }, 501),
)

// DCA endpoint (feature in development)
webappStubs.post('/dca', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Dollar-cost averaging not yet enabled' }, 501),
)
webappStubs.get('/dca/stats', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Dollar-cost averaging not yet enabled' }, 501),
)

// Snipe endpoint (feature in development)
webappStubs.post('/snipe', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Sniping not yet enabled' }, 501),
)

// Stock trading endpoint (feature in development)
webappStubs.get('/stocks', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Stock trading is not yet enabled' }, 501),
)

// Wallet linking endpoint
webappStubs.post('/link-wallet', telegramAuth(), (c) =>
  c.json({ error: 'NOT_IMPLEMENTED', message: 'Wallet linking under development' }, 501),
)

// VIP status endpoint
webappStubs.get('/me/vip', telegramAuth(), (c) =>
  c.json({ error: 'NOT_IMPLEMENTED', message: 'VIP status endpoint under development' }, 501),
)

// Challenge endpoint (not referenced in audit but follows pattern)
webappStubs.post('/challenge', telegramAuth(), (c) =>
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Challenges not yet enabled' }, 501),
)

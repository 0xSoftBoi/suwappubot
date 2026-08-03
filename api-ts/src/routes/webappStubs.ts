/**
 * Webapp feature stubs: intentional placeholders for in-development features.
 * These return proper error responses instead of 404s, allowing the webapp to fail gracefully.
 */

import { Hono } from 'hono'
import { telegramAuth } from '../middleware/auth'

export const webappStubs = new Hono()

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
  c.json({ error: 'FEATURE_NOT_ENABLED', message: 'Stock trading not yet enabled' }, 501),
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

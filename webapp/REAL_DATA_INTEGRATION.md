# Webapp Real Data Integration

## Overview
Wire up the Suwappu webapp to display real data from the API instead of mock data.

## GitHub Issues

| # | Title | Status |
|---|-------|--------|
| [#31](https://github.com/0xSoftBoi/suwappubot/issues/31) | Wire up Home.tsx to use real portfolio data from API | ✅ Done |
| [#32](https://github.com/0xSoftBoi/suwappubot/issues/32) | Wire up Portfolio.tsx to use real portfolio data from API | ✅ Done |
| [#33](https://github.com/0xSoftBoi/suwappubot/issues/33) | Implement real balance fetching in api-ts portfolio endpoint | ✅ Done |
| [#34](https://github.com/0xSoftBoi/suwappubot/issues/34) | Add DNS CNAME records for suwappu.bot domain | ⏳ Pending (Manual) |

## Progress

### Phase 1: Frontend Integration ✅
- [x] Home.tsx - Use `usePortfolio()` hook
- [x] Portfolio.tsx - Use `usePortfolio()` hook
- [x] Add loading states
- [x] Add error states

### Phase 2: Backend Enhancement ✅
- [x] Add RPC balance fetching (BalanceService)
- [x] Add price feed integration (CoinGecko)
- [x] Cache balances (1 minute TTL)

### Phase 3: DNS & Deployment
- [ ] Add CNAME records (Manual - see issue #34)
- [ ] Verify SSL
- [ ] Test in Telegram

## Files Changed

### Frontend (webapp)
- `src/pages/Home.tsx` - Uses `usePortfolio()` with loading/error states
- `src/pages/Portfolio.tsx` - Uses `usePortfolio()` with dynamic chain allocations

### Backend (api-ts)
- `src/services/BalanceService.ts` - **NEW** - Fetches balances via RPC + prices from CoinGecko
- `src/services/index.ts` - Exports BalanceService
- `src/services/MainLayer.ts` - Added BalanceServiceLive to layer
- `src/routes/webapp.ts` - Portfolio endpoint now uses BalanceService

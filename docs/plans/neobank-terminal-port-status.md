# Neobank -> terminal port status

## Auth answer
- Terminal sends `Authorization: Bearer <session JWT>` (terminal/src/lib/api.ts:100-106) and cookies.
- `/webapp/bank/*` is behind `telegramAuth()` which reads ONLY `X-Telegram-Init-Data` (api-ts/src/middleware/telegram.ts:20; mounted api-ts/src/app.ts:242). The JWT is NOT accepted.
- Terminal has the raw initData inside Telegram (`window.Telegram.WebApp.initData`, terminal/src/telegram.d.ts:13; used in contexts/AuthContext.tsx:163), so `terminal/src/lib/bankApi.ts` sends it as `X-Telegram-Init-Data`. Works inside Telegram; outside Telegram (browser JWT-only sessions) bank cannot authenticate -> shell shows "Open from Telegram". No api-ts change made.

## Pages (terminal/src/routes/bank/)
Status: all pages copied and restyled; typecheck/build pending verification in this file's last update.

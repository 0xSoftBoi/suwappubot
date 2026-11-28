# Neobank -> terminal port status

## Auth answer
- Terminal's own client (terminal/src/lib/api.ts:100-106) sends `Authorization: Bearer <session JWT>` to a same-origin base (vite.config.ts:11 forces VITE_API_URL=''; nginx.conf:83 proxies `auth|terminal|webapp|bank/app|public|v1` to api-ts over Railway private networking).
- api-ts `telegramAuth()` (api-ts/src/middleware/telegram.ts:20) reads ONLY `X-Telegram-Init-Data`; the JWT is not accepted. Bank therefore sends raw `window.Telegram.WebApp.initData` (terminal/src/lib/bankApi.ts transport, lib/bankAuth.ts). nginx forwards unknown headers, so the header survives. Outside Telegram there is no credential: BankShell shows "Open in Telegram" (deep link t.me/suwappubot) and makes no bank calls. Public `/pay/:slug` works everywhere.

## Routing
- Bank base path is `/bank/app` (bankApi.ts:32). nginx.conf proxy regex gained `bank/app(?:/|$)`; it is anchored after `^/`, so SPA routes `/bank`, `/bank/send`, `/bank/claim/<token>` still fall through to index.html. `/public/` already proxied. `/x402/` is NOT proxied (UI does not call it). `/enterprise/*` (Developers page, API-key admin) is NOT proxied -> that page's enterprise calls will 404 until added.
- App.tsx mounts `/bank/*` and public `/pay/:slug` ahead of the host gate. Header has a "Bank" link.
- Claim route survives because nothing redirects; the URL stays on /bank/claim/<token>.

## Pages (terminal/src/routes/bank/) - all PORTED (restyled to terminal tokens)
BankHome, AccountDetail, Send+Claim, Convert, Earn, Credit(+Extra), Ramps, Cards+RevealCard, Payments, PayInvoice (public), Payroll(+Extra), Business(+Extra), Developers (PARTIAL: enterprise calls need proxy), Agents, Privacy, BankSettings, index router.
Screenshot-verified (390x844): home, send confirm sheet, earn, cards, pay signed-out, API-down, outside-Telegram.
Not screenshotted: remaining pages.

## Notes
- `@noble/curves` is imported by lib/stealthScan.ts but is only a transitive dep (via viem); not added to package.json to keep the lockfile frozen.
- QR via existing `qrcode` (lib/QRCodeSVG.tsx) instead of qrcode.react.

## Production verification checklist

After merge and Railway deploy:

1. `GET /health` on terminal returns 200.
2. Unauthenticated `GET /terminal/wallet/summary` returns an auth response from api-ts/Python (401/403), never SPA HTML and never a terminal nginx 404.
3. Unauthenticated `GET /terminal/perps/account` reaches api-ts and returns auth enforcement, not SPA HTML.
4. Invalid `POST /webapp/bridge/routes` reaches api-ts and returns API validation/auth JSON, not SPA HTML.
5. Browser requests remain on the terminal origin; compiled assets contain no `https://api.suwappu.bot` API base.
6. No transaction, bridge, withdrawal, or perp order is signed during verification.

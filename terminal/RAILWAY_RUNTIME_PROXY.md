# Railway runtime API routing

The production terminal does not choose an API origin at Vite build time.

Browser requests use same-origin paths (`/auth`, `/terminal`, `/webapp`, `/public`, `/v1`). The production nginx layer forwards those namespaces to the `api-ts` service over Railway private networking using:

- `API_TS_PRIVATE_DOMAIN=${{api-ts.RAILWAY_PRIVATE_DOMAIN}}`
- `API_TS_PORT=8000`

This keeps browser bundles independent of deployment hostnames, avoids direct browser-to-API CORS coupling, and keeps service-to-service traffic inside Railway.

`VITE_API_URL` is intentionally not part of the production build contract.

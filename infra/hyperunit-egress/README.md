# HyperUnit non-US egress proxy

HyperUnit geo-blocks the US (its `/gen` route returns `403` to US IPs; `/status`
stays `200`). The Suwappu bot runs in a **US** Railway region, so its server-side
HyperUnit calls exit a US IP **even for allowed non-US users**. This tiny Caddy
reverse proxy gives those calls a **non-US egress IP**.

It is only ever reached for **region-allowed (non-US) users** — the `/fund`
handler gates the native path on `User.region` (`hyperunit_allowed()`), and the
client only routes here when `HYPERUNIT_EGRESS_URL` / `HYPERUNIT_PROXY_URL` is
set. **Do not** use it to route US users around the block.

## Deploy (Railway)

1. New service in the `suwappu` project, root dir `infra/hyperunit-egress/`
   (Dockerfile build — `railway.json` already points at it).
2. **Set the region to a non-US one**: Service → Settings → Region →
   e.g. `europe-west4` (Amsterdam) or `asia-southeast1` (Singapore).
   *(This is the whole point — the region determines the egress IP.)*
3. (Recommended) Set `EGRESS_SECRET` on this service to a random string so it
   isn't an open geo-bypass proxy (see Hardening).
4. Grab its URL (e.g. `https://hyperunit-egress-production.up.railway.app`).

## Point the bot at it

On `python-api` **and** `python-worker`, set ONE of:

- `HYPERUNIT_EGRESS_URL=https://hyperunit-egress-production.up.railway.app`
  (reverse-proxy base URL — recommended), or
- `HYPERUNIT_PROXY_URL=http://<host>:<port>` (if you run a forward HTTP proxy
  instead of this reverse proxy).

Verify from the egress region:
```
curl -s -o /dev/null -w "%{http_code}\n" \
  https://<this-service>.up.railway.app/gen/bitcoin/hyperliquid/btc/0x0000000000000000000000000000000000000000
```
`200` (or a JSON error other than the Cloudflare 403 HTML) = egress works.

## Hardening (pick one)

- **Private networking (best):** don't expose a public domain; reach this
  service from `python-worker` via Railway's internal hostname, and set
  `HYPERUNIT_EGRESS_URL` to that internal URL. No public open proxy.
- **Shared secret:** set `EGRESS_SECRET` here; the proxy then rejects requests
  without a matching `X-Egress-Secret` header. (The bot client would need to
  send it — small follow-up if you go this route instead of private networking.)

## Compliance note

This proxy exists to serve **non-US** users from **non-US** infrastructure —
respecting HyperUnit's geo-restriction, not circumventing it. Region is set by
your KYC/onboarding via the admin `/setregion` command (operator-controlled, not
user self-attestation). Keep US users on the Across USDC rail.

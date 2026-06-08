/**
 * Suwappu edge router — replaces the deleted AWS ALB that path-routed
 * `api.suwappu.bot` across two backends. Runs as a free Cloudflare Worker.
 *
 * Why a Worker (not a proxied CNAME + Host override): Railway routes by its
 * registered *.up.railway.app domain (SNI), so it rejects an unregistered Host.
 * A Worker's fetch() connects straight to the valid railway.app origin, so SNI
 * and Host both match and Railway routes correctly — no paid custom domain needed.
 *
 * Routing (mirrors the real architecture — see api-ts/src/app.ts + api/main.py):
 *   python-api  → /auth/*   (JWT ISSUER; api-ts has no /auth, it only consumes the JWT)
 *                 /telegram/*, /webhook/*  (Telegram + WhatsApp)
 *                 /users/*, /tools/*       (python-only)
 *   api-ts      → everything else: /v1/agent/*, /mcp, /a2a, /webapp/*, /public/*,
 *                 /staking/*, /billing/*, /health, /.well-known/*, agent cards, llms.txt
 *
 * The webapp flow this preserves: login → python `/auth/verify` mints a JWT
 * (with both `user_id` and `userId` claims, per PR #345) → webapp calls api-ts
 * `/v1/agent/*` and `/webapp/*` with that JWT. Both halves must stay on one host.
 */

const PYTHON_API = "https://python-api-production-8526.up.railway.app";
const API_TS = "https://api-ts-production.up.railway.app";

// Top-level prefixes owned by python-api. Everything else falls through to api-ts.
const PYTHON_PREFIXES = ["/auth", "/telegram", "/webhook", "/users", "/tools"];

function pickOrigin(pathname) {
  for (const p of PYTHON_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return PYTHON_API;
  }
  return API_TS;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = pickOrigin(url.pathname);
    const target = origin + url.pathname + url.search;

    // Re-issue the request at the railway origin. In Workers, fetch() derives the
    // Host header + TLS SNI from the target URL (not from copied headers), so the
    // upstream sees its own railway.app host and routes to the right service.
    const proxied = new Request(target, request);
    // Preserve the public host/proto for any backend that logs or builds URLs.
    proxied.headers.set("X-Forwarded-Host", url.host);
    proxied.headers.set("X-Forwarded-Proto", "https");

    return fetch(proxied);
  },
};

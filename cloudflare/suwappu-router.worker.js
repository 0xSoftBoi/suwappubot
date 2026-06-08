/**
 * Suwappu edge router — replaces the deleted AWS ALB that fronted every
 * `*.suwappu.bot` hostname. Runs as a single free Cloudflare Worker bound to
 * multiple Custom Domains; it branches on hostname, then (for the API) on path.
 *
 * Why a Worker (not a proxied CNAME + Host override): Railway routes by its
 * registered *.up.railway.app domain (SNI), so it rejects an unregistered Host.
 * A Worker's fetch() connects straight to the valid railway.app origin, so SNI
 * and Host both match and Railway routes correctly — no paid custom domain needed.
 *
 * Hostname map:
 *   api.suwappu.bot            → path-routed across python-api + api-ts (the old ALB job)
 *   www.suwappu.bot / apex     → showcase (Next.js marketing site)
 *
 * NOT wired here yet (backend not ready — see cloudflare/README.md):
 *   terminal.suwappu.bot  — terminal service currently returns 502 (app down), fix it first
 *   app.suwappu.bot       — webapp Mini App isn't a Railway service; needs a host (e.g. CF Pages)
 *   devapi.suwappu.bot    — dev environment has no public domains; stand those up first
 */

const ORIGINS = {
  PYTHON: "https://python-api-production-8526.up.railway.app",
  API_TS: "https://api-ts-production.up.railway.app",
  SHOWCASE: "https://showcase-production-6f89.up.railway.app",
};

// On api.suwappu.bot, these top-level prefixes belong to python-api (JWT issuer +
// bot/webhooks). Everything else falls through to api-ts. Validated live:
//   /auth/refresh → python 401, api-ts 404 ; /v1/agent/chains → api-ts 200, python 404
const PYTHON_PREFIXES = ["/auth", "/telegram", "/webhook", "/users", "/tools"];

function pickOrigin(hostname, pathname) {
  if (hostname === "www.suwappu.bot" || hostname === "suwappu.bot") {
    return ORIGINS.SHOWCASE;
  }
  // api.suwappu.bot (and any other host that reaches this Worker) → API path-routing
  for (const p of PYTHON_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return ORIGINS.PYTHON;
  }
  return ORIGINS.API_TS;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = pickOrigin(url.hostname, url.pathname);
    const target = origin + url.pathname + url.search;

    // Re-issue at the railway origin. In Workers, fetch() derives Host + TLS SNI from
    // the target URL (not copied headers), so the upstream sees its own railway.app host.
    const proxied = new Request(target, request);
    proxied.headers.set("X-Forwarded-Host", url.host);
    proxied.headers.set("X-Forwarded-Proto", "https");

    return fetch(proxied);
  },
};

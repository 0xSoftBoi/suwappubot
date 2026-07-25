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
 *   terminal.suwappu.bot       → terminal (trading UI; 502 fixed in PR #349 = listen on $PORT)
 *   app.suwappu.bot            → webapp (Telegram Mini App)
 *   devapi.suwappu.bot         → dev-environment python-api (see PYTHON_DEV note below)
 */

const ORIGINS = {
  PYTHON: "https://python-api-production-8526.up.railway.app",
  API_TS: "https://api-ts-production.up.railway.app",
  SHOWCASE: "https://showcase-production-6f89.up.railway.app",
  TERMINAL: "https://terminal-production-7906.up.railway.app",
  WEBAPP: "https://webapp-production-897e.up.railway.app",
  // Dev environment (Railway env `dev`, forked from production). Unlike prod there is
  // NO api-ts service in dev — the env contains only python-api, terminal and showcase.
  // So devapi does NOT mirror api.suwappu.bot's python/api-ts path split: every path
  // goes to dev python-api, because an API_TS_DEV origin does not exist to fall back to.
  PYTHON_DEV: "https://python-api-dev-456d.up.railway.app",
};

// On api.suwappu.bot, these top-level prefixes belong to python-api. Everything else
// falls through to api-ts. Validated live:
//   /auth/refresh → python 401, api-ts 404 ; /v1/agent/chains → api-ts 200, python 404
//   /terminal/* (orderbook,trades,chart,history) + /webapp/* (alerts,points,copy-trading,
//   discovery,lending,limit-orders,portfolio,…) are python-api routes (api-ts 404s them) —
//   the terminal SPA's data layer; without these here every chart/orderbook/token call 404'd.
const PYTHON_PREFIXES = ["/auth", "/telegram", "/webhook", "/users", "/tools", "/terminal", "/webapp"];

function pickOrigin(hostname, pathname) {
  if (hostname === "www.suwappu.bot" || hostname === "suwappu.bot") {
    return ORIGINS.SHOWCASE;
  }
  // terminal.suwappu.bot serves the trading UI.
  if (hostname === "terminal.suwappu.bot") {
    return ORIGINS.TERMINAL;
  }
  // app.suwappu.bot serves the Telegram Mini App (webapp/ Railway service).
  if (hostname === "app.suwappu.bot") {
    return ORIGINS.WEBAPP;
  }
  // devapi.suwappu.bot → dev python-api for ALL paths (no api-ts in the dev env).
  // Must be checked before the path-routing fallthrough below, which would otherwise
  // send any non-PYTHON_PREFIXES path to the *production* api-ts origin.
  if (hostname === "devapi.suwappu.bot") {
    return ORIGINS.PYTHON_DEV;
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

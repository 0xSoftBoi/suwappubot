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
 *   app.suwappu.bot            → terminal (the old Mini App's source is gone; app now shows terminal)
 *
 * NOT wired here yet (backend not ready — see cloudflare/README.md):
 *   devapi.suwappu.bot    — dev environment has no public domains; stand those up first
 */

const ORIGINS = {
  PYTHON: "https://python-api-production-8526.up.railway.app",
  API_TS: "https://api-ts-production.up.railway.app",
  SHOWCASE: "https://showcase-production-6f89.up.railway.app",
  TERMINAL: "https://terminal-production-7906.up.railway.app",
};

// On api.suwappu.bot, these top-level prefixes belong to python-api. Everything else
// falls through to api-ts. Validated live:
//   /auth/refresh → python 401, api-ts 404 ; /v1/agent/chains → api-ts 200, python 404
//   /terminal/* (orderbook,trades,chart,history) + /webapp/* (alerts,points,copy-trading,
//   discovery,lending,limit-orders,portfolio,…) are python-api routes (api-ts 404s them) —
//   the terminal SPA's data layer; without these here every chart/orderbook/token call 404'd.
const PYTHON_PREFIXES = ["/auth", "/telegram", "/webhook", "/users", "/tools", "/terminal", "/webapp"];

// Header stamped for the Cloudflare Monetization Gateway rollout (see
// docs/deployment/cloudflare-monetization-gateway.md). The Worker signs it on
// paths the Gateway is configured to charge, so api-ts's origin metering
// (api-ts/src/middleware/x402Payment.ts) can skip a second charge for the same
// call. MUST match EDGE_PAYMENT_HEADER in api-ts/src/lib/edgePaymentTrust.ts.
const EDGE_PAYMENT_HEADER = "x-suwappu-edge-payment";
const EDGE_RECEIPT_VERSION = "v1";

// Hex-encode an ArrayBuffer (Web Crypto sign() output) — no Buffer in Workers.
function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Mirrors api-ts/src/lib/edgePaymentTrust.ts's signEdgeReceipt() exactly:
// `v1.<unixSeconds>.<hex hmac-sha256 of "v1:<ts>:<METHOD>:<path>">`. Only
// node:crypto is unavailable here, so this uses Web Crypto's subtle API
// instead — the signed payload format is identical.
async function signEdgeReceipt(secret, method, pathname, timestampSec) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = `${EDGE_RECEIPT_VERSION}:${timestampSec}:${method.toUpperCase()}:${pathname}`;
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${EDGE_RECEIPT_VERSION}.${timestampSec}.${toHex(sig)}`;
}

// Does this path fall under one of the comma-separated GATEWAY_PAID_PREFIXES?
function isGatewayPaidPath(pathname, prefixesCsv) {
  if (!prefixesCsv) return false;
  return prefixesCsv
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function pickOrigin(hostname, pathname) {
  if (hostname === "www.suwappu.bot" || hostname === "suwappu.bot") {
    return ORIGINS.SHOWCASE;
  }
  // terminal.suwappu.bot serves the trading UI; app.suwappu.bot now mirrors it
  // (the old Mini App's deployable source no longer exists).
  if (hostname === "terminal.suwappu.bot" || hostname === "app.suwappu.bot") {
    return ORIGINS.TERMINAL;
  }
  // api.suwappu.bot (and any other host that reaches this Worker) → API path-routing
  for (const p of PYTHON_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return ORIGINS.PYTHON;
  }
  return ORIGINS.API_TS;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = pickOrigin(url.hostname, url.pathname);
    const target = origin + url.pathname + url.search;

    // Re-issue at the railway origin. In Workers, fetch() derives Host + TLS SNI from
    // the target URL (not copied headers), so the upstream sees its own railway.app host.
    const proxied = new Request(target, request);
    proxied.headers.set("X-Forwarded-Host", url.host);
    proxied.headers.set("X-Forwarded-Proto", "https");

    // Spoof prevention: always strip any client-supplied edge-payment receipt
    // before proxying, even when the Gateway trust feature isn't configured —
    // a client must never be able to hand the origin its own "paid" receipt.
    proxied.headers.delete(EDGE_PAYMENT_HEADER);

    // Cloudflare Monetization Gateway rollout: if this Worker has a shared
    // secret + a configured list of Gateway-charged path prefixes, and this
    // request's path matches one, stamp a fresh signed receipt so the origin
    // knows this call was already paid for at the edge and skips metering it
    // again. See docs/deployment/cloudflare-monetization-gateway.md.
    const secret = env && env.GATEWAY_HMAC_SECRET;
    const paidPrefixes = env && env.GATEWAY_PAID_PREFIXES;
    if (secret && paidPrefixes && isGatewayPaidPath(url.pathname, paidPrefixes)) {
      const timestampSec = Math.floor(Date.now() / 1000);
      const receipt = await signEdgeReceipt(secret, request.method, url.pathname, timestampSec);
      proxied.headers.set(EDGE_PAYMENT_HEADER, receipt);
    }

    return fetch(proxied);
  },
};

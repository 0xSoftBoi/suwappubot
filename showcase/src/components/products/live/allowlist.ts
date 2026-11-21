/**
 * The ONE place that decides what the site may call from a visitor's browser.
 * Anything not listed here is refused by `callApi` before a request is made.
 * Fund-moving routes (/swap, /swap/execute, /execute, billing topup/subscribe,
 * wallet creation, policy writes, killswitch writes, order placement) are
 * deliberately absent: they run only from the visitor's own code.
 */
export const RUNNABLE = [
  'GET /v1/agent/chains',
  'GET /v1/agent/openapi',
  'GET /v1/agent/me',
  'GET /v1/agent/billing',
  'GET /v1/agent/tokens',
  'GET /v1/agent/prices',
  'GET /v1/agent/portfolio',
  'GET /v1/agent/swaps',
  'GET /v1/agent/webhooks',
  'GET /v1/agent/wallets',
  'GET /v1/agent/wallet/policies',
  'GET /v1/agent/audit',
  'GET /v1/agent/audit/verify',
  'GET /v1/agent/approvals',
  'GET /v1/agent/killswitch',
  'GET /v1/agent/perps/markets',
  'GET /v1/agent/perps/positions',
  'GET /v1/agent/predict/markets',
  'GET /v1/agent/predict/positions',
  'GET /v1/agent/lend/markets',
  'POST /v1/agent/register',
  'POST /v1/agent/quote',
  'POST /v1/agent/swap/simulate',
  'POST /mcp',
] as const;

/** Endpoints whose POST body the site can build from a form (the LiveConsole). */
export const BODY_BUILT = new Set(['POST /v1/agent/quote', 'POST /v1/agent/swap/simulate']);

/** Credits per call, from GET /v1/agent/billing `cost_weights` (live) and the page specs. */
export const CREDIT_COST: Record<string, number> = {
  'POST /v1/agent/quote': 1,
  'POST /v1/agent/swap/simulate': 1,
  'GET /v1/agent/prices': 1,
  'GET /v1/agent/portfolio': 1,
  'GET /v1/agent/tokens': 0,
  'GET /v1/agent/chains': 0,
};

/** Normalise a page-data path (`/v1/agent/swap/status/:swapId`) for matching. */
export const routeId = (method: string, path: string) => `${method.toUpperCase()} ${path.split('?')[0]}`;
export const isRunnable = (method: string, path: string) => (RUNNABLE as readonly string[]).includes(routeId(method, path));
export const hasPathParam = (path: string) => /:[A-Za-z]|\{/.test(path);

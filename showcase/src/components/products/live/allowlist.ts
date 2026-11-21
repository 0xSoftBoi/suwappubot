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
  'GET /v1/agent/perps/markets',
  'GET /v1/agent/perps/positions',
  'GET /v1/agent/predict/markets',
  'GET /v1/agent/lend/markets',
  'GET /v1/autopilot',
  'POST /v1/agent/register',
  'POST /v1/agent/quote',
  'POST /v1/agent/swap/simulate',
  'POST /mcp',
] as const;

/** Routes the key alone cannot call: shown as an honest note instead of a Run button. */
export const CREDENTIAL_NOTE: Record<string, { text: string; href?: string }> = {
  'GET /v1/agent/approvals': { text: 'Needs a signed-in dashboard session', href: '/dashboard' },
  'GET /v1/agent/killswitch': { text: 'Needs an org API key' },
  'GET /enterprise/orgs/me': { text: 'Needs a signed-in dashboard session', href: '/dashboard' },
  'GET /v1/agent/audit/verify': { text: 'Needs an org API key' },
  'GET /v1/agent/predict/positions': { text: 'Needs a signed-in dashboard session', href: '/dashboard' },
};

/** Required query params. The Run button reveals these inputs and refuses to send until they validate. */
export type ParamSpec = { name: string; label: string; placeholder: string; kind: 'evm_or_solana' | 'evm' | 'symbols' };
export const PARAMS: Record<string, ParamSpec[]> = {
  'GET /v1/agent/portfolio': [{ name: 'wallet_address', label: 'Wallet address (your managed wallet)', placeholder: '0x…', kind: 'evm_or_solana' }],
  'GET /v1/agent/perps/positions': [{ name: 'address', label: 'EVM address', placeholder: '0x…', kind: 'evm' }],
  'GET /v1/agent/prices': [{ name: 'symbols', label: 'Symbols (1-20, comma separated)', placeholder: 'ETH,SOL,USDC', kind: 'symbols' }],
};
const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Returns an error message, or null when the value is acceptable. */
export function validateParam(spec: ParamSpec, raw: string): string | null {
  const v = raw.trim();
  if (!v) return `${spec.name} is required.`;
  if (spec.kind === 'evm') return EVM.test(v) ? null : 'Enter a 0x… EVM address (42 characters).';
  if (spec.kind === 'evm_or_solana') return EVM.test(v) || SOL.test(v) ? null : 'Enter a 0x… EVM address or a Solana address.';
  const list = v.split(',').map((x) => x.trim());
  return list.length <= 20 && list.every((x) => /^[A-Za-z0-9._-]{1,15}$/.test(x)) ? null : 'Use 1-20 token symbols separated by commas, e.g. ETH,SOL.';
}
/** Routes that only make sense once a managed wallet exists (checked with a free GET /wallets first). */
export const NEEDS_WALLET = new Set(['GET /v1/agent/wallet/policies']);

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

/** Reads that work without a key; everything else prompts for one before running. */
export const KEYLESS = new Set(['GET /v1/agent/chains', 'GET /v1/agent/openapi', 'GET /v1/autopilot']);
/** Default body for the two POST routes the endpoint table can run without a form. */
export const DEFAULT_BODY: Record<string, unknown> = {
  'POST /v1/agent/quote': { from_token: 'USDC', to_token: 'ETH', amount: '10', chain: 'base' },
  'POST /v1/agent/swap/simulate': { from_token: 'USDC', to_token: 'ETH', amount: '10', chain: 'base' },
};

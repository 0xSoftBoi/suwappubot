/**
 * Agent Swap Passport — ETHGlobal Tokyo 2026 demo.
 *
 * Talks to the hackathon endpoints a parallel agent is finalizing on the
 * python-api monolith. Base URL is overridable so local/dev runs can point
 * at a branch deploy before it lands on api.suwappu.bot.
 */
export const HACKATHON_API_BASE =
  process.env.NEXT_PUBLIC_HACKATHON_API || 'https://api.suwappu.bot';

export type ProviderState = {
  ok?: boolean;
  status?: string;
  [key: string]: unknown;
};

export type HackathonStatus = {
  trustLayer?: string;
  providers?: Record<string, ProviderState | boolean | string>;
};

export type TradeIntent = {
  agentId: string;
  chain: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
};

export const TRADE_DEFAULTS: TradeIntent = {
  agentId: 'suwappu-demo-agent',
  chain: 'base',
  fromToken: 'USDC',
  toToken: 'ETH',
  amountIn: '10',
};

export type WorldIdStartResponse = {
  connectorURI: string;
  signal: string;
  stepUp?: unknown;
};

export type WorldIdVerifyResponse =
  | { status: 'pending' }
  | { status: 'verified'; ok: true; nullifier: string }
  | { status: 'failed'; ok: false; reason?: string };

export type Receipt = { status?: string; blockNumber?: number };

export type Evidence = {
  chainId?: number;
  ens?: {
    parent?: string;
    subregistry?: string;
    sample?: { name?: string; txHash?: string; resolvedAddress?: string };
  };
  uniswap?: { hook?: string; deployTx?: string; swapTx?: string };
  receipts?: Record<string, Receipt>;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${HACKATHON_API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body ? body.slice(0, 240) : res.statusText);
  }
  return res.json() as Promise<T>;
}

export function getStatus(): Promise<HackathonStatus> {
  return fetchJson('/hackathon/status');
}

export function startWorldId(
  trade: TradeIntent & { summary: string },
): Promise<WorldIdStartResponse> {
  return fetchJson('/hackathon/world-id/start', {
    method: 'POST',
    body: JSON.stringify(trade),
  });
}

export function verifyWorldId(signal: string): Promise<WorldIdVerifyResponse> {
  return fetchJson('/hackathon/world-id/verify', {
    method: 'POST',
    body: JSON.stringify({ signal }),
  });
}

export function getEvidence(): Promise<Evidence> {
  return fetchJson('/hackathon/evidence');
}

/** World ID simulator deep link for scanning without a physical device. */
export function simulatorUrl(connectorURI: string): string {
  return `https://simulator.worldcoin.org/?uri=${encodeURIComponent(connectorURI)}`;
}

export function etherscanTx(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

export function etherscanAddress(address: string): string {
  return `https://sepolia.etherscan.io/address/${address}`;
}

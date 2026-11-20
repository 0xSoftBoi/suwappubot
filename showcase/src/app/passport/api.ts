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

export type SwapBlocked = { status: 'blocked'; reason: string; detail?: string };
export type SwapSubmitted = { status: 'submitted'; jobId: string };
export type SwapStartResponse = SwapBlocked | SwapSubmitted;

export type SwapJob = {
  status: 'submitted' | 'executed' | 'failed';
  txHash?: string;
  blockNumber?: number;
  reason?: string;
  executedBy?: string;
  swapper?: string;
};

export type PassportStartResponse = {
  connectorURI: string;
  signal: string;
  simulatorUrl?: string;
};

type EnsInfo = { name: string; txHash: string | null; existing: boolean };
type HookInfo = { allowlistTx: string | null; existing: boolean };

export type PassportVerifyResponse =
  | { status: 'pending' }
  | { status: 'provisioning'; nullifier: string }
  | { status: 'ready'; nullifier: string; wallet: string; ens: EnsInfo; hook: HookInfo }
  | { status: 'existing'; nullifier: string; wallet: string; ens: EnsInfo; hook: HookInfo }
  | { status: 'failed'; reason?: string };

export type PassportRecord = {
  label?: string;
  ensName?: string;
  ensResolvesToWallet?: boolean;
  hookAllowlisted?: boolean;
  ens?: Record<string, unknown>;
  hook?: Record<string, unknown>;
  swaps?: { txHash: string; blockNumber?: number; status: string }[];
  explorer?: string;
};

export type Evidence = {
  chainId?: number;
  ens?: { parent?: string };
  uniswap?: { hook?: string; deployTx?: string };
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

export function getEvidence(): Promise<Evidence> {
  return fetchJson('/hackathon/evidence');
}

export function passportSwap(wallet: string): Promise<SwapStartResponse> {
  return fetchJson('/hackathon/passport/swap', {
    method: 'POST',
    body: JSON.stringify({ wallet }),
  });
}

export function getSwapJob(jobId: string): Promise<SwapJob> {
  return fetchJson(`/hackathon/passport/swap/${jobId}`);
}

export function passportStart(wallet: string): Promise<PassportStartResponse> {
  return fetchJson('/hackathon/passport/start', {
    method: 'POST',
    body: JSON.stringify({ wallet }),
  });
}

export function passportVerify(signal: string): Promise<PassportVerifyResponse> {
  return fetchJson('/hackathon/passport/verify', {
    method: 'POST',
    body: JSON.stringify({ signal }),
  });
}

export function getPassport(wallet: string): Promise<PassportRecord> {
  return fetchJson(`/hackathon/passport/${wallet}`);
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

export const HOOK_ADDRESS = '0xc72ab4dFd3d6B2C1b3af51816EA8331599e6c080';

export function ensAppUrl(name: string): string {
  return `https://sepolia.app.ens.domains/${name}`;
}

/** Client-side random 20-byte EVM address — good enough for a demo "fresh agent wallet". */
export function randomWallet(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

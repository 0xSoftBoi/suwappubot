/**
 * Browser wallet sign-in (MetaMask / Phantom) against the Python auth API.
 *
 * The backend has supported this since the SIWE work landed — POST
 * /auth/turnkey/{challenge,verify} for EVM and /auth/solana/{challenge,verify}
 * for Solana — but nothing on the web ever called it, so the only web sign-in
 * was Google (plus a paste-a-bearer-token escape hatch). This module is the
 * missing client half.
 *
 * Both flows are the same three steps and deliberately share one shape:
 *   1. ask the injected provider for an address
 *   2. POST the address, get back a SIWE/SIWS challenge string + nonce
 *   3. sign the challenge, POST {address, signature, nonce} to verify
 *
 * Verify responds with `Set-Cookie: suwappu_auth=…` on the PARENT domain, which
 * is what actually logs the browser in — so every request here MUST send
 * `credentials: 'include'`, and the returned bearer token is a convenience for
 * callers that prefer a header, not the session itself.
 *
 * The challenge is bound to the requesting Origin server-side
 * (`_wallet_auth_origin` in api/main.py), so a challenge minted for suwappu.bot
 * cannot be replayed from another site.
 */

import { AUTH_BASE_URL } from './links';

export type WalletKind = 'evm' | 'solana';

export interface WalletLoginResult {
  address: string;
  /** Session bearer. The httpOnly cookie is the real session; this mirrors it. */
  token: string;
}

/** Signals the user closed/denied the wallet prompt — not worth an error banner. */
export class WalletLoginCancelled extends Error {
  constructor() {
    super('Sign-in cancelled');
    this.name = 'WalletLoginCancelled';
  }
}

interface EvmProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  providers?: EvmProvider[];
}

interface SolanaProvider {
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
  isPhantom?: boolean;
}

declare global {
  interface Window {
    ethereum?: EvmProvider;
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}

/**
 * EIP-1193 "user rejected request". Wallets are inconsistent about the shape:
 * MetaMask uses code 4001, Phantom throws a plain Error whose message says so.
 */
function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number | string; message?: string } | null;
  if (!e) return false;
  if (e.code === 4001 || e.code === 'ACTION_REJECTED') return true;
  return /user rejected|user denied|request rejected|cancell?ed/i.test(e.message ?? '');
}

/**
 * Pick the EVM provider to talk to.
 *
 * With several extensions installed, `window.ethereum` is whichever one won the
 * injection race and may expose the rest under `.providers`. Prefer MetaMask
 * when it is in there so the button does what its label says.
 */
export function getEvmProvider(): EvmProvider | null {
  if (typeof window === 'undefined') return null;
  const injected = window.ethereum;
  if (!injected) return null;
  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    return injected.providers.find((p) => p.isMetaMask) ?? injected.providers[0];
  }
  return injected;
}

/** Phantom injects under `window.phantom.solana`; older builds only set `window.solana`. */
export function getSolanaProvider(): SolanaProvider | null {
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana ?? window.solana ?? null;
}

export function isWalletAvailable(kind: WalletKind): boolean {
  return kind === 'evm' ? getEvmProvider() !== null : getSolanaProvider() !== null;
}

/** Where to send someone with no extension installed. */
export const WALLET_INSTALL_URL: Record<WalletKind, string> = {
  evm: 'https://metamask.io/download/',
  solana: 'https://phantom.app/download',
};

async function postAuth<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${AUTH_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Required: verify's Set-Cookie IS the session.
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `Sign-in failed (${res.status})`;
    try {
      const parsed = (await res.json()) as { detail?: string };
      if (parsed?.detail) detail = parsed.detail;
    } catch {
      // Non-JSON error body — the status-code message above is all we have.
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

interface ChallengeResponse {
  challenge: string;
  nonce: string;
}

interface VerifyResponse {
  success: boolean;
  token: string;
  user: { id: number; address: string; username?: string };
}

/** MetaMask / any EIP-1193 wallet → SIWE → session cookie. */
async function loginWithEvm(): Promise<WalletLoginResult> {
  const provider = getEvmProvider();
  if (!provider) throw new Error('No Ethereum wallet detected. Install MetaMask to continue.');

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts?.[0];
  if (!address) throw new WalletLoginCancelled();

  const { challenge, nonce } = await postAuth<ChallengeResponse>('/auth/turnkey/challenge', {
    address,
  });

  // personal_sign takes [message, address] — the reverse order silently
  // produces a signature over the address, which then fails verification.
  const signature = (await provider.request({
    method: 'personal_sign',
    params: [challenge, address],
  })) as string;

  const verified = await postAuth<VerifyResponse>('/auth/turnkey/verify', {
    address,
    signature,
    nonce,
    provider: 'external',
  });
  return { address: verified.user.address, token: verified.token };
}

/** Phantom → SIWS (ed25519) → session cookie. */
async function loginWithSolana(): Promise<WalletLoginResult> {
  const provider = getSolanaProvider();
  if (!provider) throw new Error('No Solana wallet detected. Install Phantom to continue.');

  const { publicKey } = await provider.connect();
  // NOTE: base58 pubkeys are CASE-SENSITIVE — the server matches them exactly.
  const address = publicKey.toString();

  const { challenge, nonce } = await postAuth<ChallengeResponse>('/auth/solana/challenge', {
    address,
  });

  const encoded = new TextEncoder().encode(challenge);
  const { signature } = await provider.signMessage(encoded, 'utf8');

  const verified = await postAuth<VerifyResponse>('/auth/solana/verify', {
    address,
    signature: toBase58(signature),
    nonce,
  });
  return { address: verified.user.address, token: verified.token };
}

export async function loginWithWallet(kind: WalletKind): Promise<WalletLoginResult> {
  try {
    return kind === 'evm' ? await loginWithEvm() : await loginWithSolana();
  } catch (err) {
    if (isUserRejection(err)) throw new WalletLoginCancelled();
    throw err;
  }
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode Phantom's raw signature bytes as base58, which is what
 * `verify_solana_auth_signature` decodes.
 *
 * Deliberately identical to `encodeBase58` in webapp/src/lib/injected-wallet.ts
 * (already proven against the live endpoint). It is duplicated rather than
 * shared because showcase is a standalone Next.js app that depends on neither
 * the webapp nor @suwappu/sdk; adding a package edge across three apps to move
 * one 15-line function is the worse trade. If a third copy ever appears, that
 * is the signal to promote it into the SDK — keep the two in sync until then.
 */
function toBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const digits: number[] = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  // Each leading zero byte is a literal '1', and `digits` is little-endian.
  // The `length - 1` bound (not `length`) matters only for an all-zero input,
  // where `digits` already contributes the final '1' — without it that case
  // gains a spurious leading character.
  let out = '';
  for (let i = 0; i < bytes.length - 1 && bytes[i] === 0; i++) out += BASE58_ALPHABET[0];
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

export const __testing = { toBase58 };

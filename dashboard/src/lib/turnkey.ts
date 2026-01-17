/**
 * Turnkey authentication utilities for the frontend.
 * Handles wallet connection, challenge signing, and session management.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export interface AuthChallenge {
  challenge: string;
  nonce: string;
  expiresAt: string;
}

export interface AuthUser {
  id: number;
  address: string;
  username: string;
}

export interface AuthSession {
  success: boolean;
  token: string;
  user: AuthUser | null;
  expiresAt: string;
}

export interface AuthStatus {
  authenticated: boolean;
  address?: string;
  userId?: number;
  createdAt?: string;
}

/**
 * Request a challenge message for wallet authentication.
 */
export async function requestChallenge(address: string): Promise<AuthChallenge> {
  const response = await fetch(`${API_BASE}/auth/turnkey/challenge`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ address }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to request challenge');
  }

  return response.json();
}

/**
 * Verify a signed challenge and create a session.
 */
export async function verifySignature(
  address: string,
  signature: string,
  nonce: string
): Promise<AuthSession> {
  const response = await fetch(`${API_BASE}/auth/turnkey/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ address, signature, nonce }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to verify signature');
  }

  return response.json();
}

/**
 * Get the current authenticated user's status.
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  try {
    const response = await fetch(`${API_BASE}/auth/me`, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      return { authenticated: false };
    }

    return response.json();
  } catch {
    return { authenticated: false };
  }
}

/**
 * Log out the current user.
 */
export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}

/**
 * Check if MetaMask or another Ethereum wallet is available.
 */
export function isWalletAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).ethereum;
}

/**
 * Request wallet connection and return the connected address.
 */
export async function connectWallet(): Promise<string> {
  if (!isWalletAvailable()) {
    throw new Error('No Ethereum wallet found. Please install MetaMask.');
  }

  const ethereum = (window as any).ethereum;
  
  try {
    const accounts = await ethereum.request({
      method: 'eth_requestAccounts',
    });

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts found');
    }

    return accounts[0];
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error('User rejected the connection request');
    }
    throw error;
  }
}

/**
 * Sign a message using the connected wallet.
 */
export async function signMessage(address: string, message: string): Promise<string> {
  if (!isWalletAvailable()) {
    throw new Error('No Ethereum wallet found');
  }

  const ethereum = (window as any).ethereum;

  try {
    const signature = await ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    });

    return signature;
  } catch (error: any) {
    if (error.code === 4001) {
      throw new Error('User rejected the signature request');
    }
    throw error;
  }
}

/**
 * Get the current connected wallet address (if any).
 */
export async function getCurrentAddress(): Promise<string | null> {
  if (!isWalletAvailable()) return null;

  const ethereum = (window as any).ethereum;

  try {
    const accounts = await ethereum.request({
      method: 'eth_accounts',
    });

    return accounts && accounts.length > 0 ? accounts[0] : null;
  } catch {
    return null;
  }
}

/**
 * Full authentication flow: connect wallet, request challenge, sign, verify.
 */
export async function authenticateWithWallet(): Promise<AuthSession> {
  // 1. Connect wallet
  const address = await connectWallet();

  // 2. Request challenge
  const { challenge, nonce } = await requestChallenge(address);

  // 3. Sign challenge
  const signature = await signMessage(address, challenge);

  // 4. Verify and create session
  const session = await verifySignature(address, signature, nonce);

  return session;
}

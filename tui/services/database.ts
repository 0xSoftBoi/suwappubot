/**
 * Database viewer service - fetches data from API or directly from SQLite
 */

import { testEndpoint, getBaseUrl } from './api';

export interface UserRecord {
  id: number;
  telegramId: string | null;
  username: string | null;
  createdAt: string;
  tosAccepted: boolean;
}

export interface WalletRecord {
  id: number;
  userId: number;
  name: string;
  address: string;
  chainType: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

export interface SwapRecord {
  id: number;
  userId: number;
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string | null;
  status: string;
  txHash: string | null;
  timestamp: string;
}

export interface DatabaseStats {
  userCount: number;
  walletCount: number;
  swapCount: number;
  lastSwapTime: string | null;
}

// Fetch via API endpoints
export async function fetchUsers(limit: number = 10): Promise<UserRecord[]> {
  // This would need an admin endpoint - for now return empty
  // The API doesn't expose a user list endpoint
  return [];
}

export async function fetchWallets(userId: number = 1): Promise<WalletRecord[]> {
  const result = await testEndpoint('GET', `/users/${userId}/wallets`);

  if (result.error || result.status !== 200) {
    return [];
  }

  const data = result.data as Array<{
    id: number;
    userId: number;
    name: string;
    address: string;
    chainType: string;
    isActive: boolean;
    isDefault: boolean;
    createdAt: string;
  }>;

  return data.map((w) => ({
    id: w.id,
    userId: w.userId,
    name: w.name,
    address: w.address,
    chainType: w.chainType,
    isActive: w.isActive,
    isDefault: w.isDefault,
    createdAt: w.createdAt,
  }));
}

export async function fetchSwaps(limit: number = 20): Promise<SwapRecord[]> {
  // Try admin endpoint first, fall back to user endpoint
  let result = await testEndpoint('GET', `/admin/swaps?limit=${limit}`);

  if (result.status !== 200) {
    // Fall back to user 1 swaps
    result = await testEndpoint('GET', `/users/1/swaps?limit=${limit}`);
  }

  if (result.error || result.status !== 200) {
    return [];
  }

  const data = result.data as Array<{
    id: number;
    userId?: number;
    fromChain: string;
    toChain: string;
    fromToken: string;
    toToken: string;
    fromAmount: string;
    toAmount: string | null;
    status: string;
    txHash: string | null;
    timestamp: string;
  }>;

  return data.map((s) => ({
    id: s.id,
    userId: s.userId || 1,
    fromChain: s.fromChain,
    toChain: s.toChain,
    fromToken: s.fromToken,
    toToken: s.toToken,
    fromAmount: s.fromAmount,
    toAmount: s.toAmount,
    status: s.status,
    txHash: s.txHash,
    timestamp: s.timestamp,
  }));
}

// Direct SQLite queries (for local development)
export async function querySqlite(dbPath: string, query: string): Promise<unknown[]> {
  try {
    const proc = Bun.spawn(['sqlite3', '-json', dbPath, query], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return [];
    }

    return JSON.parse(stdout || '[]');
  } catch {
    return [];
  }
}

export async function getLocalDatabaseStats(dbPath: string): Promise<DatabaseStats | null> {
  try {
    const userCount = await querySqlite(dbPath, 'SELECT COUNT(*) as count FROM users');
    const walletCount = await querySqlite(dbPath, 'SELECT COUNT(*) as count FROM wallets');
    const swapCount = await querySqlite(dbPath, 'SELECT COUNT(*) as count FROM swap_transactions');
    const lastSwap = await querySqlite(
      dbPath,
      'SELECT created_at FROM swap_transactions ORDER BY created_at DESC LIMIT 1'
    );

    return {
      userCount: (userCount[0] as { count: number })?.count || 0,
      walletCount: (walletCount[0] as { count: number })?.count || 0,
      swapCount: (swapCount[0] as { count: number })?.count || 0,
      lastSwapTime: (lastSwap[0] as { created_at: string })?.created_at || null,
    };
  } catch {
    return null;
  }
}

export async function getRecentSwapsFromSqlite(
  dbPath: string,
  limit: number = 20
): Promise<SwapRecord[]> {
  const query = `
    SELECT
      id,
      user_id as userId,
      from_chain as fromChain,
      to_chain as toChain,
      from_token as fromToken,
      to_token as toToken,
      from_amount as fromAmount,
      to_amount as toAmount,
      status,
      tx_hash as txHash,
      created_at as timestamp
    FROM swap_transactions
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const results = await querySqlite(dbPath, query);
  return results as SwapRecord[];
}

export async function getWalletsFromSqlite(
  dbPath: string,
  limit: number = 50
): Promise<WalletRecord[]> {
  const query = `
    SELECT
      id,
      user_id as userId,
      name,
      address,
      chain_type as chainType,
      is_active as isActive,
      is_default as isDefault,
      created_at as createdAt
    FROM wallets
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  const results = await querySqlite(dbPath, query);
  return results as WalletRecord[];
}

// Find local SQLite database
export async function findLocalDatabase(): Promise<string | null> {
  const possiblePaths = [
    './suwappubot.db',
    './bot.db',
    '../suwappubot.db',
    '../bot.db',
  ];

  for (const path of possiblePaths) {
    const file = Bun.file(path);
    if (await file.exists()) {
      return path;
    }
  }

  return null;
}

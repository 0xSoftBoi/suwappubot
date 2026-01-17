/**
 * Alchemy SDK wrapper for frontend blockchain data.
 *
 * Provides access to:
 * - Token balances and metadata
 * - NFT data
 * - Transaction history
 * - Real-time updates via WebSockets
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// Supported chains
export type SupportedChain =
  | 'ethereum'
  | 'polygon'
  | 'arbitrum'
  | 'optimism'
  | 'base';

// Token balance
export interface TokenBalance {
  contractAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceFormatted: number;
  logoUrl?: string;
  usdValue?: number;
}

// Native balance
export interface NativeBalance {
  chain: string;
  balance: number;
  symbol: string;
  usdValue?: number;
}

// Portfolio totals
export interface Portfolio {
  totalUsd: number;
  nativeBalances: NativeBalance[];
  tokenBalances: TokenBalance[];
  chains: Record<string, number>;
}

// Asset transfer
export interface AssetTransfer {
  blockNum: number;
  txHash: string;
  from: string;
  to: string;
  value: number | null;
  asset: string;
  category: 'external' | 'internal' | 'erc20' | 'erc721' | 'erc1155';
  timestamp?: string;
}

// NFT
export interface NFT {
  contractAddress: string;
  tokenId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  collection?: string;
  chain: string;
}

// Chain configuration
const CHAIN_CONFIG: Record<SupportedChain, { name: string; symbol: string; decimals: number }> = {
  ethereum: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
  polygon: { name: 'Polygon', symbol: 'MATIC', decimals: 18 },
  arbitrum: { name: 'Arbitrum', symbol: 'ETH', decimals: 18 },
  optimism: { name: 'Optimism', symbol: 'ETH', decimals: 18 },
  base: { name: 'Base', symbol: 'ETH', decimals: 18 },
};

/**
 * Get token balances for an address on a specific chain.
 */
export async function getTokenBalances(
  address: string,
  chain: SupportedChain = 'ethereum'
): Promise<TokenBalance[]> {
  try {
    const response = await fetch(
      `${API_BASE}/alchemy/tokens/${address}?chain=${chain}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );

    if (!response.ok) {
      console.error('Failed to fetch token balances');
      return [];
    }

    return response.json();
  } catch (error) {
    console.error('Error fetching token balances:', error);
    return [];
  }
}

/**
 * Get native balance (ETH, MATIC, etc.) for an address on a chain.
 */
export async function getNativeBalance(
  address: string,
  chain: SupportedChain = 'ethereum'
): Promise<NativeBalance | null> {
  try {
    const response = await fetch(
      `${API_BASE}/alchemy/balance/${address}?chain=${chain}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const config = CHAIN_CONFIG[chain];

    return {
      chain,
      balance: data.balance,
      symbol: config.symbol,
      usdValue: data.usdValue,
    };
  } catch (error) {
    console.error('Error fetching native balance:', error);
    return null;
  }
}

/**
 * Get full portfolio across all supported chains.
 */
export async function getPortfolio(address: string): Promise<Portfolio> {
  const chains: SupportedChain[] = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'];

  const nativeBalances: NativeBalance[] = [];
  const allTokenBalances: TokenBalance[] = [];
  const chainValues: Record<string, number> = {};
  let totalUsd = 0;

  // Fetch balances from all chains in parallel
  await Promise.all(
    chains.map(async (chain) => {
      const [nativeBalance, tokenBalances] = await Promise.all([
        getNativeBalance(address, chain),
        getTokenBalances(address, chain),
      ]);

      let chainTotal = 0;

      if (nativeBalance) {
        nativeBalances.push(nativeBalance);
        chainTotal += nativeBalance.usdValue || 0;
      }

      tokenBalances.forEach((token) => {
        allTokenBalances.push(token);
        chainTotal += token.usdValue || 0;
      });

      chainValues[chain] = chainTotal;
      totalUsd += chainTotal;
    })
  );

  return {
    totalUsd,
    nativeBalances,
    tokenBalances: allTokenBalances,
    chains: chainValues,
  };
}

/**
 * Get transaction history for an address.
 */
export async function getTransactionHistory(
  address: string,
  chain: SupportedChain = 'ethereum',
  limit: number = 50
): Promise<AssetTransfer[]> {
  try {
    const response = await fetch(
      `${API_BASE}/alchemy/transfers/${address}?chain=${chain}&limit=${limit}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );

    if (!response.ok) {
      return [];
    }

    return response.json();
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    return [];
  }
}

/**
 * Get NFTs owned by an address.
 */
export async function getNFTs(
  address: string,
  chain: SupportedChain = 'ethereum'
): Promise<NFT[]> {
  try {
    const response = await fetch(
      `${API_BASE}/alchemy/nfts/${address}?chain=${chain}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    return data.map((nft: any) => ({
      contractAddress: nft.contract?.address || '',
      tokenId: nft.tokenId || '',
      name: nft.name || nft.title || 'Unnamed NFT',
      description: nft.description,
      imageUrl: nft.image?.cachedUrl || nft.image?.originalUrl,
      collection: nft.contract?.name,
      chain,
    }));
  } catch (error) {
    console.error('Error fetching NFTs:', error);
    return [];
  }
}

/**
 * Get token metadata.
 */
export async function getTokenMetadata(
  contractAddress: string,
  chain: SupportedChain = 'ethereum'
): Promise<{ symbol: string; name: string; decimals: number; logo?: string } | null> {
  try {
    const response = await fetch(
      `${API_BASE}/alchemy/token/${contractAddress}?chain=${chain}`,
      {
        method: 'GET',
        credentials: 'include',
      }
    );

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('Error fetching token metadata:', error);
    return null;
  }
}

/**
 * Simulate a transaction before execution.
 */
export async function simulateTransaction(
  params: {
    from: string;
    to: string;
    data: string;
    value?: string;
  },
  chain: SupportedChain = 'ethereum'
): Promise<{
  success: boolean;
  gasUsed: number;
  error?: string;
}> {
  try {
    const response = await fetch(`${API_BASE}/alchemy/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ ...params, chain }),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        success: false,
        gasUsed: 0,
        error: error.detail || 'Simulation failed',
      };
    }

    return response.json();
  } catch (error: any) {
    return {
      success: false,
      gasUsed: 0,
      error: error.message || 'Simulation failed',
    };
  }
}

/**
 * Format a token balance for display.
 */
export function formatBalance(balance: number, decimals: number = 4): string {
  if (balance === 0) return '0';

  if (balance < 0.0001) {
    return '< 0.0001';
  }

  return balance.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format USD value for display.
 */
export function formatUSD(value: number): string {
  if (value === 0) return '$0.00';

  if (value < 0.01) {
    return '< $0.01';
  }

  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Get chain display name.
 */
export function getChainName(chain: SupportedChain): string {
  return CHAIN_CONFIG[chain]?.name || chain;
}

/**
 * Get chain native symbol.
 */
export function getChainSymbol(chain: SupportedChain): string {
  return CHAIN_CONFIG[chain]?.symbol || 'ETH';
}

/**
 * Check if Alchemy is configured (has API key).
 */
export async function isAlchemyConfigured(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/alchemy/status`, {
      method: 'GET',
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.configured === true;
  } catch {
    return false;
  }
}

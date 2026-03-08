"use client";

import { useState, useEffect, useCallback } from 'react';

interface PortfolioData {
  totalUSD: number;
  change24h: number;
  chains: Record<string, number>;
  tokens?: Array<{
    symbol: string;
    name: string;
    chain: string;
    balance: string;
    usdValue: number;
  }>;
}

interface SwapData {
  id: number | string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount?: string;
  fromChain: string;
  toChain: string;
  status: string;
  timestamp: string;
  txHash?: string;
}

interface DashboardData {
  portfolio: PortfolioData | null;
  swaps: SwapData[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useDashboardData(): DashboardData {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [swaps, setSwaps] = useState<SwapData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [pRes, sRes] = await Promise.all([
        fetch('/api/portfolio'),
        fetch('/api/swaps?limit=5'),
      ]);

      if (!pRes.ok) throw new Error('Failed to fetch portfolio');
      if (!sRes.ok) throw new Error('Failed to fetch swaps');

      const portfolioData = await pRes.json();
      const swapsData = await sRes.json();

      setPortfolio(portfolioData);
      setSwaps(Array.isArray(swapsData) ? swapsData : swapsData.swaps || []);
    } catch (err: any) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err.message || 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { portfolio, swaps, isLoading, error, refetch: fetchData };
}

"use client";

import { useState, useEffect, useCallback } from 'react';

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

interface SwapFilters {
  status: string;
  chain: string;
  search: string;
}

interface SwapHistoryResult {
  swaps: SwapData[];
  total: number;
  isLoading: boolean;
  error: string | null;
  loadMore: () => void;
  hasMore: boolean;
  filters: SwapFilters;
  setFilters: (filters: Partial<SwapFilters>) => void;
}

const PAGE_SIZE = 20;

export function useSwapHistory(): SwapHistoryResult {
  const [swaps, setSwaps] = useState<SwapData[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<SwapFilters>({
    status: 'all',
    chain: 'all',
    search: '',
  });

  const fetchSwaps = useCallback(async (currentOffset: number, append: boolean) => {
    try {
      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(currentOffset),
      });

      if (filters.status !== 'all') {
        params.set('status', filters.status);
      }

      const res = await fetch(`/api/swaps?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch swap history');

      const data = await res.json();
      const items = Array.isArray(data) ? data : data.swaps || [];
      const totalCount = data.total ?? items.length + currentOffset;

      if (append) {
        setSwaps((prev) => [...prev, ...items]);
      } else {
        setSwaps(items);
      }
      setTotal(totalCount);
    } catch (err: any) {
      console.error('Failed to fetch swap history:', err);
      setError(err.message || 'Failed to load swap history');
    } finally {
      setIsLoading(false);
    }
  }, [filters.status]);

  useEffect(() => {
    setOffset(0);
    fetchSwaps(0, false);
  }, [fetchSwaps]);

  const loadMore = useCallback(() => {
    const newOffset = offset + PAGE_SIZE;
    setOffset(newOffset);
    fetchSwaps(newOffset, true);
  }, [offset, fetchSwaps]);

  const setFilters = useCallback((partial: Partial<SwapFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...partial }));
  }, []);

  const filteredSwaps = swaps.filter((swap) => {
    if (filters.chain !== 'all') {
      const chain = filters.chain.toLowerCase();
      if (swap.fromChain.toLowerCase() !== chain && swap.toChain.toLowerCase() !== chain) {
        return false;
      }
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      return (
        swap.fromToken.toLowerCase().includes(q) ||
        swap.toToken.toLowerCase().includes(q) ||
        swap.fromChain.toLowerCase().includes(q) ||
        swap.toChain.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return {
    swaps: filteredSwaps,
    total,
    isLoading,
    error,
    loadMore,
    hasMore: swaps.length < total,
    filters,
    setFilters,
  };
}

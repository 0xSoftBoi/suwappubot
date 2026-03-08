"use client";

import React from 'react';
import { Search, ExternalLink, ArrowRightLeft } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useSwapHistory } from '@/hooks/useSwapHistory';
import { clsx } from 'clsx';

const statusOptions = [
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending', label: 'Pending' },
  { value: 'executing', label: 'Executing' },
  { value: 'failed', label: 'Failed' },
];

const chainOptions = [
  { value: 'all', label: 'All Chains' },
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'polygon', label: 'Polygon' },
  { value: 'arbitrum', label: 'Arbitrum' },
  { value: 'optimism', label: 'Optimism' },
  { value: 'base', label: 'Base' },
  { value: 'bsc', label: 'BSC' },
  { value: 'solana', label: 'Solana' },
];

const statusStyles: Record<string, string> = {
  completed: 'bg-green-500/10 text-green-400',
  pending: 'bg-orange-500/10 text-orange-400',
  executing: 'bg-blue-500/10 text-blue-400',
  signed: 'bg-blue-500/10 text-blue-400',
  failed: 'bg-red-500/10 text-red-400',
  cancelled: 'bg-red-500/10 text-red-400',
};

function formatDate(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryTab() {
  const { swaps, isLoading, error, loadMore, hasMore, filters, setFilters } = useSwapHistory();

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Status filter buttons */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 flex-shrink-0">
          {statusOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilters({ status: opt.value })}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                filters.status === opt.value
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3 flex-1">
          {/* Chain filter */}
          <div className="w-40">
            <Select
              options={chainOptions}
              value={filters.chain}
              onChange={(e) => setFilters({ chain: e.target.value })}
              selectSize="sm"
            />
          </div>

          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search swaps..."
              value={filters.search}
              onChange={(e) => setFilters({ search: e.target.value })}
              className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-system-blue/50"
            />
          </div>
        </div>
      </div>

      {/* History Table */}
      <Card variant="elevated">
        <CardHeader>
          <CardTitle>Swap History</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-4 rounded-xl bg-system-red/10 border border-system-red/20 text-sm text-system-red mb-4">
              {error}
            </div>
          )}

          {isLoading && swaps.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-16 bg-white/5 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : swaps.length === 0 ? (
            <div className="text-center py-16">
              <ArrowRightLeft className="w-12 h-12 mx-auto mb-3 text-gray-500" />
              <p className="text-gray-400 font-medium">No swaps found</p>
              <p className="text-sm text-gray-500 mt-1">Your transaction history will appear here</p>
            </div>
          ) : (
            <>
              {/* Mobile: card layout */}
              <div className="sm:hidden space-y-3">
                {swaps.map((swap) => (
                  <div key={swap.id} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{swap.fromToken}</span>
                        <ArrowRightLeft className="w-3 h-3 text-gray-400" />
                        <span className="font-medium text-white">{swap.toToken}</span>
                      </div>
                      <span className={clsx('px-2 py-0.5 rounded-lg text-xs font-medium', statusStyles[swap.status.toLowerCase()] || statusStyles.pending)}>
                        {swap.status}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-gray-400">
                      <span>{swap.fromAmount} {swap.fromToken}</span>
                      <span>{formatDate(swap.timestamp)}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {swap.fromChain} → {swap.toChain}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table layout */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left text-xs font-medium text-gray-400 pb-3">Date</th>
                      <th className="text-left text-xs font-medium text-gray-400 pb-3">Pair</th>
                      <th className="text-left text-xs font-medium text-gray-400 pb-3">Chains</th>
                      <th className="text-right text-xs font-medium text-gray-400 pb-3">Amount</th>
                      <th className="text-center text-xs font-medium text-gray-400 pb-3">Status</th>
                      <th className="text-right text-xs font-medium text-gray-400 pb-3">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {swaps.map((swap) => (
                      <tr key={swap.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 pr-4 text-sm text-gray-300 whitespace-nowrap">
                          {formatDate(swap.timestamp)}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-white">{swap.fromToken}</span>
                            <ArrowRightLeft className="w-3 h-3 text-gray-400" />
                            <span className="text-sm font-medium text-white">{swap.toToken}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-sm text-gray-400 capitalize whitespace-nowrap">
                          {swap.fromChain} → {swap.toChain}
                        </td>
                        <td className="py-3 pr-4 text-right text-sm text-white whitespace-nowrap">
                          {swap.fromAmount} {swap.fromToken}
                          {swap.toAmount && (
                            <span className="text-gray-400"> → {swap.toAmount} {swap.toToken}</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-center">
                          <span className={clsx('px-2 py-1 rounded-lg text-xs font-medium', statusStyles[swap.status.toLowerCase()] || statusStyles.pending)}>
                            {swap.status}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          {swap.txHash ? (
                            <a
                              href={`https://etherscan.io/tx/${swap.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex p-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Load more */}
              {hasMore && (
                <div className="mt-6 text-center">
                  <Button variant="secondary" size="sm" onClick={loadMore} isLoading={isLoading}>
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

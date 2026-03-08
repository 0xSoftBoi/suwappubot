"use client";

import React, { useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { PortfolioCard } from '@/components/dashboard/PortfolioCard';
import { ChainUsageChart } from '@/components/charts/ChainUsageChart';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useDashboardData } from '@/hooks/useDashboardData';

type SortKey = 'symbol' | 'chain' | 'balance' | 'usdValue';
type SortDir = 'asc' | 'desc';

export function PortfolioTab() {
  const { portfolio, isLoading, refetch } = useDashboardData();
  const [sortKey, setSortKey] = useState<SortKey>('usdValue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const totalBalance = portfolio?.totalUSD ?? 0;
  const change24h = portfolio?.change24h ?? 0;
  const chains = portfolio?.chains || {};

  const tokens = portfolio?.tokens || [];
  const sortedTokens = [...tokens].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'symbol': cmp = a.symbol.localeCompare(b.symbol); break;
      case 'chain': cmp = a.chain.localeCompare(b.chain); break;
      case 'balance': cmp = parseFloat(a.balance) - parseFloat(b.balance); break;
      case 'usdValue': cmp = a.usdValue - b.usdValue; break;
    }
    return sortDir === 'desc' ? -cmp : cmp;
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const chainData = Object.entries(chains).map(([name, value]) => ({ name, value }));

  const SortButton = ({ label, field }: { label: string; field: SortKey }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-white transition-colors"
    >
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sortKey === field ? 'text-system-blue' : ''}`} />
    </button>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PortfolioCard totalValue={0} chains={{}} isLoading />
        <Card>
          <CardContent>
            <div className="space-y-4 py-8">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Portfolio Hero */}
      <PortfolioCard
        totalValue={totalBalance}
        change24h={change24h}
        chains={chains}
        onRefresh={refetch}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Token Table */}
        <div className="lg:col-span-2">
          <Card variant="elevated">
            <CardHeader>
              <CardTitle>Token Holdings</CardTitle>
            </CardHeader>
            <CardContent>
              {sortedTokens.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-400">No token balances found</p>
                  <p className="text-sm text-gray-500 mt-1">Connect a wallet to view your portfolio</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left pb-3 pr-4"><SortButton label="Token" field="symbol" /></th>
                        <th className="text-left pb-3 pr-4 hidden sm:table-cell"><SortButton label="Chain" field="chain" /></th>
                        <th className="text-right pb-3 pr-4"><SortButton label="Balance" field="balance" /></th>
                        <th className="text-right pb-3"><SortButton label="Value" field="usdValue" /></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {sortedTokens.map((token, i) => (
                        <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                          <td className="py-3 pr-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                                {token.symbol.slice(0, 2)}
                              </div>
                              <div>
                                <p className="font-medium text-white text-sm">{token.symbol}</p>
                                <p className="text-xs text-gray-400">{token.name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-4 hidden sm:table-cell">
                            <span className="text-sm text-gray-300 capitalize">{token.chain}</span>
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <span className="text-sm text-white">{parseFloat(token.balance).toLocaleString()}</span>
                          </td>
                          <td className="py-3 text-right">
                            <span className="text-sm font-medium text-white">
                              ${token.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chain Distribution Chart */}
        <div>
          <ChainUsageChart data={chainData} />
        </div>
      </div>
    </div>
  );
}

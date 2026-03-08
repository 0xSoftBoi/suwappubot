"use client";

import React, { useState, useMemo } from 'react';
import { BarChart3, TrendingUp, Repeat, CheckCircle } from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';
import { VolumeChart } from '@/components/charts/VolumeChart';
import { PnLChart } from '@/components/charts/PnLChart';
import { ChainUsageChart } from '@/components/charts/ChainUsageChart';
import { useSwapHistory } from '@/hooks/useSwapHistory';

const timeRanges = ['7D', '30D', '90D'] as const;
type TimeRange = typeof timeRanges[number];

function getDaysForRange(range: TimeRange): number {
  switch (range) {
    case '7D': return 7;
    case '30D': return 30;
    case '90D': return 90;
  }
}

export function AnalyticsTab() {
  const { swaps, isLoading } = useSwapHistory();
  const [timeRange, setTimeRange] = useState<TimeRange>('30D');

  const days = getDaysForRange(timeRange);
  const cutoff = Date.now() - days * 86400000;

  const filteredSwaps = useMemo(
    () => swaps.filter((s) => new Date(s.timestamp).getTime() >= cutoff),
    [swaps, cutoff]
  );

  // Compute analytics
  const totalSwaps = filteredSwaps.length;
  const completedSwaps = filteredSwaps.filter((s) => s.status.toLowerCase() === 'completed').length;
  const successRate = totalSwaps > 0 ? ((completedSwaps / totalSwaps) * 100).toFixed(1) : '0';

  const totalVolume = filteredSwaps.reduce((sum, s) => {
    const amount = parseFloat(s.fromAmount) || 0;
    return sum + amount;
  }, 0);

  const avgSwapSize = totalSwaps > 0 ? totalVolume / totalSwaps : 0;

  // Chain usage
  const chainCounts: Record<string, number> = {};
  filteredSwaps.forEach((s) => {
    const from = s.fromChain.toLowerCase();
    const to = s.toChain.toLowerCase();
    chainCounts[from] = (chainCounts[from] || 0) + 1;
    chainCounts[to] = (chainCounts[to] || 0) + 1;
  });

  const mostUsedChain = Object.entries(chainCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || 'N/A';

  const chainData = Object.entries(chainCounts).map(([name, value]) => ({ name, value }));

  // Volume chart data (aggregate by day)
  const volumeByDay: Record<string, number> = {};
  filteredSwaps.forEach((s) => {
    const date = new Date(s.timestamp);
    const key = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    volumeByDay[key] = (volumeByDay[key] || 0) + (parseFloat(s.fromAmount) || 0);
  });
  const volumeData = Object.entries(volumeByDay)
    .slice(-Math.min(days, 14))
    .map(([name, volume]) => ({ name, volume }));

  // P&L chart data (cumulative, simplified)
  let cumPnL = 0;
  const pnlData = Object.entries(volumeByDay)
    .slice(-Math.min(days, 14))
    .map(([name, vol]) => {
      // Simulated P&L based on volume (replace with real backend data)
      cumPnL += vol * 0.02 * (Math.random() > 0.3 ? 1 : -1);
      return { name, pnl: Math.round(cumPnL * 100) / 100 };
    });

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/5 w-fit">
        {timeRanges.map((range) => (
          <button
            key={range}
            onClick={() => setTimeRange(range)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              timeRange === range
                ? 'bg-white/10 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {range}
          </button>
        ))}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Swaps"
          value={totalSwaps}
          icon={<Repeat size={20} />}
          iconColor="text-blue-400"
          isLoading={isLoading}
        />
        <StatCard
          title="Avg Swap Size"
          value={`$${avgSwapSize.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
          icon={<BarChart3 size={20} />}
          iconColor="text-purple-400"
          isLoading={isLoading}
        />
        <StatCard
          title="Most Used Chain"
          value={mostUsedChain.charAt(0).toUpperCase() + mostUsedChain.slice(1)}
          icon={<TrendingUp size={20} />}
          iconColor="text-green-400"
          isLoading={isLoading}
        />
        <StatCard
          title="Success Rate"
          value={`${successRate}%`}
          icon={<CheckCircle size={20} />}
          iconColor="text-teal-400"
          isLoading={isLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VolumeChart data={volumeData} isLoading={isLoading} />
        <PnLChart data={pnlData} isLoading={isLoading} />
      </div>

      {/* Chain Usage */}
      <div className="max-w-md">
        <ChainUsageChart data={chainData} isLoading={isLoading} />
      </div>
    </div>
  );
}

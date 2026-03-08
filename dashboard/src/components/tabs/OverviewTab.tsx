"use client";

import React from 'react';
import { Wallet, TrendingUp, BarChart3, RefreshCcw } from 'lucide-react';
import { StatCard } from '@/components/dashboard/StatCard';
import { PortfolioCard } from '@/components/dashboard/PortfolioCard';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { PerformanceChart } from '@/components/charts/PerformanceChart';
import { useDashboardData } from '@/hooks/useDashboardData';

interface OverviewTabProps {
  onViewAllHistory?: () => void;
  onNewSwap?: () => void;
}

// Static chart data (would be replaced by real analytics endpoint)
const chartData = [
  { name: 'Mon', value: 4000 },
  { name: 'Tue', value: 3000 },
  { name: 'Wed', value: 5000 },
  { name: 'Thu', value: 4500 },
  { name: 'Fri', value: 6000 },
  { name: 'Sat', value: 5500 },
  { name: 'Sun', value: 7000 },
];

export function OverviewTab({ onViewAllHistory }: OverviewTabProps) {
  const { portfolio, swaps, isLoading, refetch } = useDashboardData();

  const totalBalance = portfolio?.totalUSD ?? 0;
  const change24h = portfolio?.change24h ?? 0;

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <StatCard
          title="Total Balance"
          value={isLoading ? 'Loading...' : `$${totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          change={change24h}
          icon={<Wallet size={20} />}
          iconColor="text-blue-400"
          isLoading={isLoading}
        />
        <StatCard
          title="24h Volume"
          value="$42,120.50"
          change={5.2}
          icon={<TrendingUp size={20} />}
          iconColor="text-green-400"
          isLoading={isLoading}
        />
        <StatCard
          title="Active Orders"
          value="12"
          change={0}
          changeLabel="Stable"
          icon={<BarChart3 size={20} />}
          iconColor="text-purple-400"
          isLoading={isLoading}
        />
        <StatCard
          title="Gas Saved"
          value="$1,240.20"
          change={8.1}
          icon={<RefreshCcw size={20} />}
          iconColor="text-orange-400"
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Chart */}
        <div className="lg:col-span-2">
          <PerformanceChart data={chartData} isLoading={isLoading} />
        </div>

        {/* Recent Activity */}
        <div>
          <ActivityFeed
            swaps={swaps}
            isLoading={isLoading}
            onViewAll={onViewAllHistory}
          />
        </div>
      </div>

      {/* Portfolio Card */}
      <PortfolioCard
        totalValue={totalBalance}
        change24h={change24h}
        chains={portfolio?.chains || {}}
        isLoading={isLoading}
        onRefresh={refetch}
      />
    </div>
  );
}

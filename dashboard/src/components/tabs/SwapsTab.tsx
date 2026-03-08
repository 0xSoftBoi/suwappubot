"use client";

import React from 'react';
import { SwapForm } from '@/components/swap/SwapForm';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { useDashboardData } from '@/hooks/useDashboardData';

interface SwapsTabProps {
  onViewHistory?: () => void;
}

export function SwapsTab({ onViewHistory }: SwapsTabProps) {
  const { swaps, isLoading } = useDashboardData();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Swap Form — 2/3 width on desktop */}
      <div className="lg:col-span-2">
        <SwapForm />
      </div>

      {/* Recent Swaps Sidebar — 1/3 width on desktop */}
      <div>
        <ActivityFeed
          swaps={swaps}
          isLoading={isLoading}
          onViewAll={onViewHistory}
        />
      </div>
    </div>
  );
}

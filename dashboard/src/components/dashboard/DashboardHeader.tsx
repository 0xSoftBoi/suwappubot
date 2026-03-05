"use client";

import React from 'react';
import { Plus } from 'lucide-react';

interface DashboardHeaderProps {
  activeTab: string;
  onNewSwap?: () => void;
}

const tabTitles: Record<string, { title: string; subtitle: string }> = {
  overview: { title: 'Dashboard', subtitle: "Welcome back. Here's your fleet's status." },
  portfolio: { title: 'Portfolio', subtitle: 'Your cross-chain token holdings.' },
  swaps: { title: 'Swap', subtitle: 'Execute cross-chain token swaps.' },
  history: { title: 'History', subtitle: 'View your swap transaction history.' },
  analytics: { title: 'Analytics', subtitle: 'Performance metrics and insights.' },
  settings: { title: 'Settings', subtitle: 'Configure your preferences.' },
};

export function DashboardHeader({ activeTab, onNewSwap }: DashboardHeaderProps) {
  const { title, subtitle } = tabTitles[activeTab] || tabTitles.overview;

  return (
    <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold mb-1">{title}</h1>
        <p className="text-gray-400 text-sm">{subtitle}</p>
      </div>
      <div className="flex gap-3">
        <div className="px-3 py-2 bg-white/5 rounded-lg border border-white/10 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-medium">API Online</span>
        </div>
        {onNewSwap && (
          <button
            onClick={onNewSwap}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-all text-sm font-medium"
          >
            <Plus size={18} /> New Swap
          </button>
        )}
      </div>
    </header>
  );
}

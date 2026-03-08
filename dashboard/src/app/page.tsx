"use client";

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { TurnkeyAuth } from '@/components/auth/TurnkeyAuth';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { MobileNav } from '@/components/dashboard/MobileNav';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { OverviewTab } from '@/components/tabs/OverviewTab';
import { PortfolioTab } from '@/components/tabs/PortfolioTab';
import { SwapsTab } from '@/components/tabs/SwapsTab';
import { HistoryTab } from '@/components/tabs/HistoryTab';
import { AnalyticsTab } from '@/components/tabs/AnalyticsTab';
import { SettingsTab } from '@/components/tabs/SettingsTab';

export default function Dashboard() {
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0B0F]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  // Auth gate
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0B0F] p-4">
        <TurnkeyAuth />
      </div>
    );
  }

  const renderTab = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewTab
            onViewAllHistory={() => setActiveTab('history')}
            onNewSwap={() => setActiveTab('swaps')}
          />
        );
      case 'portfolio':
        return <PortfolioTab />;
      case 'swaps':
        return <SwapsTab onViewHistory={() => setActiveTab('history')} />;
      case 'history':
        return <HistoryTab />;
      case 'analytics':
        return <AnalyticsTab />;
      case 'settings':
        return <SettingsTab />;
      default:
        return (
          <OverviewTab
            onViewAllHistory={() => setActiveTab('history')}
            onNewSwap={() => setActiveTab('swaps')}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0B0F] text-white">
      {/* Desktop sidebar */}
      <div className="hidden lg:block fixed inset-y-0 left-0 z-30">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Mobile nav */}
      <div className="lg:hidden">
        <MobileNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Main content */}
      <main className="lg:ml-64 min-h-screen pt-[56px] lg:pt-0 pb-[72px] lg:pb-0">
        <div className="p-4 sm:p-6 lg:p-8">
          <DashboardHeader
            activeTab={activeTab}
            onNewSwap={() => setActiveTab('swaps')}
          />
          {renderTab()}
        </div>
      </main>
    </div>
  );
}

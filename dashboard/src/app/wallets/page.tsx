"use client";

import React from 'react';
import { WalletManager } from '@/components/wallet/WalletManager';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { MobileNav } from '@/components/dashboard/MobileNav';
import { useAuth } from '@/contexts/AuthContext';
import { TurnkeyAuth } from '@/components/auth/TurnkeyAuth';

export default function WalletsPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = React.useState('wallets');

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0B0F]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0B0F] p-4">
        <TurnkeyAuth />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0B0F] text-white">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Mobile nav */}
      <div className="lg:hidden">
        <MobileNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Main content */}
      <main className="lg:ml-64 min-h-screen">
        <div className="p-6 lg:p-8 max-w-4xl mx-auto">
          {/* Page header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Wallets</h1>
            <p className="text-gray-400">
              Manage your crypto wallets across multiple chains
            </p>
          </div>

          {/* Wallet manager */}
          <div className="glass rounded-2xl p-6 border border-white/10">
            <WalletManager />
          </div>

          {/* Tips section */}
          <div className="mt-8 p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-white/10">
            <h3 className="font-semibold mb-3">Wallet Tips</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-blue-400">•</span>
                <span>
                  <strong className="text-gray-300">EVM wallets</strong> work on
                  Ethereum, Polygon, Base, Arbitrum, Optimism, and BSC
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-400">•</span>
                <span>
                  <strong className="text-gray-300">Passkey wallets</strong> are
                  secured by your device's biometrics and never expose private keys
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-400">•</span>
                <span>
                  <strong className="text-gray-300">Set a default wallet</strong> to
                  use it automatically for swaps and transactions
                </span>
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}

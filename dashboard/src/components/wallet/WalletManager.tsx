"use client";

import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Loader2 } from 'lucide-react';
import { WalletList, WalletItem } from './WalletList';
import { CreateWalletModal } from './CreateWalletModal';
import { useAuth } from '@/contexts/AuthContext';
import { useTurnkey } from '@turnkey/react-wallet-kit';

const API_BASE = process.env.NEXT_PUBLIC_API_URL;

if (\!API_BASE) {
  console.error(
    '[WalletManager] NEXT_PUBLIC_API_URL is not set. ' +
    'Add it to your .env.local file. API calls will fail.'
  );
}

interface WalletManagerProps {
  onWalletSelect?: (wallet: WalletItem) => void;
}

export function WalletManager({ onWalletSelect }: WalletManagerProps) {
  const { user, isAuthenticated } = useAuth();
  const turnkey = useTurnkey();
  const [wallets, setWallets] = useState<WalletItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch wallets on mount and when user changes
  useEffect(() => {
    if (isAuthenticated && user) {
      fetchWallets();
    }
  }, [isAuthenticated, user]);

  const fetchWallets = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/users/${user.id}/wallets`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch wallets');
      }

      const data = await response.json();

      const walletsData: WalletItem[] = data.map((w: any) => ({
        id: String(w.id),
        address: w.address,
        name: w.name || 'Unnamed Wallet',
        chainType: w.chainType || 'evm',
        isDefault: w.isDefault || false,
        provider: w.provider || 'local',
        balance: w.balance,
      }));

      setWallets(walletsData);

      // Select default wallet or first one
      const defaultWallet = walletsData.find((w) => w.isDefault) || walletsData[0];
      if (defaultWallet && !selectedWallet) {
        setSelectedWallet(defaultWallet);
        onWalletSelect?.(defaultWallet);
      }
    } catch (err: any) {
      console.error('Failed to fetch wallets:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchWallets();
    setIsRefreshing(false);
  };

  const handleCreateLocal = async (chainType: 'evm' | 'solana', name: string) => {
    if (!user) throw new Error('Not authenticated');

    const response = await fetch(`${API_BASE}/v1/agent/wallets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        user_id: user.id,
        chain_type: chainType,
        name,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create wallet');
    }

    await fetchWallets();
  };

  const handleCreatePasskey = async (chainType: 'evm' | 'solana', name: string) => {
    const addressFormat =
      chainType === 'solana'
        ? 'ADDRESS_FORMAT_SOLANA' as const
        : 'ADDRESS_FORMAT_ETHEREUM' as const;

    await turnkey.createWallet({
      walletName: name,
      accounts: [addressFormat],
    });
    await turnkey.refreshWallets();
    await fetchWallets();
  };

  const handleSetDefault = async (wallet: WalletItem) => {
    try {
      const response = await fetch(`${API_BASE}/wallets/${wallet.id}/default`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to set default wallet');
      }

      // Update local state
      setWallets((prev) =>
        prev.map((w) => ({
          ...w,
          isDefault: w.id === wallet.id,
        }))
      );
    } catch (err: any) {
      console.error('Failed to set default wallet:', err);
    }
  };

  const handleDelete = async (wallet: WalletItem) => {
    if (!confirm('Are you sure you want to remove this wallet?')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/wallets/${wallet.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to delete wallet');
      }

      // Update local state
      setWallets((prev) => prev.filter((w) => w.id !== wallet.id));

      if (selectedWallet?.id === wallet.id) {
        setSelectedWallet(null);
      }
    } catch (err: any) {
      console.error('Failed to delete wallet:', err);
    }
  };

  const handleSelect = (wallet: WalletItem) => {
    setSelectedWallet(wallet);
    onWalletSelect?.(wallet);
  };

  if (!isAuthenticated) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">Please connect your wallet to continue</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Your Wallets</h2>
          <p className="text-sm text-gray-400 mt-1">
            Manage your EVM and Solana wallets
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw
              size={18}
              className={isRefreshing ? 'animate-spin' : ''}
            />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-medium transition-all duration-200"
          >
            <Plus size={18} />
            <span>Add Wallet</span>
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Wallet list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <WalletList
          wallets={wallets}
          onSelect={handleSelect}
          onSetDefault={handleSetDefault}
          onDelete={handleDelete}
          selectedId={selectedWallet?.id}
        />
      )}

      {/* Create wallet modal */}
      <CreateWalletModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreateLocal={handleCreateLocal}
        onCreatePasskey={handleCreatePasskey}
      />
    </div>
  );
}

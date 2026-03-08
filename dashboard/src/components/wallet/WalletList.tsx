"use client";

import React from 'react';
import { Wallet, Copy, ExternalLink, Check, MoreVertical, Trash2 } from 'lucide-react';
import { useState } from 'react';

export interface WalletItem {
  id: string;
  address: string;
  name: string;
  chainType: 'evm' | 'solana';
  isDefault: boolean;
  provider: 'local' | 'turnkey';
  balance?: number;
}

interface WalletListProps {
  wallets: WalletItem[];
  onSelect?: (wallet: WalletItem) => void;
  onSetDefault?: (wallet: WalletItem) => void;
  onDelete?: (wallet: WalletItem) => void;
  selectedId?: string;
}

export function WalletList({
  wallets,
  onSelect,
  onSetDefault,
  onDelete,
  selectedId,
}: WalletListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const copyAddress = async (wallet: WalletItem) => {
    await navigator.clipboard.writeText(wallet.address);
    setCopiedId(wallet.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const getExplorerUrl = (address: string, chainType: string) => {
    if (chainType === 'solana') {
      return `https://solscan.io/account/${address}`;
    }
    return `https://etherscan.io/address/${address}`;
  };

  if (wallets.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
          <Wallet size={32} className="text-gray-500" />
        </div>
        <h3 className="text-lg font-medium text-gray-300 mb-2">No wallets yet</h3>
        <p className="text-sm text-gray-500">
          Create your first wallet to get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {wallets.map((wallet) => (
        <div
          key={wallet.id}
          onClick={() => onSelect?.(wallet)}
          className={`relative p-4 rounded-xl border transition-all duration-200 cursor-pointer ${
            selectedId === wallet.id
              ? 'border-blue-500/50 bg-blue-500/10'
              : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
          }`}
        >
          <div className="flex items-start justify-between">
            {/* Wallet info */}
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  wallet.chainType === 'solana'
                    ? 'bg-gradient-to-br from-purple-600 to-purple-400'
                    : 'bg-gradient-to-br from-blue-600 to-blue-400'
                }`}
              >
                <Wallet size={20} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{wallet.name}</span>
                  {wallet.isDefault && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400">
                      Default
                    </span>
                  )}
                  {wallet.provider === 'turnkey' && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                      Turnkey
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-gray-400 font-mono">
                    {truncateAddress(wallet.address)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyAddress(wallet);
                    }}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                    title="Copy address"
                  >
                    {copiedId === wallet.id ? (
                      <Check size={14} className="text-green-400" />
                    ) : (
                      <Copy size={14} className="text-gray-500" />
                    )}
                  </button>
                  <a
                    href={getExplorerUrl(wallet.address, wallet.chainType)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                    title="View on explorer"
                  >
                    <ExternalLink size={14} className="text-gray-500" />
                  </a>
                </div>
              </div>
            </div>

            {/* Balance and menu */}
            <div className="flex items-center gap-3">
              {wallet.balance !== undefined && (
                <div className="text-right">
                  <div className="font-medium">
                    ${wallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-gray-500 uppercase">
                    {wallet.chainType}
                  </div>
                </div>
              )}

              {/* Menu button */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === wallet.id ? null : wallet.id);
                  }}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                >
                  <MoreVertical size={16} className="text-gray-400" />
                </button>

                {/* Dropdown menu */}
                {menuOpenId === wallet.id && (
                  <div
                    className="absolute right-0 mt-1 w-40 rounded-xl bg-[#1A1D26] border border-white/10 shadow-xl overflow-hidden z-50"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!wallet.isDefault && (
                      <button
                        onClick={() => {
                          onSetDefault?.(wallet);
                          setMenuOpenId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                      >
                        <Check size={14} />
                        Set as default
                      </button>
                    )}
                    <button
                      onClick={() => {
                        onDelete?.(wallet);
                        setMenuOpenId(null);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-white/5 transition-colors"
                    >
                      <Trash2 size={14} />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

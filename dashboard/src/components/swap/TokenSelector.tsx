"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { clsx } from 'clsx';

interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
}

interface TokenSelectorProps {
  chain: string;
  value: Token | null;
  onChange: (token: Token) => void;
  label?: string;
}

export function TokenSelector({ chain, value, onChange, label }: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!chain) return;

    async function fetchTokens() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/tokens?chain=${chain}`);
        if (res.ok) {
          const data = await res.json();
          setTokens(Array.isArray(data) ? data : data.tokens || []);
        }
      } catch {
        setTokens([]);
      } finally {
        setIsLoading(false);
      }
    }
    fetchTokens();
  }, [chain]);

  const filtered = useMemo(() => {
    if (!search) return tokens;
    const q = search.toLowerCase();
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
    );
  }, [tokens, search]);

  return (
    <>
      {label && (
        <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      )}
      <button
        type="button"
        onClick={() => chain && setIsOpen(true)}
        disabled={!chain}
        className={clsx(
          'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border transition-colors text-sm',
          chain
            ? 'bg-white/5 border-white/10 hover:border-white/20'
            : 'bg-white/[0.02] border-white/5 opacity-50 cursor-not-allowed',
        )}
      >
        <span className={value ? 'text-white font-medium' : 'text-gray-400'}>
          {value ? value.symbol : 'Select Token'}
        </span>
      </button>

      {/* Token modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          <div className="relative w-full max-w-sm bg-[#1A1D26] rounded-2xl border border-white/10 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h3 className="text-lg font-semibold">Select Token</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name or address..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-blue-500/50"
                  autoFocus
                />
              </div>
            </div>

            {/* Token list */}
            <div className="max-h-[300px] overflow-y-auto px-2 pb-4">
              {isLoading ? (
                <div className="py-8 text-center text-gray-400 text-sm">Loading tokens...</div>
              ) : filtered.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">No tokens found</div>
              ) : (
                filtered.map((token) => (
                  <button
                    key={token.address}
                    onClick={() => {
                      onChange(token);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors',
                      value?.address === token.address
                        ? 'bg-system-blue/10 text-system-blue'
                        : 'hover:bg-white/5 text-white'
                    )}
                  >
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                      {token.symbol.slice(0, 2)}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-sm">{token.symbol}</p>
                      <p className="text-xs text-gray-400">{token.name}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

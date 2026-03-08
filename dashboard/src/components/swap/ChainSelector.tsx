"use client";

import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

interface Chain {
  id: string;
  name: string;
  logo?: string;
}

interface ChainSelectorProps {
  value: string;
  onChange: (chainId: string) => void;
  label?: string;
}

const chainLogos: Record<string, string> = {
  ethereum: '⟠',
  polygon: '⬡',
  arbitrum: '◆',
  optimism: '⊕',
  base: '🔵',
  bsc: '◉',
  solana: '◎',
};

export function ChainSelector({ value, onChange, label }: ChainSelectorProps) {
  const [chains, setChains] = useState<Chain[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchChains() {
      try {
        const res = await fetch('/api/chains');
        if (res.ok) {
          const data = await res.json();
          setChains(Array.isArray(data) ? data : data.chains || []);
        }
      } catch {
        // Fallback chains
        setChains([
          { id: 'ethereum', name: 'Ethereum' },
          { id: 'polygon', name: 'Polygon' },
          { id: 'arbitrum', name: 'Arbitrum' },
          { id: 'optimism', name: 'Optimism' },
          { id: 'base', name: 'Base' },
          { id: 'bsc', name: 'BSC' },
          { id: 'solana', name: 'Solana' },
        ]);
      } finally {
        setIsLoading(false);
      }
    }
    fetchChains();
  }, []);

  const selected = chains.find((c) => c.id === value);

  return (
    <div className="relative">
      {label && (
        <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
      )}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-colors text-sm"
      >
        <div className="flex items-center gap-2">
          {selected && (
            <span className="text-base">{chainLogos[selected.id] || '●'}</span>
          )}
          <span className="text-white font-medium">
            {isLoading ? 'Loading...' : selected?.name || 'Select Chain'}
          </span>
        </div>
        <ChevronDown className={clsx('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl bg-[#1A1D26] border border-white/10 shadow-xl overflow-hidden max-h-60 overflow-y-auto">
            {chains.map((chain) => (
              <button
                key={chain.id}
                onClick={() => {
                  onChange(chain.id);
                  setIsOpen(false);
                }}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors',
                  value === chain.id
                    ? 'bg-system-blue/10 text-system-blue'
                    : 'text-white hover:bg-white/5'
                )}
              >
                <span className="text-base">{chainLogos[chain.id] || '●'}</span>
                <span className="font-medium">{chain.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

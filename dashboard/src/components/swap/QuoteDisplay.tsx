"use client";

import React from 'react';
import { Info, Loader2 } from 'lucide-react';

interface QuoteDisplayProps {
  quote: {
    rate: string;
    priceImpact: string;
    estimatedGas: string;
    minimumReceived: string;
    fee?: string;
  } | null;
  isLoading?: boolean;
}

export function QuoteDisplay({ quote, isLoading = false }: QuoteDisplayProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4">
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Fetching best quote...</span>
        </div>
      </div>
    );
  }

  if (!quote) return null;

  const rows = [
    { label: 'Rate', value: quote.rate },
    { label: 'Price Impact', value: quote.priceImpact, warn: parseFloat(quote.priceImpact) > 3 },
    { label: 'Est. Gas', value: quote.estimatedGas },
    { label: 'Min. Received', value: quote.minimumReceived },
  ];

  if (quote.fee) {
    rows.push({ label: 'Fee', value: quote.fee });
  }

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-4 space-y-2.5">
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
        <Info className="w-3.5 h-3.5" />
        <span>Quote Details</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between text-sm">
          <span className="text-gray-400">{row.label}</span>
          <span className={row.warn ? 'text-system-orange font-medium' : 'text-white'}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

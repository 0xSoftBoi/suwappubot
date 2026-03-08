"use client";

import React, { useState, useCallback } from 'react';
import { ArrowDownUp, Loader2 } from 'lucide-react';
import { ChainSelector } from './ChainSelector';
import { TokenSelector } from './TokenSelector';
import { QuoteDisplay } from './QuoteDisplay';
import { Button } from '@/components/ui/Button';

interface Token {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
}

interface Quote {
  rate: string;
  priceImpact: string;
  estimatedGas: string;
  minimumReceived: string;
  fee?: string;
}

export function SwapForm() {
  const [fromChain, setFromChain] = useState('');
  const [toChain, setToChain] = useState('');
  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [toToken, setToToken] = useState<Token | null>(null);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQuote = useCallback(async () => {
    if (!fromChain || !toChain || !fromToken || !toToken || !fromAmount) return;

    try {
      setIsQuoting(true);
      setError(null);

      const res = await fetch('/api/swap/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromChain,
          toChain,
          fromToken: fromToken.address,
          toToken: toToken.address,
          fromAmount,
        }),
      });

      if (!res.ok) throw new Error('Failed to get quote');

      const data = await res.json();
      setQuote(data);
      setToAmount(data.estimatedOutput || data.toAmount || '');
    } catch (err: any) {
      setError(err.message || 'Failed to get quote');
      setQuote(null);
    } finally {
      setIsQuoting(false);
    }
  }, [fromChain, toChain, fromToken, toToken, fromAmount]);

  const handleExecute = async () => {
    if (!quote || !fromToken || !toToken) return;

    try {
      setIsExecuting(true);
      setError(null);

      const res = await fetch('/api/swap/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromChain,
          toChain,
          fromToken: fromToken.address,
          toToken: toToken.address,
          fromAmount,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to execute swap');
      }

      // Reset form on success
      setFromAmount('');
      setToAmount('');
      setQuote(null);
    } catch (err: any) {
      setError(err.message || 'Swap execution failed');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleSwapDirection = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
    setQuote(null);
  };

  const canQuote = fromChain && toChain && fromToken && toToken && fromAmount && parseFloat(fromAmount) > 0;

  return (
    <div className="space-y-4">
      {/* From section */}
      <div className="glass rounded-2xl p-4 space-y-3">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">From</p>
        <div className="grid grid-cols-2 gap-3">
          <ChainSelector value={fromChain} onChange={setFromChain} label="Chain" />
          <TokenSelector chain={fromChain} value={fromToken} onChange={setFromToken} label="Token" />
        </div>
        <input
          type="number"
          placeholder="0.00"
          value={fromAmount}
          onChange={(e) => {
            setFromAmount(e.target.value);
            setQuote(null);
          }}
          className="w-full bg-transparent text-3xl font-bold text-white placeholder:text-gray-600 focus:outline-none"
        />
      </div>

      {/* Direction toggle */}
      <div className="flex justify-center -my-2 relative z-10">
        <button
          onClick={handleSwapDirection}
          className="p-2.5 rounded-xl bg-[#1A1D26] border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all"
        >
          <ArrowDownUp className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {/* To section */}
      <div className="glass rounded-2xl p-4 space-y-3">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">To</p>
        <div className="grid grid-cols-2 gap-3">
          <ChainSelector value={toChain} onChange={setToChain} label="Chain" />
          <TokenSelector chain={toChain} value={toToken} onChange={setToToken} label="Token" />
        </div>
        <div className="text-3xl font-bold text-gray-500">
          {isQuoting ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-lg">Calculating...</span>
            </div>
          ) : (
            toAmount || '0.00'
          )}
        </div>
      </div>

      {/* Quote display */}
      <QuoteDisplay quote={quote} isLoading={isQuoting} />

      {/* Error */}
      {error && (
        <div className="p-3 rounded-xl bg-system-red/10 border border-system-red/20 text-sm text-system-red">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="space-y-2">
        {!quote ? (
          <Button
            fullWidth
            size="lg"
            disabled={!canQuote || isQuoting}
            isLoading={isQuoting}
            onClick={fetchQuote}
          >
            {canQuote ? 'Get Quote' : 'Enter swap details'}
          </Button>
        ) : (
          <Button
            fullWidth
            size="lg"
            disabled={isExecuting}
            isLoading={isExecuting}
            onClick={handleExecute}
          >
            Execute Swap
          </Button>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { useEffect, useState, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { TrendingUp, TrendingDown, Wallet, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';

interface PortfolioCardProps {
  totalValue: number;
  change24h?: number;
  chains: Record<string, number>;
  isLoading?: boolean;
  onRefresh?: () => void;
}

// Animated counter hook
function useAnimatedCounter(end: number, duration: number = 1000) {
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    startTime.current = null;
    
    const animate = (timestamp: number) => {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      
      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setValue(end * easeOut);
      
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };
    
    animationRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [end, duration]);

  return value;
}

export function PortfolioCard({
  totalValue,
  change24h = 0,
  chains,
  isLoading = false,
  onRefresh,
}: PortfolioCardProps) {
  const animatedValue = useAnimatedCounter(totalValue, 1200);
  const isPositive = change24h >= 0;

  // Calculate chain distribution
  const sortedChains = Object.entries(chains)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  
  const totalChainValue = Object.values(chains).reduce((a, b) => a + b, 0);

  const chainColors: Record<string, string> = {
    ethereum: '#627EEA',
    polygon: '#8247E5',
    arbitrum: '#28A0F0',
    optimism: '#FF0420',
    base: '#0052FF',
    bsc: '#F3BA2F',
    solana: '#14F195',
  };

  if (isLoading) {
    return (
      <Card variant="elevated" className="relative overflow-hidden">
        <CardHeader>
          <div className="h-6 w-32 bg-white/5 rounded animate-shimmer" />
        </CardHeader>
        <CardContent>
          <div className="h-12 w-48 bg-white/5 rounded animate-shimmer mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 bg-white/5 rounded animate-shimmer" style={{ width: `${100 - i * 20}%` }} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="elevated" className="relative overflow-hidden group">
      {/* Subtle glow effect on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-system-blue/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-system-blue/10">
            <Wallet className="w-5 h-5 text-system-blue" />
          </div>
          <CardTitle>Total Portfolio</CardTitle>
        </div>
        
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors text-gray-1 hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </CardHeader>

      <CardContent>
        {/* Main value */}
        <div className="mb-6">
          <div className="text-4xl font-bold tracking-tight mb-2">
            ${animatedValue.toLocaleString('en-US', { 
              minimumFractionDigits: 2,
              maximumFractionDigits: 2 
            })}
          </div>
          
          {/* 24h change */}
          <div className={clsx(
            'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-medium',
            isPositive ? 'bg-system-green/10 text-system-green' : 'bg-system-red/10 text-system-red'
          )}>
            {isPositive ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            <span>{isPositive ? '+' : ''}{change24h.toFixed(2)}%</span>
            <span className="text-gray-2 font-normal">24h</span>
          </div>
        </div>

        {/* Chain distribution */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-gray-1 uppercase tracking-wider">Distribution</p>
          
          {/* Progress bars */}
          <div className="space-y-2">
            {sortedChains.map(([chain, value]) => {
              const percentage = totalChainValue > 0 ? (value / totalChainValue) * 100 : 0;
              const color = chainColors[chain.toLowerCase()] || '#8E8E93';
              
              return (
                <div key={chain} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-1 capitalize">{chain}</span>
                    <span className="text-white font-medium">
                      ${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-1000 ease-out-expo"
                      style={{ 
                        width: `${percentage}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

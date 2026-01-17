"use client";

import React, { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { clsx } from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: ReactNode;
  iconColor?: string;
  isLoading?: boolean;
}

export function StatCard({
  title,
  value,
  change,
  changeLabel = '24h',
  icon,
  iconColor = 'text-system-blue',
  isLoading = false,
}: StatCardProps) {
  const isPositive = change !== undefined && change >= 0;
  const isNeutral = change === undefined || change === 0;

  if (isLoading) {
    return (
      <Card variant="default" hoverable className="min-h-[140px]">
        <div className="flex justify-between items-start mb-4">
          <div className="p-2.5 rounded-xl bg-white/5 animate-shimmer" style={{ width: 44, height: 44 }} />
          <div className="h-6 w-16 bg-white/5 rounded-lg animate-shimmer" />
        </div>
        <div className="h-4 w-20 bg-white/5 rounded animate-shimmer mb-2" />
        <div className="h-8 w-32 bg-white/5 rounded animate-shimmer" />
      </Card>
    );
  }

  return (
    <Card variant="default" hoverable className="min-h-[140px] group">
      <div className="flex justify-between items-start mb-4">
        {/* Icon */}
        <div className={clsx(
          'p-2.5 rounded-xl bg-white/5 transition-all duration-300',
          'group-hover:scale-110 group-hover:bg-white/10'
        )}>
          <div className={iconColor}>
            {icon}
          </div>
        </div>

        {/* Change indicator */}
        {change !== undefined && (
          <div className={clsx(
            'flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold',
            isNeutral && 'bg-gray-3/50 text-gray-1',
            !isNeutral && isPositive && 'bg-system-green/10 text-system-green',
            !isNeutral && !isPositive && 'bg-system-red/10 text-system-red'
          )}>
            {isNeutral ? (
              <Minus className="w-3 h-3" />
            ) : isPositive ? (
              <TrendingUp className="w-3 h-3" />
            ) : (
              <TrendingDown className="w-3 h-3" />
            )}
            <span>
              {!isNeutral && (isPositive ? '+' : '')}
              {change?.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Title */}
      <p className="text-sm text-gray-1 mb-1">{title}</p>

      {/* Value */}
      <p className="text-2xl font-bold text-white tracking-tight">
        {typeof value === 'number' 
          ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
          : value
        }
      </p>

      {/* Change label */}
      {change !== undefined && changeLabel && (
        <p className="text-xs text-gray-2 mt-1">{changeLabel}</p>
      )}
    </Card>
  );
}

"use client";

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { ArrowRightLeft, Clock, CheckCircle2, Loader2, XCircle, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';

interface Swap {
  id: number | string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount?: string;
  fromChain: string;
  toChain: string;
  status: string;
  timestamp: string;
  txHash?: string;
}

type NormalizedStatus = 'pending' | 'executing' | 'completed' | 'failed';

function normalizeStatus(status: string): NormalizedStatus {
  const map: Record<string, NormalizedStatus> = {
    pending: 'pending',
    signed: 'executing',
    executing: 'executing',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'failed',
    canceled: 'failed',
  };
  return map[status.toLowerCase()] || 'pending';
}

interface ActivityFeedProps {
  swaps: Swap[];
  isLoading?: boolean;
  onViewAll?: () => void;
}

const statusConfig = {
  pending: {
    icon: Clock,
    color: 'text-system-orange',
    bgColor: 'bg-system-orange/10',
    label: 'Pending',
    animate: false,
  },
  executing: {
    icon: Loader2,
    color: 'text-system-blue',
    bgColor: 'bg-system-blue/10',
    label: 'Executing',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-system-green',
    bgColor: 'bg-system-green/10',
    label: 'Completed',
    animate: false,
  },
  failed: {
    icon: XCircle,
    color: 'text-system-red',
    bgColor: 'bg-system-red/10',
    label: 'Failed',
    animate: false,
  },
};

const chainColors: Record<string, string> = {
  ethereum: 'from-[#627EEA] to-[#8B9FFF]',
  polygon: 'from-[#8247E5] to-[#A87FFF]',
  arbitrum: 'from-[#28A0F0] to-[#5BC0FF]',
  optimism: 'from-[#FF0420] to-[#FF5555]',
  base: 'from-[#0052FF] to-[#4D8AFF]',
  bsc: 'from-[#F3BA2F] to-[#FFD666]',
  solana: 'from-[#14F195] to-[#66FFB8]',
};

function SwapItem({ swap }: { swap: Swap }) {
  const status = statusConfig[normalizeStatus(swap.status)];
  const StatusIcon = status.icon;

  const fromChainColor = chainColors[swap.fromChain.toLowerCase()] || 'from-gray-3 to-gray-2';
  const toChainColor = chainColors[swap.toChain.toLowerCase()] || 'from-gray-3 to-gray-2';

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="group flex items-center gap-4 p-3 rounded-xl hover:bg-white/[0.03] transition-colors">
      {/* Token icons */}
      <div className="relative flex -space-x-2">
        <div className={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-gray-6 bg-gradient-to-br',
          fromChainColor
        )}>
          {swap.fromToken.slice(0, 3)}
        </div>
        <div className={clsx(
          'w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-gray-6 bg-gradient-to-br',
          toChainColor
        )}>
          {swap.toToken.slice(0, 3)}
        </div>
      </div>

      {/* Swap details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium text-white">{swap.fromToken}</span>
          <ArrowRightLeft className="w-3.5 h-3.5 text-gray-2" />
          <span className="font-medium text-white">{swap.toToken}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-2">
          <span>{swap.fromAmount} {swap.fromToken}</span>
          {swap.toAmount && (
            <>
              <span className="text-gray-3">&rarr;</span>
              <span>{swap.toAmount} {swap.toToken}</span>
            </>
          )}
        </div>
      </div>

      {/* Status and time */}
      <div className="flex flex-col items-end gap-1">
        <div className={clsx(
          'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium',
          status.bgColor,
          status.color
        )}>
          <StatusIcon className={clsx('w-3 h-3', status.animate && 'animate-spin')} />
          <span>{status.label}</span>
        </div>
        <span className="text-xs text-gray-2">{formatTime(swap.timestamp)}</span>
      </div>

      {/* External link (on hover) */}
      {swap.txHash && (
        <a
          href={`https://etherscan.io/tx/${swap.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-white/5 transition-all text-gray-2 hover:text-white"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
    </div>
  );
}

function SkeletonItem() {
  return (
    <div className="flex items-center gap-4 p-3">
      <div className="relative flex -space-x-2">
        <div className="w-10 h-10 rounded-full bg-white/5 animate-shimmer" />
        <div className="w-10 h-10 rounded-full bg-white/5 animate-shimmer" />
      </div>
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 bg-white/5 rounded animate-shimmer" />
        <div className="h-3 w-24 bg-white/5 rounded animate-shimmer" />
      </div>
      <div className="h-6 w-20 bg-white/5 rounded animate-shimmer" />
    </div>
  );
}

export function ActivityFeed({
  swaps,
  isLoading = false,
  onViewAll,
}: ActivityFeedProps) {
  return (
    <Card variant="elevated" className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent Activity</CardTitle>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-sm text-system-blue hover:text-system-blue/80 transition-colors"
          >
            View All
          </button>
        )}
      </CardHeader>

      <CardContent className="space-y-1">
        {isLoading ? (
          <>
            <SkeletonItem />
            <SkeletonItem />
            <SkeletonItem />
          </>
        ) : swaps.length === 0 ? (
          <div className="text-center py-8">
            <ArrowRightLeft className="w-12 h-12 mx-auto mb-3 text-gray-3" />
            <p className="text-gray-1 font-medium">No recent activity</p>
            <p className="text-sm text-gray-2 mt-1">Your swap history will appear here</p>
          </div>
        ) : (
          swaps.map((swap) => (
            <SwapItem key={swap.id} swap={swap} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

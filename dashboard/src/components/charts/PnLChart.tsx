"use client";

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface PnLDataPoint {
  name: string;
  pnl: number;
}

interface PnLChartProps {
  data: PnLDataPoint[];
  isLoading?: boolean;
}

export function PnLChart({ data, isLoading = false }: PnLChartProps) {
  if (isLoading) {
    return (
      <div className="glass rounded-2xl p-6">
        <div className="h-6 w-32 bg-white/5 rounded animate-pulse mb-6" />
        <div className="h-[250px] bg-white/[0.02] rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-4">Profit & Loss</h3>
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="pnlPositive" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="pnlNegative" x1="0" y1="1" x2="0" y2="0">
                <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 12 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#6B7280', fontSize: 12 }}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1A1D26',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
              }}
              itemStyle={{ color: '#F8F9FA' }}
              formatter={(value: number) => [
                `${value >= 0 ? '+' : ''}$${value.toLocaleString()}`,
                'P&L',
              ]}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke="#10B981"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#pnlPositive)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

"use client";

import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DataPoint {
  name: string;
  value: number;
}

interface PerformanceChartProps {
  data: DataPoint[];
  timeRange?: string;
  isLoading?: boolean;
  onTimeRangeChange?: (range: string) => void;
}

const timeRanges = ['7D', '30D', '90D'];

export function PerformanceChart({
  data,
  timeRange = '7D',
  isLoading = false,
  onTimeRangeChange,
}: PerformanceChartProps) {
  if (isLoading) {
    return (
      <div className="glass rounded-2xl p-6">
        <div className="flex justify-between items-center mb-6">
          <div className="h-6 w-32 bg-white/5 rounded animate-pulse" />
          <div className="h-8 w-24 bg-white/5 rounded animate-pulse" />
        </div>
        <div className="h-[300px] w-full bg-white/[0.02] rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold">Performance</h2>
        <div className="flex gap-1 p-1 rounded-lg bg-white/5">
          {timeRanges.map((range) => (
            <button
              key={range}
              onClick={() => onTimeRangeChange?.(range)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                timeRange === range
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="perfColorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
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
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1A1D26',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              }}
              itemStyle={{ color: '#F8F9FA' }}
              labelStyle={{ color: '#9CA3AF' }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'Value']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#3B82F6"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#perfColorValue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

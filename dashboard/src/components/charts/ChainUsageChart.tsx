"use client";

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ChainData {
  name: string;
  value: number;
}

interface ChainUsageChartProps {
  data: ChainData[];
  isLoading?: boolean;
}

const CHAIN_COLORS: Record<string, string> = {
  ethereum: '#627EEA',
  polygon: '#8247E5',
  arbitrum: '#28A0F0',
  optimism: '#FF0420',
  base: '#0052FF',
  bsc: '#F3BA2F',
  solana: '#14F195',
};

const DEFAULT_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899'];

export function ChainUsageChart({ data, isLoading = false }: ChainUsageChartProps) {
  if (isLoading) {
    return (
      <div className="glass rounded-2xl p-6">
        <div className="h-6 w-32 bg-white/5 rounded animate-pulse mb-6" />
        <div className="h-[250px] flex items-center justify-center">
          <div className="w-40 h-40 rounded-full bg-white/5 animate-pulse" />
        </div>
      </div>
    );
  }

  const getColor = (name: string, index: number) =>
    CHAIN_COLORS[name.toLowerCase()] || DEFAULT_COLORS[index % DEFAULT_COLORS.length];

  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-4">Chain Distribution</h3>
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={3}
              dataKey="value"
              nameKey="name"
            >
              {data.map((entry, index) => (
                <Cell key={entry.name} fill={getColor(entry.name, index)} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#1A1D26',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '12px',
              }}
              itemStyle={{ color: '#F8F9FA' }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'Value']}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => (
                <span className="text-xs text-gray-300 capitalize">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

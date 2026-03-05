"use client";

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface VolumeDataPoint {
  name: string;
  volume: number;
}

interface VolumeChartProps {
  data: VolumeDataPoint[];
  isLoading?: boolean;
}

export function VolumeChart({ data, isLoading = false }: VolumeChartProps) {
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
      <h3 className="text-lg font-semibold mb-4">Swap Volume</h3>
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
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
              }}
              itemStyle={{ color: '#F8F9FA' }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'Volume']}
              cursor={{ fill: 'rgba(255,255,255,0.03)' }}
            />
            <Bar
              dataKey="volume"
              fill="#3B82F6"
              radius={[6, 6, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

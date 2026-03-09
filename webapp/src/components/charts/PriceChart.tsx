/**
 * TradingView Lightweight Charts integration for token price display.
 *
 * Uses the lightweight-charts library (BSD-3-Clause license, ~45KB gzipped)
 * for candlestick and line charts with real-time updates.
 *
 * Install: npm install lightweight-charts
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// Types for lightweight-charts (will resolve when package is installed)
interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface LineData {
  time: number;
  value: number;
}

type ChartInterval = '5s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

interface PriceChartProps {
  tokenSymbol: string;
  chain?: string;
  height?: number;
  defaultInterval?: ChartInterval;
  showVolume?: boolean;
  onIntervalChange?: (interval: ChartInterval) => void;
}

const INTERVALS: { label: string; value: ChartInterval }[] = [
  { label: '5s', value: '5s' },
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '1H', value: '1h' },
  { label: '4H', value: '4h' },
  { label: '1D', value: '1d' },
];

export function PriceChart({
  tokenSymbol,
  chain = 'solana',
  height = 400,
  defaultInterval = '1h',
  showVolume = true,
  onIntervalChange,
}: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const [interval, setInterval] = useState<ChartInterval>(defaultInterval);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleIntervalChange = useCallback((newInterval: ChartInterval) => {
    setInterval(newInterval);
    onIntervalChange?.(newInterval);
  }, [onIntervalChange]);

  useEffect(() => {
    let disposed = false;

    const initChart = async () => {
      if (!chartContainerRef.current) return;

      try {
        // Dynamic import - only loads when component mounts
        const { createChart, ColorType, CrosshairMode } = await import('lightweight-charts');

        if (disposed) return;

        // Clean up previous chart
        if (chartRef.current) {
          chartRef.current.remove();
        }

        const chart = createChart(chartContainerRef.current, {
          height,
          layout: {
            background: { type: ColorType.Solid, color: '#1C1C30' },
            textColor: '#A0A0B4',
            fontFamily: "'Inter', system-ui, sans-serif",
          },
          grid: {
            vertLines: { color: '#2A2A3E' },
            horzLines: { color: '#2A2A3E' },
          },
          crosshair: {
            mode: CrosshairMode.Normal,
          },
          rightPriceScale: {
            borderColor: '#2A2A3E',
          },
          timeScale: {
            borderColor: '#2A2A3E',
            timeVisible: true,
            secondsVisible: interval === '5s' || interval === '1m',
          },
        });

        chartRef.current = chart;

        // Add candlestick series
        const candlestickSeries = chart.addCandlestickSeries({
          upColor: '#14F195',
          downColor: '#FF453A',
          borderUpColor: '#14F195',
          borderDownColor: '#FF453A',
          wickUpColor: '#14F195',
          wickDownColor: '#FF453A',
        });

        // Fetch data from API
        const data = await fetchChartData(tokenSymbol, chain, interval);

        if (disposed) return;

        if (data.length > 0) {
          candlestickSeries.setData(data);
          chart.timeScale().fitContent();
        }

        // Add volume histogram if enabled
        if (showVolume) {
          const volumeSeries = chart.addHistogramSeries({
            color: '#627EEA',
            priceFormat: {
              type: 'volume',
            },
            priceScaleId: 'volume',
          });

          chart.priceScale('volume').applyOptions({
            scaleMargins: {
              top: 0.8,
              bottom: 0,
            },
          });

          // Generate volume data from candle data
          const volumeData = data.map((d: CandlestickData) => ({
            time: d.time,
            value: Math.abs(d.close - d.open) * 1000, // Synthetic volume
            color: d.close >= d.open ? '#14F19533' : '#FF453A33',
          }));

          volumeSeries.setData(volumeData);
        }

        // Auto-resize
        const resizeObserver = new ResizeObserver((entries) => {
          if (entries.length > 0 && chartRef.current) {
            const { width } = entries[0].contentRect;
            chartRef.current.applyOptions({ width });
          }
        });

        resizeObserver.observe(chartContainerRef.current);

        setIsLoading(false);
        setError(null);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (e) {
        if (!disposed) {
          console.error('Chart init error:', e);
          setError('Chart library not installed. Run: npm install lightweight-charts');
          setIsLoading(false);
        }
      }
    };

    setIsLoading(true);
    initChart();

    return () => {
      disposed = true;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [tokenSymbol, chain, interval, height, showVolume]);

  return (
    <div style={{ position: 'relative' }}>
      {/* Interval selector */}
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '8px 0',
        justifyContent: 'center',
      }}>
        {INTERVALS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => handleIntervalChange(value)}
            style={{
              padding: '4px 10px',
              fontSize: '12px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              background: interval === value ? '#627EEA' : '#2A2A3E',
              color: interval === value ? '#fff' : '#A0A0B4',
              fontWeight: interval === value ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Chart container */}
      <div
        ref={chartContainerRef}
        style={{
          width: '100%',
          height,
          borderRadius: '12px',
          overflow: 'hidden',
          background: '#1C1C30',
        }}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#A0A0B4',
          fontSize: '14px',
        }}>
          Loading chart...
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#FF453A',
          fontSize: '12px',
          textAlign: 'center',
          padding: '0 20px',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Fetch OHLCV data for a token from the API.
 */
async function fetchChartData(
  symbol: string,
  chain: string,
  interval: ChartInterval,
): Promise<CandlestickData[]> {
  try {
    const apiBase = import.meta.env.VITE_API_URL || '';
    const resp = await fetch(
      `${apiBase}/webapp/chart/${symbol}?chain=${chain}&interval=${interval}`,
    );

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();
    return data.candles || [];
  } catch (e) {
    console.warn('Chart data fetch failed, using empty data:', e);
    return [];
  }
}

export default PriceChart;

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { getLogs, clearLogs, type LogLine } from '../services/local';

export type LogFilter = 'all' | 'error' | 'warn' | 'info';

interface LocalLogPanelProps {
  maxLines?: number;
  isPaused: boolean;
  filter: LogFilter;
  scrollOffset: number;
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  debug: 'gray',
};

const FILTER_ORDER: LogFilter[] = ['all', 'error', 'warn', 'info'];

export function LocalLogPanel({
  maxLines = 15,
  isPaused,
  filter,
  scrollOffset,
}: LocalLogPanelProps) {
  const [logs, setLogs] = useState<LogLine[]>([]);

  // Refresh logs
  useEffect(() => {
    if (isPaused) return;

    const refresh = () => {
      setLogs(getLogs());
    };

    refresh();
    const interval = setInterval(refresh, 200);
    return () => clearInterval(interval);
  }, [isPaused]);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (filter === 'all') return true;
    if (filter === 'error') return log.level === 'error';
    if (filter === 'warn') return log.level === 'error' || log.level === 'warn';
    if (filter === 'info') return log.level !== 'debug';
    return true;
  });

  // Calculate scroll position
  const totalLogs = filteredLogs.length;
  const maxScroll = Math.max(0, totalLogs - maxLines);
  const effectiveOffset = Math.min(scrollOffset, maxScroll);

  // Get visible logs based on scroll position
  const startIdx = Math.max(0, totalLogs - maxLines - effectiveOffset);
  const endIdx = totalLogs - effectiveOffset;
  const displayLogs = filteredLogs.slice(startIdx, endIdx);

  // Scroll indicator
  const isAtBottom = effectiveOffset === 0;
  const scrollPercent =
    maxScroll > 0 ? Math.round((1 - effectiveOffset / maxScroll) * 100) : 100;

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      flexGrow={1}
      overflow="hidden"
    >
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold>LOGS</Text>
          <Text dimColor> (Local)</Text>
        </Box>
        <Box>
          {isPaused && <Text color="yellow">[PAUSED] </Text>}
          {!isAtBottom && <Text color="cyan">[SCROLL:{scrollPercent}%] </Text>}
          <Text dimColor>[F]ilter: </Text>
          <Text color="cyan">{filter.toUpperCase()}</Text>
          <Text dimColor>
            {' '}
            ({filteredLogs.length}/{logs.length})
          </Text>
        </Box>
      </Box>

      {/* Log lines */}
      <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
        {displayLogs.length === 0 ? (
          <Text dimColor>Waiting for logs... Start the API server or run commands.</Text>
        ) : (
          displayLogs.map((log) => (
            <Box key={log.id}>
              <Text dimColor>{formatTime(log.timestamp)} </Text>
              <Text color={LEVEL_COLORS[log.level]}>
                [{log.level.toUpperCase().padEnd(5)}]{' '}
              </Text>
              <Text wrap="truncate">{log.message}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* Footer hints */}
      <Box paddingX={1} justifyContent="space-between">
        <Text dimColor>
          [J/K] scroll [G] bottom [T] top [P] pause [C] clear
        </Text>
        <Text dimColor>
          {startIdx + 1}-{endIdx} of {totalLogs}
        </Text>
      </Box>
    </Box>
  );
}

export function getNextFilter(current: LogFilter): LogFilter {
  const idx = FILTER_ORDER.indexOf(current);
  return FILTER_ORDER[(idx + 1) % FILTER_ORDER.length] ?? 'all';
}

export function getMaxScroll(logsCount: number, maxLines: number = 15): number {
  return Math.max(0, logsCount - maxLines);
}

// Hook for log panel state
export function useLocalLogPanel() {
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [scrollOffset, setScrollOffset] = useState(0);

  const togglePause = () => setIsPaused((p) => !p);
  const cycleFilter = () => {
    setFilter(getNextFilter);
    setScrollOffset(0);
  };
  const scrollUp = () =>
    setScrollOffset((prev) => Math.min(prev + 1, getMaxScroll(getLogs().length)));
  const scrollDown = () => setScrollOffset((prev) => Math.max(prev - 1, 0));
  const scrollToBottom = () => setScrollOffset(0);
  const scrollToTop = () => setScrollOffset(getMaxScroll(getLogs().length));

  const clear = () => {
    clearLogs();
    setScrollOffset(0);
  };

  return {
    isPaused,
    filter,
    scrollOffset,
    togglePause,
    cycleFilter,
    scrollUp,
    scrollDown,
    scrollToBottom,
    scrollToTop,
    clear,
  };
}

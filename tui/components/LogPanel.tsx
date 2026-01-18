import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export type LogFilter = 'all' | 'error' | 'warn' | 'info';

interface LogEntry {
  id: number;
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  raw: string;
}

interface LogPanelProps {
  logs: string[];
  isLoading: boolean;
  error: string | null;
  isPaused: boolean;
  filter: LogFilter;
  envName: string;
  scrollOffset: number;
  flexGrow?: number;
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  debug: 'gray',
};

const FILTER_ORDER: LogFilter[] = ['all', 'error', 'warn', 'info'];

function parseLogLevel(line: string): 'error' | 'warn' | 'info' | 'debug' {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('exception') || lower.includes('fail')) return 'error';
  if (lower.includes('warn')) return 'warn';
  if (lower.includes('info') || lower.includes('200') || lower.includes('201')) return 'info';
  return 'debug';
}

function parseTimestamp(line: string): string {
  // Try to extract timestamp from log line
  const match = line.match(/(\d{2}:\d{2}:\d{2})/);
  if (match) return match[1];
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function LogPanel({
  logs,
  isLoading,
  error,
  isPaused,
  filter,
  envName,
  scrollOffset,
  flexGrow = 1
}: LogPanelProps) {
  const maxLines = 12;

  // Parse logs into entries
  const entries: LogEntry[] = logs.map((line, i) => ({
    id: i,
    timestamp: parseTimestamp(line),
    level: parseLogLevel(line),
    message: line.slice(0, 120),
    raw: line,
  }));

  // Filter logs
  const filteredLogs = entries.filter(log => {
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
  const isAtTop = effectiveOffset >= maxScroll;
  const scrollPercent = maxScroll > 0 ? Math.round((1 - effectiveOffset / maxScroll) * 100) : 100;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={flexGrow} overflow="hidden">
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Box>
          <Text bold>LOGS</Text>
          <Text dimColor> ({envName})</Text>
          {isLoading && (
            <Text color="yellow"> <Spinner type="dots" /></Text>
          )}
          <Text dimColor> [CloudWatch]</Text>
        </Box>
        <Box>
          {isPaused && <Text color="yellow">[PAUSED] </Text>}
          {!isAtBottom && <Text color="cyan">[SCROLL:{scrollPercent}%] </Text>}
          <Text dimColor>[F]ilter: </Text>
          <Text color="cyan">{filter.toUpperCase()}</Text>
          <Text dimColor> ({filteredLogs.length}/{logs.length})</Text>
        </Box>
      </Box>

      {/* Log lines */}
      <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
        {error ? (
          <Text color="red">Error: {error}</Text>
        ) : displayLogs.length === 0 ? (
          <Text dimColor>Waiting for logs...</Text>
        ) : (
          displayLogs.map(log => (
            <Box key={log.id}>
              <Text dimColor>{log.timestamp} </Text>
              <Text color={LEVEL_COLORS[log.level]}>[{log.level.toUpperCase().padEnd(5)}] </Text>
              <Text wrap="truncate">{log.message}</Text>
            </Box>
          ))
        )}
      </Box>

      {/* Scroll hints */}
      <Box paddingX={1} justifyContent="space-between">
        <Text dimColor>
          {isAtTop ? '' : '\u2191'} {isAtBottom ? '' : '\u2193'}
          {' '}[J/K] scroll [G] bottom [T] top
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

// Helper to calculate max scroll
export function getMaxScroll(logsCount: number, maxLines: number = 12): number {
  return Math.max(0, logsCount - maxLines);
}

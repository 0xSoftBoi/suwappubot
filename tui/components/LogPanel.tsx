import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export type LogFilter = 'smart' | 'all' | 'error' | 'warn' | 'info';

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
  provider?: 'ec2' | 'ecs-fargate' | 'render';
  flexGrow?: number;
}

const LEVEL_COLORS: Record<string, string> = {
  error: 'red',
  warn: 'yellow',
  info: 'cyan',
  debug: 'gray',
};

const FILTER_ORDER: LogFilter[] = ['smart', 'all', 'error', 'warn', 'info'];

// Routine lines that clutter the view when using "smart" filter
const SMART_HIDE = [
  /answerCallbackQuery/,          // routine Telegram response
  /editMessageText.*200 OK/,      // routine message edits
  /sendMessage.*200 OK/,          // routine message sends (keep errors)
  /Started server process/,       // startup noise (shown once)
  /Waiting for application/,      // startup noise
  /Application startup complete/, // startup noise
  /Uvicorn running on/,           // startup noise
  /deleteWebhook.*200 OK/,        // startup noise
  /Preloaded \d+ chains/,         // startup noise
];

function isSmartHidden(line: string): boolean {
  return SMART_HIDE.some(p => p.test(line));
}

function parseLogLevel(line: string): 'error' | 'warn' | 'info' | 'debug' {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('exception') || lower.includes('fail') || lower.includes('traceback')) return 'error';
  if (lower.includes('warn') || lower.includes('degraded')) return 'warn';
  if (lower.includes('info') || lower.includes('started') || lower.includes('connected')) return 'info';
  return 'debug';
}

function parseTimestamp(line: string): string {
  const match = line.match(/(\d{2}:\d{2}:\d{2})/);
  if (match) return match[1];
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// Strip the syslog prefix from journalctl lines for cleaner display
function cleanMessage(line: string): string {
  // Remove "2026-03-08T05:10:13+0000 ip-10-0-0-92 suwappubot[28742]: " prefix
  const journalMatch = line.match(/^\d{4}-\d{2}-\d{2}T[\d:+]+\s+\S+\s+\S+\[\d+\]:\s*(.*)/);
  if (journalMatch) return journalMatch[1];
  // Remove "2026-03-08 05:10:13,117 - module - LEVEL - " prefix (Python logging)
  const pyMatch = line.match(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+\s+-\s+\S+\s+-\s+\w+\s+-\s+(.*)/);
  if (pyMatch) return pyMatch[1];
  return line;
}

export function LogPanel({
  logs,
  isLoading,
  error,
  isPaused,
  filter,
  envName,
  scrollOffset,
  provider = 'ecs-fargate',
  flexGrow = 1
}: LogPanelProps) {
  const maxLines = 16;

  // Parse logs into entries
  const entries: LogEntry[] = logs.map((line, i) => ({
    id: i,
    timestamp: parseTimestamp(line),
    level: parseLogLevel(line),
    message: cleanMessage(line).slice(0, 150),
    raw: line,
  }));

  // Filter logs
  const filteredLogs = entries.filter(log => {
    if (filter === 'smart') {
      // Show errors+warnings always, hide routine noise
      if (log.level === 'error' || log.level === 'warn') return true;
      return !isSmartHidden(log.raw);
    }
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

  const startIdx = Math.max(0, totalLogs - maxLines - effectiveOffset);
  const endIdx = totalLogs - effectiveOffset;
  const displayLogs = filteredLogs.slice(startIdx, endIdx);

  const isAtBottom = effectiveOffset === 0;
  const isAtTop = effectiveOffset >= maxScroll;
  const scrollPercent = maxScroll > 0 ? Math.round((1 - effectiveOffset / maxScroll) * 100) : 100;

  const sourceLabel = provider === 'ec2' ? 'journalctl' : 'CloudWatch';

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
          <Text dimColor> [{sourceLabel}]</Text>
        </Box>
        <Box>
          {isPaused && <Text color="yellow">[PAUSED] </Text>}
          {!isAtBottom && <Text color="cyan">[SCROLL:{scrollPercent}%] </Text>}
          <Text dimColor>[F]ilter: </Text>
          <Text color={filter === 'smart' ? 'green' : 'cyan'}>{filter.toUpperCase()}</Text>
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
              <Text wrap="truncate" color={log.level === 'error' ? 'red' : log.level === 'warn' ? 'yellow' : undefined}>{log.message}</Text>
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
          {totalLogs > 0 ? `${startIdx + 1}-${endIdx} of ${totalLogs}` : '0'}
        </Text>
      </Box>
    </Box>
  );
}

export function getNextFilter(current: LogFilter): LogFilter {
  const idx = FILTER_ORDER.indexOf(current);
  return FILTER_ORDER[(idx + 1) % FILTER_ORDER.length] ?? 'smart';
}

export function getMaxScroll(logsCount: number, maxLines: number = 16): number {
  return Math.max(0, logsCount - maxLines);
}

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface LogPanelProps {
  logs: string[];
  isLoading: boolean;
  error: string | null;
  isPaused: boolean;
  maxHeight?: number;
}

export function LogPanel({ logs, isLoading, error, isPaused, maxHeight = 15 }: LogPanelProps) {
  // Show last N lines
  const visibleLogs = logs.slice(-maxHeight);

  // Parse log level from message
  const getLogColor = (line: string): string => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('exception') || lower.includes('fail')) {
      return 'red';
    }
    if (lower.includes('warn')) {
      return 'yellow';
    }
    if (lower.includes('info')) {
      return 'cyan';
    }
    if (lower.includes('debug')) {
      return 'gray';
    }
    return 'white';
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      height={maxHeight + 2}
    >
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text bold>CloudWatch Logs</Text>
        <Box>
          {isLoading && <Text color="yellow"><Spinner type="dots" /> </Text>}
          {isPaused && <Text color="yellow">[PAUSED] </Text>}
          <Text dimColor>{logs.length} lines</Text>
        </Box>
      </Box>

      {/* Log content */}
      <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
        {error ? (
          <Text color="red">Error: {error}</Text>
        ) : visibleLogs.length === 0 ? (
          <Text dimColor>No logs available...</Text>
        ) : (
          visibleLogs.map((line, i) => (
            <Text key={i} color={getLogColor(line)} wrap="truncate">
              {line.length > 120 ? line.substring(0, 120) + '...' : line}
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

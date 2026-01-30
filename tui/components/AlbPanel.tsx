import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface AlbPanelProps {
  metrics: { requestCount: number; errorRate: number; avgLatency: number } | null;
  isLoading: boolean;
  error: string | null;
  envName: string;
  albName?: string;
}

export function AlbPanel({ metrics, isLoading, error, envName, albName }: AlbPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={1} paddingX={1}>
      {/* Header */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="magenta">ALB</Text>
          <Text dimColor> ({envName})</Text>
          {isLoading && <Text color="yellow"> <Spinner type="dots" /></Text>}
        </Box>
      </Box>

      {albName && (
        <Text dimColor>{albName}</Text>
      )}

      {/* Metrics */}
      {error ? (
        <Text color="red">Error: {error}</Text>
      ) : !metrics ? (
        <Text dimColor>Loading metrics...</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Box justifyContent="space-between">
            <Text dimColor>Requests (5m):</Text>
            <Text color="cyan" bold>{metrics.requestCount}</Text>
          </Box>
          <Box justifyContent="space-between">
            <Text dimColor>Error Rate:</Text>
            <Text color={metrics.errorRate > 1 ? 'red' : 'green'} bold>
              {metrics.errorRate.toFixed(2)}%
            </Text>
          </Box>
          <Box justifyContent="space-between">
            <Text dimColor>Avg Latency:</Text>
            <Text color={metrics.avgLatency > 500 ? 'yellow' : 'green'} bold>
              {metrics.avgLatency}ms
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

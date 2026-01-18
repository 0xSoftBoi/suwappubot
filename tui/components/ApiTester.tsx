import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import {
  ENDPOINTS,
  testPredefinedEndpoint,
  checkHealth,
  getBaseUrl,
  type EndpointKey,
  type ApiResponse,
  type HealthStatus,
} from '../services/api';

interface EndpointResult {
  key: EndpointKey;
  response: ApiResponse | null;
  isLoading: boolean;
}

interface ApiTesterProps {
  selectedEndpoint: number;
  onTestComplete?: (key: EndpointKey, result: ApiResponse) => void;
}

export function ApiTester({ selectedEndpoint, onTestComplete }: ApiTesterProps) {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [results, setResults] = useState<Map<EndpointKey, ApiResponse>>(new Map());
  const [testing, setTesting] = useState<EndpointKey | null>(null);

  const endpointKeys = Object.keys(ENDPOINTS) as EndpointKey[];

  // Health check on mount and periodically
  useEffect(() => {
    const check = async () => {
      const status = await checkHealth();
      setHealth(status);
    };

    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  // Test selected endpoint when it changes
  useEffect(() => {
    const key = endpointKeys[selectedEndpoint];
    if (key && !results.has(key)) {
      testEndpoint(key);
    }
  }, [selectedEndpoint]);

  const testEndpoint = async (key: EndpointKey) => {
    setTesting(key);
    const result = await testPredefinedEndpoint(key);
    setResults((prev) => new Map(prev).set(key, result));
    setTesting(null);
    onTestComplete?.(key, result);
  };

  const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return 'green';
    if (status >= 400 && status < 500) return 'yellow';
    if (status >= 500) return 'red';
    if (status === 0) return 'red';
    return 'gray';
  };

  const formatResponseTime = (ms: number): string => {
    if (ms < 100) return `${ms}ms`;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const selectedKey = endpointKeys[selectedEndpoint];
  const selectedResult = selectedKey ? results.get(selectedKey) : null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={1}>
      {/* Header with health status */}
      <Box paddingX={1} justifyContent="space-between">
        <Text bold>API TESTER</Text>
        <Box>
          <Text dimColor>Base: </Text>
          <Text color="cyan">{getBaseUrl()}</Text>
          <Text dimColor> | Health: </Text>
          {health ? (
            <>
              <Text color={health.status === 'healthy' ? 'green' : 'red'}>
                {health.status.toUpperCase()}
              </Text>
              <Text dimColor> ({formatResponseTime(health.responseTime)})</Text>
            </>
          ) : (
            <Text color="gray">checking...</Text>
          )}
        </Box>
      </Box>

      {/* Endpoint list */}
      <Box flexDirection="row" paddingX={1} marginTop={1}>
        <Box flexDirection="column" width={30}>
          <Text bold dimColor>
            ENDPOINTS
          </Text>
          {endpointKeys.map((key, idx) => {
            const endpoint = ENDPOINTS[key];
            const result = results.get(key);
            const isSelected = idx === selectedEndpoint;
            const isLoading = testing === key;

            return (
              <Box key={key}>
                <Text color={isSelected ? 'cyan' : 'white'}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text
                  color={isSelected ? 'cyan' : 'white'}
                  bold={isSelected}
                >
                  {endpoint.method.padEnd(4)}
                </Text>
                <Text color={isSelected ? 'cyan' : 'gray'}>
                  {' '}
                  {endpoint.path.slice(0, 18).padEnd(18)}
                </Text>
                {isLoading ? (
                  <Text color="yellow">
                    {' '}
                    <Spinner type="dots" />
                  </Text>
                ) : result ? (
                  <Text color={getStatusColor(result.status)}>
                    {' '}
                    {result.status || 'ERR'}
                  </Text>
                ) : (
                  <Text dimColor> ---</Text>
                )}
              </Box>
            );
          })}
        </Box>

        {/* Response preview */}
        <Box
          flexDirection="column"
          flexGrow={1}
          marginLeft={2}
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
        >
          <Text bold dimColor>
            RESPONSE
          </Text>
          {selectedResult ? (
            <>
              <Box marginTop={1}>
                <Text dimColor>Status: </Text>
                <Text color={getStatusColor(selectedResult.status)}>
                  {selectedResult.status || 'ERROR'}
                </Text>
                <Text dimColor> | Time: </Text>
                <Text>{formatResponseTime(selectedResult.responseTime)}</Text>
              </Box>
              {selectedResult.error ? (
                <Box marginTop={1}>
                  <Text color="red">Error: {selectedResult.error}</Text>
                </Box>
              ) : (
                <Box marginTop={1} flexDirection="column">
                  <Text dimColor>Body:</Text>
                  <Text wrap="truncate-end">
                    {JSON.stringify(selectedResult.data, null, 2).slice(0, 500)}
                  </Text>
                </Box>
              )}
            </>
          ) : testing === selectedKey ? (
            <Box marginTop={1}>
              <Text color="yellow">
                <Spinner type="dots" /> Testing...
              </Text>
            </Box>
          ) : (
            <Box marginTop={1}>
              <Text dimColor>Press Enter to test endpoint</Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer hints */}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          [↑/↓] Select endpoint | [Enter] Test | [A] Test all | [R] Refresh
        </Text>
      </Box>
    </Box>
  );
}

// Hook for managing endpoint selection
export function useEndpointSelection() {
  const [selectedEndpoint, setSelectedEndpoint] = useState(0);
  const endpointCount = Object.keys(ENDPOINTS).length;

  const moveUp = () => setSelectedEndpoint((prev) => Math.max(0, prev - 1));
  const moveDown = () =>
    setSelectedEndpoint((prev) => Math.min(endpointCount - 1, prev + 1));

  return {
    selectedEndpoint,
    setSelectedEndpoint,
    moveUp,
    moveDown,
    endpointCount,
  };
}

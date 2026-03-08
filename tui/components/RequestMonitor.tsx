import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getRequestLogs, clearRequestLogs, type RequestLog } from '../services/api';

interface RequestMonitorProps {
  maxLines?: number;
  selectedIndex: number;
  showDetails: boolean;
}

export function RequestMonitor({
  maxLines = 10,
  selectedIndex,
  showDetails,
}: RequestMonitorProps) {
  const [logs, setLogs] = useState<RequestLog[]>([]);

  // Refresh logs periodically
  useEffect(() => {
    const refresh = () => {
      setLogs(getRequestLogs());
    };

    refresh();
    const interval = setInterval(refresh, 500);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return 'green';
    if (status >= 400 && status < 500) return 'yellow';
    if (status >= 500) return 'red';
    if (status === 0) return 'red';
    return 'gray';
  };

  const getMethodColor = (method: string): string => {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'cyan';
      case 'POST':
        return 'green';
      case 'PUT':
        return 'yellow';
      case 'DELETE':
        return 'red';
      default:
        return 'white';
    }
  };

  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const visibleLogs = logs.slice(0, maxLines);
  const selectedLog = logs[selectedIndex];

  if (showDetails && selectedLog) {
    return (
      <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={1}>
        <Box paddingX={1} justifyContent="space-between">
          <Text bold>REQUEST DETAILS</Text>
          <Text dimColor>[Esc] Back to list</Text>
        </Box>

        <Box flexDirection="column" paddingX={1} marginTop={1}>
          <Box>
            <Text dimColor>Time: </Text>
            <Text>{formatTime(selectedLog.timestamp)}</Text>
          </Box>
          <Box>
            <Text dimColor>Method: </Text>
            <Text color={getMethodColor(selectedLog.method)}>{selectedLog.method}</Text>
          </Box>
          <Box>
            <Text dimColor>Path: </Text>
            <Text>{selectedLog.path}</Text>
          </Box>
          <Box>
            <Text dimColor>Status: </Text>
            <Text color={getStatusColor(selectedLog.status)}>
              {selectedLog.status || 'ERROR'}
            </Text>
          </Box>
          <Box>
            <Text dimColor>Response Time: </Text>
            <Text>{selectedLog.responseTime}ms</Text>
          </Box>

          {selectedLog.error && (
            <Box marginTop={1} flexDirection="column">
              <Text bold color="red">
                Error:
              </Text>
              <Text color="red">{selectedLog.error}</Text>
            </Box>
          )}

          {selectedLog.requestBody !== undefined && (
            <Box marginTop={1} flexDirection="column">
              <Text bold dimColor>
                Request Body:
              </Text>
              <Text wrap="truncate-end">
                {JSON.stringify(selectedLog.requestBody, null, 2).slice(0, 300)}
              </Text>
            </Box>
          )}

          {selectedLog.responseBody !== undefined && (
            <Box marginTop={1} flexDirection="column">
              <Text bold dimColor>
                Response Body:
              </Text>
              <Text wrap="truncate-end">
                {JSON.stringify(selectedLog.responseBody, null, 2).slice(0, 500)}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text bold>REQUEST MONITOR</Text>
        <Box>
          <Text dimColor>Total: </Text>
          <Text>{logs.length}</Text>
          <Text dimColor> | [C] Clear</Text>
        </Box>
      </Box>

      {/* Request list */}
      <Box flexDirection="column" paddingX={1} marginTop={1} flexGrow={1}>
        {visibleLogs.length === 0 ? (
          <Text dimColor>No requests yet. Use API Tester or make requests to the API.</Text>
        ) : (
          visibleLogs.map((log, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <Box key={log.id}>
                <Text color={isSelected ? 'cyan' : 'gray'}>
                  {isSelected ? '▶' : ' '}
                </Text>
                <Text dimColor> {formatTime(log.timestamp)} </Text>
                <Text color={getMethodColor(log.method)}>
                  {log.method.padEnd(6)}
                </Text>
                <Text color={isSelected ? 'cyan' : 'white'}>
                  {log.path.slice(0, 30).padEnd(30)}
                </Text>
                <Text color={getStatusColor(log.status)}>
                  {' '}
                  {(log.status || 'ERR').toString().padEnd(4)}
                </Text>
                <Text dimColor> {log.responseTime.toString().padStart(4)}ms</Text>
                {log.error && <Text color="red"> ✗</Text>}
              </Box>
            );
          })
        )}
      </Box>

      {/* Footer */}
      <Box paddingX={1}>
        <Text dimColor>
          [↑/↓] Select | [Enter] Details | [C] Clear
        </Text>
      </Box>
    </Box>
  );
}

// Hook for managing request selection
export function useRequestSelection() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  const moveUp = () => setSelectedIndex((prev) => Math.max(0, prev - 1));
  const moveDown = (maxIndex: number) =>
    setSelectedIndex((prev) => Math.min(maxIndex, prev + 1));
  const toggleDetails = () => setShowDetails((prev) => !prev);
  const hideDetails = () => setShowDetails(false);

  const clear = () => {
    clearRequestLogs();
    setSelectedIndex(0);
  };

  return {
    selectedIndex,
    setSelectedIndex,
    showDetails,
    moveUp,
    moveDown,
    toggleDetails,
    hideDetails,
    clear,
  };
}

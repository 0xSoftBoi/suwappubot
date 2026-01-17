import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  environment: string;
  message?: string;
}

export function StatusBar({ environment, message }: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text dimColor>[Q] Quit </Text>
        <Text dimColor>[R] Restart </Text>
        <Text dimColor>[D] Deploy </Text>
        <Text dimColor>[L] Logs </Text>
        <Text dimColor>[1-4] Switch</Text>
      </Box>
      <Box>
        {message ? (
          <Text color="yellow">{message}</Text>
        ) : (
          <Text dimColor>Active: {environment}</Text>
        )}
      </Box>
    </Box>
  );
}

import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  activeEnvironment: string;
  mode: 'dashboard' | 'detail' | 'confirm';
  message?: string;
}

export function StatusBar({ activeEnvironment, mode, message }: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text>
          <Text bold color="cyan">[1-4]</Text>
          <Text dimColor>Env </Text>
          <Text bold color="cyan">[I]</Text>
          <Text dimColor>nfo </Text>
          <Text bold color="yellow">[P]</Text>
          <Text dimColor>ause </Text>
          <Text bold color="cyan">[F]</Text>
          <Text dimColor>ilter </Text>
          <Text bold color="magenta">[J/K]</Text>
          <Text dimColor>Scrl </Text>
          <Text bold color="cyan">[D]</Text>
          <Text dimColor>ep </Text>
          <Text bold color="cyan">[R]</Text>
          <Text dimColor>st </Text>
          <Text bold color="red">[Q]</Text>
          <Text dimColor>uit</Text>
        </Text>
      </Box>
      <Box>
        {message ? (
          <Text color="yellow">{message}</Text>
        ) : (
          <Text>
            <Text dimColor>Active: </Text>
            <Text bold>{activeEnvironment.toUpperCase()}</Text>
          </Text>
        )}
      </Box>
    </Box>
  );
}

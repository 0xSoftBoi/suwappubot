import React from 'react';
import { Box, Text, useInput } from 'ink';

interface ConfirmDialogProps {
  title: string;
  message: string;
  environment: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  environment,
  action,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      padding={2}
      width={60}
    >
      <Text bold color="yellow">{title}</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>{message}</Text>
        <Text dimColor>Environment: <Text color="cyan">{environment}</Text></Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Command: </Text>
        <Text color="gray">{action}</Text>
      </Box>

      <Box marginTop={2} justifyContent="center">
        <Text>
          Press <Text color="green" bold>[Y]</Text> to confirm or{' '}
          <Text color="red" bold>[N]</Text> to cancel
        </Text>
      </Box>
    </Box>
  );
}

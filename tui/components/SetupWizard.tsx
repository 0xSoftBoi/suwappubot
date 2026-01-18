import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { runSetupChecks, type SetupStatus, type SetupCheckResult } from '../services/setup';

interface SetupWizardProps {
  profileName?: string;
  onComplete?: (ready: boolean) => void;
}

function CheckIcon({ status }: { status: SetupCheckResult['status'] }) {
  if (status === 'pass') {
    return <Text color="green">✓</Text>;
  }
  if (status === 'fail') {
    return <Text color="red">✗</Text>;
  }
  return <Text color="yellow">!</Text>;
}

export function SetupWizard({ profileName = 'Swappu', onComplete }: SetupWizardProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [showHelp, setShowHelp] = useState<string | null>(null);

  useEffect(() => {
    async function check() {
      setIsChecking(true);
      const result = await runSetupChecks(profileName);
      setStatus(result);
      setIsChecking(false);
    }
    check();
  }, [profileName]);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
    }
    if (input === 'r') {
      setIsChecking(true);
      runSetupChecks(profileName).then(result => {
        setStatus(result);
        setIsChecking(false);
      });
    }
    if (key.return && status?.ready) {
      onComplete?.(true);
    }
    if (input >= '1' && input <= '9' && status) {
      const index = parseInt(input) - 1;
      if (index < status.checks.length && status.checks[index].help) {
        setShowHelp(showHelp === status.checks[index].help ? null : status.checks[index].help!);
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╔══════════════════════════════════════╗
        </Text>
      </Box>
      <Box>
        <Text bold color="cyan">
          ║   Suwappu TUI - Setup Wizard         ║
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╚══════════════════════════════════════╝
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Checking your AWS configuration for profile: </Text>
        <Text color="yellow">{profileName}</Text>
      </Box>

      {isChecking ? (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Running checks...</Text>
        </Box>
      ) : status ? (
        <Box flexDirection="column">
          {/* Check Results */}
          <Box flexDirection="column" marginBottom={1}>
            {status.checks.map((check, i) => (
              <Box key={check.name}>
                <Text dimColor>{i + 1}. </Text>
                <CheckIcon status={check.status} />
                <Text> </Text>
                <Text>{check.name}: </Text>
                <Text color={check.status === 'pass' ? 'green' : check.status === 'fail' ? 'red' : 'yellow'}>
                  {check.message}
                </Text>
                {check.help && <Text dimColor> (press {i + 1} for help)</Text>}
              </Box>
            ))}
          </Box>

          {/* Help Section */}
          {showHelp && (
            <Box flexDirection="column" marginY={1} paddingX={2} borderStyle="single" borderColor="yellow">
              <Text bold color="yellow">Help:</Text>
              <Box marginTop={1}>
                <Text>{showHelp}</Text>
              </Box>
            </Box>
          )}

          {/* Status Summary */}
          <Box marginTop={1} flexDirection="column">
            {status.ready ? (
              <Box flexDirection="column">
                <Text color="green" bold>
                  ✓ All checks passed! You're ready to use the TUI.
                </Text>
                <Box marginTop={1}>
                  <Text dimColor>Press </Text>
                  <Text color="cyan">Enter</Text>
                  <Text dimColor> to continue to the dashboard</Text>
                </Box>
              </Box>
            ) : (
              <Box flexDirection="column">
                <Text color="red" bold>
                  ✗ Some checks failed. Please fix the issues above.
                </Text>
                <Box marginTop={1}>
                  <Text dimColor>Press a number key to see help for that item</Text>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      ) : null}

      {/* Footer */}
      <Box marginTop={2} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          [R] Re-run checks  [1-9] Show help  [Q] Quit
          {status?.ready && '  [Enter] Continue'}
        </Text>
      </Box>
    </Box>
  );
}

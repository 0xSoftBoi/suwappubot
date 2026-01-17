import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { ServicePanel } from './components/ServicePanel';
import { LogPanel } from './components/LogPanel';
import { StatusBar } from './components/StatusBar';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useDeployments } from './hooks/useDeployments';
import { useEcsStatus } from './hooks/useEcsStatus';
import { useLogs } from './hooks/useLogs';
import { forceNewDeployment } from './services/aws';

type Mode = 'dashboard' | 'logs' | 'confirm';

interface PendingAction {
  type: 'deploy' | 'restart';
  title: string;
  message: string;
  action: string;
}

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { deployments, isLoading: deploymentsLoading, error: deploymentsError } = useDeployments();

  // Terminal dimensions
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  // UI State
  const [activePane, setActivePane] = useState(0);
  const [mode, setMode] = useState<Mode>('dashboard');
  const [message, setMessage] = useState('');
  const [actionInProgress, setActionInProgress] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Active deployment
  const activeDeployment = deployments[activePane] ?? null;

  // Status hooks for each deployment (up to 4)
  const status0 = useEcsStatus(deployments[0] ?? null, { enabled: true });
  const status1 = useEcsStatus(deployments[1] ?? null, { enabled: true });
  const status2 = useEcsStatus(deployments[2] ?? null, { enabled: true });
  const status3 = useEcsStatus(deployments[3] ?? null, { enabled: true });

  const statuses = [status0, status1, status2, status3];

  // Logs for active deployment
  const { logs, isLoading: logsLoading, error: logsError, clearLogs } = useLogs(
    activeDeployment,
    { enabled: mode === 'logs' || mode === 'dashboard', streaming: !isPaused }
  );

  const showMessage = useCallback((msg: string, duration = 3000) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), duration);
  }, []);

  // Request deploy confirmation
  const requestDeploy = useCallback(() => {
    if (!activeDeployment || actionInProgress) return;
    setPendingAction({
      type: 'deploy',
      title: 'Confirm Deploy',
      message: 'This will force a new ECS deployment.',
      action: 'aws ecs update-service --force-new-deployment',
    });
    setMode('confirm');
  }, [activeDeployment, actionInProgress]);

  // Execute deploy
  const executeDeploy = useCallback(async () => {
    if (!activeDeployment?.fargate) return;

    setActionInProgress(true);
    showMessage(`Deploying to ${activeDeployment.environment}...`, 60000);

    try {
      const success = await forceNewDeployment(
        activeDeployment.fargate.clusterName,
        activeDeployment.fargate.serviceName,
        activeDeployment.region,
        activeDeployment.awsProfile
      );
      showMessage(success ? 'Deploy triggered!' : 'Deploy failed!');

      // Refresh status
      setTimeout(() => {
        statuses[activePane]?.refresh();
      }, 3000);
    } catch (err) {
      showMessage(`Deploy error: ${err}`);
    } finally {
      setActionInProgress(false);
    }
  }, [activeDeployment, activePane, showMessage, statuses]);

  // Request restart (same as deploy for Fargate)
  const requestRestart = useCallback(() => {
    if (!activeDeployment || actionInProgress) return;
    setPendingAction({
      type: 'restart',
      title: 'Confirm Restart',
      message: 'This will force a new ECS deployment (restart).',
      action: 'aws ecs update-service --force-new-deployment',
    });
    setMode('confirm');
  }, [activeDeployment, actionInProgress]);

  // Handle confirmation
  const handleConfirm = useCallback(() => {
    if (!pendingAction) return;
    setMode('dashboard');

    if (pendingAction.type === 'deploy' || pendingAction.type === 'restart') {
      executeDeploy();
    }
    setPendingAction(null);
  }, [pendingAction, executeDeploy]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setMode('dashboard');
    setPendingAction(null);
    showMessage('Action cancelled');
  }, [showMessage]);

  // Keyboard input
  useInput((input, key) => {
    if (actionInProgress || mode === 'confirm') return;

    // Quit
    if (input === 'q' || input === 'Q') {
      exit();
      return;
    }

    // Toggle logs view
    if (input === 'l' || input === 'L') {
      setMode(m => m === 'logs' ? 'dashboard' : 'logs');
      return;
    }

    // Toggle pause
    if (input === 'p' || input === 'P') {
      setIsPaused(p => !p);
      showMessage(isPaused ? 'Resumed' : 'Paused');
      return;
    }

    // Clear logs
    if (input === 'c' || input === 'C') {
      clearLogs();
      showMessage('Logs cleared');
      return;
    }

    // Deploy
    if (input === 'd' || input === 'D') {
      requestDeploy();
      return;
    }

    // Restart
    if (input === 'r' || input === 'R') {
      requestRestart();
      return;
    }

    // Refresh
    if (key.return) {
      statuses[activePane]?.refresh();
      showMessage('Refreshing...');
      return;
    }

    // Switch panes with numbers
    if (input >= '1' && input <= '4') {
      const idx = parseInt(input) - 1;
      if (idx < deployments.length) {
        setActivePane(idx);
      }
      return;
    }

    // Arrow navigation
    if (key.leftArrow) {
      setActivePane(p => Math.max(0, p - 1));
    }
    if (key.rightArrow) {
      setActivePane(p => Math.min(deployments.length - 1, p + 1));
    }
    if (key.tab) {
      setActivePane(p => (p + 1) % Math.max(1, deployments.length));
    }
  });

  // Loading state
  if (deploymentsLoading) {
    return (
      <Box padding={2}>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text> Loading deployments...</Text>
      </Box>
    );
  }

  // Error state
  if (deploymentsError) {
    return (
      <Box padding={2} flexDirection="column">
        <Text color="red">Error loading deployments:</Text>
        <Text>{deploymentsError}</Text>
        <Text dimColor>Press Q to quit</Text>
      </Box>
    );
  }

  // No deployments
  if (deployments.length === 0) {
    return (
      <Box padding={2} flexDirection="column">
        <Text color="yellow">No deployments found</Text>
        <Text dimColor>Add deployment configs to tui/deployments/</Text>
        <Text dimColor>Press Q to quit</Text>
      </Box>
    );
  }

  // Confirmation dialog
  if (mode === 'confirm' && pendingAction && activeDeployment) {
    return (
      <Box flexDirection="column" height={terminalHeight} justifyContent="center" alignItems="center">
        <ConfirmDialog
          title={pendingAction.title}
          message={pendingAction.message}
          environment={activeDeployment.environment}
          action={pendingAction.action}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      </Box>
    );
  }

  // Main dashboard
  return (
    <Box flexDirection="column" height={terminalHeight}>
      {/* Header */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">Suwappu Dashboard</Text>
        <Box>
          {actionInProgress && <Text color="yellow"><Spinner type="dots" /> </Text>}
          <Text dimColor>{terminalWidth}x{terminalHeight}</Text>
        </Box>
      </Box>

      {/* Service panels */}
      <Box flexDirection="row" flexGrow={1}>
        {deployments.map((deployment, index) => (
          <Box key={deployment.name} width={`${100 / deployments.length}%`}>
            <ServicePanel
              deployment={deployment}
              status={statuses[index]?.status ?? null}
              isActive={activePane === index}
              isLoading={statuses[index]?.isLoading ?? false}
            />
          </Box>
        ))}
      </Box>

      {/* Log panel (always visible, takes remaining space) */}
      <LogPanel
        logs={logs}
        isLoading={logsLoading}
        error={logsError}
        isPaused={isPaused}
        maxHeight={mode === 'logs' ? terminalHeight - 15 : 10}
      />

      {/* Status bar */}
      <StatusBar
        environment={activeDeployment?.environment || 'none'}
        message={message}
      />
    </Box>
  );
}

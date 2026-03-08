import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { CompactPane } from './components/CompactPane';
import { LogPanel, getNextFilter, getMaxScroll, type LogFilter } from './components/LogPanel';
import { EnvironmentPane } from './components/EnvironmentPane';
import { StatusBar } from './components/StatusBar';
import { ConfirmDialog } from './components/ConfirmDialog';
import { useDeployments } from './hooks/useDeployments';
import { useEcsStatus } from './hooks/useEcsStatus';
import { useLogs } from './hooks/useLogs';
import { forceNewDeployment } from './services/aws';

type Mode = 'dashboard' | 'detail' | 'confirm';

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
  const [logFilter, setLogFilter] = useState<LogFilter>('all');
  const [logScrollOffset, setLogScrollOffset] = useState(0);

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
    { enabled: true, streaming: !isPaused }
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

    // Toggle detail view
    if (input === 'i' || input === 'I') {
      setMode(m => m === 'detail' ? 'dashboard' : 'detail');
      return;
    }

    // Toggle pause
    if (input === 'p' || input === 'P') {
      setIsPaused(p => !p);
      showMessage(isPaused ? 'Resumed' : 'Paused');
      return;
    }

    // Cycle log filter
    if (input === 'f' || input === 'F') {
      setLogFilter(f => getNextFilter(f));
      setLogScrollOffset(0); // Reset scroll when filter changes
      return;
    }

    // Scroll logs up (older)
    if (input === 'k' || input === 'K' || key.upArrow) {
      setLogScrollOffset(prev => {
        const maxScroll = getMaxScroll(logs.length);
        return Math.min(prev + 1, maxScroll);
      });
      return;
    }

    // Scroll logs down (newer)
    if (input === 'j' || input === 'J' || key.downArrow) {
      setLogScrollOffset(prev => Math.max(prev - 1, 0));
      return;
    }

    // Jump to bottom (newest)
    if (input === 'g' || input === 'G') {
      setLogScrollOffset(0);
      return;
    }

    // Jump to top (oldest)
    if (input === 't' || input === 'T') {
      setLogScrollOffset(getMaxScroll(logs.length));
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

    // Tab navigation between panes
    if (key.tab) {
      setActivePane(p => (p + 1) % Math.max(1, deployments.length));
    }

    // Left/Right for pane switching (when not scrolling)
    if (key.leftArrow && key.shift) {
      setActivePane(p => Math.max(0, p - 1));
    }
    if (key.rightArrow && key.shift) {
      setActivePane(p => Math.min(deployments.length - 1, p + 1));
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

  // Detail view (expanded info for one environment)
  if (mode === 'detail' && activeDeployment) {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
          <Text bold color="cyan">Detail View: {activeDeployment.environment.toUpperCase()}</Text>
          <Box>
            {actionInProgress && <Text color="yellow"><Spinner type="dots" /> </Text>}
            <Text dimColor>[I] Back | {terminalWidth}x{terminalHeight}</Text>
          </Box>
        </Box>
        <Box flexGrow={1}>
          <EnvironmentPane
            deployment={activeDeployment}
            status={statuses[activePane]?.status ?? null}
            isActive={true}
            isLoading={statuses[activePane]?.isLoading ?? false}
          />
        </Box>
        <StatusBar
          activeEnvironment={activeDeployment.environment}
          mode="detail"
          message={message}
        />
      </Box>
    );
  }

  // Main Dashboard view
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

      {/* Compact Panes Row */}
      <Box flexDirection="row">
        {deployments.map((deployment, index) => (
          <CompactPane
            key={deployment.name}
            deployment={deployment}
            status={statuses[index]?.status ?? null}
            isActive={activePane === index}
            isLoading={statuses[index]?.isLoading ?? false}
          />
        ))}
      </Box>

      {/* Flexible content area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {/* Logs Panel */}
        <LogPanel
          logs={logs}
          isLoading={logsLoading}
          error={logsError}
          isPaused={isPaused}
          filter={logFilter}
          envName={activeDeployment?.environment?.toUpperCase() || 'NONE'}
          scrollOffset={logScrollOffset}
          flexGrow={1}
        />
      </Box>

      {/* Status Bar */}
      <StatusBar
        activeEnvironment={activeDeployment?.environment || 'none'}
        mode="dashboard"
        message={message}
      />
    </Box>
  );
}

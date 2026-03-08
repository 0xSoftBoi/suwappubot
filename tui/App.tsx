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
import { useEc2Status } from './hooks/useEc2Status';
import { useLogs } from './hooks/useLogs';
import { forceNewDeployment } from './services/aws';
import { deployEc2, restartEc2Service } from './services/ec2';

type Mode = 'dashboard' | 'detail' | 'confirm';

interface PendingAction {
  type: 'deploy' | 'restart';
  title: string;
  message: string;
  action: string;
}

function useDeploymentStatus(deployment: import('./types/deployment').DeploymentConfig | null, options: { enabled: boolean }) {
  const isEc2 = deployment?.provider === 'ec2';
  const ec2Result = useEc2Status(deployment, { ...options, enabled: options.enabled && isEc2 });
  const ecsResult = useEcsStatus(deployment, { ...options, enabled: options.enabled && !isEc2 });
  return isEc2 ? ec2Result : ecsResult;
}

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { deployments, isLoading: deploymentsLoading, error: deploymentsError } = useDeployments();

  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  const [activePane, setActivePane] = useState(0);
  const [mode, setMode] = useState<Mode>('dashboard');
  const [message, setMessage] = useState('');
  const [actionInProgress, setActionInProgress] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [logFilter, setLogFilter] = useState<LogFilter>('smart');
  const [logScrollOffset, setLogScrollOffset] = useState(0);

  const activeDeployment = deployments[activePane] ?? null;

  const status0 = useDeploymentStatus(deployments[0] ?? null, { enabled: true });
  const status1 = useDeploymentStatus(deployments[1] ?? null, { enabled: true });
  const status2 = useDeploymentStatus(deployments[2] ?? null, { enabled: true });
  const status3 = useDeploymentStatus(deployments[3] ?? null, { enabled: true });
  const statuses = [status0, status1, status2, status3];

  const { logs, isLoading: logsLoading, error: logsError, clearLogs } = useLogs(
    activeDeployment,
    { enabled: true, streaming: !isPaused }
  );

  const showMessage = useCallback((msg: string, duration = 3000) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), duration);
  }, []);

  const requestDeploy = useCallback(() => {
    if (!activeDeployment || actionInProgress) return;
    const isEc2 = activeDeployment.provider === 'ec2';
    setPendingAction({
      type: 'deploy',
      title: 'Confirm Deploy',
      message: isEc2
        ? `git pull + restart on ${activeDeployment.ec2?.host}`
        : 'Force new ECS deployment',
      action: isEc2
        ? `ssh → git pull origin/${activeDeployment.github?.branch || 'main'} → restart`
        : 'aws ecs update-service --force-new-deployment',
    });
    setMode('confirm');
  }, [activeDeployment, actionInProgress]);

  const executeDeploy = useCallback(async () => {
    if (!activeDeployment) return;
    setActionInProgress(true);
    showMessage(`Deploying to ${activeDeployment.environment}...`, 60000);

    try {
      if (activeDeployment.provider === 'ec2' && activeDeployment.ec2) {
        const { host, user, sshKeyPath, serviceName, appDir } = activeDeployment.ec2;
        const branch = activeDeployment.github?.branch || 'main';
        const result = await deployEc2(host, user, sshKeyPath, appDir, branch, serviceName);
        showMessage(result.success ? 'Deploy OK!' : `Deploy failed: ${result.output}`);
      } else if (activeDeployment.fargate) {
        const success = await forceNewDeployment(
          activeDeployment.fargate.clusterName,
          activeDeployment.fargate.serviceName,
          activeDeployment.region,
          activeDeployment.awsProfile
        );
        showMessage(success ? 'Deploy triggered!' : 'Deploy failed!');
      }
      setTimeout(() => statuses[activePane]?.refresh(), 5000);
    } catch (err) {
      showMessage(`Deploy error: ${err}`);
    } finally {
      setActionInProgress(false);
    }
  }, [activeDeployment, activePane, showMessage, statuses]);

  const executeRestart = useCallback(async () => {
    if (!activeDeployment) return;
    setActionInProgress(true);
    showMessage(`Restarting ${activeDeployment.environment}...`, 60000);

    try {
      if (activeDeployment.provider === 'ec2' && activeDeployment.ec2) {
        const { host, user, sshKeyPath, serviceName } = activeDeployment.ec2;
        const success = await restartEc2Service(host, user, sshKeyPath, serviceName);
        showMessage(success ? 'Restart OK!' : 'Restart failed!');
      } else if (activeDeployment.fargate) {
        const success = await forceNewDeployment(
          activeDeployment.fargate.clusterName,
          activeDeployment.fargate.serviceName,
          activeDeployment.region,
          activeDeployment.awsProfile
        );
        showMessage(success ? 'Restart triggered!' : 'Restart failed!');
      }
      setTimeout(() => statuses[activePane]?.refresh(), 5000);
    } catch (err) {
      showMessage(`Restart error: ${err}`);
    } finally {
      setActionInProgress(false);
    }
  }, [activeDeployment, activePane, showMessage, statuses]);

  const requestRestart = useCallback(() => {
    if (!activeDeployment || actionInProgress) return;
    const isEc2 = activeDeployment.provider === 'ec2';
    setPendingAction({
      type: 'restart',
      title: 'Confirm Restart',
      message: isEc2
        ? `Restart systemd service on ${activeDeployment.ec2?.host}`
        : 'Force new ECS deployment (restart)',
      action: isEc2
        ? `systemctl restart ${activeDeployment.ec2?.serviceName}`
        : 'aws ecs update-service --force-new-deployment',
    });
    setMode('confirm');
  }, [activeDeployment, actionInProgress]);

  const handleConfirm = useCallback(() => {
    if (!pendingAction) return;
    setMode('dashboard');
    if (pendingAction.type === 'deploy') executeDeploy();
    else if (pendingAction.type === 'restart') executeRestart();
    setPendingAction(null);
  }, [pendingAction, executeDeploy, executeRestart]);

  const handleCancel = useCallback(() => {
    setMode('dashboard');
    setPendingAction(null);
    showMessage('Action cancelled');
  }, [showMessage]);

  useInput((input, key) => {
    if (actionInProgress || mode === 'confirm') return;

    if (input === 'q' || input === 'Q') { exit(); return; }
    if (input === 'i' || input === 'I') { setMode(m => m === 'detail' ? 'dashboard' : 'detail'); return; }
    if (input === 'p' || input === 'P') { setIsPaused(p => !p); showMessage(isPaused ? 'Resumed' : 'Paused'); return; }
    if (input === 'f' || input === 'F') { setLogFilter(f => getNextFilter(f)); setLogScrollOffset(0); return; }
    if (input === 'k' || input === 'K' || key.upArrow) { setLogScrollOffset(prev => Math.min(prev + 1, getMaxScroll(logs.length))); return; }
    if (input === 'j' || input === 'J' || key.downArrow) { setLogScrollOffset(prev => Math.max(prev - 1, 0)); return; }
    if (input === 'g' || input === 'G') { setLogScrollOffset(0); return; }
    if (input === 't' || input === 'T') { setLogScrollOffset(getMaxScroll(logs.length)); return; }
    if (input === 'c' || input === 'C') { clearLogs(); showMessage('Logs cleared'); return; }
    if (input === 'd' || input === 'D') { requestDeploy(); return; }
    if (input === 'r' || input === 'R') { requestRestart(); return; }
    if (key.return) { statuses[activePane]?.refresh(); showMessage('Refreshing...'); return; }
    if (input >= '1' && input <= '4') { const idx = parseInt(input) - 1; if (idx < deployments.length) setActivePane(idx); return; }
    if (key.tab) { setActivePane(p => (p + 1) % Math.max(1, deployments.length)); }
    if (key.leftArrow && key.shift) { setActivePane(p => Math.max(0, p - 1)); }
    if (key.rightArrow && key.shift) { setActivePane(p => Math.min(deployments.length - 1, p + 1)); }
  });

  if (deploymentsLoading) {
    return (<Box padding={2}><Text color="cyan"><Spinner type="dots" /></Text><Text> Loading deployments...</Text></Box>);
  }
  if (deploymentsError) {
    return (<Box padding={2} flexDirection="column"><Text color="red">Error: {deploymentsError}</Text><Text dimColor>Press Q to quit</Text></Box>);
  }
  if (deployments.length === 0) {
    return (<Box padding={2} flexDirection="column"><Text color="yellow">No deployments found</Text><Text dimColor>Add configs to tui/deployments/</Text></Box>);
  }

  if (mode === 'confirm' && pendingAction && activeDeployment) {
    return (
      <Box flexDirection="column" height={terminalHeight} justifyContent="center" alignItems="center">
        <ConfirmDialog title={pendingAction.title} message={pendingAction.message}
          environment={activeDeployment.environment} action={pendingAction.action}
          onConfirm={handleConfirm} onCancel={handleCancel} />
      </Box>
    );
  }

  if (mode === 'detail' && activeDeployment) {
    return (
      <Box flexDirection="column" height={terminalHeight}>
        <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
          <Text bold color="cyan">Detail: {activeDeployment.environment.toUpperCase()}</Text>
          <Box>{actionInProgress && <Text color="yellow"><Spinner type="dots" /> </Text>}<Text dimColor>[I] Back</Text></Box>
        </Box>
        <Box flexGrow={1}>
          <EnvironmentPane deployment={activeDeployment} status={statuses[activePane]?.status ?? null}
            isActive={true} isLoading={statuses[activePane]?.isLoading ?? false} />
        </Box>
        <StatusBar activeEnvironment={activeDeployment.environment} mode="detail" message={message} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
        <Text bold color="cyan">Suwappu Dashboard</Text>
        <Box>{actionInProgress && <Text color="yellow"><Spinner type="dots" /> </Text>}<Text dimColor>{terminalWidth}x{terminalHeight}</Text></Box>
      </Box>

      <Box flexDirection="row">
        {deployments.map((deployment, index) => (
          <CompactPane key={deployment.name} deployment={deployment}
            status={statuses[index]?.status ?? null} isActive={activePane === index}
            isLoading={statuses[index]?.isLoading ?? false} />
        ))}
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <LogPanel logs={logs} isLoading={logsLoading} error={logsError} isPaused={isPaused}
          filter={logFilter} envName={activeDeployment?.environment?.toUpperCase() || 'NONE'}
          scrollOffset={logScrollOffset} provider={activeDeployment?.provider || 'ec2'} flexGrow={1} />
      </Box>

      <StatusBar activeEnvironment={activeDeployment?.environment || 'none'} mode="dashboard" message={message} />
    </Box>
  );
}

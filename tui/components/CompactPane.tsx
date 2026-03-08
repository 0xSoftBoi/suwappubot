import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { DeploymentConfig, EnvironmentStatus } from '../types/deployment';

interface CompactPaneProps {
  deployment: DeploymentConfig;
  status: EnvironmentStatus | null;
  isActive: boolean;
  isLoading: boolean;
}

const ENV_COLORS: Record<string, string> = {
  local: 'magenta',
  development: 'green',
  staging: 'yellow',
  production: 'red',
};

export function CompactPane({
  deployment,
  status,
  isActive,
  isLoading,
}: CompactPaneProps) {
  const envColor = ENV_COLORS[deployment.environment] || 'white';
  const borderColor = isActive ? envColor : 'gray';

  // Health indicator
  const healthIcon = status?.health?.status === 'healthy' ? '\u25CF' :
                     status?.health?.status === 'unhealthy' ? '\u25CB' :
                     status?.health?.status === 'unreachable' ? '\u2717' : '\u25CC';
  const healthColor = status?.health?.status === 'healthy' ? 'green' :
                      status?.health?.status === 'unhealthy' ? 'yellow' :
                      status?.health?.status === 'unreachable' ? 'red' : 'gray';

  // Response time
  const responseTime = status?.health?.responseTime
    ? `${Math.round(status.health.responseTime)}ms`
    : '--';

  // Version
  const version = status?.health?.version || '--';

  // Task count
  const taskCount = status?.service
    ? `${status.service.runningCount}/${status.service.desiredCount}`
    : '0/0';

  // Service status
  const serviceStatus = status?.service?.status || 'UNKNOWN';

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      flexGrow={1}
      paddingX={1}
    >
      {/* Line 1: Env name + health + version + response time */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color={envColor}>
            {deployment.environment.toUpperCase().slice(0, 4)}
          </Text>
          {version !== '--' && (
            <Text dimColor> v{version}</Text>
          )}
          {isLoading && (
            <Text color="cyan"> <Spinner type="dots" /></Text>
          )}
        </Box>
        <Box>
          <Text color={healthColor}>{healthIcon}</Text>
          <Text dimColor> {responseTime}</Text>
        </Box>
      </Box>

      {/* Line 2: ECS status + task count */}
      <Box justifyContent="space-between">
        <Text color={serviceStatus === 'ACTIVE' ? 'cyan' : 'yellow'}>
          {serviceStatus.slice(0, 6)}
        </Text>
        <Box>
          <Text color="green">{taskCount}</Text>
          <Text dimColor> tasks</Text>
        </Box>
      </Box>

      {/* Line 3: Health endpoint */}
      {deployment.endpoints.health && (
        <Box>
          <Text dimColor>
            {deployment.endpoints.health.replace(/^https?:\/\//, '').slice(0, 35)}
          </Text>
        </Box>
      )}

      {/* Line 4: RDS status if available */}
      {status?.rds && (
        <Box justifyContent="space-between">
          <Text dimColor>RDS:</Text>
          <Text color={status.rds.status === 'available' ? 'green' : 'yellow'}>
            {status.rds.status}
          </Text>
        </Box>
      )}
    </Box>
  );
}

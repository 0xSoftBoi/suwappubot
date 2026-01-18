import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { DeploymentConfig, EnvironmentStatus } from '../types/deployment';

interface EnvironmentPaneProps {
  deployment: DeploymentConfig;
  status: EnvironmentStatus | null;
  isActive: boolean;
  isLoading: boolean;
}

const ENV_COLORS: Record<string, string> = {
  production: 'red',
  staging: 'yellow',
  development: 'green',
  local: 'magenta',
};

export function EnvironmentPane({
  deployment,
  status,
  isActive,
  isLoading,
}: EnvironmentPaneProps) {
  const borderColor = isActive ? ENV_COLORS[deployment.environment] || 'white' : 'gray';
  const envLabel = deployment.environment.toUpperCase();

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      flexGrow={1}
      paddingX={1}
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color={ENV_COLORS[deployment.environment]}>
          {envLabel}
        </Text>
        {isLoading && (
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
        )}
      </Box>

      {/* Cluster Info */}
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text dimColor>Cluster: </Text>
          <Text>{deployment.fargate?.clusterName || 'N/A'}</Text>
        </Text>
        <Text>
          <Text dimColor>Service: </Text>
          <Text>{deployment.fargate?.serviceName?.slice(0, 30) || 'N/A'}...</Text>
        </Text>
      </Box>

      {/* ECS Service Status */}
      {status?.service && (
        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text dimColor>Status: </Text>
            <Text color={status.service.status === 'ACTIVE' ? 'green' : 'yellow'}>
              {status.service.status}
            </Text>
          </Text>
          <Text>
            <Text dimColor>Tasks: </Text>
            <Text color={status.service.runningCount === status.service.desiredCount ? 'green' : 'yellow'}>
              {status.service.runningCount}/{status.service.desiredCount} running
            </Text>
          </Text>
        </Box>
      )}

      {/* Running Tasks Detail */}
      {status?.tasks && status.tasks.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Task Details:</Text>
          {status.tasks.map(task => (
            <Box key={task.taskId} paddingLeft={1}>
              <Text>
                <Text color={task.lastStatus === 'RUNNING' ? 'green' : 'yellow'}>
                  {task.lastStatus === 'RUNNING' ? '\u25CF' : '\u25CB'}
                </Text>
                {' '}
                <Text>{task.taskId.slice(0, 8)}</Text>
                <Text dimColor> {task.lastStatus} </Text>
                <Text dimColor>({task.cpu}cpu/{task.memory}MB)</Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Health Status */}
      <Box marginTop={1}>
        <Text>
          <Text dimColor>Health: </Text>
          {status?.health ? (
            <Text color={status.health.status === 'healthy' ? 'green' : 'red'}>
              {status.health.status}
              {status.health.responseTime && ` (${Math.round(status.health.responseTime)}ms)`}
            </Text>
          ) : (
            <Text color="gray">checking...</Text>
          )}
        </Text>
      </Box>

      {/* RDS Status */}
      {status?.rds && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>RDS Database:</Text>
          <Box paddingLeft={1}>
            <Text>
              <Text color={status.rds.status === 'available' ? 'green' : 'yellow'}>
                {status.rds.status === 'available' ? '\u25CF' : '\u25CB'}
              </Text>
              {' '}
              <Text>{status.rds.status}</Text>
              <Text dimColor> ({status.rds.engine})</Text>
            </Text>
          </Box>
        </Box>
      )}

      {/* Endpoints */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Endpoints:</Text>
        <Box paddingLeft={1} flexDirection="column">
          {deployment.endpoints.api && (
            <Text>
              <Text dimColor>API: </Text>
              <Text>{deployment.endpoints.api}</Text>
            </Text>
          )}
          {deployment.endpoints.health && (
            <Text>
              <Text dimColor>Health: </Text>
              <Text>{deployment.endpoints.health}</Text>
            </Text>
          )}
        </Box>
      </Box>

      {/* Last Updated */}
      {status?.lastUpdated && (
        <Box marginTop={1}>
          <Text dimColor>
            Updated: {status.lastUpdated.toLocaleTimeString()}
          </Text>
        </Box>
      )}

      {/* Error */}
      {status?.error && (
        <Box marginTop={1}>
          <Text color="red">{status.error}</Text>
        </Box>
      )}
    </Box>
  );
}

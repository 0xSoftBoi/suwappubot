import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { EnvironmentStatus, DeploymentConfig } from '../types/deployment';

interface ServicePanelProps {
  deployment: DeploymentConfig;
  status: EnvironmentStatus | null;
  isActive: boolean;
  isLoading: boolean;
}

export function ServicePanel({ deployment, status, isActive, isLoading }: ServicePanelProps) {
  const borderColor = isActive ? 'cyan' : 'gray';

  // Health status indicator
  const getHealthColor = () => {
    if (!status?.health) return 'gray';
    switch (status.health.status) {
      case 'healthy': return 'green';
      case 'unhealthy': return 'red';
      case 'unreachable': return 'red';
      default: return 'yellow';
    }
  };

  const getHealthIcon = () => {
    if (!status?.health) return '?';
    switch (status.health.status) {
      case 'healthy': return '●';
      case 'unhealthy': return '○';
      case 'unreachable': return '✗';
      default: return '?';
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
      width="100%"
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold color={isActive ? 'cyan' : 'white'}>
          {deployment.environment.toUpperCase()}
        </Text>
        <Box>
          {isLoading && <Text color="yellow"><Spinner type="dots" /> </Text>}
          <Text color={getHealthColor()}>{getHealthIcon()}</Text>
        </Box>
      </Box>

      {/* ECS Service Status */}
      {status?.service && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>ECS Service:</Text>
          <Text>
            {' '}<Text color={status.service.status === 'ACTIVE' ? 'green' : 'yellow'}>
              {status.service.status}
            </Text>
            {' '}<Text color={status.service.runningCount === status.service.desiredCount ? 'green' : 'yellow'}>
              ({status.service.runningCount}/{status.service.desiredCount} tasks)
            </Text>
          </Text>
        </Box>
      )}

      {/* Running Tasks */}
      {status?.tasks && status.tasks.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Tasks:</Text>
          {status.tasks.map((task) => (
            <Box key={task.taskId} marginLeft={1}>
              <Text>
                {task.taskId.substring(0, 8)}:{' '}
                <Text color={task.lastStatus === 'RUNNING' ? 'green' : 'yellow'}>
                  {task.lastStatus}
                </Text>
                {' '}
                <Text dimColor>({task.cpu}cpu/{task.memory}MB)</Text>
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* RDS Status */}
      {status?.rds && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>RDS:</Text>
          <Text>
            {' '}<Text color={status.rds.status === 'available' ? 'green' : 'yellow'}>
              {status.rds.status}
            </Text>
            {' '}<Text dimColor>({status.rds.engine})</Text>
          </Text>
        </Box>
      )}

      {/* Health Check */}
      {status?.health && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Health:</Text>
          <Text>
            {' '}<Text color={getHealthColor()}>{status.health.status}</Text>
            {status.health.responseTime !== null ? (
              <Text dimColor> ({Math.round(status.health.responseTime)}ms)</Text>
            ) : !deployment.endpoints.health ? (
              <Text dimColor> (no ALB)</Text>
            ) : null}
          </Text>
        </Box>
      )}

      {/* Last Updated */}
      {status?.lastUpdated && (
        <Box marginTop={1}>
          <Text dimColor>
            Updated: {status.lastUpdated.toLocaleTimeString()}
          </Text>
        </Box>
      )}
    </Box>
  );
}

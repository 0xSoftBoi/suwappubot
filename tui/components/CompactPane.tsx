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

export function CompactPane({ deployment, status, isActive, isLoading }: CompactPaneProps) {
  const envColor = ENV_COLORS[deployment.environment] || 'white';
  const borderColor = isActive ? envColor : 'gray';
  const isEc2 = deployment.provider === 'ec2';

  const healthIcon = status?.health?.status === 'healthy' ? '\u25CF' :
                     status?.health?.status === 'unhealthy' ? '\u25CB' :
                     status?.health?.status === 'unreachable' ? '\u2717' : '\u25CC';
  const healthColor = status?.health?.status === 'healthy' ? 'green' :
                      status?.health?.status === 'unhealthy' ? 'yellow' :
                      status?.health?.status === 'unreachable' ? 'red' : 'gray';

  const responseTime = status?.health?.responseTime
    ? `${Math.round(status.health.responseTime)}ms`
    : '--';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={borderColor} flexGrow={1} paddingX={1}>
      {/* Line 1: Env + provider + health */}
      <Box justifyContent="space-between">
        <Box>
          <Text bold color={envColor}>{deployment.environment.toUpperCase().slice(0, 4)}</Text>
          <Text dimColor> {isEc2 ? 'EC2' : 'ECS'}</Text>
          {isLoading && <Text color="cyan"> <Spinner type="dots" /></Text>}
        </Box>
        <Box>
          <Text color={healthColor}>{healthIcon}</Text>
          <Text dimColor> {responseTime}</Text>
        </Box>
      </Box>

      {/* Line 2: Service status */}
      {isEc2 && status?.ec2 ? (
        <Box justifyContent="space-between">
          <Text color={status.ec2.systemdActive === 'active' ? 'green' : 'red'}>
            {status.ec2.systemdActive}/{status.ec2.systemdSub}
          </Text>
          {status.ec2.uptime && <Text dimColor>up {status.ec2.uptime}</Text>}
        </Box>
      ) : !isEc2 && status?.service ? (
        <Box justifyContent="space-between">
          <Text color={status.service.status === 'ACTIVE' ? 'cyan' : 'yellow'}>{status.service.status.slice(0, 6)}</Text>
          <Box><Text color="green">{status.service.runningCount}/{status.service.desiredCount}</Text><Text dimColor> tasks</Text></Box>
        </Box>
      ) : (
        <Text dimColor>connecting...</Text>
      )}

      {/* Line 3: Git info (EC2) or health endpoint */}
      {isEc2 && status?.ec2?.gitBranch ? (
        <Box justifyContent="space-between">
          <Text dimColor>{status.ec2.gitBranch}@{status.ec2.gitCommit}</Text>
          {status.ec2.memoryUsage && <Text dimColor>{status.ec2.memoryUsage}</Text>}
        </Box>
      ) : deployment.endpoints.health ? (
        <Text dimColor>{deployment.endpoints.health.replace(/^https?:\/\//, '').slice(0, 35)}</Text>
      ) : null}

      {/* Line 4: Bot/DB from health check */}
      {status?.health?.bot && (
        <Box justifyContent="space-between">
          <Box><Text dimColor>bot:</Text><Text color={status.health.bot === 'polling' ? 'green' : 'yellow'}> {status.health.bot}</Text></Box>
          {status.health.database && (
            <Box><Text dimColor>db:</Text><Text color={status.health.database === 'connected' ? 'green' : 'yellow'}> {status.health.database}</Text></Box>
          )}
        </Box>
      )}

      {status?.rds && (
        <Box justifyContent="space-between">
          <Text dimColor>RDS:</Text>
          <Text color={status.rds.status === 'available' ? 'green' : 'yellow'}>{status.rds.status}</Text>
        </Box>
      )}
    </Box>
  );
}

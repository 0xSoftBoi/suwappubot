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

export function EnvironmentPane({ deployment, status, isActive, isLoading }: EnvironmentPaneProps) {
  const borderColor = isActive ? ENV_COLORS[deployment.environment] || 'white' : 'gray';
  const isEc2 = deployment.provider === 'ec2';

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={borderColor} flexGrow={1} paddingX={1}>
      <Box justifyContent="space-between">
        <Box>
          <Text bold color={ENV_COLORS[deployment.environment]}>{deployment.environment.toUpperCase()}</Text>
          <Text dimColor> ({isEc2 ? 'EC2' : 'ECS Fargate'})</Text>
        </Box>
        {isLoading && <Text color="cyan"><Spinner type="dots" /></Text>}
      </Box>

      {/* Infrastructure */}
      <Box marginTop={1} flexDirection="column">
        {isEc2 && deployment.ec2 ? (
          <>
            <Text><Text dimColor>Host:    </Text><Text>{deployment.ec2.host}</Text></Text>
            <Text><Text dimColor>Service: </Text><Text>{deployment.ec2.serviceName}</Text></Text>
          </>
        ) : deployment.fargate ? (
          <>
            <Text><Text dimColor>Cluster: </Text><Text>{deployment.fargate.clusterName}</Text></Text>
            <Text><Text dimColor>Service: </Text><Text>{deployment.fargate.serviceName.slice(0, 40)}</Text></Text>
          </>
        ) : null}
      </Box>

      {/* EC2 systemd status */}
      {isEc2 && status?.ec2 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Systemd:</Text>
          <Box paddingLeft={1} flexDirection="column">
            <Text><Text dimColor>State:  </Text><Text color={status.ec2.systemdActive === 'active' ? 'green' : 'red'}>{status.ec2.systemdActive} ({status.ec2.systemdSub})</Text></Text>
            {status.ec2.pid && <Text><Text dimColor>PID:    </Text><Text>{status.ec2.pid}</Text></Text>}
            {status.ec2.uptime && <Text><Text dimColor>Uptime: </Text><Text color="cyan">{status.ec2.uptime}</Text></Text>}
            {status.ec2.memoryUsage && <Text><Text dimColor>Memory: </Text><Text>{status.ec2.memoryUsage}</Text>{status.ec2.cpuUsage && <Text dimColor> | CPU: {status.ec2.cpuUsage}</Text>}</Text>}
          </Box>
        </Box>
      )}

      {/* EC2 git */}
      {isEc2 && status?.ec2?.gitBranch && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Git:</Text>
          <Box paddingLeft={1} flexDirection="column">
            <Text><Text dimColor>Branch: </Text><Text color="cyan">{status.ec2.gitBranch}</Text></Text>
            <Text><Text dimColor>Commit: </Text><Text>{status.ec2.gitCommit}</Text></Text>
          </Box>
        </Box>
      )}

      {/* ECS status (legacy) */}
      {!isEc2 && status?.service && (
        <Box marginTop={1} flexDirection="column">
          <Text><Text dimColor>Status: </Text><Text color={status.service.status === 'ACTIVE' ? 'green' : 'yellow'}>{status.service.status}</Text></Text>
          <Text><Text dimColor>Tasks:  </Text><Text color={status.service.runningCount === status.service.desiredCount ? 'green' : 'yellow'}>{status.service.runningCount}/{status.service.desiredCount} running</Text></Text>
        </Box>
      )}

      {/* Health */}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Health:</Text>
        <Box paddingLeft={1} flexDirection="column">
          {status?.health ? (
            <>
              <Text><Text dimColor>Status: </Text><Text color={status.health.status === 'healthy' ? 'green' : 'red'}>{status.health.status}{status.health.responseTime && ` (${Math.round(status.health.responseTime)}ms)`}</Text></Text>
              {status.health.bot && <Text><Text dimColor>Bot:    </Text><Text color={status.health.bot === 'polling' ? 'green' : 'yellow'}>{status.health.bot}</Text></Text>}
              {status.health.database && <Text><Text dimColor>DB:     </Text><Text color={status.health.database === 'connected' ? 'green' : 'yellow'}>{status.health.database}</Text></Text>}
              {status.health.version && <Text><Text dimColor>Ver:    </Text><Text color="cyan">v{status.health.version}</Text></Text>}
            </>
          ) : (
            <Text color="gray">checking...</Text>
          )}
        </Box>
      </Box>

      {status?.rds && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>RDS:</Text>
          <Box paddingLeft={1}>
            <Text color={status.rds.status === 'available' ? 'green' : 'yellow'}>{status.rds.status}</Text>
            <Text dimColor> ({status.rds.engine})</Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Endpoints:</Text>
        <Box paddingLeft={1} flexDirection="column">
          {deployment.endpoints.api && <Text><Text dimColor>API:    </Text><Text>{deployment.endpoints.api}</Text></Text>}
          {deployment.endpoints.health && <Text><Text dimColor>Health: </Text><Text>{deployment.endpoints.health}</Text></Text>}
        </Box>
      </Box>

      {status?.lastUpdated && <Box marginTop={1}><Text dimColor>Updated: {status.lastUpdated.toLocaleTimeString()}</Text></Box>}
      {status?.error && <Box marginTop={1}><Text color="red">{status.error}</Text></Box>}
    </Box>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import type { DeploymentConfig, EnvironmentStatus, HealthCheckResult } from '../types/deployment';
import { getEc2ServiceStatus } from '../services/ec2';
import { getRdsStatus } from '../services/aws';

interface UseEc2StatusOptions {
  refreshInterval?: number;
  enabled?: boolean;
}

export function useEc2Status(
  deployment: DeploymentConfig | null,
  options: UseEc2StatusOptions = {}
) {
  const { refreshInterval = 15000, enabled = true } = options;
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!deployment || !enabled || !deployment.ec2) return;

    setIsLoading(true);

    const { host, user, sshKeyPath, serviceName, appDir } = deployment.ec2;
    const region = deployment.region;
    const profile = deployment.awsProfile;

    try {
      // Get EC2 systemd status via SSH
      const ec2Status = await getEc2ServiceStatus(host, user, sshKeyPath, serviceName, appDir);

      // Get RDS status if configured
      let rds = null;
      if (deployment.rds) {
        rds = await getRdsStatus(deployment.rds.instanceId, region, profile);
      }

      // Check health endpoint
      let health: HealthCheckResult = {
        status: 'unknown',
        responseTime: null,
        lastCheck: null,
      };

      if (deployment.endpoints.health) {
        try {
          const start = performance.now();
          const response = await fetch(deployment.endpoints.health, {
            signal: AbortSignal.timeout(5000),
          });
          const responseTime = performance.now() - start;

          let version: string | undefined;
          let service: string | undefined;
          let bot: string | undefined;
          let database: string | undefined;
          try {
            const body = await response.json();
            version = body.version;
            service = body.service;
            bot = body.bot;
            database = body.database;
          } catch { /* not JSON */ }

          health = {
            status: response.ok ? 'healthy' : 'unhealthy',
            responseTime,
            lastCheck: new Date(),
            statusCode: response.status,
            version,
            service,
            bot,
            database,
          };
        } catch {
          health = {
            status: 'unreachable',
            responseTime: null,
            lastCheck: new Date(),
          };
        }
      } else if (ec2Status) {
        // Derive health from systemd status
        health = {
          status: ec2Status.systemdActive === 'active' ? 'healthy' : 'unhealthy',
          responseTime: null,
          lastCheck: new Date(),
        };
      }

      setStatus({
        service: null,
        tasks: [],
        ec2: ec2Status,
        rds,
        health,
        lastUpdated: new Date(),
        isLoading: false,
        error: null,
      });
    } catch (error) {
      setStatus(prev => ({
        ...(prev || {
          service: null,
          tasks: [],
          ec2: null,
          rds: null,
          health: { status: 'unknown' as const, responseTime: null, lastCheck: null },
          lastUpdated: new Date(),
          isLoading: false,
        }),
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    } finally {
      setIsLoading(false);
    }
  }, [deployment, enabled]);

  useEffect(() => {
    if (!enabled || !deployment) return;

    refresh();

    intervalRef.current = setInterval(refresh, refreshInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refresh, refreshInterval, enabled, deployment]);

  return { status, isLoading, refresh };
}

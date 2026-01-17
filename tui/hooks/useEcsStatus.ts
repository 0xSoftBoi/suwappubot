import { useState, useEffect, useCallback, useRef } from 'react';
import type { DeploymentConfig, EnvironmentStatus, HealthCheckResult } from '../types/deployment';
import { getEcsService, getEcsTasks, getRdsStatus, getTargetGroupHealth } from '../services/aws';

interface UseEcsStatusOptions {
  refreshInterval?: number;
  enabled?: boolean;
}

export function useEcsStatus(
  deployment: DeploymentConfig | null,
  options: UseEcsStatusOptions = {}
) {
  const { refreshInterval = 15000, enabled = true } = options;
  const [status, setStatus] = useState<EnvironmentStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!deployment || !enabled || !deployment.fargate) {
      return;
    }

    setIsLoading(true);

    const { clusterName, serviceName, targetGroupArn } = deployment.fargate;
    const region = deployment.region;
    const profile = deployment.awsProfile;

    try {
      // Get ECS service status
      const service = await getEcsService(clusterName, serviceName, region, profile);

      // Get running tasks
      const tasks = await getEcsTasks(clusterName, serviceName, region, profile);

      // Get RDS status if configured
      let rds = null;
      if (deployment.rds) {
        rds = await getRdsStatus(deployment.rds.instanceId, region, profile);
      }

      // Check health endpoint (skip if no endpoint configured)
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

          health = {
            status: response.ok ? 'healthy' : 'unhealthy',
            responseTime,
            lastCheck: new Date(),
            statusCode: response.status,
          };
        } catch {
          health = {
            status: 'unreachable',
            responseTime: null,
            lastCheck: new Date(),
          };
        }
      } else {
        // No endpoint configured - derive health from ECS task status
        const hasHealthyTasks = tasks.some(t => t.lastStatus === 'RUNNING');
        health = {
          status: hasHealthyTasks ? 'healthy' : 'unknown',
          responseTime: null,
          lastCheck: new Date(),
        };
      }

      setStatus({
        service,
        tasks,
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
          rds: null,
          health: { status: 'unknown', responseTime: null, lastCheck: null },
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

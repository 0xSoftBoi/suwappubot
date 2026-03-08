import { useState, useEffect, useCallback, useRef } from 'react';
import type { DeploymentConfig } from '../types/deployment';
import { getAlbMetrics } from '../services/aws';

interface AlbMetrics {
  requestCount: number;
  errorRate: number;
  avgLatency: number;
}

interface UseAlbStatusOptions {
  refreshInterval?: number;
  enabled?: boolean;
}

export function useAlbStatus(
  deployment: DeploymentConfig | null,
  options: UseAlbStatusOptions = {}
) {
  const { refreshInterval = 30000, enabled = true } = options;
  const [metrics, setMetrics] = useState<AlbMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!deployment || !enabled || !deployment.alb) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const { loadBalancerArn } = deployment.alb;
    const region = deployment.region;
    const profile = deployment.awsProfile;

    try {
      const albMetrics = await getAlbMetrics(loadBalancerArn, region, profile);
      setMetrics(albMetrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch ALB data');
    } finally {
      setIsLoading(false);
    }
  }, [deployment, enabled]);

  useEffect(() => {
    if (!enabled || !deployment?.alb) return;

    refresh();

    intervalRef.current = setInterval(refresh, refreshInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refresh, refreshInterval, enabled, deployment]);

  return { metrics, isLoading, error, refresh };
}

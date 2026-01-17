import { useState, useEffect, useRef, useCallback } from 'react';
import type { DeploymentConfig, CloudWatchLogEvent } from '../types/deployment';
import { getCloudWatchLogs, streamCloudWatchLogs } from '../services/aws';

interface UseLogsOptions {
  maxLines?: number;
  enabled?: boolean;
  streaming?: boolean;
}

export function useLogs(
  deployment: DeploymentConfig | null,
  options: UseLogsOptions = {}
) {
  const { maxLines = 100, enabled = true, streaming = true } = options;
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<{ stop: () => void } | null>(null);

  const addLog = useCallback((line: string) => {
    setLogs(prev => {
      const next = [...prev, line];
      if (next.length > maxLines) {
        return next.slice(-maxLines);
      }
      return next;
    });
  }, [maxLines]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Initial fetch of recent logs
  const fetchLogs = useCallback(async () => {
    if (!deployment || !enabled || !deployment.fargate) return;

    setIsLoading(true);
    setError(null);

    try {
      const { logGroup, logStreamPrefix } = deployment.fargate;
      const events = await getCloudWatchLogs(
        logGroup,
        logStreamPrefix,
        50,
        deployment.region,
        deployment.awsProfile
      );

      const lines = events.map(e => {
        const date = new Date(e.timestamp);
        const time = date.toLocaleTimeString();
        return `[${time}] ${e.message}`;
      });

      setLogs(lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setIsLoading(false);
    }
  }, [deployment, enabled]);

  // Start streaming logs
  useEffect(() => {
    if (!deployment || !enabled || !streaming || !deployment.fargate) return;

    // Fetch initial logs first
    fetchLogs();

    // Then start streaming
    const { logGroup } = deployment.fargate;
    streamRef.current = streamCloudWatchLogs(
      logGroup,
      deployment.region,
      deployment.awsProfile,
      (line) => {
        addLog(line);
      },
      (err) => {
        setError(err.message);
      }
    );

    return () => {
      if (streamRef.current) {
        streamRef.current.stop();
        streamRef.current = null;
      }
    };
  }, [deployment, enabled, streaming, fetchLogs, addLog]);

  return { logs, isLoading, error, clearLogs, refresh: fetchLogs };
}

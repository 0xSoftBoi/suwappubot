import { useState, useEffect, useRef, useCallback } from 'react';
import type { DeploymentConfig } from '../types/deployment';
import { getCloudWatchLogs, streamCloudWatchLogs } from '../services/aws';
import { getEc2Logs, streamEc2Logs } from '../services/ec2';

// Noise patterns to filter out — these drown real debug info
const NOISE_PATTERNS = [
  /getUpdates.*200 OK/,           // Telegram polling (every 10s)
  /PTBUserWarning/,               // python-telegram-bot warnings on startup
  /HTTP Request: POST.*getUpdates/, // httpx getUpdates
];

function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some(p => p.test(line));
}

interface UseLogsOptions {
  maxLines?: number;
  enabled?: boolean;
  streaming?: boolean;
}

export function useLogs(
  deployment: DeploymentConfig | null,
  options: UseLogsOptions = {}
) {
  const { maxLines = 200, enabled = true, streaming = true } = options;
  const [logs, setLogs] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<{ stop: () => void } | null>(null);

  const addLog = useCallback((line: string) => {
    if (isNoise(line)) return; // Drop noise lines
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

  const fetchLogs = useCallback(async () => {
    if (!deployment || !enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      if (deployment.provider === 'ec2' && deployment.ec2) {
        const { host, user, sshKeyPath, serviceName } = deployment.ec2;
        const lines = await getEc2Logs(host, user, sshKeyPath, serviceName, 100);
        setLogs(lines.filter(l => !isNoise(l)));
      } else if (deployment.fargate) {
        const { logGroup, logStreamPrefix } = deployment.fargate;
        const events = await getCloudWatchLogs(
          logGroup, logStreamPrefix, 50,
          deployment.region, deployment.awsProfile
        );
        const lines = events
          .map(e => {
            const date = new Date(e.timestamp);
            const time = date.toLocaleTimeString();
            return `[${time}] ${e.message}`;
          })
          .filter(l => !isNoise(l));
        setLogs(lines);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setIsLoading(false);
    }
  }, [deployment, enabled]);

  useEffect(() => {
    if (!deployment || !enabled || !streaming) return;

    fetchLogs();

    if (deployment.provider === 'ec2' && deployment.ec2) {
      const { host, user, sshKeyPath, serviceName } = deployment.ec2;
      streamRef.current = streamEc2Logs(
        host, user, sshKeyPath, serviceName,
        (line) => addLog(line),
        (err) => setError(err.message)
      );
    } else if (deployment.fargate) {
      const { logGroup } = deployment.fargate;
      streamRef.current = streamCloudWatchLogs(
        logGroup, deployment.region, deployment.awsProfile,
        (line) => addLog(line),
        (err) => setError(err.message)
      );
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.stop();
        streamRef.current = null;
      }
    };
  }, [deployment, enabled, streaming, fetchLogs, addLog]);

  return { logs, isLoading, error, clearLogs, refresh: fetchLogs };
}

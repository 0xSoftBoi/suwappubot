import type { EcsServiceStatus, EcsTask, RdsStatus, CloudWatchLogEvent } from '../types/deployment';

// Helper to run AWS CLI commands
async function runAwsCommand(args: string[], profile?: string): Promise<{ stdout: string; exitCode: number }> {
  const fullArgs = ['aws', ...args];
  if (profile) {
    fullArgs.push('--profile', profile);
  }
  fullArgs.push('--output', 'json');

  const proc = Bun.spawn(fullArgs, {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  return { stdout, exitCode };
}

// ============================================================================
// ECS Functions
// ============================================================================

export async function getEcsService(
  cluster: string,
  serviceName: string,
  region: string,
  profile?: string
): Promise<EcsServiceStatus | null> {
  const { stdout, exitCode } = await runAwsCommand([
    'ecs', 'describe-services',
    '--region', region,
    '--cluster', cluster,
    '--services', serviceName,
    '--query', 'services[0]',
  ], profile);

  if (exitCode !== 0 || !stdout.trim() || stdout.trim() === 'null') {
    return null;
  }

  try {
    const data = JSON.parse(stdout);
    return {
      serviceName: data.serviceName,
      status: data.status,
      desiredCount: data.desiredCount,
      runningCount: data.runningCount,
      pendingCount: data.pendingCount,
      taskDefinition: data.taskDefinition,
    };
  } catch {
    return null;
  }
}

export async function getEcsTasks(
  cluster: string,
  serviceName: string,
  region: string,
  profile?: string
): Promise<EcsTask[]> {
  // List task ARNs
  const listResult = await runAwsCommand([
    'ecs', 'list-tasks',
    '--region', region,
    '--cluster', cluster,
    '--service-name', serviceName,
    '--query', 'taskArns',
  ], profile);

  if (listResult.exitCode !== 0) {
    return [];
  }

  const taskArns = JSON.parse(listResult.stdout);
  if (!taskArns || taskArns.length === 0) {
    return [];
  }

  // Describe tasks
  const descArgs = [
    'ecs', 'describe-tasks',
    '--region', region,
    '--cluster', cluster,
    '--tasks', ...taskArns,
    '--query', 'tasks',
  ];

  const descResult = await runAwsCommand(descArgs, profile);
  if (descResult.exitCode !== 0) {
    return [];
  }

  try {
    const tasks = JSON.parse(descResult.stdout);
    return tasks.map((t: Record<string, unknown>) => ({
      taskArn: t.taskArn as string,
      taskId: (t.taskArn as string).split('/').pop() || '',
      lastStatus: t.lastStatus as string,
      desiredStatus: t.desiredStatus as string,
      healthStatus: (t.healthStatus as string) || 'UNKNOWN',
      cpu: t.cpu as string,
      memory: t.memory as string,
      createdAt: t.createdAt as string,
      startedAt: (t.startedAt as string) || null,
    }));
  } catch {
    return [];
  }
}

export async function forceNewDeployment(
  cluster: string,
  serviceName: string,
  region: string,
  profile?: string
): Promise<boolean> {
  const args = [
    'ecs', 'update-service',
    '--region', region,
    '--cluster', cluster,
    '--service', serviceName,
    '--force-new-deployment',
    '--query', 'service.status',
  ];

  // Remove --output json since we want text
  const fullArgs = ['aws', ...args];
  if (profile) {
    fullArgs.push('--profile', profile);
  }
  fullArgs.push('--output', 'text');

  const proc = Bun.spawn(fullArgs, {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  return exitCode === 0 && stdout.trim() === 'ACTIVE';
}

// ============================================================================
// RDS Functions
// ============================================================================

export async function getRdsStatus(
  instanceId: string,
  region: string,
  profile?: string
): Promise<RdsStatus | null> {
  const { stdout, exitCode } = await runAwsCommand([
    'rds', 'describe-db-instances',
    '--region', region,
    '--db-instance-identifier', instanceId,
    '--query', 'DBInstances[0]',
  ], profile);

  if (exitCode !== 0 || !stdout.trim() || stdout.trim() === 'null') {
    return null;
  }

  try {
    const data = JSON.parse(stdout);
    return {
      instanceId: data.DBInstanceIdentifier,
      status: data.DBInstanceStatus,
      engine: `${data.Engine} ${data.EngineVersion}`,
      endpoint: data.Endpoint?.Address || 'N/A',
      multiAz: data.MultiAZ,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// CloudWatch Logs Functions
// ============================================================================

export async function getCloudWatchLogs(
  logGroup: string,
  logStreamPrefix: string,
  limit: number,
  region: string,
  profile?: string
): Promise<CloudWatchLogEvent[]> {
  // Get latest log stream
  const streamsArgs = [
    'logs', 'describe-log-streams',
    '--region', region,
    '--log-group-name', logGroup,
    '--log-stream-name-prefix', logStreamPrefix,
    '--order-by', 'LastEventTime',
    '--descending',
    '--limit', '1',
    '--query', 'logStreams[0].logStreamName',
  ];

  const fullArgs = ['aws', ...streamsArgs];
  if (profile) {
    fullArgs.push('--profile', profile);
  }
  fullArgs.push('--output', 'text');

  const streamsProc = Bun.spawn(fullArgs, {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const streamName = (await new Response(streamsProc.stdout).text()).trim();
  const streamsExitCode = await streamsProc.exited;

  if (streamsExitCode !== 0 || !streamName || streamName === 'None') {
    return [];
  }

  // Get log events
  const { stdout, exitCode } = await runAwsCommand([
    'logs', 'get-log-events',
    '--region', region,
    '--log-group-name', logGroup,
    '--log-stream-name', streamName,
    '--limit', String(limit),
    '--query', 'events',
  ], profile);

  if (exitCode !== 0) {
    return [];
  }

  try {
    const events = JSON.parse(stdout);
    return events.map((e: Record<string, unknown>) => ({
      timestamp: e.timestamp as number,
      message: e.message as string,
      ingestionTime: e.ingestionTime as number,
    }));
  } catch {
    return [];
  }
}

export interface StreamLogsResult {
  stop: () => void;
}

export function streamCloudWatchLogs(
  logGroup: string,
  region: string,
  profile: string | undefined,
  onData: (line: string) => void,
  onError?: (error: Error) => void
): StreamLogsResult {
  let stopped = false;
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  const startStream = async () => {
    const args = [
      'aws', 'logs', 'tail',
      '--region', region,
      logGroup,
      '--follow',
      '--format', 'short',
    ];
    if (profile) {
      args.push('--profile', profile);
    }

    proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (!proc.stdout || typeof proc.stdout === 'number') {
      throw new Error('Failed to open stdout pipe');
    }

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            onData(line);
          }
        }
      }
    } catch (error) {
      if (!stopped && onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };

  startStream();

  return {
    stop: () => {
      stopped = true;
      if (proc) {
        proc.kill();
      }
    },
  };
}

// ============================================================================
// Target Group Health
// ============================================================================

export interface TargetHealth {
  targetId: string;
  healthState: string;
  description: string | null;
}

export async function getTargetGroupHealth(
  targetGroupArn: string,
  region: string,
  profile?: string
): Promise<TargetHealth[]> {
  const { stdout, exitCode } = await runAwsCommand([
    'elbv2', 'describe-target-health',
    '--region', region,
    '--target-group-arn', targetGroupArn,
    '--query', 'TargetHealthDescriptions',
  ], profile);

  if (exitCode !== 0) {
    return [];
  }

  try {
    const data = JSON.parse(stdout);
    return data.map((t: Record<string, unknown>) => ({
      targetId: (t.Target as Record<string, string>)?.Id,
      healthState: (t.TargetHealth as Record<string, string>)?.State,
      description: (t.TargetHealth as Record<string, string>)?.Description || null,
    }));
  } catch {
    return [];
  }
}

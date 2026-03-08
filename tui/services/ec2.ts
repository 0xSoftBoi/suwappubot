import { homedir } from 'node:os';
import type { Ec2ServiceStatus } from '../types/deployment';

function expandHome(path: string): string {
  if (path.startsWith('~/')) {
    return path.replace('~', homedir());
  }
  return path;
}

// SSH command helper
async function runSshCommand(
  host: string,
  user: string,
  keyPath: string,
  command: string
): Promise<{ stdout: string; exitCode: number }> {
  const resolvedKey = expandHome(keyPath);
  const args = [
    'ssh',
    '-T',
    '-i', resolvedKey,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=5',
    '-o', 'LogLevel=ERROR',
    `${user}@${host}`,
    command,
  ];

  const proc = Bun.spawn(args, {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), exitCode };
}

// Get systemd service status
export async function getEc2ServiceStatus(
  host: string,
  user: string,
  keyPath: string,
  serviceName: string,
  appDir: string
): Promise<Ec2ServiceStatus | null> {
  try {
    // Run a single SSH command that gathers everything
    const script = [
      `ACTIVE=$(systemctl is-active ${serviceName} 2>/dev/null || echo unknown)`,
      `SUB=$(systemctl show ${serviceName} --property=SubState --value 2>/dev/null || echo unknown)`,
      `PID=$(systemctl show ${serviceName} --property=MainPID --value 2>/dev/null || echo 0)`,
      `MEM=$(systemctl show ${serviceName} --property=MemoryCurrent --value 2>/dev/null || echo 0)`,
      // Get uptime from ActiveEnterTimestamp
      `SINCE=$(systemctl show ${serviceName} --property=ActiveEnterTimestamp --value 2>/dev/null || echo "")`,
      // Git info
      `cd ${appDir} 2>/dev/null`,
      `BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)`,
      `COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)`,
      // CPU from ps
      `CPU=""`,
      `if [ "$PID" != "0" ] && [ -n "$PID" ]; then CPU=$(ps -p "$PID" -o %cpu= 2>/dev/null || echo ""); fi`,
      // Output as parseable lines
      `echo "ACTIVE=$ACTIVE"`,
      `echo "SUB=$SUB"`,
      `echo "PID=$PID"`,
      `echo "MEM=$MEM"`,
      `echo "SINCE=$SINCE"`,
      `echo "BRANCH=$BRANCH"`,
      `echo "COMMIT=$COMMIT"`,
      `echo "CPU=$CPU"`,
    ].join('; ');

    const { stdout, exitCode } = await runSshCommand(host, user, keyPath, script);
    if (exitCode !== 0 && !stdout) return null;

    // Parse output
    const vars: Record<string, string> = {};
    for (const line of stdout.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        vars[line.slice(0, eq)] = line.slice(eq + 1).trim();
      }
    }

    // Calculate uptime
    let uptime: string | null = null;
    if (vars.SINCE) {
      try {
        const since = new Date(vars.SINCE);
        const diff = Date.now() - since.getTime();
        if (diff > 0) {
          const hours = Math.floor(diff / 3600000);
          const mins = Math.floor((diff % 3600000) / 60000);
          uptime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        }
      } catch { /* ignore */ }
    }

    // Format memory
    let memoryUsage: string | null = null;
    const memBytes = parseInt(vars.MEM || '0');
    if (memBytes > 0) {
      const memMb = Math.round(memBytes / 1048576);
      memoryUsage = `${memMb}MB`;
    }

    const pid = parseInt(vars.PID || '0');

    return {
      systemdActive: vars.ACTIVE || 'unknown',
      systemdSub: vars.SUB || 'unknown',
      uptime,
      pid: pid > 0 ? pid : null,
      memoryUsage,
      cpuUsage: vars.CPU ? `${parseFloat(vars.CPU).toFixed(1)}%` : null,
      gitBranch: vars.BRANCH || null,
      gitCommit: vars.COMMIT || null,
    };
  } catch {
    return null;
  }
}

// Stream journalctl logs via SSH
export interface StreamLogsResult {
  stop: () => void;
}

export function streamEc2Logs(
  host: string,
  user: string,
  keyPath: string,
  serviceName: string,
  onData: (line: string) => void,
  onError?: (error: Error) => void
): StreamLogsResult {
  let stopped = false;
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  const startStream = async () => {
    const resolvedKey = expandHome(keyPath);
    const args = [
      'ssh',
      '-T',
      '-i', resolvedKey,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=5',
      '-o', 'LogLevel=ERROR',
      '-o', 'ServerAliveInterval=30',
      `${user}@${host}`,
      `journalctl -u ${serviceName} -f --no-pager -o short-iso -n 0`,
    ];

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

// Fetch recent logs (one-shot)
export async function getEc2Logs(
  host: string,
  user: string,
  keyPath: string,
  serviceName: string,
  lines: number = 50
): Promise<string[]> {
  const { stdout, exitCode } = await runSshCommand(
    host, user, keyPath,
    `journalctl -u ${serviceName} --no-pager -o short-iso -n ${lines}`
  );

  if (exitCode !== 0 && !stdout) return [];

  return stdout
    .split('\n')
    .filter(line => line.trim().length > 0);
}

// Deploy to EC2 (restart service)
export async function deployEc2(
  host: string,
  user: string,
  keyPath: string,
  appDir: string,
  branch: string,
  serviceName: string
): Promise<{ success: boolean; output: string }> {
  const script = [
    `cd ${appDir}`,
    'git fetch origin',
    `git reset --hard origin/${branch}`,
    './venv/bin/pip install -r requirements.txt -q 2>&1 | tail -3',
    'sudo bash scripts/pull-secrets.sh',
    `sudo cp suwappubot.service /etc/systemd/system/${serviceName}.service`,
    'sudo systemctl daemon-reload',
    `sudo systemctl restart ${serviceName}`,
    'sleep 5',
    `systemctl is-active ${serviceName}`,
  ].join(' && ');

  const { stdout, exitCode } = await runSshCommand(host, user, keyPath, script);

  return {
    success: exitCode === 0 && stdout.includes('active'),
    output: stdout,
  };
}

// Restart service only (no git pull)
export async function restartEc2Service(
  host: string,
  user: string,
  keyPath: string,
  serviceName: string
): Promise<boolean> {
  const { stdout, exitCode } = await runSshCommand(
    host, user, keyPath,
    `sudo systemctl restart ${serviceName} && sleep 3 && systemctl is-active ${serviceName}`
  );

  return exitCode === 0 && stdout.trim() === 'active';
}

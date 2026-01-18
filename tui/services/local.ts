/**
 * Local development services - process management and log streaming
 */

export interface ProcessInfo {
  pid: number | null;
  status: 'running' | 'stopped' | 'error';
  startTime: Date | null;
  command: string;
}

export interface LogLine {
  id: number;
  timestamp: Date;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  raw: string;
}

let logCounter = 0;
const logs: LogLine[] = [];
const MAX_LOGS = 500;
let currentProcess: ReturnType<typeof Bun.spawn> | null = null;
let onLogCallback: ((log: LogLine) => void) | null = null;

function parseLogLevel(line: string): LogLine['level'] {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('exception') || lower.includes('traceback')) {
    return 'error';
  }
  if (lower.includes('warning') || lower.includes('warn')) {
    return 'warn';
  }
  if (lower.includes('info') || lower.includes('startup') || lower.includes('started')) {
    return 'info';
  }
  return 'debug';
}

function parseLogLine(raw: string): LogLine {
  return {
    id: ++logCounter,
    timestamp: new Date(),
    level: parseLogLevel(raw),
    message: raw.slice(0, 200),
    raw,
  };
}

export function getLogs(): LogLine[] {
  return [...logs];
}

export function clearLogs(): void {
  logs.length = 0;
}

export function addLog(raw: string): void {
  const log = parseLogLine(raw);
  logs.push(log);
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }
  onLogCallback?.(log);
}

export function setLogCallback(cb: ((log: LogLine) => void) | null): void {
  onLogCallback = cb;
}

export function getProcessInfo(): ProcessInfo {
  if (!currentProcess) {
    return {
      pid: null,
      status: 'stopped',
      startTime: null,
      command: '',
    };
  }

  return {
    pid: currentProcess.pid,
    status: 'running',
    startTime: new Date(), // Would need to track this properly
    command: 'uvicorn api.main:app --reload',
  };
}

export async function startApiServer(projectRoot: string): Promise<boolean> {
  if (currentProcess) {
    addLog('[TUI] API server already running');
    return false;
  }

  try {
    addLog('[TUI] Starting API server...');

    const proc = Bun.spawn(
      ['uvicorn', 'api.main:app', '--host', '0.0.0.0', '--port', '8000', '--reload'],
      {
        cwd: projectRoot,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
        },
      }
    );

    currentProcess = proc;

    // Stream stdout
    if (proc.stdout) {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();

      (async () => {
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                addLog(line);
              }
            }
          }
        } catch {
          // Stream ended
        }
      })();
    }

    // Stream stderr
    if (proc.stderr) {
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();

      (async () => {
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                addLog(line);
              }
            }
          }
        } catch {
          // Stream ended
        }
      })();
    }

    // Monitor process exit
    proc.exited.then((code) => {
      addLog(`[TUI] API server exited with code ${code}`);
      currentProcess = null;
    });

    return true;
  } catch (error) {
    addLog(`[TUI] Failed to start API server: ${error}`);
    return false;
  }
}

export function stopApiServer(): void {
  if (currentProcess) {
    addLog('[TUI] Stopping API server...');
    currentProcess.kill();
    currentProcess = null;
  }
}

export function isServerRunning(): boolean {
  return currentProcess !== null;
}

// Watch a log file (alternative to spawning process)
export interface LogWatcher {
  stop: () => void;
}

export function watchLogFile(filePath: string): LogWatcher {
  let stopped = false;

  const watch = async () => {
    try {
      const file = Bun.file(filePath);
      let lastSize = 0;

      while (!stopped) {
        try {
          const stat = await file.exists();
          if (!stat) {
            await Bun.sleep(1000);
            continue;
          }

          const currentSize = file.size;
          if (currentSize > lastSize) {
            const content = await file.text();
            const newContent = content.slice(lastSize);
            const lines = newContent.split('\n');

            for (const line of lines) {
              if (line.trim()) {
                addLog(line);
              }
            }

            lastSize = currentSize;
          }

          await Bun.sleep(500);
        } catch {
          await Bun.sleep(1000);
        }
      }
    } catch {
      // File watching failed
    }
  };

  watch();

  return {
    stop: () => {
      stopped = true;
    },
  };
}

// Tail existing process output (e.g., docker logs)
export function tailDockerLogs(containerName: string): LogWatcher {
  let stopped = false;
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  const start = async () => {
    proc = Bun.spawn(['docker', 'logs', '-f', '--tail', '100', containerName], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    if (proc.stdout) {
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
              addLog(line);
            }
          }
        }
      } catch {
        // Stream ended
      }
    }
  };

  start();

  return {
    stop: () => {
      stopped = true;
      proc?.kill();
    },
  };
}

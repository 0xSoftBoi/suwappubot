import { spawn } from "child_process";
import { isAllowed } from "./whitelist.js";

export interface CommandResult {
  cmd: string;
  succ: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Execute a single elytro command and return a structured result.
 * Commands not present in the whitelist are rejected without execution.
 */
export function execCommand(cmd: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    if (!isAllowed(cmd)) {
      return resolve({
        cmd,
        succ: false,
        stdout: "",
        stderr: `Command not allowed: ${cmd}`,
      });
    }

    const parts = cmd.trim().split(/\s+/);
    const bin = parts[0]; // "elytro"
    const args = parts.slice(1);

    let stdout = "";
    let stderr = "";

    const proc = spawn(bin, args, { shell: false });
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code: number | null) => {
      resolve({ cmd, succ: code === 0, stdout, stderr });
    });
    proc.on("error", (err: Error) => {
      resolve({ cmd, succ: false, stdout: "", stderr: err.message });
    });
  });
}

/**
 * Execute multiple commands sequentially (order matters for simulate→send pairs).
 */
export async function execCommands(
  cmds: string[]
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const cmd of cmds) {
    results.push(await execCommand(cmd));
  }
  return results;
}

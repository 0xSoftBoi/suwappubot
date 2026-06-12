import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { VERSION } from '../version';
import { outputResult, outputError } from '../utils/display';
import ora from 'ora';
import chalk from 'chalk';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = '@elytro/cli';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

interface NpmPackageInfo {
  version: string;
  name: string;
}

/**
 * Fetch the latest published version from the npm registry.
 */
async function fetchLatestVersion(): Promise<string> {
  const res = await fetch(NPM_REGISTRY_URL);
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status}`);
  }
  const data = (await res.json()) as NpmPackageInfo;
  if (typeof data.version !== 'string' || !SEMVER_RE.test(data.version)) {
    throw new Error(`npm registry returned an invalid version: ${String(data.version)}`);
  }
  return data.version;
}

/**
 * Compare two semver strings.  Returns:
 *   -1  if a < b
 *    0  if a === b
 *    1  if a > b
 */
function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}

/**
 * Detect which package manager installed this CLI.
 *
 * Strategy:
 *   1. Resolve the real filesystem path of the running script (follows symlinks).
 *   2. Match against known global-install directory patterns for each manager.
 *   3. Fall back to `npm_config_user_agent` if the path is ambiguous.
 *   4. Default to 'npm' as the safest last resort.
 */
function detectPackageManager(): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  // Resolve the real path of the running script (follows symlinks)
  try {
    const scriptPath = realpathSync(fileURLToPath(import.meta.url));
    if (scriptPath.includes('/.bun/')) return 'bun';
    if (scriptPath.includes('/pnpm/') || scriptPath.includes('/pnpm-global/')) return 'pnpm';
    if (scriptPath.includes('/yarn/global/')) return 'yarn';
  } catch {
    // If path resolution fails, fall through to env-based detection
  }

  // Fallback: check npm_config_user_agent (set when run via package manager scripts)
  const ua = process.env.npm_config_user_agent ?? '';
  if (ua.startsWith('bun')) return 'bun';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';

  return 'npm';
}
/**
 * Build the install command for the detected package manager.
 */
function buildInstallCommand(pm: string, version: string): string {
  const pkg = `${PACKAGE_NAME}@${version}`;
  switch (pm) {
    case 'yarn':
      return `yarn global add ${pkg}`;
    case 'pnpm':
      return `pnpm add -g ${pkg}`;
    case 'bun':
      return `bun add -g ${pkg}`;
    default:
      return `npm install -g ${pkg}`;
  }
}

/**
 * Build candidate `[bin, args]` invocations for the detected package manager.
 * Returns multiple candidates on Windows so the executor can fall back when
 * a tool is installed via a different shape (e.g. `pnpm.cmd` shim vs
 * `pnpm.exe` from `@pnpm/exe`).
 *
 * On Windows, Node ≥18 refuses to spawn `.cmd`/`.bat` files via execFile
 * without an explicit extension (CVE-2024-27980 hardening), so we list the
 * `.cmd` candidate first and fall back to the bare name (resolved via
 * PATHEXT to `.exe`) on ENOENT.
 */
function buildInstallCandidates(pm: string, version: string): Array<[string, string[]]> {
  const pkg = `${PACKAGE_NAME}@${version}`;
  const args: Record<string, string[]> = {
    yarn: ['global', 'add', pkg],
    pnpm: ['add', '-g', pkg],
    bun: ['add', '-g', pkg],
    npm: ['install', '-g', pkg],
  };
  const bin = pm in args ? pm : 'npm';
  const a = args[bin];

  if (process.platform !== 'win32') return [[bin, a]];
  // bun ships as bun.exe; npm/yarn/pnpm typically ship as .cmd shims but
  // pnpm may also be installed as pnpm.exe — try .cmd first, then bare name.
  if (bin === 'bun') return [[bin, a]];
  return [
    [`${bin}.cmd`, a],
    [bin, a],
  ];
}

/**
 * `elytro update` — Check for updates and optionally upgrade.
 *
 * Subcommands:
 *   check   — Check if a newer version is available (JSON output, no side effects)
 *   (none)  — Check and upgrade to latest if available
 */
export function registerUpdateCommand(program: Command): void {
  const updateCmd = program
    .command('update')
    .alias('upgrade')
    .description('Check for updates and upgrade to the latest version');

  // ── check ─────────────────────────────────────────────────────
  updateCmd
    .command('check')
    .description('Check if a newer version is available (no install)')
    .action(async () => {
      try {
        const latest = await fetchLatestVersion();
        const cmp = compareSemver(VERSION, latest);

        outputResult({
          currentVersion: VERSION,
          latestVersion: latest,
          updateAvailable: cmp < 0,
          ...(cmp < 0
            ? {
                upgradeCommand: buildInstallCommand(detectPackageManager(), latest),
              }
            : {}),
        });
      } catch (err) {
        outputError(-32000, `Failed to check for updates: ${(err as Error).message}`);
      }
    });

  // ── default (upgrade) ─────────────────────────────────────────
  updateCmd.action(async () => {
    const spinner = ora('Checking for updates…').start();

    try {
      const latest = await fetchLatestVersion();
      const cmp = compareSemver(VERSION, latest);

      if (cmp >= 0) {
        spinner.succeed(chalk.green(`Already up to date (v${VERSION})`));
        outputResult({
          currentVersion: VERSION,
          latestVersion: latest,
          updateAvailable: false,
        });
        return;
      }

      spinner.text = `Updating ${chalk.gray(`v${VERSION}`)} → ${chalk.green(`v${latest}`)}…`;

      const pm = detectPackageManager();
      const candidates = buildInstallCandidates(pm, latest);

      // Stop the spinner so the underlying installer can render its own output.
      spinner.stop();

      let lastErr: unknown;
      let ran = false;
      for (const [bin, args] of candidates) {
        try {
          execFileSync(bin, args, { stdio: 'inherit' });
          ran = true;
          break;
        } catch (err) {
          // Only fall through on "binary not found"; bubble up real install failures.
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            lastErr = err;
            continue;
          }
          throw err;
        }
      }
      if (!ran) {
        throw lastErr ?? new Error(`Could not locate ${pm} executable`);
      }

      spinner.succeed(chalk.green(`Updated to v${latest}`));
      outputResult({
        previousVersion: VERSION,
        currentVersion: latest,
        updateAvailable: false,
        packageManager: pm,
      });
    } catch (err) {
      spinner.fail('Update failed');
      outputError(-32000, `Update failed: ${(err as Error).message}`);
    }
  });
}

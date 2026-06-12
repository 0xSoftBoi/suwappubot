import { readFile, writeFile, mkdir, access, chmod, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { StorageAdapter } from '../types';

/**
 * File-based storage adapter.
 *
 * Each key maps to a JSON file under the data directory.
 * Default root: ~/.elytro/
 *
 * Design note:
 * Extension uses LocalSubscribableStore (chrome.storage + Proxy reactivity).
 * CLI has no UI to react to — a simple read/write-on-demand model is sufficient.
 * Services call load() at startup and save() after mutations.
 */
export class FileStore implements StorageAdapter {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(homedir(), '.elytro');
  }

  private filePath(key: string): string {
    // Allow nested keys like "history/10-0xabc" → ~/.elytro/history/10-0xabc.json
    return join(this.root, `${key}.json`);
  }

  async load<T>(key: string): Promise<T | null> {
    const path = this.filePath(key);
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async save<T>(key: string, data: T): Promise<void> {
    const path = this.filePath(key);
    const dir = dirname(path);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => {});

    // Atomic write: write to a temp file then rename.
    // rename() on the same filesystem is atomic on POSIX and effectively
    // atomic on modern Windows NTFS, preventing partial-write corruption.
    const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => {});
    try {
      await rename(tmp, path);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    const path = this.filePath(key);
    try {
      await unlink(path);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const path = this.filePath(key);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Ensure the root directory exists. Call once at startup. */
  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700).catch(() => {});
  }

  get dataDir(): string {
    return this.root;
  }
}

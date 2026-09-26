/**
 * Local "harness" state for `suwappu ai`: a run journal and a lessons file,
 * both under ~/.suwappu/harness/ — deliberately separate from the auth
 * config at ~/.config/suwappu/config.json since this is usage telemetry the
 * user owns and can delete freely, not credentials.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Lazy (not module-level constants) so tests can redirect via
// SUWAPPU_HARNESS_DIR without touching the real user home directory —
// os.homedir() itself can't be overridden mid-process. Unset in normal use,
// so production behavior (~/.suwappu/harness/) is unchanged.
function harnessDir(): string {
  return process.env.SUWAPPU_HARNESS_DIR || path.join(os.homedir(), ".suwappu", "harness");
}

function journalFile(): string {
  return path.join(harnessDir(), "journal.jsonl");
}

function lessonsFile(): string {
  return path.join(harnessDir(), "lessons.md");
}

export function journalPath(): string {
  return journalFile();
}

export function lessonsPath(): string {
  return lessonsFile();
}

export interface JournalEntry {
  ts: string;
  backend: string;
  model?: string;
  ok: boolean;
  ms: number;
  /** First 120 chars of the prompt — never the full prompt or any response. */
  prompt: string;
}

/**
 * Append one journal line. Never throws — a broken home directory or full
 * disk must not fail the `ai` command whose result the user is waiting on.
 */
export function appendJournalEntry(entry: JournalEntry): void {
  try {
    fs.mkdirSync(harnessDir(), { recursive: true });
    fs.appendFileSync(journalFile(), `${JSON.stringify(entry)}\n`);
  } catch {
    // Intentionally swallowed — see doc comment above.
  }
}

/** Reads and parses the journal, skipping any malformed lines. */
export function readJournalEntries(): JournalEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(journalFile(), "utf8");
  } catch {
    return [];
  }
  const entries: JournalEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") entries.push(parsed as JournalEntry);
    } catch {
      // Skip malformed line rather than failing the whole read.
    }
  }
  return entries;
}

export interface JournalDigest {
  total: number;
  byBackend: Record<string, number>;
  failures: number;
  failureRate: number;
  last5: JournalEntry[];
}

export function computeJournalDigest(entries: JournalEntry[]): JournalDigest {
  const byBackend: Record<string, number> = {};
  let failures = 0;
  for (const entry of entries) {
    byBackend[entry.backend] = (byBackend[entry.backend] ?? 0) + 1;
    if (!entry.ok) failures += 1;
  }
  const total = entries.length;
  return {
    total,
    byBackend,
    failures,
    failureRate: total === 0 ? 0 : failures / total,
    last5: entries.slice(-5).reverse(),
  };
}

export const LESSONS_TEMPLATE = `# Suwappu AI Lessons

One section per lesson: a \`### title\` heading followed by up to 3 lines.
Cap: 25 lessons total — merge or evict the least useful one before adding a
new one past the cap.

### Example lesson title

- What went wrong or what worked.
- The concrete fix or pattern to repeat next time.
- (optional) When this applies / when it doesn't.
`;

/** Returns the lessons file content, or undefined if it doesn't exist. */
export function readLessonsFile(): string | undefined {
  try {
    return fs.readFileSync(lessonsFile(), "utf8");
  } catch {
    return undefined;
  }
}

export function lessonsFileExists(): boolean {
  return fs.existsSync(lessonsFile());
}

/** Seeds ~/.suwappu/harness/lessons.md with a template (`ai lessons --init`). */
export function writeLessonsTemplate(): void {
  fs.mkdirSync(harnessDir(), { recursive: true });
  fs.writeFileSync(lessonsFile(), LESSONS_TEMPLATE);
}

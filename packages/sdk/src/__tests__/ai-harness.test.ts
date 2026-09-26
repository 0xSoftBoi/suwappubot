import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The harness module resolves its storage directory lazily via
// SUWAPPU_HARNESS_DIR (see src/cli/ai/harness.ts) specifically so tests can
// point it at a throwaway temp dir instead of the real ~/.suwappu/.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suwappu-harness-test-"));
process.env.SUWAPPU_HARNESS_DIR = tmpDir;

const harness = await import("../cli/ai/harness.js");

afterAll(() => {
  delete process.env.SUWAPPU_HARNESS_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("journal", () => {
  it("returns an empty digest when no journal file exists", () => {
    const entries = harness.readJournalEntries();
    expect(entries).toEqual([]);
    expect(harness.computeJournalDigest(entries)).toEqual({
      total: 0,
      byBackend: {},
      failures: 0,
      failureRate: 0,
      last5: [],
    });
  });

  it("appends entries as JSONL and reads them back", () => {
    harness.appendJournalEntry({
      ts: "2026-01-01T00:00:00.000Z",
      backend: "router",
      model: "anthropic/claude-sonnet-5",
      ok: true,
      ms: 100,
      prompt: "first prompt",
    });
    harness.appendJournalEntry({
      ts: "2026-01-01T00:01:00.000Z",
      backend: "claude",
      ok: false,
      ms: 250,
      prompt: "second prompt",
    });

    const entries = harness.readJournalEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].backend).toBe("router");
    expect(entries[1].ok).toBe(false);
    expect(fs.statSync(harness.journalPath()).isFile()).toBe(true);
  });

  it("skips malformed lines instead of throwing", () => {
    fs.appendFileSync(harness.journalPath(), "not valid json\n");
    const entries = harness.readJournalEntries();
    // Still just the 2 well-formed entries from the previous test.
    expect(entries.length).toBe(2);
  });

  it("computes backend counts, failure rate, and last5 most-recent-first", () => {
    const entries = harness.readJournalEntries();
    const digest = harness.computeJournalDigest(entries);

    expect(digest.total).toBe(2);
    expect(digest.byBackend).toEqual({ router: 1, claude: 1 });
    expect(digest.failures).toBe(1);
    expect(digest.failureRate).toBe(0.5);
    expect(digest.last5[0].prompt).toBe("second prompt");
    expect(digest.last5[1].prompt).toBe("first prompt");
  });

  it("caps last5 at 5 entries even with more history", () => {
    const many = harness.computeJournalDigest(
      Array.from({ length: 8 }, (_, i) => ({
        ts: `t${i}`,
        backend: "router",
        ok: true,
        ms: 1,
        prompt: `p${i}`,
      })),
    );
    expect(many.last5.length).toBe(5);
    expect(many.last5[0].prompt).toBe("p7");
  });
});

describe("lessons", () => {
  it("reports no lessons file initially", () => {
    expect(harness.lessonsFileExists()).toBe(false);
    expect(harness.readLessonsFile()).toBeUndefined();
  });

  it("writes and reads back a seeded template", () => {
    harness.writeLessonsTemplate();
    expect(harness.lessonsFileExists()).toBe(true);
    const content = harness.readLessonsFile();
    expect(content).toContain("### Example lesson title");
    expect(content).toContain("25 lessons");
  });
});

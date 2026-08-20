import { describe, expect, it } from "bun:test";
import { BASE_SYSTEM_PROMPT, buildSystemPrompt } from "../cli/ai/systemPrompt.js";

describe("buildSystemPrompt", () => {
  it("returns just the base prompt when there are no lessons", () => {
    expect(buildSystemPrompt()).toBe(BASE_SYSTEM_PROMPT);
  });

  it("treats a blank/whitespace-only lessons file as no lessons", () => {
    expect(buildSystemPrompt("   \n  ")).toBe(BASE_SYSTEM_PROMPT);
  });

  it("mentions the suwappu CLI's purpose and its commands", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("suwappu");
    expect(BASE_SYSTEM_PROMPT).toContain("cross-chain");
    expect(BASE_SYSTEM_PROMPT).toContain("quote");
    expect(BASE_SYSTEM_PROMPT).toContain("swap");
  });

  it("appends lessons content under a 'Learned lessons' heading", () => {
    const lessons = "### Retry 429s\n\n- Back off and retry.\n- Cap at 3 attempts.";
    const result = buildSystemPrompt(lessons);

    expect(result.startsWith(BASE_SYSTEM_PROMPT)).toBe(true);
    expect(result).toContain("## Learned lessons");
    expect(result).toContain("### Retry 429s");
    expect(result).toContain("Back off and retry.");
  });
});

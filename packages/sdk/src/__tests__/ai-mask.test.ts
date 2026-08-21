import { describe, expect, it } from "bun:test";
import { maskApiKey } from "../cli/ai/mask.js";

describe("maskApiKey", () => {
  it("reports configured without exposing any key-derived material", () => {
    const key = "sk-or-v1-abcdefgh1234";
    const masked = maskApiKey(key);

    expect(masked).toBe("[configured]");
    expect(masked).not.toContain("sk-");
    expect(masked).not.toContain("1234");
    expect(masked).not.toContain(key);
  });

  it("uses the same non-secret marker for short keys", () => {
    expect(maskApiKey("abc123")).toBe("[configured]");
  });

  it("never includes secret substrings", () => {
    const masked = maskApiKey("sk-or-v1-supersecretvalue1234");
    expect(masked).toBe("[configured]");
    expect(masked).not.toContain("supersecret");
    expect(masked).not.toContain("1234");
  });

  it("reports not configured for empty input", () => {
    expect(maskApiKey("")).toBe("[not configured]");
  });
});

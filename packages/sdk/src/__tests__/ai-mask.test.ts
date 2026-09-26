import { describe, expect, it } from "bun:test";
import { maskApiKey } from "../cli/ai/mask.js";

describe("maskApiKey", () => {
  it("masks a short key entirely", () => {
    expect(maskApiKey("abc123")).toBe("******");
  });

  it("keeps a short dash-delimited prefix and the last 4 chars", () => {
    expect(maskApiKey("sk-or-v1-abcdefgh1234")).toBe("sk-...1234");
  });

  it("falls back to the first 3 chars when there's no short dash prefix", () => {
    expect(maskApiKey("abcdefghijklmnop")).toBe("abc...mnop");
  });

  it("never includes the middle of the key", () => {
    const masked = maskApiKey("sk-or-v1-supersecretvalue1234");
    expect(masked).not.toContain("supersecret");
  });

  it("returns an empty string for empty input", () => {
    expect(maskApiKey("")).toBe("");
  });
});

import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// config.ts resolves its storage directory lazily via SUWAPPU_CONFIG_DIR
// (see src/cli/utils/config.ts) so tests never touch the real
// ~/.config/suwappu/config.json.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "suwappu-config-test-"));
process.env.SUWAPPU_CONFIG_DIR = tmpDir;

const configModule = await import("../cli/utils/config.js");
const { maskApiKey } = await import("../cli/ai/mask.js");

afterAll(() => {
  delete process.env.SUWAPPU_CONFIG_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ai config persistence", () => {
  it("returns an empty config when nothing has been saved", () => {
    expect(configModule.readConfig()).toEqual({});
  });

  it("writes a router ai config at 0600 and reads it back exactly", () => {
    configModule.writeConfig({
      ai: {
        backend: "router",
        apiKey: "sk-or-v1-abcdefgh1234",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "anthropic/claude-sonnet-5",
      },
    });

    const stat = fs.statSync(configModule.configPath());
    expect(stat.mode & 0o777).toBe(0o600);

    const config = configModule.readConfig();
    expect(config.ai).toEqual({
      backend: "router",
      apiKey: "sk-or-v1-abcdefgh1234",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-sonnet-5",
    });
  });

  it("stores claude/chatgpt backends without an apiKey field", () => {
    configModule.writeConfig({ ai: { backend: "claude" } });
    const config = configModule.readConfig();
    expect(config.ai?.backend).toBe("claude");
    expect(config.ai?.apiKey).toBeUndefined();
  });

  it("preserves existing top-level fields when only the ai config changes", () => {
    configModule.writeConfig({ apiKey: "suwappu-agent-key", baseUrl: "https://api.suwappu.bot" });
    configModule.writeConfig({ ...configModule.readConfig(), ai: { backend: "router", apiKey: "sk-abc123456789" } });

    const config = configModule.readConfig();
    expect(config.apiKey).toBe("suwappu-agent-key");
    expect(config.baseUrl).toBe("https://api.suwappu.bot");
    expect(config.ai?.backend).toBe("router");
  });

  it("masks the stored router key for display without ever printing it raw", () => {
    configModule.writeConfig({ ai: { backend: "router", apiKey: "sk-or-v1-topsecretvalue7890" } });
    const config = configModule.readConfig();
    const masked = maskApiKey(config.ai!.apiKey!);

    expect(masked).toBe("sk-...7890");
    expect(masked).not.toContain("topsecret");
  });
});

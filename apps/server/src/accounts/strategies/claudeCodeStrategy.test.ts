import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeCredentialStrategy } from "./claudeCodeStrategy.ts";

const tempDirs: Array<string> = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "t3-claude-strategy-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("ClaudeCodeCredentialStrategy", () => {
  it("creates the config subdirectory", async () => {
    const profilePath = await makeTempDir();
    const strategy = new ClaudeCodeCredentialStrategy();

    await strategy.initProfileDir(profilePath);

    const stat = await fs.stat(path.join(profilePath, "config"));
    expect(stat.isDirectory()).toBe(true);
  });

  it("writes credentials from apiKey option and trims whitespace", async () => {
    const profilePath = await makeTempDir();
    const configPath = path.join(profilePath, "config", "credentials.json");
    const strategy = new ClaudeCodeCredentialStrategy();
    await strategy.initProfileDir(profilePath);

    await strategy.runLoginFlow(profilePath, { apiKey: "  sk-ant-abc123  " });

    const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as {
      apiKey: string;
      addedAt: string;
    };
    expect(parsed.apiKey).toBe("sk-ant-abc123");
    expect(typeof parsed.addedAt).toBe("string");
    const mode = (await fs.stat(configPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("throws when apiKey option is not provided", async () => {
    const profilePath = await makeTempDir();
    const strategy = new ClaudeCodeCredentialStrategy();
    await strategy.initProfileDir(profilePath);

    await expect(strategy.runLoginFlow(profilePath)).rejects.toThrow(
      "Claude Code requires an API key",
    );
  });

  it("throws when apiKey has invalid format", async () => {
    const profilePath = await makeTempDir();
    const strategy = new ClaudeCodeCredentialStrategy();
    await strategy.initProfileDir(profilePath);

    await expect(strategy.runLoginFlow(profilePath, { apiKey: "bad-key" })).rejects.toThrow(
      "Invalid Anthropic API key format",
    );
  });

  it("returns ANTHROPIC_API_KEY from stored credentials", async () => {
    const profilePath = await makeTempDir();
    const strategy = new ClaudeCodeCredentialStrategy();
    await strategy.initProfileDir(profilePath);
    await strategy.runLoginFlow(profilePath, { apiKey: "sk-ant-valid123" });

    const env = strategy.getSessionEnv(profilePath);
    expect(env).toEqual({ ANTHROPIC_API_KEY: "sk-ant-valid123" });
  });

  it("throws when session env is requested with missing credentials", async () => {
    const profilePath = await makeTempDir();
    const strategy = new ClaudeCodeCredentialStrategy();

    expect(() => strategy.getSessionEnv(profilePath)).toThrow(
      "Claude Code credentials not found for this account. Please re-add the account.",
    );
  });

  it("checks credentials for valid, missing, and malformed states", async () => {
    const profilePath = await makeTempDir();
    const configPath = path.join(profilePath, "config", "credentials.json");
    const strategy = new ClaudeCodeCredentialStrategy();
    await strategy.initProfileDir(profilePath);

    expect(await strategy.checkCredentials(profilePath)).toEqual({
      valid: false,
      reason: "missing",
    });

    await fs.writeFile(configPath, "not-json", "utf8");
    expect(await strategy.checkCredentials(profilePath)).toEqual({
      valid: false,
      reason: "malformed",
    });

    await fs.writeFile(configPath, JSON.stringify({ apiKey: "bad", addedAt: "2026-01-01" }), "utf8");
    expect(await strategy.checkCredentials(profilePath)).toEqual({
      valid: false,
      reason: "malformed",
    });

    await fs.writeFile(
      configPath,
      JSON.stringify({ apiKey: "sk-ant-good", addedAt: "2026-01-01T00:00:00.000Z" }),
      "utf8",
    );
    expect(await strategy.checkCredentials(profilePath)).toEqual({ valid: true });
  });

  it("removes profiles safely", async () => {
    const profilePath = await makeTempDir();
    const strategy = new ClaudeCodeCredentialStrategy();
    await strategy.initProfileDir(profilePath);
    await strategy.runLoginFlow(profilePath, { apiKey: "sk-ant-removal" });

    await strategy.removeProfile(profilePath);
    await strategy.removeProfile(profilePath);

    await expect(fs.stat(profilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

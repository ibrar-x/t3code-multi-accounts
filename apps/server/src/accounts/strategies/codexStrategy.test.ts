import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { CodexCredentialStrategy } from "./codexStrategy.ts";

const tempDirs: Array<string> = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "t3-codex-strategy-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("CodexCredentialStrategy", () => {
  it("creates profile directories idempotently", async () => {
    const profilePath = await makeTempDir();
    const target = path.join(profilePath, "nested");
    const strategy = new CodexCredentialStrategy({ warningLogger: () => undefined });

    await strategy.initProfileDir(target);
    await strategy.initProfileDir(target);

    const stat = await fs.stat(target);
    expect(stat.isDirectory()).toBe(true);
  });

  it("runs codex login and injects CODEX_HOME into the child env", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");
    const spawnCalls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];

    const strategy = new CodexCredentialStrategy({
      spawnImpl: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        const child = new EventEmitter();
        queueMicrotask(() => {
          void fs
            .writeFile(
              authPath,
              JSON.stringify({ access_token: "token", refresh_token: "refresh" }),
              "utf8",
            )
            .then(() => {
              child.emit("close", 0);
            })
            .catch((error) => {
              child.emit("error", error);
            });
        });
        return child as unknown as ChildProcess;
      },
      warningLogger: () => undefined,
    });

    await strategy.runLoginFlow(profilePath);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.command).toBe("codex");
    expect(spawnCalls[0]?.args).toEqual(["login"]);
    expect(spawnCalls[0]?.options.stdio).toBe("inherit");
    expect(spawnCalls[0]?.options.env?.CODEX_HOME).toBe(profilePath);

    const mode = (await fs.stat(authPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("returns a readable error when the codex binary is not installed", async () => {
    const profilePath = await makeTempDir();
    const strategy = new CodexCredentialStrategy({
      spawnImpl: () => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          const error = new Error("spawn codex ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          child.emit("error", error);
        });
        return child as unknown as ChildProcess;
      },
      warningLogger: () => undefined,
    });

    await expect(strategy.runLoginFlow(profilePath)).rejects.toThrow(
      "Codex CLI not found. Install it with: npm install -g @openai/codex",
    );
  });

  it("fails when codex login exits non-zero", async () => {
    const profilePath = await makeTempDir();
    const strategy = new CodexCredentialStrategy({
      spawnImpl: () => {
        const child = new EventEmitter();
        queueMicrotask(() => {
          child.emit("close", 2);
        });
        return child as unknown as ChildProcess;
      },
      warningLogger: () => undefined,
    });

    await expect(strategy.runLoginFlow(profilePath)).rejects.toThrow(
      "codex login exited with code 2",
    );
  });

  it("checks credentials for valid, missing, and malformed auth.json", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");
    const strategy = new CodexCredentialStrategy({ warningLogger: () => undefined });

    expect(await strategy.checkCredentials(profilePath)).toEqual({
      valid: false,
      reason: "missing",
    });

    await fs.writeFile(authPath, "{ bad json", "utf8");
    expect(await strategy.checkCredentials(profilePath)).toEqual({
      valid: false,
      reason: "malformed",
    });

    await fs.writeFile(authPath, JSON.stringify({ access_token: "token" }), "utf8");
    expect(await strategy.checkCredentials(profilePath)).toEqual({
      valid: false,
      reason: "malformed",
    });

    await fs.writeFile(
      authPath,
      JSON.stringify({ access_token: "token", refresh_token: "refresh" }),
      "utf8",
    );
    expect(await strategy.checkCredentials(profilePath)).toEqual({ valid: true });
  });

  it("removes profile directories safely", async () => {
    const profilePath = await makeTempDir();
    const nestedFile = path.join(profilePath, "nested", "file.txt");
    const strategy = new CodexCredentialStrategy({ warningLogger: () => undefined });
    await fs.mkdir(path.dirname(nestedFile), { recursive: true });
    await fs.writeFile(nestedFile, "ok", "utf8");

    await strategy.removeProfile(profilePath);
    await strategy.removeProfile(profilePath);

    await expect(fs.stat(profilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

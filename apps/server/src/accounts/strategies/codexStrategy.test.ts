import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexCredentialStrategy, resolveCodexLoginUrl } from "./codexStrategy.ts";

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
  it("resolves full auth urls and ignores bare auth host urls", () => {
    expect(
      resolveCodexLoginUrl("Visit https://auth.openai.com/device?code=abc123 to continue"),
    ).toBe("https://auth.openai.com/device?code=abc123");
    expect(resolveCodexLoginUrl("Visit https://auth.openai.com")).toBeNull();
  });

  it("extracts urls wrapped in OSC-8 terminal hyperlink sequences", () => {
    const osc8 = [
      "\u001B]8;;https://auth.openai.com/device?code=abc123\u0007",
      "Open login",
      "\u001B]8;;\u0007",
    ].join("");
    expect(resolveCodexLoginUrl(osc8)).toBe("https://auth.openai.com/device?code=abc123");
  });

  it("prefers oauth authorize URLs when multiple auth URLs are present", () => {
    const output = [
      "Use this as fallback: https://auth.openai.com/codex/device",
      "Primary URL: https://auth.openai.com/oauth/authorize?response_type=code&client_id=abc",
    ].join("\n");
    expect(resolveCodexLoginUrl(output)).toBe(
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=abc",
    );
  });

  it("strips terminal escape suffixes from captured auth URLs", () => {
    expect(resolveCodexLoginUrl("https://auth.openai.com/codex/device%1B%5B0m")).toBe(
      "https://auth.openai.com/codex/device",
    );
    expect(resolveCodexLoginUrl("https://auth.openai.com/codex/device\u001B[0m")).toBe(
      "https://auth.openai.com/codex/device",
    );
  });

  it("reconstructs wrapped oauth authorize URLs from multiline output", () => {
    const wrapped = [
      "If your browser did not open, navigate to this URL to authenticate:",
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_abc",
      "&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid",
      "&state=xyz&originator=codex_cli_rs",
      "",
      "On a remote or headless machine? Use `codex login --device-auth` instead.",
    ].join("\n");
    expect(resolveCodexLoginUrl(wrapped)).toBe(
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_abc&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid&state=xyz&originator=codex_cli_rs",
    );
  });

  it("extracts oauth authorize URL from real codex login output shape", () => {
    const output = [
      "Starting local login server on http://localhost:1455.",
      "If your browser did not open, navigate to this URL to authenticate:",
      "",
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid%20profile%20email%20offline_access&code_challenge=r8raZ0ryBaXfi6LT6vL212zyvkCMZga9vUa8LRD47B4&code_challenge_method=S256&id_token_add_organizations=true&codex_cli_simplified_flow=true&state=QZ6lUOnEgcHKX5KNRynlNHRV1jnXTTVfLye0z0FscyE&originator=codex_cli_rs",
      "",
      "On a remote or headless machine? Use `codex login --device-auth` instead.",
    ].join("\n");
    expect(resolveCodexLoginUrl(output)).toBe(
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid%20profile%20email%20offline_access&code_challenge=r8raZ0ryBaXfi6LT6vL212zyvkCMZga9vUa8LRD47B4&code_challenge_method=S256&id_token_add_organizations=true&codex_cli_simplified_flow=true&state=QZ6lUOnEgcHKX5KNRynlNHRV1jnXTTVfLye0z0FscyE&originator=codex_cli_rs",
    );
  });

  it("creates profile directories idempotently", async () => {
    const profilePath = await makeTempDir();
    const target = path.join(profilePath, "nested");
    const strategy = new CodexCredentialStrategy({ warningLogger: () => undefined });

    await strategy.initProfileDir(target);
    await strategy.initProfileDir(target);

    const stat = await fs.stat(target);
    expect(stat.isDirectory()).toBe(true);
  });

  it("runs codex login and injects CODEX_HOME without opening extra browser windows", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");
    const spawnCalls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];

    const strategy = new CodexCredentialStrategy({
      spawnImpl: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          (child.stdout as EventEmitter).emit(
            "data",
            "Open this URL to authenticate: https://auth.openai.com/oauth/authorize?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=xyz\n",
          );
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
        return child;
      },
      warningLogger: () => undefined,
    });

    await strategy.runLoginFlow(profilePath);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.command).toBe("codex");
    expect(spawnCalls[0]?.args).toEqual(["login"]);
    expect(spawnCalls[0]?.options.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(spawnCalls[0]?.options.env?.CODEX_HOME).toBe(profilePath);

    const mode = (await fs.stat(authPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("accepts non-oauth fallback URL output without failing login", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");
    const strategy = new CodexCredentialStrategy({
      spawnImpl: (_command, _args) => {
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          (child.stdout as EventEmitter).emit(
            "data",
            "Fallback URL: https://auth.openai.com/codex/device%1B%5B0m\n",
          );
          void fs
            .writeFile(
              authPath,
              JSON.stringify({ access_token: "token", refresh_token: "refresh" }),
              "utf8",
            )
            .then(() => child.emit("close", 0))
            .catch((error) => child.emit("error", error));
        });
        return child;
      },
      warningLogger: () => undefined,
    });

    await strategy.runLoginFlow(profilePath);
  });

  it("does not fail when URL text appears in --device-auth fallback output", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");

    const strategy = new CodexCredentialStrategy({
      spawnImpl: (_command, args) => {
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          if (args.length === 1 && args[0] === "login") {
            (child.stderr as EventEmitter).emit("data", "Browser login unavailable");
            child.emit("close", 2);
            return;
          }
          (child.stdout as EventEmitter).emit(
            "data",
            "https://auth.openai.com/oauth/authorize?response_type=code&client_id=abc&state=xyz\n",
          );
          void fs
            .writeFile(
              authPath,
              JSON.stringify({ access_token: "token", refresh_token: "refresh" }),
              "utf8",
            )
            .then(() => child.emit("close", 0))
            .catch((error) => child.emit("error", error));
        });
        return child;
      },
      warningLogger: () => undefined,
    });

    await strategy.runLoginFlow(profilePath);
  });

  it("handles mixed URL output without opening additional browser windows", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");
    const strategy = new CodexCredentialStrategy({
      spawnImpl: (_command, _args) => {
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          (child.stdout as EventEmitter).emit(
            "data",
            "Fallback URL: https://auth.openai.com/codex/device%1B%5B0m\n",
          );
          setTimeout(() => {
            (child.stdout as EventEmitter).emit(
              "data",
              "Primary URL: https://auth.openai.com/oauth/authorize?response_type=code&client_id=abc&state=xyz\n",
            );
            void fs
              .writeFile(
                authPath,
                JSON.stringify({ access_token: "token", refresh_token: "refresh" }),
                "utf8",
              )
              .then(() => child.emit("close", 0))
              .catch((error) => child.emit("error", error));
          }, 20);
        });
        return child;
      },
      warningLogger: () => undefined,
    });

    await strategy.runLoginFlow(profilePath);
  });

  it("falls back to codex login --device-auth when browser login fails", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");
    const spawnCalls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
    const warningLogger = vi.fn();

    const strategy = new CodexCredentialStrategy({
      spawnImpl: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];

        queueMicrotask(() => {
          if (args.length === 1 && args[0] === "login") {
            (child.stderr as EventEmitter).emit("data", "Browser login unavailable");
            child.emit("close", 2);
            return;
          }

          (child.stdout as EventEmitter).emit(
            "data",
            "Open this URL to authenticate: https://auth.openai.com/oauth/authorize?code=abc123\n",
          );
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

        return child;
      },
      warningLogger,
    });

    await strategy.runLoginFlow(profilePath);

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0]?.args).toEqual(["login"]);
    expect(spawnCalls[1]?.args).toEqual(["login", "--device-auth"]);
    expect(warningLogger).toHaveBeenCalledWith(
      expect.stringContaining("Browser login failed; falling back to device-auth login"),
    );
  });

  it("returns a readable error when the codex binary is not installed", async () => {
    const profilePath = await makeTempDir();
    const strategy = new CodexCredentialStrategy({
      spawnImpl: () => {
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          const error = new Error("spawn codex ENOENT") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          child.emit("error", error);
        });
        return child;
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
      spawnImpl: (_command, args) => {
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          if (args.length === 1 && args[0] === "login") {
            (child.stderr as EventEmitter).emit("data", "Browser auth failed");
            child.emit("close", 2);
            return;
          }
          (child.stderr as EventEmitter).emit("data", "Device auth failed");
          child.emit("close", 3);
        });
        return child;
      },
      warningLogger: () => undefined,
    });

    await expect(strategy.runLoginFlow(profilePath)).rejects.toThrow(
      "Couldn't complete Codex sign-in",
    );
  });

  it("returns a cancellation message when login is cancelled", async () => {
    const profilePath = await makeTempDir();
    const strategy = new CodexCredentialStrategy({
      spawnImpl: (_command, args) => {
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          if (args.length === 1 && args[0] === "login") {
            (child.stderr as EventEmitter).emit("data", "Browser auth unavailable");
            child.emit("close", 2);
            return;
          }
          (child.stderr as EventEmitter).emit("data", "User canceled authentication");
          child.emit("close", 130);
        });
        return child;
      },
      warningLogger: () => undefined,
    });

    await expect(strategy.runLoginFlow(profilePath)).rejects.toThrow(
      "Sign-in was cancelled. No account was added.",
    );
  });

  it("returns a rate-limit message when auth responds with 429", async () => {
    const profilePath = await makeTempDir();
    const strategy = new CodexCredentialStrategy({
      spawnImpl: (_command, args) => {
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          if (args.length === 1 && args[0] === "login") {
            (child.stderr as EventEmitter).emit(
              "data",
              "Error logging in with device code: device code request failed with status 429 Too Many Requests",
            );
            child.emit("close", 1);
            return;
          }
          (child.stderr as EventEmitter).emit("data", "device flow status 429 Too Many Requests");
          child.emit("close", 1);
        });
        return child;
      },
      warningLogger: () => undefined,
    });

    await expect(strategy.runLoginFlow(profilePath)).rejects.toThrow(
      "Too many login attempts right now (429). Please wait a few minutes, then try connecting again.",
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

    await fs.writeFile(
      authPath,
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: "token_nested",
          refresh_token: "refresh_nested",
          id_token: "id_nested",
        },
      }),
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

  it("runs codex logout before removing a profile with auth credentials", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");
    await fs.writeFile(
      authPath,
      JSON.stringify({ tokens: { access_token: "token", refresh_token: "refresh" } }),
      "utf8",
    );
    const spawnCalls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];

    const strategy = new CodexCredentialStrategy({
      spawnImpl: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          child.emit("close", 0);
        });
        return child;
      },
      warningLogger: () => undefined,
    });

    await strategy.removeProfile(profilePath);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.command).toBe("codex");
    expect(spawnCalls[0]?.args).toEqual(["logout"]);
    expect(spawnCalls[0]?.options.env?.CODEX_HOME).toBe(profilePath);
    await expect(fs.stat(profilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still removes the profile when codex logout fails", async () => {
    const profilePath = await makeTempDir();
    const authPath = path.join(profilePath, "auth.json");
    await fs.writeFile(
      authPath,
      JSON.stringify({ tokens: { access_token: "token", refresh_token: "refresh" } }),
      "utf8",
    );
    const warningLogger = vi.fn();

    const strategy = new CodexCredentialStrategy({
      spawnImpl: (_command, _args) => {
        const child = new EventEmitter() as ChildProcess;
        child.stdout = new EventEmitter() as unknown as ChildProcess["stdout"];
        child.stderr = new EventEmitter() as unknown as ChildProcess["stderr"];
        queueMicrotask(() => {
          (child.stderr as EventEmitter).emit("data", "logout failed");
          child.emit("close", 1);
        });
        return child;
      },
      warningLogger,
    });

    await strategy.removeProfile(profilePath);
    expect(warningLogger).toHaveBeenCalledWith(
      expect.stringContaining("Best-effort codex logout failed"),
    );
    await expect(fs.stat(profilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

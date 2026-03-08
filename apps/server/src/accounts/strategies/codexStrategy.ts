import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { CredentialIsolationStrategy, CredentialStatus } from "../credentialStrategy.ts";

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface CodexCredentialStrategyOptions {
  readonly spawnImpl?: SpawnFn;
  readonly warningLogger?: (message: string) => void;
}

export class CodexCredentialStrategy implements CredentialIsolationStrategy {
  readonly providerKind = "codex" as const;
  private readonly spawnImpl: SpawnFn;
  private readonly warningLogger: (message: string) => void;

  constructor(options: CodexCredentialStrategyOptions = {}) {
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.warningLogger = options.warningLogger ?? ((message) => console.warn(message));
  }

  async initProfileDir(profilePath: string): Promise<void> {
    await fs.mkdir(profilePath, { recursive: true });
  }

  async runLoginFlow(profilePath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = this.spawnImpl("codex", ["login"], {
        env: { ...process.env, CODEX_HOME: profilePath },
        stdio: "inherit",
      });

      proc.on("error", (error) => {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? (error as NodeJS.ErrnoException).code
            : undefined;
        if (code === "ENOENT") {
          reject(new Error("Codex CLI not found. Install it with: npm install -g @openai/codex"));
          return;
        }
        reject(error);
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`codex login exited with code ${String(code)}`));
      });
    });

    const authPath = path.join(profilePath, "auth.json");
    try {
      await fs.chmod(authPath, 0o600);
    } catch {
      this.warningLogger(`[codexStrategy] Could not chmod ${authPath} - file may not exist`);
    }
  }

  getSessionEnv(profilePath: string): Record<string, string> {
    return { CODEX_HOME: profilePath };
  }

  async checkCredentials(profilePath: string): Promise<CredentialStatus> {
    const authPath = path.join(profilePath, "auth.json");
    try {
      const raw = await fs.readFile(authPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        return { valid: false, reason: "malformed" };
      }
      const record = parsed as Record<string, unknown>;
      if (
        typeof record.access_token !== "string" ||
        typeof record.refresh_token !== "string"
      ) {
        return { valid: false, reason: "malformed" };
      }
      return { valid: true };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code === "ENOENT") {
        return { valid: false, reason: "missing" };
      }
      return { valid: false, reason: "malformed" };
    }
  }

  async removeProfile(profilePath: string): Promise<void> {
    await fs.rm(profilePath, { recursive: true, force: true });
  }
}

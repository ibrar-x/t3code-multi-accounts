import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import open from "open";
import type {
  CredentialIsolationStrategy,
  CredentialLoginOptions,
  CredentialStatus,
} from "../credentialStrategy.ts";

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface CodexCredentialStrategyOptions {
  readonly spawnImpl?: SpawnFn;
  readonly warningLogger?: (message: string) => void;
  readonly openUrl?: (url: string) => Promise<void> | void;
}

export class CodexCredentialStrategy implements CredentialIsolationStrategy {
  readonly providerKind = "codex" as const;
  private readonly spawnImpl: SpawnFn;
  private readonly warningLogger: (message: string) => void;
  private readonly openUrl: (url: string) => Promise<void> | void;

  constructor(options: CodexCredentialStrategyOptions = {}) {
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.warningLogger = options.warningLogger ?? ((message) => console.warn(message));
    this.openUrl = options.openUrl ?? ((url) => open(url, { wait: false }).then(() => undefined));
  }

  async initProfileDir(profilePath: string): Promise<void> {
    await fs.mkdir(profilePath, { recursive: true });
  }

  async runLoginFlow(profilePath: string, _options?: CredentialLoginOptions): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = this.spawnImpl("codex", ["login", "--device-auth"], {
        env: { ...process.env, CODEX_HOME: profilePath },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const recentOutputLines: string[] = [];
      let openedLoginUrl = false;

      const recordOutput = (rawChunk: string) => {
        const chunk = rawChunk.trim();
        if (!chunk) {
          return;
        }
        for (const line of chunk.split(/\r?\n/)) {
          const trimmedLine = line.trim();
          if (trimmedLine.length === 0) {
            continue;
          }
          recentOutputLines.push(trimmedLine);
          if (recentOutputLines.length > 6) {
            recentOutputLines.shift();
          }
        }
      };

      const maybeOpenLoginUrl = (rawChunk: string) => {
        if (openedLoginUrl) {
          return;
        }
        const match = rawChunk.match(/https?:\/\/\S+/);
        const rawUrl = match?.[0];
        if (!rawUrl) {
          return;
        }

        const normalizedUrl = rawUrl.replace(/[),.;]+$/g, "");
        if (normalizedUrl.length === 0) {
          return;
        }

        openedLoginUrl = true;
        Promise.resolve(this.openUrl(normalizedUrl)).catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          this.warningLogger(`[codexStrategy] Failed to open login URL "${normalizedUrl}": ${reason}`);
        });
      };

      proc.stdout?.setEncoding?.("utf8");
      proc.stderr?.setEncoding?.("utf8");
      proc.stdout?.on("data", (chunk: Buffer | string) => {
        const text = String(chunk);
        recordOutput(text);
        maybeOpenLoginUrl(text);
      });
      proc.stderr?.on("data", (chunk: Buffer | string) => {
        const text = String(chunk);
        recordOutput(text);
        maybeOpenLoginUrl(text);
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
        const tail = recentOutputLines.slice(-3).join(" | ");
        reject(
          new Error(
            tail.length > 0
              ? `codex login exited with code ${String(code)}: ${tail}`
              : `codex login exited with code ${String(code)}`,
          ),
        );
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

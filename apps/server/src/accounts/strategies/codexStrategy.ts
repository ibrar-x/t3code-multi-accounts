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

const OSC8_URL_PATTERN = new RegExp(
  String.raw`\u001B\]8;;([^\u001B\u0007]+)(?:\u0007|\u001B\\)`,
  "g",
);
const ANSI_SEQUENCE_PATTERN = new RegExp(
  String.raw`\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`,
  "g",
);
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;
const MAX_URL_SCAN_BUFFER_CHARS = 16_000;

function normalizeUrlCandidate(rawUrl: string): string | null {
  const cleaned = rawUrl
    .replace(ANSI_SEQUENCE_PATTERN, "")
    .replace(/[),.;]+$/g, "")
    .trim();
  if (cleaned.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function loginUrlScore(url: string): number {
  try {
    const parsed = new URL(url);
    const hasPath = parsed.pathname !== "/" && parsed.pathname.length > 0;
    const hasQuery = parsed.search.length > 1;
    const host = parsed.hostname.toLowerCase();

    if (host === "auth.openai.com") {
      return hasPath || hasQuery ? 5 : 1;
    }

    if (host.endsWith("openai.com")) {
      return hasPath || hasQuery ? 4 : 1;
    }

    return hasPath || hasQuery ? 3 : 1;
  } catch {
    return 0;
  }
}

export function resolveCodexLoginUrl(rawOutput: string): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const match of rawOutput.matchAll(OSC8_URL_PATTERN)) {
    const normalized = normalizeUrlCandidate(match[1] ?? "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push(normalized);
  }

  const withoutOsc8 = rawOutput
    .replace(OSC8_URL_PATTERN, " ")
    .replace(ANSI_SEQUENCE_PATTERN, " ");
  for (const match of withoutOsc8.matchAll(URL_PATTERN)) {
    const normalized = normalizeUrlCandidate(match[0]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    candidates.push(normalized);
  }

  let bestUrl: string | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = loginUrlScore(candidate);
    if (score <= bestScore) continue;
    bestScore = score;
    bestUrl = candidate;
  }

  return bestScore >= 2 ? bestUrl : null;
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
    let primaryFailure: string | null = null;
    try {
      await this.runCodexLogin(profilePath, ["login", "--device-auth"]);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code === "ENOENT") {
        throw new Error("Codex CLI not found. Install it with: npm install -g @openai/codex");
      }

      primaryFailure = error instanceof Error ? error.message : String(error);
      this.warningLogger(
        `[codexStrategy] Device-auth login failed; falling back to browser login. Reason: ${primaryFailure}`,
      );
    }

    if (primaryFailure !== null) {
      try {
        await this.runCodexLogin(profilePath, ["login"]);
      } catch (error) {
        const fallbackFailure = error instanceof Error ? error.message : String(error);
        throw new Error(
          `codex login fallback failed. Device auth error: ${primaryFailure}. Browser login error: ${fallbackFailure}`,
        );
      }
    }

    const authPath = path.join(profilePath, "auth.json");
    try {
      await fs.chmod(authPath, 0o600);
    } catch {
      this.warningLogger(`[codexStrategy] Could not chmod ${authPath} - file may not exist`);
    }
  }

  private runCodexLogin(profilePath: string, args: readonly string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const proc = this.spawnImpl("codex", args, {
        env: { ...process.env, CODEX_HOME: profilePath },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const recentOutputLines: string[] = [];
      let urlScanBuffer = "";
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
        urlScanBuffer = `${urlScanBuffer}\n${rawChunk}`.slice(-MAX_URL_SCAN_BUFFER_CHARS);
        const loginUrl = resolveCodexLoginUrl(urlScanBuffer);
        if (!loginUrl) {
          return;
        }

        openedLoginUrl = true;
        Promise.resolve(this.openUrl(loginUrl)).catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          this.warningLogger(`[codexStrategy] Failed to open login URL "${loginUrl}": ${reason}`);
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
        reject(error);
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        const tail = recentOutputLines.slice(-3).join(" | ");
        const commandLabel = `codex ${args.join(" ")}`;
        reject(
          new Error(
            tail.length > 0
              ? `${commandLabel} exited with code ${String(code)}: ${tail}`
              : `${commandLabel} exited with code ${String(code)}`,
          ),
        );
      });
    });
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

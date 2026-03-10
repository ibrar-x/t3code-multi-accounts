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
const OAUTH_AUTHORIZE_SCORE = 7;
const LOGIN_CANCELLED_MESSAGE = "Sign-in was cancelled. No account was added.";
const LOGIN_EXPIRED_MESSAGE = "The sign-in code expired before completion. Please try connecting again.";
const LOGIN_TIMEOUT_MESSAGE = "Sign-in timed out before completion. Please try connecting again.";
const LOGIN_RATE_LIMITED_MESSAGE =
  "Too many login attempts right now (429). Please wait a few minutes, then try connecting again.";
const LOGIN_GENERIC_FAILURE_MESSAGE =
  "Couldn't complete Codex sign-in. Please try again and keep the login window open until completion.";

function stripTerminalUrlNoise(rawUrl: string): string {
  return rawUrl
    .replace(/(?:\\u001b\[[0-9;]*m)+$/gi, "")
    .replace(/(?:%1B(?:%5B|\[)[0-9;]*m)+$/gi, "")
    .replace(/(?:%5B[0-9;]*m)+$/gi, "")
    .replace(/(?:\[[0-9;]*m)+$/g, "");
}

function normalizeUrlCandidate(rawUrl: string): string | null {
  const cleaned = stripTerminalUrlNoise(
    rawUrl
      .replace(ANSI_SEQUENCE_PATTERN, "")
      .replace(/[),.;]+$/g, "")
      .trim(),
  );
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

function parseWrappedOauthAuthorizeUrl(rawOutput: string): string | null {
  const marker = "https://auth.openai.com/oauth/authorize?";
  const sanitized = rawOutput.replace(ANSI_SEQUENCE_PATTERN, "");
  const start = sanitized.indexOf(marker);
  if (start < 0) {
    return null;
  }

  const lines = sanitized.slice(start).split(/\r?\n/);
  if (lines.length === 0) {
    return null;
  }

  let candidate = lines[0]?.trim() ?? "";
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) break;
    if (
      trimmed.startsWith("On a remote") ||
      trimmed.startsWith("If your browser") ||
      trimmed.startsWith("Follow these steps") ||
      /^[0-9]+\.\s/.test(trimmed)
    ) {
      break;
    }
    if (!/^[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/.test(trimmed)) {
      break;
    }
    candidate += trimmed;
  }

  return normalizeUrlCandidate(candidate);
}

function loginUrlScore(url: string): number {
  try {
    const parsed = new URL(url);
    const hasPath = parsed.pathname !== "/" && parsed.pathname.length > 0;
    const hasQuery = parsed.search.length > 1;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host === "auth.openai.com") {
      // Prefer the exact browser-login authorize link emitted by `codex login`.
      if (path.startsWith("/oauth/authorize")) {
        return OAUTH_AUTHORIZE_SCORE;
      }
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

function isOauthAuthorizeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.toLowerCase() === "auth.openai.com" &&
      parsed.pathname.toLowerCase().startsWith("/oauth/authorize")
    );
  } catch {
    return false;
  }
}

export function resolveCodexLoginUrl(rawOutput: string): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const wrappedOauthCandidate = parseWrappedOauthAuthorizeUrl(rawOutput);
  if (wrappedOauthCandidate) {
    seen.add(wrappedOauthCandidate);
    candidates.push(wrappedOauthCandidate);
  }

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
    if (score < bestScore) continue;
    if (score === bestScore && bestUrl !== null && candidate.length <= bestUrl.length) continue;
    bestScore = score;
    bestUrl = candidate;
  }

  return bestScore >= 2 ? bestUrl : null;
}

function includesAny(haystack: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => haystack.includes(pattern));
}

function toFriendlyLoginFailureMessage(exitCode: number | null, tail: string): string {
  const normalized = tail.toLowerCase();
  if (
    exitCode === 130 ||
    exitCode === 143 ||
    includesAny(normalized, ["user canceled", "user cancelled", "cancelled", "canceled", "aborted"])
  ) {
    return LOGIN_CANCELLED_MESSAGE;
  }

  if (includesAny(normalized, ["expired", "expiration"])) {
    return LOGIN_EXPIRED_MESSAGE;
  }

  if (includesAny(normalized, ["timed out", "timeout"])) {
    return LOGIN_TIMEOUT_MESSAGE;
  }
  if (includesAny(normalized, ["too many requests", "status 429", "rate limit", "rate_limit"])) {
    return LOGIN_RATE_LIMITED_MESSAGE;
  }

  return LOGIN_GENERIC_FAILURE_MESSAGE;
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
      await this.runCodexLogin(profilePath, ["login"]);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code === "ENOENT") {
        throw new Error("Codex CLI not found. Install it with: npm install -g @openai/codex", {
          cause: error,
        });
      }

      primaryFailure = error instanceof Error ? error.message : String(error);
      if (
        primaryFailure === LOGIN_CANCELLED_MESSAGE ||
        primaryFailure === LOGIN_EXPIRED_MESSAGE ||
        primaryFailure === LOGIN_TIMEOUT_MESSAGE ||
        primaryFailure === LOGIN_RATE_LIMITED_MESSAGE
      ) {
        throw error;
      }
      this.warningLogger(
        `[codexStrategy] Browser login failed; falling back to device-auth login. Reason: ${primaryFailure}`,
      );
    }

    if (primaryFailure !== null) {
      try {
        await this.runCodexLogin(profilePath, ["login", "--device-auth"]);
      } catch (error) {
        const fallbackFailure = error instanceof Error ? error.message : String(error);
        if (
          fallbackFailure === LOGIN_CANCELLED_MESSAGE ||
          fallbackFailure === LOGIN_EXPIRED_MESSAGE ||
          fallbackFailure === LOGIN_TIMEOUT_MESSAGE ||
          fallbackFailure === LOGIN_RATE_LIMITED_MESSAGE
        ) {
          throw error;
        }

        throw new Error(LOGIN_GENERIC_FAILURE_MESSAGE, {
          cause: error,
        });
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

      const openResolvedLoginUrl = (url: string) => {
        if (openedLoginUrl) {
          return;
        }
        openedLoginUrl = true;
        Promise.resolve(this.openUrl(url)).catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          this.warningLogger(`[codexStrategy] Failed to open login URL "${url}": ${reason}`);
        });
      };

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
        const score = loginUrlScore(loginUrl);
        if (score < OAUTH_AUTHORIZE_SCORE || !isOauthAuthorizeUrl(loginUrl)) {
          return;
        }
        openResolvedLoginUrl(loginUrl);
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
        if (tail.length > 0) {
          this.warningLogger(
            `[codexStrategy] ${commandLabel} exited with code ${String(code)}. Output: ${tail}`,
          );
        } else {
          this.warningLogger(`[codexStrategy] ${commandLabel} exited with code ${String(code)}.`);
        }
        reject(new Error(toFriendlyLoginFailureMessage(code, tail)));
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

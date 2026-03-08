import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CredentialIsolationStrategy,
  CredentialLoginOptions,
  CredentialStatus,
} from "../credentialStrategy.ts";

interface ClaudeCredentials {
  readonly apiKey: string;
  readonly addedAt: string;
}

function credentialsPath(profilePath: string): string {
  return path.join(profilePath, "config", "credentials.json");
}

function parseCredentials(raw: string): ClaudeCredentials | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.apiKey !== "string" || !record.apiKey.startsWith("sk-ant-")) {
    return null;
  }

  if (typeof record.addedAt !== "string") {
    return null;
  }

  return {
    apiKey: record.apiKey,
    addedAt: record.addedAt,
  };
}

export class ClaudeCodeCredentialStrategy implements CredentialIsolationStrategy {
  readonly providerKind = "claudeCode" as const;

  async initProfileDir(profilePath: string): Promise<void> {
    await fs.mkdir(path.join(profilePath, "config"), { recursive: true });
  }

  async runLoginFlow(profilePath: string, options?: CredentialLoginOptions): Promise<void> {
    const apiKey = options?.apiKey?.trim();
    if (!apiKey) {
      throw new Error(
        "Claude Code requires an API key. Get yours at https://console.anthropic.com/api-keys",
      );
    }

    if (!apiKey.startsWith("sk-ant-")) {
      throw new Error("Invalid Anthropic API key format. Keys should start with 'sk-ant-'");
    }

    const configPath = credentialsPath(profilePath);
    const credentials: ClaudeCredentials = {
      apiKey,
      addedAt: new Date().toISOString(),
    };

    await fs.writeFile(configPath, JSON.stringify(credentials, null, 2), "utf8");
    try {
      await fs.chmod(configPath, 0o600);
    } catch {
      // Best effort: some filesystems may not support unix-style chmod.
    }
  }

  getSessionEnv(profilePath: string): Record<string, string> {
    const configPath = credentialsPath(profilePath);
    try {
      const raw = readFileSync(configPath, "utf8");
      const credentials = parseCredentials(raw);
      if (!credentials) {
        throw new Error("invalid credentials");
      }
      return { ANTHROPIC_API_KEY: credentials.apiKey };
    } catch {
      throw new Error(
        "Claude Code credentials not found for this account. Please re-add the account.",
      );
    }
  }

  async checkCredentials(profilePath: string): Promise<CredentialStatus> {
    const configPath = credentialsPath(profilePath);
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const credentials = parseCredentials(raw);
      if (!credentials) {
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

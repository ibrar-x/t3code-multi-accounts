import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import type { CodexAccountProfile, CodexRateLimitWindow, CodexRateLimits } from "@t3tools/contracts";

interface JsonRpcResponse {
  readonly id?: string | number;
  readonly result?: unknown;
  readonly error?: unknown;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 1_200;
const APP_SERVER_INITIALIZE_PARAMS = {
  clientInfo: {
    name: "t3code_accounts_probe",
    title: "T3 Code Accounts Probe",
    version: "0.1.0",
  },
  capabilities: {
    experimentalApi: true,
  },
} as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asKnownString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  const lower = normalized.toLowerCase();
  if (
    lower === "unknown" ||
    lower === "n/a" ||
    lower === "na" ||
    lower === "none" ||
    lower === "null"
  ) {
    return undefined;
  }
  return normalized;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return asRecord(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeUsedPercent(value: unknown): number | undefined {
  const numeric = asNumber(value);
  if (numeric === undefined) return undefined;
  return Math.max(0, Math.min(100, numeric));
}

function normalizeRateLimitWindow(value: unknown): CodexRateLimitWindow | undefined {
  const record = asObject(value);
  if (!record) return undefined;
  const usedPercent = normalizeUsedPercent(record.usedPercent ?? record.used_percent);
  const remainingPercent = normalizeUsedPercent(
    record.remainingPercent ?? record.remaining_percent,
  );
  if (usedPercent === undefined && remainingPercent === undefined) return undefined;

  const normalizedUsedPercent =
    usedPercent !== undefined
      ? usedPercent
      : remainingPercent !== undefined
        ? Math.max(0, Math.min(100, 100 - remainingPercent))
        : undefined;
  if (normalizedUsedPercent === undefined) return undefined;

  const windowDurationMins = asNumber(record.windowDurationMins ?? record.window_duration_mins);
  const rawResetsAt = asNumber(record.resetsAt ?? record.resets_at);
  const resetsAt =
    rawResetsAt !== undefined && rawResetsAt > 1_000_000_000_000
      ? Math.floor(rawResetsAt / 1_000)
      : rawResetsAt;
  const normalizedRemainingPercent =
    remainingPercent !== undefined ? remainingPercent : Math.max(0, 100 - normalizedUsedPercent);
  return {
    usedPercent: normalizedUsedPercent,
    remainingPercent: normalizedRemainingPercent,
    ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  };
}

function normalizeRateLimits(value: unknown): CodexRateLimits | undefined {
  const record = asObject(value);
  if (!record) return undefined;

  const primary = normalizeRateLimitWindow(record.primary);
  const secondary = normalizeRateLimitWindow(record.secondary);
  const credits = asObject(record.credits);

  if (!primary && !secondary && !credits) {
    return undefined;
  }

  return {
    ...(asString(record.limitId ?? record.limit_id)
      ? { limitId: asString(record.limitId ?? record.limit_id) }
      : {}),
    ...(typeof (record.limitName ?? record.limit_name) === "string" ||
    (record.limitName ?? record.limit_name) === null
      ? { limitName: (record.limitName ?? record.limit_name) as string | null }
      : {}),
    ...(asKnownString(record.planType ?? record.plan_type)
      ? { planType: asKnownString(record.planType ?? record.plan_type) }
      : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(credits
      ? {
          credits: {
            ...(typeof credits.hasCredits === "boolean" ? { hasCredits: credits.hasCredits } : {}),
            ...(typeof credits.unlimited === "boolean" ? { unlimited: credits.unlimited } : {}),
            ...(asString(credits.balance ?? credits.remaining_balance)
              ? { balance: asString(credits.balance ?? credits.remaining_balance) }
              : {}),
          },
        }
      : {}),
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) {
    return undefined;
  }
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  try {
    return asRecord(JSON.parse(Buffer.from(padded, "base64").toString("utf8")));
  } catch {
    return undefined;
  }
}

function normalizeAccountType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === "apikey" || lower === "api_key") {
    return "apiKey";
  }
  if (lower === "chatgpt") {
    return "chatgpt";
  }
  return value;
}

function mergeProfiles(
  primary: Omit<CodexAccountProfile, "syncedAt"> | undefined,
  fallback: Omit<CodexAccountProfile, "syncedAt"> | undefined,
): Omit<CodexAccountProfile, "syncedAt"> | undefined {
  if (!primary && !fallback) return undefined;
  const merged: Omit<CodexAccountProfile, "syncedAt"> = {
    ...(primary?.type ? { type: primary.type } : fallback?.type ? { type: fallback.type } : {}),
    ...(primary?.email
      ? { email: primary.email }
      : fallback?.email
        ? { email: fallback.email }
        : {}),
    ...(primary?.name ? { name: primary.name } : fallback?.name ? { name: fallback.name } : {}),
    ...(primary?.planType
      ? { planType: primary.planType }
      : fallback?.planType
        ? { planType: fallback.planType }
        : {}),
    ...(primary?.rateLimits
      ? { rateLimits: primary.rateLimits }
      : fallback?.rateLimits
        ? { rateLimits: fallback.rateLimits }
        : {}),
  };

  if (
    !merged.type &&
    !merged.email &&
    !merged.name &&
    !merged.planType &&
    !merged.rateLimits
  ) {
    return undefined;
  }

  return merged;
}

function readProfileFromAuthData(
  rawAuthData: unknown,
): Omit<CodexAccountProfile, "syncedAt"> | undefined {
  const authData = asRecord(rawAuthData);
  if (!authData) {
    return undefined;
  }

  const authMode = asKnownString(authData.auth_mode);
  const tokens = asRecord(authData.tokens);
  const tokenPayload = decodeJwtPayload(asKnownString(tokens?.id_token) ?? "");
  const openaiAuth = asRecord(tokenPayload?.["https://api.openai.com/auth"]);

  const type = normalizeAccountType(
    authMode === "chatgpt"
      ? "chatgpt"
      : authMode === "api_key" || authMode === "apikey"
        ? "apiKey"
        : asKnownString(tokenPayload?.account_type) ?? asKnownString(authData.type),
  );
  const email = asKnownString(tokenPayload?.email) ?? asKnownString(authData.email);
  const name =
    asKnownString(tokenPayload?.name) ??
    asKnownString(tokenPayload?.preferred_username) ??
    asKnownString(authData.name);
  const planType =
    asKnownString(openaiAuth?.chatgpt_plan_type) ??
    asKnownString(tokenPayload?.chatgpt_plan_type) ??
    asKnownString(tokenPayload?.plan_type) ??
    asKnownString(authData.plan_type);
  const rateLimits = normalizeRateLimits(authData.rateLimits ?? authData.rate_limits);

  if (!type && !email && !name && !planType && !rateLimits) {
    return undefined;
  }

  return {
    ...(type ? { type } : {}),
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(planType ? { planType } : {}),
    ...(rateLimits ? { rateLimits } : {}),
  };
}

async function readProfileFromAuthJson(
  profilePath: string,
): Promise<Omit<CodexAccountProfile, "syncedAt"> | undefined> {
  const authPath = path.join(profilePath, "auth.json");
  try {
    const raw = await fs.readFile(authPath, "utf8");
    return readProfileFromAuthData(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

async function sendJsonRpcRequest(params: {
  readonly write: (value: string) => void;
  readonly pending: Map<number, (response: JsonRpcResponse) => void>;
  readonly method: string;
  readonly params?: unknown;
  readonly requestId: number;
  readonly timeoutMs: number;
}): Promise<JsonRpcResponse> {
  const { write, pending, method, requestId, timeoutMs } = params;

  return await new Promise<JsonRpcResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Timeout waiting for ${method}`));
    }, timeoutMs);

    pending.set(requestId, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });

    write(
      `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params: params.params ?? {} })}\n`,
    );
  });
}

export async function readCodexAccountProfile(
  profilePath: string,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<CodexAccountProfile | undefined> {
  const authProfile = await readProfileFromAuthJson(profilePath).catch(() => undefined);
  const child = spawn("codex", ["app-server"], {
    env: {
      ...process.env,
      CODEX_HOME: profilePath,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const output = readline.createInterface({ input: child.stdout });
  const errors = readline.createInterface({ input: child.stderr });
  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  let requestId = 1;
  let closed = false;

  const settlePending = (response: JsonRpcResponse) => {
    if (typeof response.id !== "number") return;
    const resolver = pending.get(response.id);
    if (!resolver) return;
    pending.delete(response.id);
    resolver(response);
  };

  output.on("line", (line) => {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return;
    }
    settlePending(parsed);
  });
  errors.on("line", () => undefined);

  child.on("close", (code) => {
    closed = true;
    if (pending.size === 0) {
      return;
    }
    const exitCode = typeof code === "number" ? code : -1;
    for (const [id, resolver] of pending.entries()) {
      resolver({
        id,
        error: { message: `codex app-server exited with code ${String(exitCode)}` },
      });
    }
    pending.clear();
  });

  const write = (value: string) => {
    if (closed) {
      return;
    }
    child.stdin.write(value);
  };

  try {
    const initialized = await sendJsonRpcRequest({
      write,
      pending,
      method: "initialize",
      params: APP_SERVER_INITIALIZE_PARAMS,
      requestId: requestId++,
      timeoutMs: requestTimeoutMs,
    });
    if (initialized.error) {
      return authProfile;
    }

    write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);

    const [accountRead, rateLimitsRead] = await Promise.all([
      sendJsonRpcRequest({
        write,
        pending,
        method: "account/read",
        requestId: requestId++,
        timeoutMs: requestTimeoutMs,
      }).catch(() => ({ result: undefined } as JsonRpcResponse)),
      sendJsonRpcRequest({
        write,
        pending,
        method: "account/rateLimits/read",
        requestId: requestId++,
        timeoutMs: requestTimeoutMs,
      }).catch(() => ({ result: undefined } as JsonRpcResponse)),
    ]);

    const accountPayload = asObject(accountRead.result);
    const account = asObject(accountPayload?.account) ?? accountPayload;

    const rateLimitsPayload = asObject(rateLimitsRead.result);
    const rateLimits = normalizeRateLimits(rateLimitsPayload?.rateLimits ?? rateLimitsPayload);

    const type = normalizeAccountType(asKnownString(account?.type));
    const email = asString(account?.email);
    const name = asString(account?.name);
    const planType = asKnownString(account?.planType) ?? rateLimits?.planType;

    const appServerProfile: Omit<CodexAccountProfile, "syncedAt"> | undefined =
      !type && !email && !name && !planType && !rateLimits
        ? undefined
        : {
            ...(type ? { type } : {}),
            ...(email ? { email } : {}),
            ...(name ? { name } : {}),
            ...(planType ? { planType } : {}),
            ...(rateLimits ? { rateLimits } : {}),
          };

    const mergedProfile = mergeProfiles(appServerProfile, authProfile);
    if (!mergedProfile) {
      return undefined;
    }

    return {
      ...mergedProfile,
      syncedAt: new Date().toISOString(),
    };
  } catch {
    if (!authProfile) {
      return undefined;
    }
    return {
      ...authProfile,
      syncedAt: new Date().toISOString(),
    };
  } finally {
    output.close();
    errors.close();
    child.kill("SIGTERM");
    pending.clear();
  }
}

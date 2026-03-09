import { spawn } from "node:child_process";
import readline from "node:readline";
import type { CodexAccountProfile, CodexRateLimitWindow, CodexRateLimits } from "@t3tools/contracts";

interface JsonRpcResponse {
  readonly id?: string | number;
  readonly result?: unknown;
  readonly error?: unknown;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
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
  const usedPercent = normalizeUsedPercent(record.usedPercent);
  if (usedPercent === undefined) return undefined;
  const windowDurationMins = asNumber(record.windowDurationMins);
  const resetsAt = asNumber(record.resetsAt);
  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
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
    ...(asString(record.limitId) ? { limitId: asString(record.limitId) } : {}),
    ...(typeof record.limitName === "string" || record.limitName === null
      ? { limitName: record.limitName as string | null }
      : {}),
    ...(asString(record.planType) ? { planType: asString(record.planType) } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(credits
      ? {
          credits: {
            ...(typeof credits.hasCredits === "boolean" ? { hasCredits: credits.hasCredits } : {}),
            ...(typeof credits.unlimited === "boolean" ? { unlimited: credits.unlimited } : {}),
            ...(asString(credits.balance) ? { balance: asString(credits.balance) } : {}),
          },
        }
      : {}),
  };
}

async function sendJsonRpcRequest(params: {
  readonly write: (value: string) => void;
  readonly pending: Map<number, (response: JsonRpcResponse) => void>;
  readonly method: string;
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
      `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params: {} })}\n`,
    );
  });
}

export async function readCodexAccountProfile(
  profilePath: string,
  requestTimeoutMs = 4_000,
): Promise<CodexAccountProfile | undefined> {
  const child = spawn("codex", ["app-server"], {
    env: {
      ...process.env,
      CODEX_HOME: profilePath,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const output = readline.createInterface({ input: child.stdout });
  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  let requestId = 1;

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

  const write = (value: string) => {
    child.stdin.write(value);
  };

  try {
    const initialized = await sendJsonRpcRequest({
      write,
      pending,
      method: "initialize",
      requestId: requestId++,
      timeoutMs: requestTimeoutMs,
    });
    if (initialized.error) {
      return undefined;
    }

    write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const accountRead = await sendJsonRpcRequest({
      write,
      pending,
      method: "account/read",
      requestId: requestId++,
      timeoutMs: requestTimeoutMs,
    }).catch(() => ({ result: undefined } as JsonRpcResponse));

    const rateLimitsRead = await sendJsonRpcRequest({
      write,
      pending,
      method: "account/rateLimits/read",
      requestId: requestId++,
      timeoutMs: requestTimeoutMs,
    }).catch(() => ({ result: undefined } as JsonRpcResponse));

    const accountPayload = asObject(accountRead.result);
    const account = asObject(accountPayload?.account) ?? accountPayload;

    const rateLimitsPayload = asObject(rateLimitsRead.result);
    const rateLimits = normalizeRateLimits(rateLimitsPayload?.rateLimits);

    const type = asString(account?.type);
    const email = asString(account?.email);
    const name = asString(account?.name);
    const planType = asString(account?.planType) ?? rateLimits?.planType;

    if (!type && !email && !name && !planType && !rateLimits) {
      return undefined;
    }

    return {
      ...(type ? { type } : {}),
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(planType ? { planType } : {}),
      ...(rateLimits ? { rateLimits } : {}),
      syncedAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  } finally {
    output.close();
    child.kill("SIGTERM");
    pending.clear();
  }
}

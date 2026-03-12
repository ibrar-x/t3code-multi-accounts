import * as Http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Exit, Layer, Scope } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  WS_METHODS,
  type WebSocketResponse,
  type ProviderAccount,
} from "@t3tools/contracts";

import { createServer } from "./wsServer";
import { ServerConfig, type ServerConfigShape } from "./config";
import { makeServerProviderLayer, makeServerRuntimeServicesLayer } from "./serverLayers";
import { ProviderHealth, type ProviderHealthShape } from "./provider/Services/ProviderHealth";
import { Open, type OpenShape } from "./open";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService";
import { accountManager } from "./accounts/accountManager";
import * as CodexProfileProbe from "./accounts/codexProfileProbe.ts";

interface PendingMessages {
  queue: unknown[];
  waiters: Array<(message: unknown) => void>;
}

const pendingBySocket = new WeakMap<WebSocket, PendingMessages>();

const defaultOpenService: OpenShape = {
  openBrowser: () => Effect.void,
  openInEditor: () => Effect.void,
};

const defaultProviderHealthService: ProviderHealthShape = {
  getStatuses: Effect.succeed([
    {
      provider: "codex",
      status: "ready",
      available: true,
      authStatus: "authenticated",
      checkedAt: "2026-01-01T00:00:00.000Z",
    },
  ]),
};

function makeAccount(id: string): ProviderAccount {
  return {
    id,
    providerKind: "codex",
    name: `Account ${id}`,
    profilePath: `/tmp/.t3code/accounts/${id}`,
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
  };
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    const pending: PendingMessages = { queue: [], waiters: [] };
    pendingBySocket.set(ws, pending);

    ws.on("message", (raw) => {
      const parsed = JSON.parse(String(raw));
      const waiter = pending.waiters.shift();
      if (waiter) {
        waiter(parsed);
        return;
      }
      pending.queue.push(parsed);
    });

    ws.once("open", () => resolve(ws));
    ws.once("error", () => reject(new Error("WebSocket connection failed")));
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  const pending = pendingBySocket.get(ws);
  if (!pending) {
    return Promise.reject(new Error("WebSocket not initialized"));
  }

  const queued = pending.queue.shift();
  if (queued !== undefined) {
    return Promise.resolve(queued);
  }

  return new Promise((resolve) => {
    pending.waiters.push(resolve);
  });
}

function asWebSocketResponse(message: unknown): WebSocketResponse | null {
  if (typeof message !== "object" || message === null) return null;
  if (!("id" in message)) return null;
  const id = (message as { id?: unknown }).id;
  if (typeof id !== "string") return null;
  return message as WebSocketResponse;
}

async function sendRequest(
  ws: WebSocket,
  method: string,
  params?: Record<string, unknown>,
): Promise<WebSocketResponse> {
  const id = crypto.randomUUID();
  const body = params ? { _tag: method, ...params } : { _tag: method };
  ws.send(JSON.stringify({ id, body }));

  while (true) {
    const parsed = asWebSocketResponse(await waitForMessage(ws));
    if (!parsed) {
      continue;
    }
    if (parsed.id === id || parsed.id === "unknown") {
      return parsed;
    }
  }
}

describe("wsServer account method routing", () => {
  let server: Http.Server | null = null;
  let serverScope: Scope.Closeable | null = null;
  let stateDir: string | null = null;
  const sockets: WebSocket[] = [];

  async function createTestServer(): Promise<Http.Server> {
    if (serverScope) {
      throw new Error("Test server already running");
    }

    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-ws-accounts-"));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    const providerLayer = makeServerProviderLayer();
    const infrastructure = providerLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory));
    const runtimeLayer = makeServerRuntimeServicesLayer().pipe(Layer.provide(infrastructure));
    const serverConfigLayer = Layer.succeed(ServerConfig, {
      mode: "web",
      port: 0,
      host: undefined,
      cwd: "/test/project",
      keybindingsConfigPath: path.join(stateDir, "keybindings.json"),
      stateDir,
      staticDir: undefined,
      devUrl: undefined,
      noBrowser: true,
      authToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
    } satisfies ServerConfigShape);

    const dependencies = Layer.empty.pipe(
      Layer.provideMerge(runtimeLayer),
      Layer.provideMerge(infrastructure),
      Layer.provideMerge(Layer.succeed(ProviderHealth, defaultProviderHealthService)),
      Layer.provideMerge(Layer.succeed(Open, defaultOpenService)),
      Layer.provideMerge(serverConfigLayer),
      Layer.provideMerge(AnalyticsService.layerTest),
      Layer.provideMerge(NodeServices.layer),
    );

    const runtimeServices = await Effect.runPromise(
      Layer.build(dependencies).pipe(Scope.provide(scope)),
    );
    const runningServer = await Effect.runPromise(
      createServer().pipe(Effect.provide(runtimeServices), Scope.provide(scope)),
    );
    serverScope = scope;
    return runningServer;
  }

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    sockets.length = 0;

    if (serverScope) {
      await Effect.runPromise(Scope.close(serverScope, Exit.void));
      serverScope = null;
    }
    server = null;

    if (stateDir) {
      fs.rmSync(stateDir, { recursive: true, force: true });
      stateDir = null;
    }

    vi.restoreAllMocks();
  });

  it("routes accounts.list", async () => {
    const account = makeAccount("acc_1");
    vi.spyOn(accountManager, "listAccounts").mockResolvedValue([account]);

    server = await createTestServer();
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    const ws = await connectWs(port);
    sockets.push(ws);
    await waitForMessage(ws); // welcome push

    const response = await sendRequest(ws, WS_METHODS.accountsList);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      accounts: [expect.objectContaining({ id: account.id })],
    });
  });

  it("routes accounts.add success and error envelopes", async () => {
    const account = makeAccount("acc_new");
    vi.spyOn(accountManager, "addAccount").mockResolvedValueOnce(account);

    server = await createTestServer();
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const ws = await connectWs(port);
    sockets.push(ws);
    await waitForMessage(ws); // welcome push

    const success = await sendRequest(ws, WS_METHODS.accountsAdd, {
      providerKind: "codex",
      name: "Work",
    });
    expect(success.error).toBeUndefined();
    expect(success.result).toEqual({ account });

    vi.spyOn(accountManager, "addAccount").mockRejectedValueOnce(new Error("login failed"));
    const failure = await sendRequest(ws, WS_METHODS.accountsAdd, {
      providerKind: "codex",
      name: "Broken",
    });
    expect(failure.error?.message).toContain("login failed");
  });

  it("routes accounts.remove and returns errors for unknown account ids", async () => {
    const account = makeAccount("acc_remove");
    vi.spyOn(accountManager, "getAccountById").mockImplementation(async (accountId) =>
      accountId === account.id ? account : undefined,
    );
    const removeSpy = vi.spyOn(accountManager, "removeAccount").mockResolvedValue(undefined);

    server = await createTestServer();
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const ws = await connectWs(port);
    sockets.push(ws);
    await waitForMessage(ws); // welcome push

    const success = await sendRequest(ws, WS_METHODS.accountsRemove, { accountId: account.id });
    expect(success.error).toBeUndefined();
    expect(success.result).toEqual({ success: true });
    expect(removeSpy).toHaveBeenCalledWith(expect.objectContaining({ id: account.id }));

    const missing = await sendRequest(ws, WS_METHODS.accountsRemove, { accountId: "acc_missing" });
    expect(missing.error?.message).toContain('Account "acc_missing" not found');
  });

  it("routes accounts.check missing and existing account flows", async () => {
    const account = makeAccount("acc_check");
    vi.spyOn(accountManager, "getAccountById").mockImplementation(async (accountId) =>
      accountId === account.id ? account : undefined,
    );
    vi.spyOn(accountManager, "checkAccount").mockResolvedValue({
      accountId: account.id,
      valid: true,
      reason: "ok",
    });

    server = await createTestServer();
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const ws = await connectWs(port);
    sockets.push(ws);
    await waitForMessage(ws); // welcome push

    const existing = await sendRequest(ws, WS_METHODS.accountsCheck, { accountId: account.id });
    expect(existing.error).toBeUndefined();
    expect(existing.result).toEqual({
      accountId: account.id,
      valid: true,
      reason: "ok",
    });

    const missing = await sendRequest(ws, WS_METHODS.accountsCheck, { accountId: "acc_missing" });
    expect(missing.error).toBeUndefined();
    expect(missing.result).toEqual({
      accountId: "acc_missing",
      valid: false,
      reason: "missing",
    });
  });

  it("routes accounts.supported", async () => {
    server = await createTestServer();
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const ws = await connectWs(port);
    sockets.push(ws);
    await waitForMessage(ws); // welcome push

    const response = await sendRequest(ws, WS_METHODS.accountsSupported);
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({
      providers: expect.arrayContaining(["codex", "claudeCode"]),
    });
  });

  it("routes accounts.current for fast default codex snapshot", async () => {
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = "/tmp/t3code-current-account-test";
    vi.spyOn(CodexProfileProbe, "readCodexAccountProfileFromAuthJson").mockResolvedValue({
      type: "chatgpt",
      email: "fast@example.com",
      planType: "pro",
      syncedAt: "2026-01-01T00:00:00.000Z",
    });

    try {
      server = await createTestServer();
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const ws = await connectWs(port);
      sockets.push(ws);
      await waitForMessage(ws); // welcome push

      const response = await sendRequest(ws, WS_METHODS.accountsCurrent, {
        providerKind: "codex",
      });
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({
        providerKind: "codex",
        account: expect.objectContaining({
          providerKind: "codex",
          isDefault: true,
          codexProfile: expect.objectContaining({
            email: "fast@example.com",
            planType: "pro",
          }),
        }),
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });
});

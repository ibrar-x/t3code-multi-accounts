import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ApprovalRequestId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
    spawnSync: spawnSyncMock,
  };
});

import { CodexAppServerManager } from "./codexAppServerManager.ts";

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

class MockChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  pid = 1234;

  kill = vi.fn(() => {
    this.killed = true;
    this.emit("exit", 0, null);
    return true;
  });
}

function createManagerWithSessionStartStub() {
  const manager = new CodexAppServerManager();
  const sendRequest = vi
    .spyOn(
      manager as unknown as {
        sendRequest: (
          context: unknown,
          method: string,
          params: unknown,
          timeoutMs?: number,
        ) => Promise<unknown>;
      },
      "sendRequest",
    )
    .mockImplementation(async (_context, method) => {
      if (method === "thread/start") {
        return {
          thread: {
            id: "provider-thread-1",
          },
        };
      }
      return {};
    });
  return { manager, sendRequest };
}

describe("CodexAppServerManager account env wiring", () => {
  const originalCodexHome = process.env.CODEX_HOME;

  beforeEach(() => {
    spawnSyncMock.mockReset();
    spawnMock.mockReset();
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: "0.40.0",
      stderr: "",
    });
  });

  afterEach(() => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    vi.restoreAllMocks();
  });

  it("merges start input env over process and provider options", async () => {
    process.env.CODEX_HOME = "/system-codex-home";
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
    const { manager } = createManagerWithSessionStartStub();

    await manager.startSession({
      threadId: asThreadId("thread-1"),
      runtimeMode: "full-access",
      providerOptions: {
        codex: {
          binaryPath: "/opt/custom-codex",
          homePath: "/settings-codex-home",
        },
      },
      env: {
        CODEX_HOME: "/account-codex-home",
        T3_ACCOUNT_ID: "acc_123",
      },
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[0]).toBe("/opt/custom-codex");
    const spawnOptions = spawnMock.mock.calls[0]?.[2] as { env?: Record<string, string> };
    expect(spawnOptions.env?.CODEX_HOME).toBe("/account-codex-home");
    expect(spawnOptions.env?.T3_ACCOUNT_ID).toBe("acc_123");

    manager.stopAll();
  });

  it("keeps provider CODEX_HOME behavior when no session env override is provided", async () => {
    const child = new MockChildProcess();
    spawnMock.mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
    const { manager } = createManagerWithSessionStartStub();

    await manager.startSession({
      threadId: asThreadId("thread-2"),
      runtimeMode: "full-access",
      providerOptions: {
        codex: {
          homePath: "/settings-codex-home",
        },
      },
    });

    const spawnOptions = spawnMock.mock.calls[0]?.[2] as { env?: Record<string, string> };
    expect(spawnOptions.env?.CODEX_HOME).toBe("/settings-codex-home");

    manager.stopAll();
  });

  it("stops existing sessions before replacing the same thread and keeps new session active", async () => {
    const children: MockChildProcess[] = [];
    spawnMock.mockImplementation(() => {
      const child = new MockChildProcess();
      children.push(child);
      return child as unknown as ChildProcessWithoutNullStreams;
    });

    const { manager } = createManagerWithSessionStartStub();
    const stopSpy = vi.spyOn(manager, "stopSession");

    await manager.startSession({
      threadId: asThreadId("thread-3"),
      runtimeMode: "full-access",
    });
    await manager.startSession({
      threadId: asThreadId("thread-3"),
      runtimeMode: "full-access",
    });

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledWith(asThreadId("thread-3"));
    expect(manager.hasSession(asThreadId("thread-3"))).toBe(true);

    const firstChild = children[0];
    firstChild?.emit("exit", 0, null);
    expect(manager.hasSession(asThreadId("thread-3"))).toBe(true);

    stopSpy.mockRestore();
    manager.stopAll();
  });

  it("does not delete pending user input when answer conversion fails", async () => {
    const manager = new CodexAppServerManager();
    const requestId = ApprovalRequestId.makeUnsafe("req-user-input-1");
    const context = {
      session: {
        provider: "codex",
        status: "ready",
        threadId: asThreadId("thread-4"),
        runtimeMode: "full-access",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      pendingUserInputs: new Map([
        [
          requestId,
          {
            requestId,
            jsonRpcId: 77,
            threadId: asThreadId("thread-4"),
          },
        ],
      ]),
    };

    vi.spyOn(
      manager as unknown as { requireSession: (threadId: ThreadId) => unknown },
      "requireSession",
    ).mockReturnValue(context);

    await expect(
      manager.respondToUserInput(asThreadId("thread-4"), requestId, {
        question: 123 as unknown as string,
      }),
    ).rejects.toThrow("User input answers must be strings or arrays of strings.");

    expect(context.pendingUserInputs.has(requestId)).toBe(true);
  });
});

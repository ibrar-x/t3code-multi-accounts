import {
  type ProviderAccount,
  type ProviderSession,
  type ProviderSessionStartInput,
  ThreadId,
  type TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ProviderService } from "../Services/ProviderService.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import { makeProviderServiceLive } from "./ProviderService.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import { accountManager } from "../../accounts/accountManager.ts";

const NOW = "2026-03-08T00:00:00.000Z";

function asThreadId(value: string): ThreadId {
  return ThreadId.makeUnsafe(value);
}

function makeAccount(input: {
  id: string;
  providerKind?: "codex" | "claudeCode" | "cursor";
  isDefault?: boolean;
  profilePath?: string;
}): ProviderAccount {
  return {
    id: input.id,
    providerKind: input.providerKind ?? "codex",
    name: input.id,
    profilePath: input.profilePath ?? `/tmp/.t3code/accounts/${input.id}`,
    isDefault: input.isDefault ?? false,
    createdAt: NOW,
    lastUsedAt: null,
  };
}

function makeFixture() {
  const bindings = new Map<ThreadId, ProviderRuntimeBinding>();
  const sessions = new Map<ThreadId, ProviderSession>();

  const startSession = vi.fn((input: ProviderSessionStartInput) =>
    Effect.sync(() => {
      const session: ProviderSession = {
        provider: "codex",
        status: "ready",
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        cwd: input.cwd,
        model: input.model,
        createdAt: NOW,
        updatedAt: NOW,
      };
      sessions.set(session.threadId, session);
      return session;
    }),
  );

  const adapter = {
    provider: "codex" as const,
    capabilities: { sessionModelSwitch: "in-session" as const },
    startSession,
    sendTurn: vi.fn(() =>
      Effect.fail(new Error("sendTurn not expected in account resolution tests")),
    ),
    interruptTurn: vi.fn(() => Effect.void),
    respondToRequest: vi.fn(() => Effect.void),
    respondToUserInput: vi.fn(() => Effect.void),
    stopSession: vi.fn((threadId: ThreadId) =>
      Effect.sync(() => {
        sessions.delete(threadId);
      }),
    ),
    listSessions: vi.fn(() => Effect.succeed(Array.from(sessions.values()))),
    hasSession: vi.fn((threadId: ThreadId) => Effect.succeed(sessions.has(threadId))),
    readThread: vi.fn((threadId: ThreadId) =>
      Effect.succeed({ threadId, turns: [] as Array<{ id: TurnId; items: readonly [] }> }),
    ),
    rollbackThread: vi.fn((threadId: ThreadId) =>
      Effect.succeed({ threadId, turns: [] as const }),
    ),
    stopAll: vi.fn(() =>
      Effect.sync(() => {
        sessions.clear();
      }),
    ),
    streamEvents: Stream.empty,
  };

  const registry: typeof ProviderAdapterRegistry.Service = {
    getByProvider: () => Effect.succeed(adapter as never),
    listProviders: () => Effect.succeed(["codex"]),
  };

  const directory: typeof ProviderSessionDirectory.Service = {
    upsert: (binding) =>
      Effect.sync(() => {
        bindings.set(binding.threadId, binding);
      }),
    getProvider: (threadId) =>
      Effect.sync(() => {
        const binding = bindings.get(threadId);
        if (!binding) {
          throw new Error(`missing binding for ${threadId}`);
        }
        return binding.provider;
      }),
    getBinding: (threadId) =>
      Effect.succeed(bindings.has(threadId) ? Option.some(bindings.get(threadId)!) : Option.none()),
    remove: (threadId) =>
      Effect.sync(() => {
        bindings.delete(threadId);
      }),
    listThreadIds: () => Effect.succeed(Array.from(bindings.keys())),
  };

  const layer = makeProviderServiceLive().pipe(
    Layer.provide(Layer.succeed(ProviderAdapterRegistry, registry)),
    Layer.provide(Layer.succeed(ProviderSessionDirectory, directory)),
    Layer.provide(AnalyticsService.layerTest),
  );

  return { startSession, layer };
}

describe("ProviderService account resolution", () => {
  it("injects CODEX_HOME from an explicitly selected account", async () => {
    const fixture = makeFixture();
    const account = makeAccount({
      id: "acc_explicit",
      profilePath: "/tmp/.t3code/accounts/acc_explicit",
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const providerService = yield* ProviderService;
        yield* providerService.startSession(asThreadId("thread-explicit"), {
          threadId: asThreadId("thread-explicit"),
          provider: "codex",
          account,
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(fixture.layer), Effect.scoped),
    );

    const forwarded = fixture.startSession.mock.calls[0]?.[0];
    expect(forwarded?.env).toEqual({ CODEX_HOME: account.profilePath });
  });

  it("falls back to provider default account when no explicit selection is provided", async () => {
    const fixture = makeFixture();
    const fallbackDefault = makeAccount({
      id: "acc_default",
      isDefault: true,
      profilePath: "/tmp/.t3code/accounts/acc_default",
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const providerService = yield* ProviderService;
        yield* providerService.startSession(asThreadId("thread-default"), {
          threadId: asThreadId("thread-default"),
          provider: "codex",
          accounts: [fallbackDefault, makeAccount({ id: "acc_other", isDefault: false })],
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(fixture.layer), Effect.scoped),
    );

    const forwarded = fixture.startSession.mock.calls[0]?.[0];
    expect(forwarded?.env).toEqual({ CODEX_HOME: fallbackDefault.profilePath });
  });

  it("warns and safely falls back when explicit accountId is missing", async () => {
    const fixture = makeFixture();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await Effect.runPromise(
      Effect.gen(function* () {
        const providerService = yield* ProviderService;
        yield* providerService.startSession(asThreadId("thread-missing"), {
          threadId: asThreadId("thread-missing"),
          provider: "codex",
          accountId: "acc_missing",
          accounts: [makeAccount({ id: "acc_known", isDefault: false })],
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(fixture.layer), Effect.scoped),
    );

    const forwarded = fixture.startSession.mock.calls[0]?.[0];
    expect(forwarded?.env).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('accountId "acc_missing" not found'),
    );
  });

  it("resolves explicit accountId from account manager when accounts are not provided", async () => {
    const fixture = makeFixture();
    const managedAccount = makeAccount({
      id: "acc_managed",
      profilePath: "/tmp/.t3code/accounts/acc_managed",
    });
    const getByIdSpy = vi
      .spyOn(accountManager, "getAccountById")
      .mockResolvedValue(managedAccount);
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const providerService = yield* ProviderService;
          yield* providerService.startSession(asThreadId("thread-managed"), {
            threadId: asThreadId("thread-managed"),
            provider: "codex",
            accountId: managedAccount.id,
            runtimeMode: "full-access",
          });
        }).pipe(Effect.provide(fixture.layer), Effect.scoped),
      );

      expect(getByIdSpy).toHaveBeenCalledWith(managedAccount.id);
      const forwarded = fixture.startSession.mock.calls[0]?.[0];
      expect(forwarded?.env).toEqual({ CODEX_HOME: managedAccount.profilePath });
    } finally {
      getByIdSpy.mockRestore();
    }
  });

  it("keeps account fallback deterministic across reconnect-style repeated starts", async () => {
    const fixture = makeFixture();
    const fallbackDefault = makeAccount({
      id: "acc_default",
      isDefault: true,
      profilePath: "/tmp/.t3code/accounts/acc_default",
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const providerService = yield* ProviderService;
        yield* providerService.startSession(asThreadId("thread-repeat"), {
          threadId: asThreadId("thread-repeat"),
          provider: "codex",
          accounts: [fallbackDefault],
          runtimeMode: "full-access",
        });
        yield* providerService.startSession(asThreadId("thread-repeat"), {
          threadId: asThreadId("thread-repeat"),
          provider: "codex",
          accounts: [fallbackDefault],
          runtimeMode: "full-access",
        });
      }).pipe(Effect.provide(fixture.layer), Effect.scoped),
    );

    expect(fixture.startSession).toHaveBeenCalledTimes(2);
    expect(fixture.startSession.mock.calls[0]?.[0]?.env).toEqual({
      CODEX_HOME: fallbackDefault.profilePath,
    });
    expect(fixture.startSession.mock.calls[1]?.[0]?.env).toEqual({
      CODEX_HOME: fallbackDefault.profilePath,
    });
  });
});

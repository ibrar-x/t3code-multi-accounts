import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexAccountProfile, ProviderKind } from "@t3tools/contracts";
import { createAccountManager } from "./accountManager.ts";
import { createAccountStore } from "./accountStore.ts";
import type { CredentialIsolationStrategy, CredentialStatus } from "./credentialStrategy.ts";

const tempDirs: Array<string> = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "t3-account-manager-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

interface TestFixture {
  rootDir: string;
  accountsDir: string;
  storePath: string;
  manager: ReturnType<typeof createAccountManager>;
  strategyByProvider: Map<ProviderKind, MockStrategy>;
}

type MockStrategy = CredentialIsolationStrategy & {
  initProfileDir: ReturnType<typeof vi.fn<(profilePath: string) => Promise<void>>>;
  runLoginFlow: ReturnType<
    typeof vi.fn<
      (profilePath: string, options?: { apiKey?: string; readonly [key: string]: string | undefined }) => Promise<void>
    >
  >;
  getSessionEnv: ReturnType<typeof vi.fn<(profilePath: string) => Record<string, string>>>;
  checkCredentials: ReturnType<typeof vi.fn<(profilePath: string) => Promise<CredentialStatus>>>;
  removeProfile: ReturnType<typeof vi.fn<(profilePath: string) => Promise<void>>>;
};

function createMockStrategy(providerKind: ProviderKind): MockStrategy {
  return {
    providerKind,
    initProfileDir: vi.fn(async (profilePath: string) => {
      await fs.mkdir(profilePath, { recursive: true });
    }),
    runLoginFlow: vi.fn(async (profilePath: string, options) => {
      const marker = path.join(profilePath, "credentials.marker");
      await fs.writeFile(marker, options?.apiKey ?? "ok", "utf8");
    }),
    getSessionEnv: vi.fn((profilePath: string) => {
      if (providerKind === "claudeCode") {
        return { ANTHROPIC_API_KEY: "sk-ant-test" };
      }
      return { CODEX_HOME: profilePath };
    }),
    checkCredentials: vi.fn(async () => ({ valid: true })),
    removeProfile: vi.fn(async (profilePath: string) => {
      await fs.rm(profilePath, { recursive: true, force: true });
    }),
  };
}

function createFixtureManager(input: {
  readonly accountsDir: string;
  readonly storePath: string;
  readonly strategyByProvider: Map<ProviderKind, MockStrategy>;
  readonly nowIso?: string;
  readonly idFactory?: () => string;
  readonly readCodexProfile?: (profilePath: string) => Promise<CodexAccountProfile | undefined>;
  readonly readCodexProfileFromAuthJson?: (
    profilePath: string,
  ) => Promise<CodexAccountProfile | undefined>;
}) {
  return createAccountManager({
    accountsDir: input.accountsDir,
    store: createAccountStore({ storePath: input.storePath }),
    hasStrategy: (providerKind) => input.strategyByProvider.has(providerKind),
    getStrategy: (providerKind) => {
      const strategy = input.strategyByProvider.get(providerKind);
      if (!strategy) {
        throw new Error(`missing strategy for "${providerKind}"`);
      }
      return strategy;
    },
    now: () => new Date(input.nowIso ?? "2026-01-01T00:00:00.000Z"),
    generateId: input.idFactory ?? (() => "acc_fixed"),
    readCodexProfile: input.readCodexProfile ?? (async () => undefined),
    readCodexProfileFromAuthJson: input.readCodexProfileFromAuthJson ?? (async () => undefined),
  });
}

async function makeFixture(): Promise<TestFixture> {
  const rootDir = await makeTempDir();
  const accountsDir = path.join(rootDir, "accounts");
  const storePath = path.join(rootDir, "state", "accounts.json");
  const strategyByProvider = new Map<ProviderKind, MockStrategy>([
    ["codex", createMockStrategy("codex")],
    ["claudeCode", createMockStrategy("claudeCode")],
  ]);
  let sequence = 0;
  const manager = createFixtureManager({
    accountsDir,
    storePath,
    strategyByProvider,
    idFactory: () => {
      sequence += 1;
      return `acc_${String(sequence).padStart(4, "0")}`;
    },
  });

  return { rootDir, accountsDir, storePath, manager, strategyByProvider };
}

describe("accountManager", () => {
  it("persists add/list/check/remove workflows across manager reloads", async () => {
    const fixture = await makeFixture();
    const account = await fixture.manager.addAccount("codex", "Personal");

    expect(account.id).toBe("acc_0001");
    expect(account.name).toBe("Personal");
    expect(account.createdAt).toBe("2026-01-01T00:00:00.000Z");

    const firstList = await fixture.manager.listAccounts();
    expect(firstList).toHaveLength(1);
    expect(firstList[0]?.id).toBe(account.id);

    const reloadedManager = createFixtureManager({
      accountsDir: fixture.accountsDir,
      storePath: fixture.storePath,
      strategyByProvider: fixture.strategyByProvider,
      idFactory: () => "acc_reload",
    });

    const reloadedList = await reloadedManager.listAccounts();
    expect(reloadedList).toHaveLength(1);
    expect(reloadedList[0]?.id).toBe(account.id);

    const check = await reloadedManager.checkAccount(account.id);
    expect(check).toEqual(
      expect.objectContaining({
        accountId: account.id,
        valid: true,
        reason: "ok",
      }),
    );

    await reloadedManager.removeAccount(account.id);
    const finalList = await reloadedManager.listAccounts();
    expect(finalList).toEqual([]);
    await expect(fs.stat(account.profilePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans up profile artifacts and store state when login fails", async () => {
    const fixture = await makeFixture();
    const codexStrategy = fixture.strategyByProvider.get("codex");
    if (!codexStrategy) {
      throw new Error("codex strategy fixture missing");
    }
    codexStrategy.runLoginFlow.mockRejectedValueOnce(new Error("Login cancelled"));

    await expect(fixture.manager.addAccount("codex", "Will Fail")).rejects.toThrow("Login cancelled");
    expect(await fixture.manager.listAccounts()).toEqual([]);
    expect(codexStrategy.removeProfile).toHaveBeenCalledTimes(1);

    const dirEntries = await fs
      .readdir(fixture.accountsDir, { withFileTypes: true })
      .catch((): Array<{ isDirectory(): boolean }> => []);
    expect(dirEntries.filter((entry) => entry.isDirectory())).toHaveLength(0);
  });

  it("returns deterministic errors for duplicate and missing account operations", async () => {
    const fixture = await makeFixture();
    await fixture.manager.addAccount("codex", "Work");

    await expect(fixture.manager.addAccount("codex", "Work")).rejects.toThrow(
      'An account named "Work" already exists for provider "codex".',
    );
    await expect(fixture.manager.removeAccount("acc_missing")).rejects.toThrow(
      'Account "acc_missing" not found.',
    );

    const missingCheck = await fixture.manager.checkAccount("acc_missing");
    expect(missingCheck).toEqual({
      accountId: "acc_missing",
      valid: false,
      reason: "missing",
    });
  });

  it("removes profile paths safely and reports missing account IDs on repeat delete", async () => {
    const fixture = await makeFixture();
    const account = await fixture.manager.addAccount("codex", "Delete Me");
    await fs.mkdir(path.join(account.profilePath, "nested"), { recursive: true });
    await fs.writeFile(path.join(account.profilePath, "nested", "file.txt"), "ok", "utf8");

    await fixture.manager.removeAccount(account.id);
    await expect(fs.stat(account.profilePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fixture.manager.removeAccount(account.id)).rejects.toThrow(
      `Account "${account.id}" not found.`,
    );
  });

  it("passes apiKey to login flow and resolves session env from stored account", async () => {
    const fixture = await makeFixture();
    const account = await fixture.manager.addAccount("claudeCode", "Main", {
      apiKey: "sk-ant-abc",
    });

    const claudeStrategy = fixture.strategyByProvider.get("claudeCode");
    if (!claudeStrategy) {
      throw new Error("claude strategy fixture missing");
    }
    expect(claudeStrategy.runLoginFlow).toHaveBeenCalledWith(account.profilePath, {
      apiKey: "sk-ant-abc",
    });

    expect(fixture.manager.getSessionEnv(account)).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
    expect(fixture.manager.getSessionEnv(undefined)).toBeUndefined();
  });

  it("throws for unsupported providers and falls back to missing status checks", async () => {
    const fixture = await makeFixture();
    await expect(fixture.manager.addAccount("cursor", "Unsupported")).rejects.toThrow(
      'Provider "cursor" is not supported yet.',
    );

    const check = await fixture.manager.checkAccount({
      id: "acc_custom",
      providerKind: "cursor",
      name: "Custom",
      profilePath: path.join(fixture.rootDir, "custom"),
      isDefault: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
    });
    expect(check).toEqual(
      expect.objectContaining({
        accountId: "acc_custom",
        valid: false,
        reason: "missing",
      }),
    );
  });

  it("hydrates persisted codex account details from auth profile reads during list", async () => {
    const fixture = await makeFixture();
    const account = await fixture.manager.addAccount("codex", "Personal");

    const manager = createFixtureManager({
      accountsDir: fixture.accountsDir,
      storePath: fixture.storePath,
      strategyByProvider: fixture.strategyByProvider,
      readCodexProfileFromAuthJson: async (profilePath) =>
        profilePath === account.profilePath
          ? {
              type: "chatgpt",
              email: "personal@example.com",
              name: "Personal Plus",
              planType: "plus",
              syncedAt: "2026-01-01T00:00:00.000Z",
            }
          : undefined,
    });

    const list = await manager.listAccounts();
    const hydrated = list.find((entry) => entry.id === account.id);
    expect(hydrated?.credentialStatus).toBe("ok");
    expect(hydrated?.codexProfile).toMatchObject({
      email: "personal@example.com",
      name: "Personal Plus",
      planType: "plus",
      type: "chatgpt",
    });
  });

  it("probes codex usage details when auth profile has identity but no rate limits", async () => {
    const fixture = await makeFixture();
    const account = await fixture.manager.addAccount("codex", "Personal");

    const readCodexProfile = vi.fn(async (profilePath: string) =>
      profilePath === account.profilePath
        ? {
            type: "chatgpt" as const,
            email: "personal@example.com",
            planType: "team",
            rateLimits: {
              primary: {
                usedPercent: 36,
                remainingPercent: 64,
                windowDurationMins: 300,
              },
            },
            syncedAt: "2026-01-01T00:00:00.000Z",
          }
        : undefined,
    );

    const manager = createFixtureManager({
      accountsDir: fixture.accountsDir,
      storePath: fixture.storePath,
      strategyByProvider: fixture.strategyByProvider,
      readCodexProfile,
      readCodexProfileFromAuthJson: async (profilePath) =>
        profilePath === account.profilePath
          ? {
              type: "chatgpt",
              email: "personal@example.com",
              planType: "team",
              syncedAt: "2026-01-01T00:00:00.000Z",
            }
          : undefined,
    });

    const list = await manager.listAccounts();
    const hydrated = list.find((entry) => entry.id === account.id);
    expect(hydrated?.codexProfile?.rateLimits?.primary?.remainingPercent).toBe(64);
    expect(readCodexProfile).toHaveBeenCalledWith(account.profilePath);
  });

  it("does not duplicate system default when persisted codex account matches the same identity", async () => {
    const fixture = await makeFixture();
    const account = await fixture.manager.addAccount("codex", "Personal Plus");
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = account.profilePath;

    try {
      const manager = createFixtureManager({
        accountsDir: fixture.accountsDir,
        storePath: fixture.storePath,
        strategyByProvider: fixture.strategyByProvider,
        readCodexProfileFromAuthJson: async (profilePath) =>
          profilePath === account.profilePath
            ? {
                type: "chatgpt",
                email: "personal@example.com",
                name: "Personal Plus",
                planType: "plus",
                syncedAt: "2026-01-01T00:00:00.000Z",
              }
            : undefined,
      });

      const listed = await manager.listAccounts();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe(account.id);
      expect(listed[0]?.isDefault).toBe(false);
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });
});

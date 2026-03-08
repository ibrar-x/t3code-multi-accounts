import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ProviderAccount, ProviderKind } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assertProfilePathWithinAccountsDir, createAccountManager } from "./accountManager.ts";
import { createAccountStore } from "./accountStore.ts";
import type { CredentialIsolationStrategy, CredentialStatus } from "./credentialStrategy.ts";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "t3-account-hardening-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

type MockStrategy = CredentialIsolationStrategy & {
  readonly initProfileDir: ReturnType<typeof vi.fn<(profilePath: string) => Promise<void>>>;
  readonly runLoginFlow: ReturnType<typeof vi.fn<(profilePath: string) => Promise<void>>>;
  readonly getSessionEnv: ReturnType<typeof vi.fn<(profilePath: string) => Record<string, string>>>;
  readonly checkCredentials: ReturnType<typeof vi.fn<(profilePath: string) => Promise<CredentialStatus>>>;
  readonly removeProfile: ReturnType<typeof vi.fn<(profilePath: string) => Promise<void>>>;
};

function createMockStrategy(
  providerKind: ProviderKind,
  resolveStatus?: (profilePath: string) => CredentialStatus,
): MockStrategy {
  return {
    providerKind,
    initProfileDir: vi.fn(async (profilePath) => {
      await fs.mkdir(profilePath, { recursive: true });
    }),
    runLoginFlow: vi.fn(async () => undefined),
    getSessionEnv: vi.fn((profilePath) => ({ CODEX_HOME: profilePath })),
    checkCredentials: vi.fn(async (profilePath) =>
      resolveStatus ? resolveStatus(profilePath) : ({ valid: true } as const),
    ),
    removeProfile: vi.fn(async (profilePath) => {
      await fs.rm(profilePath, { recursive: true, force: true });
    }),
  };
}

function makeAccount(input: {
  id: string;
  profilePath: string;
  providerKind?: ProviderKind;
}): ProviderAccount {
  return {
    id: input.id,
    providerKind: input.providerKind ?? "codex",
    name: input.id,
    profilePath: input.profilePath,
    isDefault: false,
    createdAt: "2026-03-08T00:00:00.000Z",
    lastUsedAt: null,
  };
}

describe("assertProfilePathWithinAccountsDir", () => {
  it("accepts paths inside accounts directory", () => {
    const accountsDir = "/tmp/.t3code/accounts";
    const profilePath = "/tmp/.t3code/accounts/acc_123";

    expect(assertProfilePathWithinAccountsDir(profilePath, accountsDir)).toBe(profilePath);
  });

  it("rejects paths outside accounts directory and traversal attempts", () => {
    const accountsDir = "/tmp/.t3code/accounts";

    expect(() => assertProfilePathWithinAccountsDir("/etc/passwd", accountsDir)).toThrow(
      /outside accounts directory/,
    );
    expect(() =>
      assertProfilePathWithinAccountsDir("/tmp/.t3code/accounts/acc_1/../../other", accountsDir),
    ).toThrow(/outside accounts directory/);
  });
});

describe("accountManager hardening", () => {
  it("removes orphan profile directories without provider metadata", async () => {
    const rootDir = await makeTempDir();
    const accountsDir = path.join(rootDir, "accounts");
    const storePath = path.join(rootDir, "state", "accounts.json");
    const strategy = createMockStrategy("codex");
    const manager = createAccountManager({
      accountsDir,
      store: createAccountStore({ storePath }),
      hasStrategy: (providerKind) => providerKind === "codex",
      getStrategy: () => strategy,
      generateId: () => "acc_fixed",
      now: () => new Date("2026-03-08T00:00:00.000Z"),
      readCodexProfile: async () => undefined,
    });

    const orphan = path.join(accountsDir, "acc_orphan");
    await fs.mkdir(orphan, { recursive: true });

    await manager.cleanupOrphanedProfiles();

    await expect(fs.stat(orphan)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes orphan directories with missing credentials but keeps expired profiles", async () => {
    const rootDir = await makeTempDir();
    const accountsDir = path.join(rootDir, "accounts");
    const storePath = path.join(rootDir, "state", "accounts.json");
    const strategy = createMockStrategy("codex", (profilePath) => {
      if (profilePath.includes("acc_orphan_missing")) {
        return { valid: false, reason: "missing" };
      }
      if (profilePath.includes("acc_orphan_expired")) {
        return { valid: false, reason: "expired" };
      }
      return { valid: true };
    });
    const manager = createAccountManager({
      accountsDir,
      store: createAccountStore({ storePath }),
      hasStrategy: (providerKind) => providerKind === "codex",
      getStrategy: () => strategy,
      generateId: () => "acc_fixed",
      now: () => new Date("2026-03-08T00:00:00.000Z"),
      readCodexProfile: async () => undefined,
    });

    const missing = path.join(accountsDir, "acc_orphan_missing");
    const expired = path.join(accountsDir, "acc_orphan_expired");
    await fs.mkdir(missing, { recursive: true });
    await fs.mkdir(expired, { recursive: true });
    await fs.writeFile(path.join(missing, "provider.json"), JSON.stringify({ kind: "codex" }), "utf8");
    await fs.writeFile(path.join(expired, "provider.json"), JSON.stringify({ kind: "codex" }), "utf8");

    await manager.cleanupOrphanedProfiles();

    await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(expired)).resolves.toBeTruthy();
  });

  it("blocks deletion when stored profile path escapes the accounts root", async () => {
    const rootDir = await makeTempDir();
    const accountsDir = path.join(rootDir, "accounts");
    const storePath = path.join(rootDir, "state", "accounts.json");
    const store = createAccountStore({ storePath });
    const strategy = createMockStrategy("codex");
    const manager = createAccountManager({
      accountsDir,
      store,
      hasStrategy: (providerKind) => providerKind === "codex",
      getStrategy: () => strategy,
      generateId: () => "acc_fixed",
      now: () => new Date("2026-03-08T00:00:00.000Z"),
      readCodexProfile: async () => undefined,
    });

    const unsafeProfilePath = path.join(rootDir, "..", "outside", "acc_escape");
    await store.addAccount(
      makeAccount({
        id: "acc_escape",
        profilePath: unsafeProfilePath,
      }),
    );

    await expect(manager.removeAccount("acc_escape")).rejects.toThrow(/outside accounts directory/);
    expect(strategy.removeProfile).not.toHaveBeenCalled();
    expect((await manager.listAccounts()).map((account) => account.id)).toEqual(["acc_escape"]);
  });
});

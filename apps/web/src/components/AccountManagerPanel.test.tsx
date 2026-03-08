import { describe, expect, it } from "vitest";
import type { ProviderAccount } from "@t3tools/contracts";

import {
  cleanupActiveAccountByProvider,
  clearActiveForProvider,
  normalizeSupportedProviders,
  removeAccountAndCleanupActive,
  renameAccountById,
  setAccountCredentialStatus,
  setActiveForAccount,
  upsertAccountById,
} from "./AccountManagerPanel.state";

function makeAccount(
  id: string,
  providerKind: ProviderAccount["providerKind"] = "codex",
): ProviderAccount {
  return {
    id,
    providerKind,
    name: `Account ${id}`,
    profilePath: `/tmp/accounts/${id}`,
    isDefault: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: null,
  };
}

describe("normalizeSupportedProviders", () => {
  it("deduplicates providers and preserves canonical provider ordering", () => {
    expect(normalizeSupportedProviders(["cursor", "codex", "codex", "claudeCode"])).toEqual([
      "codex",
      "claudeCode",
      "cursor",
    ]);
  });
});

describe("upsertAccountById", () => {
  it("appends accounts that do not already exist", () => {
    const existing = [makeAccount("acc_1")];
    const next = upsertAccountById(existing, makeAccount("acc_2"));
    expect(next.map((account) => account.id)).toEqual(["acc_1", "acc_2"]);
  });

  it("replaces existing account entries by id", () => {
    const existing = [makeAccount("acc_1"), makeAccount("acc_2")];
    const replacement = { ...makeAccount("acc_2"), name: "Renamed" };
    const next = upsertAccountById(existing, replacement);
    expect(next).toHaveLength(2);
    expect(next.find((account) => account.id === "acc_2")?.name).toBe("Renamed");
  });
});

describe("renameAccountById", () => {
  it("renames the target account using a trimmed value", () => {
    const existing = [makeAccount("acc_1"), makeAccount("acc_2")];
    const renamed = renameAccountById(existing, "acc_1", "  Work  ");
    expect(renamed[0]?.name).toBe("Work");
    expect(renamed[1]?.name).toBe("Account acc_2");
  });

  it("does not mutate names when the input is empty", () => {
    const existing = [makeAccount("acc_1")];
    const renamed = renameAccountById(existing, "acc_1", "   ");
    expect(renamed[0]?.name).toBe("Account acc_1");
  });
});

describe("active account helpers", () => {
  it("sets and clears active accounts per provider", () => {
    const codex = makeAccount("acc_codex_1", "codex");
    const claude = makeAccount("acc_claude_1", "claudeCode");

    const activeWithCodex = setActiveForAccount({}, codex);
    const activeWithBoth = setActiveForAccount(activeWithCodex, claude);
    const cleared = clearActiveForProvider(activeWithBoth, "codex");

    expect(activeWithBoth).toEqual({
      codex: "acc_codex_1",
      claudeCode: "acc_claude_1",
    });
    expect(cleared).toEqual({
      claudeCode: "acc_claude_1",
    });
  });

  it("drops stale active account entries during cleanup", () => {
    const accounts = [makeAccount("acc_codex_1", "codex")];
    const cleaned = cleanupActiveAccountByProvider(
      { codex: "acc_codex_1", claudeCode: "acc_missing" },
      accounts,
    );

    expect(cleaned).toEqual({ codex: "acc_codex_1" });
  });
});

describe("removeAccountAndCleanupActive", () => {
  it("removes account and clears active reference for deleted account", () => {
    const codex = makeAccount("acc_codex_1", "codex");
    const claude = makeAccount("acc_claude_1", "claudeCode");
    const next = removeAccountAndCleanupActive(
      {
        accounts: [codex, claude],
        activeAccountByProvider: {
          codex: codex.id,
          claudeCode: claude.id,
        },
      },
      codex.id,
    );

    expect(next.accounts.map((account) => account.id)).toEqual([claude.id]);
    expect(next.activeAccountByProvider).toEqual({ claudeCode: claude.id });
  });
});

describe("setAccountCredentialStatus", () => {
  it("updates only the target account status", () => {
    const codex = makeAccount("acc_codex_1", "codex");
    const claude = makeAccount("acc_claude_1", "claudeCode");
    const next = setAccountCredentialStatus([codex, claude], codex.id, "expired");

    expect(next.find((account) => account.id === codex.id)?.credentialStatus).toBe("expired");
    expect(next.find((account) => account.id === claude.id)?.credentialStatus).toBeUndefined();
  });
});

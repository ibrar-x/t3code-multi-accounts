import type { ProviderAccount } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  getAccountSelectionValueForSlot,
  getActiveAccountForProvider,
  getNextCycledAccountSelectionValue,
  getNextActiveAccountByProvider,
  getProviderAccounts,
  parseAccountShortcutCommand,
} from "./AccountSwitcher.logic";

function makeAccount(id: string, providerKind: ProviderAccount["providerKind"]): ProviderAccount {
  return {
    id,
    providerKind,
    name: `Account ${id}`,
    profilePath: `/tmp/accounts/${id}`,
    isDefault: false,
    createdAt: "2026-03-08T00:00:00.000Z",
    lastUsedAt: null,
  };
}

describe("getProviderAccounts", () => {
  it("returns only accounts for the selected provider", () => {
    const accounts = [
      makeAccount("acc_codex_1", "codex"),
      makeAccount("acc_claude_1", "claudeCode"),
      makeAccount("acc_codex_2", "codex"),
    ];

    expect(getProviderAccounts(accounts, "codex").map((account) => account.id)).toEqual([
      "acc_codex_1",
      "acc_codex_2",
    ]);
  });
});

describe("getActiveAccountForProvider", () => {
  it("returns null when active account id is stale", () => {
    const providerAccounts = [makeAccount("acc_codex_1", "codex")];

    expect(getActiveAccountForProvider(providerAccounts, "acc_missing")).toBeNull();
  });

  it("returns matching account when id exists", () => {
    const providerAccounts = [makeAccount("acc_codex_1", "codex")];

    expect(getActiveAccountForProvider(providerAccounts, "acc_codex_1")?.id).toBe("acc_codex_1");
  });
});

describe("getNextActiveAccountByProvider", () => {
  it("sets provider active account to selected id", () => {
    const providerAccounts = [
      makeAccount("acc_codex_1", "codex"),
      makeAccount("acc_codex_2", "codex"),
    ];

    const next = getNextActiveAccountByProvider({
      provider: "codex",
      selectedValue: "acc_codex_2",
      providerAccounts,
      activeAccountByProvider: {
        codex: "acc_codex_1",
        claudeCode: "acc_claude_1",
      },
    });

    expect(next).toEqual({
      codex: "acc_codex_2",
      claudeCode: "acc_claude_1",
    });
  });

  it("clears provider active account when default option selected", () => {
    const next = getNextActiveAccountByProvider({
      provider: "codex",
      selectedValue: "__default__",
      providerAccounts: [makeAccount("acc_codex_1", "codex")],
      activeAccountByProvider: {
        codex: "acc_codex_1",
        claudeCode: "acc_claude_1",
      },
    });

    expect(next).toEqual({
      claudeCode: "acc_claude_1",
    });
  });

  it("keeps current map when selected account id does not exist", () => {
    const current = {
      codex: "acc_codex_1",
    };

    const next = getNextActiveAccountByProvider({
      provider: "codex",
      selectedValue: "acc_missing",
      providerAccounts: [makeAccount("acc_codex_1", "codex")],
      activeAccountByProvider: current,
    });

    expect(next).toBe(current);
  });
});

describe("parseAccountShortcutCommand", () => {
  it("parses switcher-open commands", () => {
    expect(parseAccountShortcutCommand("account.switcher.open")).toEqual({
      kind: "switcher-open",
      provider: null,
    });
    expect(parseAccountShortcutCommand("account.codex.open")).toEqual({
      kind: "switcher-open",
      provider: "codex",
    });
  });

  it("parses cycle and slot selection commands", () => {
    expect(parseAccountShortcutCommand("account.codex.cycle")).toEqual({
      kind: "cycle",
      provider: "codex",
    });
    expect(parseAccountShortcutCommand("account.codex.select10")).toEqual({
      kind: "select",
      provider: "codex",
      slot: 10,
    });
  });

  it("rejects malformed account commands", () => {
    expect(parseAccountShortcutCommand("account.codex.select0")).toBeNull();
    expect(parseAccountShortcutCommand("account.codex.select")).toBeNull();
    expect(parseAccountShortcutCommand("account.other.cycle")).toBeNull();
  });
});

describe("getAccountSelectionValueForSlot", () => {
  it("returns null for invalid slots", () => {
    const providerAccounts = [makeAccount("acc_codex_1", "codex")];
    expect(getAccountSelectionValueForSlot(providerAccounts, 0)).toBeNull();
    expect(getAccountSelectionValueForSlot(providerAccounts, -1)).toBeNull();
    expect(getAccountSelectionValueForSlot(providerAccounts, 9)).toBeNull();
  });

  it("returns account id for one-based slot", () => {
    const providerAccounts = [
      makeAccount("acc_codex_1", "codex"),
      makeAccount("acc_codex_2", "codex"),
    ];
    expect(getAccountSelectionValueForSlot(providerAccounts, 2)).toBe("acc_codex_2");
  });
});

describe("getNextCycledAccountSelectionValue", () => {
  it("returns first account when there is no active account", () => {
    const providerAccounts = [
      makeAccount("acc_codex_1", "codex"),
      makeAccount("acc_codex_2", "codex"),
    ];
    expect(
      getNextCycledAccountSelectionValue({
        providerAccounts,
        activeAccountId: null,
      }),
    ).toBe("acc_codex_1");
  });

  it("wraps to first account after last account", () => {
    const providerAccounts = [
      makeAccount("acc_codex_1", "codex"),
      makeAccount("acc_codex_2", "codex"),
    ];
    expect(
      getNextCycledAccountSelectionValue({
        providerAccounts,
        activeAccountId: "acc_codex_2",
      }),
    ).toBe("acc_codex_1");
  });

  it("returns null when provider has no accounts", () => {
    expect(
      getNextCycledAccountSelectionValue({
        providerAccounts: [],
        activeAccountId: "acc_codex_1",
      }),
    ).toBeNull();
  });
});

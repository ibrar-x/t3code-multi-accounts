import type { ActiveAccountByProvider, ProviderAccount, ProviderKind } from "@t3tools/contracts";

import { clearActiveForProvider, setActiveForAccount } from "./AccountManagerPanel.state";

export const DEFAULT_OPTION_VALUE = "__default__";
const ACCOUNT_SHORTCUT_COMMAND_PATTERN =
  /^account\.(codex|claudeCode|cursor)\.(cycle|open|select([1-9][0-9]{0,2}))$/;

export type AccountShortcutCommand =
  | {
      kind: "switcher-open";
      provider: ProviderKind | null;
    }
  | {
      kind: "cycle";
      provider: ProviderKind;
    }
  | {
      kind: "select";
      provider: ProviderKind;
      slot: number;
    };

export function parseAccountShortcutCommand(command: string): AccountShortcutCommand | null {
  if (command === "account.switcher.open") {
    return {
      kind: "switcher-open",
      provider: null,
    };
  }

  const match = ACCOUNT_SHORTCUT_COMMAND_PATTERN.exec(command);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const provider = match[1] as ProviderKind;
  const action = match[2];

  if (action === "open") {
    return {
      kind: "switcher-open",
      provider,
    };
  }
  if (action === "cycle") {
    return {
      kind: "cycle",
      provider,
    };
  }

  const slotText = match[3];
  if (!slotText) {
    return null;
  }
  const slot = Number(slotText);
  if (!Number.isInteger(slot) || slot < 1) {
    return null;
  }
  return {
    kind: "select",
    provider,
    slot,
  };
}

export function getProviderAccounts(
  accounts: readonly ProviderAccount[],
  provider: ProviderKind,
): ProviderAccount[] {
  return accounts.filter((account) => account.providerKind === provider);
}

export function getActiveAccountForProvider(
  providerAccounts: readonly ProviderAccount[],
  activeAccountId: string | null | undefined,
): ProviderAccount | null {
  if (!activeAccountId) {
    return null;
  }
  return providerAccounts.find((account) => account.id === activeAccountId) ?? null;
}

export function getNextActiveAccountByProvider(input: {
  provider: ProviderKind;
  selectedValue: string;
  providerAccounts: readonly ProviderAccount[];
  activeAccountByProvider: ActiveAccountByProvider;
}): ActiveAccountByProvider {
  if (input.selectedValue === DEFAULT_OPTION_VALUE) {
    return clearActiveForProvider(input.activeAccountByProvider, input.provider);
  }
  const account = input.providerAccounts.find((entry) => entry.id === input.selectedValue);
  if (!account) {
    return input.activeAccountByProvider;
  }
  return setActiveForAccount(input.activeAccountByProvider, account);
}

export function getAccountSelectionValueForSlot(
  providerAccounts: readonly ProviderAccount[],
  slot: number,
): string | null {
  if (!Number.isInteger(slot) || slot < 1) {
    return null;
  }
  const account = providerAccounts[slot - 1];
  return account?.id ?? null;
}

export function getNextCycledAccountSelectionValue(input: {
  providerAccounts: readonly ProviderAccount[];
  activeAccountId: string | null | undefined;
}): string | null {
  const { providerAccounts, activeAccountId } = input;
  if (providerAccounts.length === 0) {
    return null;
  }
  if (!activeAccountId) {
    return providerAccounts[0]?.id ?? null;
  }

  const activeIndex = providerAccounts.findIndex((account) => account.id === activeAccountId);
  if (activeIndex < 0) {
    return providerAccounts[0]?.id ?? null;
  }

  const nextIndex = (activeIndex + 1) % providerAccounts.length;
  return providerAccounts[nextIndex]?.id ?? null;
}

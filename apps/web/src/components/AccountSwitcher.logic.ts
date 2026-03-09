import type { ActiveAccountByProvider, ProviderAccount, ProviderKind } from "@t3tools/contracts";

import { clearActiveForProvider, setActiveForAccount } from "./AccountManagerPanel.state";

export const DEFAULT_OPTION_VALUE = "__default__";

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

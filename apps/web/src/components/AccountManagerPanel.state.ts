import type { AccountCheckReason, ProviderAccount, ProviderKind } from "@t3tools/contracts";

import type { AppSettings } from "../appSettings";

type MultiAccountSettings = AppSettings["multiAccount"];
type ActiveAccountByProvider = MultiAccountSettings["activeAccountByProvider"];

type MutableActiveAccountByProvider = {
  codex?: string;
  claudeCode?: string;
  cursor?: string;
};

const PROVIDER_ORDER: ProviderKind[] = ["codex", "claudeCode", "cursor"];

export function normalizeSupportedProviders(providers: readonly ProviderKind[]): ProviderKind[] {
  const deduped: ProviderKind[] = [];
  const seen = new Set<ProviderKind>();

  for (const provider of PROVIDER_ORDER) {
    if (!providers.includes(provider) || seen.has(provider)) continue;
    deduped.push(provider);
    seen.add(provider);
  }

  for (const provider of providers) {
    if (seen.has(provider)) continue;
    deduped.push(provider);
    seen.add(provider);
  }

  return deduped;
}

export function upsertAccountById(
  accounts: readonly ProviderAccount[],
  account: ProviderAccount,
): ProviderAccount[] {
  let found = false;
  const nextAccounts = accounts.map((existing) => {
    if (existing.id !== account.id) return existing;
    found = true;
    return account;
  });
  if (found) return nextAccounts;
  return [...nextAccounts, account];
}

export function renameAccountById(
  accounts: readonly ProviderAccount[],
  accountId: string,
  nextName: string,
): ProviderAccount[] {
  const trimmedName = nextName.trim();
  if (!trimmedName) {
    return [...accounts];
  }
  return accounts.map((account) =>
    account.id === accountId ? { ...account, name: trimmedName } : account,
  );
}

export function setActiveForAccount(
  activeAccountByProvider: ActiveAccountByProvider,
  account: ProviderAccount,
): ActiveAccountByProvider {
  return {
    ...activeAccountByProvider,
    [account.providerKind]: account.id,
  };
}

export function clearActiveForProvider(
  activeAccountByProvider: ActiveAccountByProvider,
  providerKind: ProviderKind,
): ActiveAccountByProvider {
  const next: MutableActiveAccountByProvider = {};
  if (activeAccountByProvider.codex) {
    next.codex = activeAccountByProvider.codex;
  }
  if (activeAccountByProvider.claudeCode) {
    next.claudeCode = activeAccountByProvider.claudeCode;
  }
  if (activeAccountByProvider.cursor) {
    next.cursor = activeAccountByProvider.cursor;
  }
  delete next[providerKind];
  return next;
}

export function cleanupActiveAccountByProvider(
  activeAccountByProvider: ActiveAccountByProvider,
  accounts: readonly ProviderAccount[],
): ActiveAccountByProvider {
  const validByProvider = new Map<ProviderKind, Set<string>>();
  for (const account of accounts) {
    const existing = validByProvider.get(account.providerKind);
    if (existing) {
      existing.add(account.id);
      continue;
    }
    validByProvider.set(account.providerKind, new Set([account.id]));
  }

  const cleaned: MutableActiveAccountByProvider = {};
  for (const providerKind of PROVIDER_ORDER) {
    const accountId = activeAccountByProvider[providerKind];
    if (!accountId) continue;
    if (!validByProvider.get(providerKind)?.has(accountId)) continue;
    cleaned[providerKind] = accountId;
  }
  return cleaned;
}

export function removeAccountAndCleanupActive(
  multiAccount: MultiAccountSettings,
  accountId: string,
): MultiAccountSettings {
  const accounts = multiAccount.accounts.filter((account) => account.id !== accountId);
  return {
    accounts,
    activeAccountByProvider: cleanupActiveAccountByProvider(multiAccount.activeAccountByProvider, accounts),
  };
}

export function setAccountCredentialStatus(
  accounts: readonly ProviderAccount[],
  accountId: string,
  reason: AccountCheckReason,
): ProviderAccount[] {
  return accounts.map((account) =>
    account.id === accountId ? { ...account, credentialStatus: reason } : account,
  );
}

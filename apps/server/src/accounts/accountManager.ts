import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AccountCheckResponse,
  ProviderAccount,
  ProviderKind,
} from "@t3tools/contracts";
import type { CredentialIsolationStrategy, CredentialLoginOptions } from "./credentialStrategy.ts";
import { ACCOUNTS_DIR, type AccountStore, createAccountStore } from "./accountStore.ts";
import { getStrategy, hasStrategy } from "./strategies/registry.ts";

const PROVIDER_FILE = "provider.json";

export interface AccountManager {
  listAccounts(): Promise<ProviderAccount[]>;
  getAccountById(accountId: string): Promise<ProviderAccount | undefined>;
  addAccount(
    providerKind: ProviderKind,
    name: string,
    options?: CredentialLoginOptions,
  ): Promise<ProviderAccount>;
  renameAccount(accountId: string, name: string): Promise<ProviderAccount>;
  removeAccount(account: ProviderAccount | string): Promise<void>;
  checkAccount(account: ProviderAccount | string): Promise<AccountCheckResponse>;
  checkAllAccounts(accounts?: readonly ProviderAccount[]): Promise<AccountCheckResponse[]>;
  getSessionEnv(account: ProviderAccount | undefined): Record<string, string> | undefined;
  isLoginInProgress(profilePath: string): boolean;
}

export interface AccountManagerOptions {
  readonly accountsDir?: string;
  readonly store?: AccountStore;
  readonly getStrategy?: (providerKind: ProviderKind) => CredentialIsolationStrategy;
  readonly hasStrategy?: (providerKind: ProviderKind) => boolean;
  readonly generateId?: () => string;
  readonly now?: () => Date;
}

function normalizeAccountName(name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Account name cannot be empty.");
  }
  return trimmedName;
}

const loginInProgress = new Set<string>();

async function resolveAccount(
  store: AccountStore,
  account: ProviderAccount | string,
): Promise<ProviderAccount | undefined> {
  if (typeof account === "string") {
    const accountId = account.trim();
    if (!accountId) {
      return undefined;
    }
    return store.getAccountById(accountId);
  }

  return store.getAccountById(account.id);
}

function createDefaultAccountId(): string {
  return `acc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function createAccountManager(options: AccountManagerOptions = {}): AccountManager {
  const accountsDir = path.resolve(options.accountsDir ?? ACCOUNTS_DIR);
  const store = options.store ?? createAccountStore({ storePath: path.join(accountsDir, "accounts.json") });
  const resolveStrategy = options.getStrategy ?? getStrategy;
  const supportsProvider = options.hasStrategy ?? hasStrategy;
  const generateId = options.generateId ?? createDefaultAccountId;
  const now = options.now ?? (() => new Date());

  return {
    async listAccounts() {
      return store.listAccounts();
    },
    async getAccountById(accountId) {
      return store.getAccountById(accountId);
    },
    async addAccount(providerKind, name, loginOptions) {
      if (!supportsProvider(providerKind)) {
        throw new Error(`Provider "${providerKind}" is not supported yet.`);
      }

      const accountName = normalizeAccountName(name);
      const existingAccounts = await store.listAccounts();
      if (
        existingAccounts.some(
          (account) =>
            account.providerKind === providerKind &&
            account.name.localeCompare(accountName, undefined, { sensitivity: "accent" }) === 0,
        )
      ) {
        throw new Error(
          `An account named "${accountName}" already exists for provider "${providerKind}".`,
        );
      }

      const strategy = resolveStrategy(providerKind);
      let accountId = "";
      do {
        accountId = generateId();
      } while (existingAccounts.some((account) => account.id === accountId));
      const profilePath = path.join(accountsDir, accountId);

      if (loginInProgress.has(profilePath)) {
        throw new Error("A login is already in progress for this account. Please wait.");
      }

      await fs.mkdir(accountsDir, { recursive: true });
      await strategy.initProfileDir(profilePath);
      await fs.writeFile(
        path.join(profilePath, PROVIDER_FILE),
        `${JSON.stringify({ kind: providerKind })}\n`,
        "utf8",
      );

      loginInProgress.add(profilePath);
      try {
        await strategy.runLoginFlow(profilePath, loginOptions);
      } catch (error) {
        await strategy.removeProfile(profilePath).catch(() => undefined);
        throw error;
      } finally {
        loginInProgress.delete(profilePath);
      }

      const account: ProviderAccount = {
        id: accountId,
        providerKind,
        name: accountName,
        profilePath,
        isDefault: false,
        createdAt: now().toISOString(),
        lastUsedAt: null,
      };

      try {
        await store.addAccount(account);
      } catch (error) {
        await strategy.removeProfile(profilePath).catch(() => undefined);
        throw error;
      }

      return account;
    },
    async renameAccount(accountId, name) {
      const accountName = normalizeAccountName(name);
      const account = await store.getAccountById(accountId);
      if (!account) {
        throw new Error(`Account "${accountId}" not found.`);
      }

      const accounts = await store.listAccounts();
      const duplicate = accounts.some(
        (existing) =>
          existing.id !== account.id &&
          existing.providerKind === account.providerKind &&
          existing.name.localeCompare(accountName, undefined, { sensitivity: "accent" }) === 0,
      );
      if (duplicate) {
        throw new Error(
          `An account named "${accountName}" already exists for provider "${account.providerKind}".`,
        );
      }

      const updatedAccount: ProviderAccount = {
        ...account,
        name: accountName,
      };
      await store.updateAccount(updatedAccount);
      return updatedAccount;
    },
    async removeAccount(account) {
      const resolvedAccount = await resolveAccount(store, account);
      const resolvedId = typeof account === "string" ? account.trim() : account.id;
      if (!resolvedAccount) {
        throw new Error(`Account "${resolvedId}" not found.`);
      }

      if (supportsProvider(resolvedAccount.providerKind)) {
        const strategy = resolveStrategy(resolvedAccount.providerKind);
        await strategy.removeProfile(resolvedAccount.profilePath);
      } else {
        await fs.rm(resolvedAccount.profilePath, { recursive: true, force: true });
      }

      await store.removeAccount(resolvedAccount.id);
    },
    async checkAccount(account) {
      const resolvedAccount = await resolveAccount(store, account);
      const resolvedId = typeof account === "string" ? account.trim() : account.id;
      if (!resolvedAccount) {
        return {
          accountId: resolvedId,
          valid: false,
          reason: "missing",
        };
      }

      if (!supportsProvider(resolvedAccount.providerKind)) {
        return {
          accountId: resolvedAccount.id,
          valid: false,
          reason: "missing",
        };
      }

      const strategy = resolveStrategy(resolvedAccount.providerKind);
      const status = await strategy.checkCredentials(resolvedAccount.profilePath);
      return {
        accountId: resolvedAccount.id,
        valid: status.valid,
        reason: status.valid ? "ok" : status.reason,
      };
    },
    async checkAllAccounts(accounts) {
      const accountsToCheck = accounts ? [...accounts] : await store.listAccounts();
      return Promise.all(accountsToCheck.map((account) => this.checkAccount(account)));
    },
    getSessionEnv(account) {
      if (!account) return undefined;
      if (!supportsProvider(account.providerKind)) return undefined;
      const strategy = resolveStrategy(account.providerKind);
      return strategy.getSessionEnv(account.profilePath);
    },
    isLoginInProgress(profilePath) {
      return loginInProgress.has(profilePath);
    },
  };
}

export const accountManager = createAccountManager();

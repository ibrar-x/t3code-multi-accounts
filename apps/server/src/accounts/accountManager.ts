import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AccountCheckResponse,
  CodexAccountProfile,
  ProviderAccount,
  ProviderKind,
} from "@t3tools/contracts";
import type { CredentialIsolationStrategy, CredentialLoginOptions } from "./credentialStrategy.ts";
import { ACCOUNTS_DIR, type AccountStore, createAccountStore } from "./accountStore.ts";
import {
  readCodexAccountProfile,
  readCodexAccountProfileFromAuthJson,
} from "./codexProfileProbe.ts";
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
  ensureAccountsDirPermissions(): Promise<void>;
  cleanupOrphanedProfiles(): Promise<void>;
  runStartupMaintenance(): Promise<void>;
}

export interface AccountManagerOptions {
  readonly accountsDir?: string;
  readonly store?: AccountStore;
  readonly getStrategy?: (providerKind: ProviderKind) => CredentialIsolationStrategy;
  readonly hasStrategy?: (providerKind: ProviderKind) => boolean;
  readonly readCodexProfile?: (profilePath: string) => Promise<ProviderAccount["codexProfile"] | undefined>;
  readonly readCodexProfileFromAuthJson?: (
    profilePath: string,
  ) => Promise<ProviderAccount["codexProfile"] | undefined>;
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
export const DEFAULT_CODEX_ACCOUNT_ID = "acc_codex_default_system";

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

export function assertProfilePathWithinAccountsDir(profilePath: string, accountsDir: string): string {
  const resolvedAccountsDir = path.resolve(accountsDir);
  const resolvedProfilePath = path.resolve(profilePath);
  const insideAccountsDir = resolvedProfilePath.startsWith(`${resolvedAccountsDir}${path.sep}`);
  if (!insideAccountsDir) {
    throw new Error(
      `Security: profilePath "${profilePath}" is outside accounts directory "${resolvedAccountsDir}".`,
    );
  }
  return resolvedProfilePath;
}

async function readProviderKind(profilePath: string): Promise<ProviderKind | null> {
  try {
    const raw = await fs.readFile(path.join(profilePath, PROVIDER_FILE), "utf8");
    const parsed = JSON.parse(raw) as { kind?: unknown };
    return typeof parsed.kind === "string" ? (parsed.kind as ProviderKind) : null;
  } catch {
    return null;
  }
}

function hasCodexProfileDetails(profile: CodexAccountProfile | undefined): boolean {
  if (!profile) {
    return false;
  }
  return Boolean(
    profile.type || profile.email || profile.name || profile.planType || profile.rateLimits,
  );
}

function codexProfileWithoutSyncedAt(
  profile: CodexAccountProfile | undefined,
): Omit<CodexAccountProfile, "syncedAt"> | undefined {
  if (!profile) {
    return undefined;
  }
  const { syncedAt: _syncedAt, ...rest } = profile;
  return rest;
}

function codexProfileChanged(
  currentProfile: CodexAccountProfile | undefined,
  nextProfile: CodexAccountProfile | undefined,
): boolean {
  return (
    JSON.stringify(codexProfileWithoutSyncedAt(currentProfile)) !==
    JSON.stringify(codexProfileWithoutSyncedAt(nextProfile))
  );
}

function pickPreferredCodexProfile(
  currentProfile: CodexAccountProfile | undefined,
  preferredProfile: CodexAccountProfile | undefined,
  fallbackProfile?: CodexAccountProfile | undefined,
): CodexAccountProfile | undefined {
  const nextProfile = preferredProfile ?? fallbackProfile;
  if (!hasCodexProfileDetails(nextProfile)) {
    return currentProfile;
  }
  if (!codexProfileChanged(currentProfile, nextProfile)) {
    return currentProfile;
  }
  return nextProfile;
}

function normalizeComparable(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function codexProfilesLikelySameIdentity(
  left: CodexAccountProfile | undefined,
  right: CodexAccountProfile | undefined,
): boolean {
  const leftEmail = normalizeComparable(left?.email);
  const rightEmail = normalizeComparable(right?.email);
  if (!leftEmail || !rightEmail || leftEmail !== rightEmail) {
    return false;
  }

  const leftType = normalizeComparable(left?.type);
  const rightType = normalizeComparable(right?.type);
  if (!leftType || !rightType) {
    return true;
  }
  return leftType === rightType;
}

function isDuplicateDefaultCodexAccount(
  account: ProviderAccount,
  defaultProfilePath: string,
  defaultProfile: CodexAccountProfile,
): boolean {
  if (account.providerKind !== "codex") {
    return false;
  }

  if (path.resolve(account.profilePath) === path.resolve(defaultProfilePath)) {
    return true;
  }

  return codexProfilesLikelySameIdentity(account.codexProfile, defaultProfile);
}

export function createAccountManager(options: AccountManagerOptions = {}): AccountManager {
  const accountsDir = path.resolve(options.accountsDir ?? ACCOUNTS_DIR);
  const store = options.store ?? createAccountStore({ storePath: path.join(accountsDir, "accounts.json") });
  const resolveStrategy = options.getStrategy ?? getStrategy;
  const supportsProvider = options.hasStrategy ?? hasStrategy;
  const readCodexProfile = options.readCodexProfile ?? readCodexAccountProfile;
  const readCodexProfileFromAuthJson =
    options.readCodexProfileFromAuthJson ?? readCodexAccountProfileFromAuthJson;
  const generateId = options.generateId ?? createDefaultAccountId;
  const now = options.now ?? (() => new Date());

  async function refreshPersistedCodexMetadata(account: ProviderAccount): Promise<ProviderAccount> {
    if (account.providerKind !== "codex" || !supportsProvider("codex") || account.isDefault) {
      return account;
    }

    const strategy = resolveStrategy("codex");
    const safeProfilePath = assertProfilePathWithinAccountsDir(account.profilePath, accountsDir);
    const status = await strategy.checkCredentials(safeProfilePath).catch(() => ({
      valid: false,
      reason: "missing" as const,
    }));

    let nextProfile = account.codexProfile;
    if (status.valid) {
      const authProfile = await readCodexProfileFromAuthJson(safeProfilePath).catch(() => undefined);
      const profileWithRateLimits =
        authProfile?.rateLimits
          ? authProfile
          : await readCodexProfile(safeProfilePath).catch(() => undefined);
      nextProfile = pickPreferredCodexProfile(account.codexProfile, profileWithRateLimits, authProfile);
    }

    const nextAccount: ProviderAccount = {
      ...account,
      ...(status.valid ? { credentialStatus: "ok" as const } : { credentialStatus: status.reason }),
      ...(nextProfile ? { codexProfile: nextProfile } : {}),
    };

    if (JSON.stringify(nextAccount) !== JSON.stringify(account)) {
      await store.updateAccount(nextAccount).catch(() => undefined);
    }

    return nextAccount;
  }

  return {
    async listAccounts() {
      const persistedAccounts = await store.listAccounts();
      const hydratedAccounts = await Promise.all(
        persistedAccounts.map(async (account) => {
          try {
            return await refreshPersistedCodexMetadata(account);
          } catch {
            return account;
          }
        }),
      );
      if (!supportsProvider("codex")) {
        return hydratedAccounts;
      }

      const defaultProfilePath = path.resolve(
        process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex"),
      );
      const defaultProfileFromAuth = await readCodexProfileFromAuthJson(defaultProfilePath).catch(
        () => undefined,
      );
      const defaultProfile =
        defaultProfileFromAuth?.rateLimits
          ? defaultProfileFromAuth
          : (await readCodexProfile(defaultProfilePath).catch(() => undefined)) ??
            defaultProfileFromAuth;
      if (!defaultProfile) {
        return hydratedAccounts;
      }

      const codexStatus = await resolveStrategy("codex")
        .checkCredentials(defaultProfilePath)
        .catch(() => ({ valid: false, reason: "missing" as const }));

      const defaultName =
        defaultProfile.name?.trim() || defaultProfile.email?.trim() || "Default system credentials";

      const persistedWithoutSyntheticDefault = hydratedAccounts.filter(
        (account) => account.id !== DEFAULT_CODEX_ACCOUNT_ID,
      );
      const duplicatePersistedDefault = persistedWithoutSyntheticDefault.find((account) =>
        isDuplicateDefaultCodexAccount(account, defaultProfilePath, defaultProfile),
      );
      if (duplicatePersistedDefault) {
        const mergedDuplicateProfile = pickPreferredCodexProfile(
          duplicatePersistedDefault.codexProfile,
          defaultProfile,
        );
        const mergedDuplicateAccount: ProviderAccount = {
          ...duplicatePersistedDefault,
          ...(codexStatus.valid
            ? { credentialStatus: "ok" as const }
            : { credentialStatus: codexStatus.reason }),
          ...(mergedDuplicateProfile ? { codexProfile: mergedDuplicateProfile } : {}),
        };
        if (JSON.stringify(mergedDuplicateAccount) !== JSON.stringify(duplicatePersistedDefault)) {
          await store.updateAccount(mergedDuplicateAccount).catch(() => undefined);
          return persistedWithoutSyntheticDefault.map((account) =>
            account.id === mergedDuplicateAccount.id ? mergedDuplicateAccount : account,
          );
        }
        return persistedWithoutSyntheticDefault;
      }

      const defaultAccount: ProviderAccount = {
        id: DEFAULT_CODEX_ACCOUNT_ID,
        providerKind: "codex",
        name: defaultName,
        profilePath: defaultProfilePath,
        isDefault: true,
        ...(codexStatus.valid ? { credentialStatus: "ok" as const } : { credentialStatus: codexStatus.reason }),
        codexProfile: defaultProfile,
        createdAt: "1970-01-01T00:00:00.000Z",
        lastUsedAt: null,
      };

      return [
        ...persistedWithoutSyntheticDefault,
        defaultAccount,
      ];
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

      await this.ensureAccountsDirPermissions();
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
        ...(providerKind === "codex"
          ? { codexProfile: await readCodexProfile(profilePath).catch(() => undefined) }
          : {}),
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
      const safeProfilePath = assertProfilePathWithinAccountsDir(
        resolvedAccount.profilePath,
        accountsDir,
      );

      if (supportsProvider(resolvedAccount.providerKind)) {
        const strategy = resolveStrategy(resolvedAccount.providerKind);
        await strategy.removeProfile(safeProfilePath);
      } else {
        await fs.rm(safeProfilePath, { recursive: true, force: true });
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
      let safeProfilePath: string;
      try {
        safeProfilePath = assertProfilePathWithinAccountsDir(resolvedAccount.profilePath, accountsDir);
      } catch {
        return {
          accountId: resolvedAccount.id,
          valid: false,
          reason: "missing",
        };
      }
      const status = await strategy.checkCredentials(safeProfilePath);
      const nextAccount: ProviderAccount = {
        ...resolvedAccount,
        credentialStatus: status.valid ? "ok" : status.reason,
        ...(resolvedAccount.providerKind === "codex" && status.valid
          ? {
              codexProfile:
                (await readCodexProfile(safeProfilePath).catch(() => undefined)) ??
                resolvedAccount.codexProfile,
            }
          : {}),
      };

      if (JSON.stringify(nextAccount) !== JSON.stringify(resolvedAccount)) {
        await store.updateAccount(nextAccount).catch(() => undefined);
      }

      return {
        accountId: resolvedAccount.id,
        valid: status.valid,
        reason: status.valid ? "ok" : status.reason,
        account: nextAccount,
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
    async ensureAccountsDirPermissions() {
      await fs.mkdir(accountsDir, { recursive: true });
      await fs.chmod(accountsDir, 0o700).catch(() => undefined);
    },
    async cleanupOrphanedProfiles() {
      const knownProfiles = new Set(
        (await store.listAccounts()).map((account) =>
          path.resolve(account.profilePath),
        ),
      );
      const entries = await fs.readdir(accountsDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.startsWith("acc_")) continue;

        const profilePath = path.join(accountsDir, entry.name);
        let safeProfilePath: string;
        try {
          safeProfilePath = assertProfilePathWithinAccountsDir(profilePath, accountsDir);
        } catch {
          continue;
        }
        if (knownProfiles.has(path.resolve(safeProfilePath))) {
          continue;
        }

        const providerKind = await readProviderKind(safeProfilePath);
        if (!providerKind) {
          await fs.rm(safeProfilePath, { recursive: true, force: true });
          continue;
        }
        if (!supportsProvider(providerKind)) {
          continue;
        }

        const strategy = resolveStrategy(providerKind);
        const credentialStatus = await strategy.checkCredentials(safeProfilePath).catch(() => ({
          valid: false,
          reason: "malformed" as const,
        }));

        if (!credentialStatus.valid && credentialStatus.reason !== "expired") {
          await fs.rm(safeProfilePath, { recursive: true, force: true });
        }
      }
    },
    async runStartupMaintenance() {
      await this.ensureAccountsDirPermissions();
      await this.cleanupOrphanedProfiles();
    },
  };
}

export const accountManager = createAccountManager();

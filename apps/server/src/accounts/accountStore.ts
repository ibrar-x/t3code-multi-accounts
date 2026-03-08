import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Schema } from "effect";
import { AccountListResponse, type ProviderAccount } from "@t3tools/contracts";

export const ACCOUNTS_DIR = path.join(os.homedir(), ".t3code", "accounts");
export const ACCOUNTS_STORE_FILE = "accounts.json";
export const DEFAULT_ACCOUNTS_STORE_PATH = path.join(ACCOUNTS_DIR, ACCOUNTS_STORE_FILE);

export interface AccountStore {
  listAccounts(): Promise<ProviderAccount[]>;
  getAccountById(accountId: string): Promise<ProviderAccount | undefined>;
  addAccount(account: ProviderAccount): Promise<void>;
  updateAccount(account: ProviderAccount): Promise<void>;
  removeAccount(accountId: string): Promise<ProviderAccount>;
}

export interface AccountStoreOptions {
  readonly storePath?: string;
}

function normalizeStorePath(storePath: string): string {
  const trimmed = storePath.trim();
  if (!trimmed) {
    throw new Error("Account store path cannot be empty.");
  }
  return path.resolve(trimmed);
}

async function readAccountsFile(storePath: string): Promise<ProviderAccount[]> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const decoded = Schema.decodeSync(Schema.fromJsonString(AccountListResponse))(raw);
    return [...decoded.accounts];
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (code === "ENOENT") {
      return [];
    }
    throw new Error(
      `Unable to read account store at "${storePath}". The file is missing or malformed.`,
      { cause: error },
    );
  }
}

async function writeAccountsFile(storePath: string, accounts: readonly ProviderAccount[]): Promise<void> {
  const encoded = JSON.stringify({ accounts }, null, 2);
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(tempPath, `${encoded}\n`, "utf8");
  await fs.rename(tempPath, storePath);
}

export function createAccountStore(options: AccountStoreOptions = {}): AccountStore {
  const storePath = normalizeStorePath(options.storePath ?? DEFAULT_ACCOUNTS_STORE_PATH);

  return {
    async listAccounts() {
      return readAccountsFile(storePath);
    },
    async getAccountById(accountId) {
      const targetId = accountId.trim();
      if (!targetId) {
        return undefined;
      }
      const accounts = await readAccountsFile(storePath);
      return accounts.find((account) => account.id === targetId);
    },
    async addAccount(account) {
      const accounts = await readAccountsFile(storePath);
      if (accounts.some((existing) => existing.id === account.id)) {
        throw new Error(`Account "${account.id}" already exists.`);
      }
      accounts.push(account);
      await writeAccountsFile(storePath, accounts);
    },
    async updateAccount(account) {
      const accounts = await readAccountsFile(storePath);
      const accountIndex = accounts.findIndex((existing) => existing.id === account.id);
      if (accountIndex < 0) {
        throw new Error(`Account "${account.id}" not found.`);
      }
      accounts[accountIndex] = account;
      await writeAccountsFile(storePath, accounts);
    },
    async removeAccount(accountId) {
      const targetId = accountId.trim();
      const accounts = await readAccountsFile(storePath);
      const accountIndex = accounts.findIndex((account) => account.id === targetId);
      if (accountIndex < 0) {
        throw new Error(`Account "${targetId}" not found.`);
      }
      const [removedAccount] = accounts.splice(accountIndex, 1);
      await writeAccountsFile(storePath, accounts);
      return removedAccount as ProviderAccount;
    },
  };
}

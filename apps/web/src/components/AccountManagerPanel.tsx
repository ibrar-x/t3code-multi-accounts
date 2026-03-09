import { type ProviderAccount, type ProviderKind } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type AppSettings, useAppSettings } from "../appSettings";
import { ensureNativeApi } from "../nativeApi";
import { useStore } from "../store";
import {
  cleanupActiveAccountByProvider,
  clearActiveForProvider,
  normalizeSupportedProviders,
  removeAccountAndCleanupActive,
  setAccountCredentialStatus,
  setActiveForAccount,
  upsertAccountById,
} from "./AccountManagerPanel.state";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";

const CODEX_ONLY_PROVIDER: ProviderKind = "codex";
const DEFAULT_ACCOUNT_VALUE = "__default__";

function toActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function readPrimaryRemainingPercent(account: ProviderAccount | null): number | null {
  const primary = account?.codexProfile?.rateLimits?.primary;
  if (!primary) return null;
  if (typeof primary.remainingPercent === "number") {
    return Math.max(0, Math.min(100, Math.round(primary.remainingPercent)));
  }
  if (typeof primary.usedPercent === "number") {
    return Math.max(0, Math.min(100, Math.round(100 - primary.usedPercent)));
  }
  return null;
}

function formatResetTimestamp(account: ProviderAccount | null): string | null {
  const resetsAt = account?.codexProfile?.rateLimits?.primary?.resetsAt;
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) {
    return null;
  }
  const date = new Date(resetsAt * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AccountManagerPanel() {
  const { settings, updateSettings } = useAppSettings();
  const hasActiveSession = useStore((store) =>
    store.threads.some(
      (thread) => thread.session?.status === "running" || thread.session?.status === "connecting",
    ),
  );

  const settingsRef = useRef(settings);
  const [supportedProviders, setSupportedProviders] = useState<ProviderKind[]>([CODEX_ONLY_PROVIDER]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderKind>(CODEX_ONLY_PROVIDER);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(DEFAULT_ACCOUNT_VALUE);
  const [newAccountName, setNewAccountName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const commitMultiAccount = useCallback(
    (nextMultiAccount: AppSettings["multiAccount"]) => {
      settingsRef.current = {
        ...settingsRef.current,
        multiAccount: nextMultiAccount,
      };
      updateSettings({ multiAccount: nextMultiAccount });
    },
    [updateSettings],
  );

  const refreshAccounts = useCallback(async () => {
    const api = ensureNativeApi();
    const currentMultiAccount = settingsRef.current.multiAccount;
    const [supported, listed] = await Promise.all([
      api.accounts.supported(),
      api.accounts.list({}),
    ]);

    const nextAccounts = listed.accounts.filter((account) => account.providerKind === CODEX_ONLY_PROVIDER);
    const nextActive = cleanupActiveAccountByProvider(
      currentMultiAccount.activeAccountByProvider,
      nextAccounts,
    );

    commitMultiAccount({
      accounts: nextAccounts,
      activeAccountByProvider: nextActive,
    });
    setLoadError(null);

    const codexOnlySupported = normalizeSupportedProviders(
      supported.providers.filter((provider) => provider === CODEX_ONLY_PROVIDER),
    );
    setSupportedProviders(codexOnlySupported.length > 0 ? codexOnlySupported : [CODEX_ONLY_PROVIDER]);

    const nextActiveId = nextActive[CODEX_ONLY_PROVIDER] ?? null;
    const selectedStillExists = nextAccounts.some((account) => account.id === selectedAccountId);
    if (selectedStillExists) {
      return;
    }

    if (nextActiveId) {
      setSelectedAccountId(nextActiveId);
      return;
    }

    const firstId = nextAccounts[0]?.id;
    setSelectedAccountId(firstId ?? DEFAULT_ACCOUNT_VALUE);
  }, [commitMultiAccount, selectedAccountId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void refreshAccounts()
      .catch((error) => {
        if (cancelled) return;
        setLoadError(toActionErrorMessage(error, "Unable to load accounts."));
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshAccounts]);

  useEffect(() => {
    if (!supportedProviders.includes(selectedProvider)) {
      setSelectedProvider(CODEX_ONLY_PROVIDER);
    }
  }, [selectedProvider, supportedProviders]);

  const providerAccounts = useMemo(
    () => settings.multiAccount.accounts.filter((account) => account.providerKind === selectedProvider),
    [selectedProvider, settings.multiAccount.accounts],
  );
  const activeAccountId = settings.multiAccount.activeAccountByProvider[selectedProvider] ?? null;
  const activeAccount = providerAccounts.find((account) => account.id === activeAccountId) ?? null;
  const selectedAccount =
    providerAccounts.find((account) => account.id === selectedAccountId) ?? activeAccount ?? null;

  const handleAddAccount = useCallback(async () => {
    const name = newAccountName.trim();
    if (!name) {
      setActionError("Enter an account name.");
      return;
    }

    setPendingAction("add");
    setActionError(null);

    try {
      const api = ensureNativeApi();
      const response = await api.accounts.add({
        providerKind: CODEX_ONLY_PROVIDER,
        name,
      });

      const currentMultiAccount = settingsRef.current.multiAccount;
      const nextAccounts = upsertAccountById(currentMultiAccount.accounts, response.account);
      const nextActive = currentMultiAccount.activeAccountByProvider[CODEX_ONLY_PROVIDER]
        ? currentMultiAccount.activeAccountByProvider
        : setActiveForAccount(currentMultiAccount.activeAccountByProvider, response.account);

      commitMultiAccount({
        accounts: nextAccounts,
        activeAccountByProvider: cleanupActiveAccountByProvider(nextActive, nextAccounts),
      });

      setNewAccountName("");
      await refreshAccounts();
    } catch (error) {
      setActionError(toActionErrorMessage(error, "Unable to connect account."));
    } finally {
      setPendingAction(null);
    }
  }, [commitMultiAccount, newAccountName, refreshAccounts]);

  const handleActiveAccountChange = useCallback(
    (value: string) => {
      if (hasActiveSession) {
        setActionError("Account switching is blocked while a session is active.");
        return;
      }

      const currentMultiAccount = settingsRef.current.multiAccount;
      const nextActiveAccountByProvider =
        value === DEFAULT_ACCOUNT_VALUE
          ? clearActiveForProvider(currentMultiAccount.activeAccountByProvider, selectedProvider)
          : (() => {
              const account = providerAccounts.find((entry) => entry.id === value);
              return account
                ? setActiveForAccount(currentMultiAccount.activeAccountByProvider, account)
                : currentMultiAccount.activeAccountByProvider;
            })();

      commitMultiAccount({
        accounts: currentMultiAccount.accounts,
        activeAccountByProvider: nextActiveAccountByProvider,
      });

      setActionError(null);
      setSelectedAccountId(value);
    },
    [commitMultiAccount, hasActiveSession, providerAccounts, selectedProvider],
  );

  const handleCheckSelectedAccount = useCallback(async () => {
    if (!selectedAccount) {
      setActionError("Select an account to check.");
      return;
    }

    setPendingAction(`check:${selectedAccount.id}`);
    setActionError(null);

    try {
      const api = ensureNativeApi();
      const result = await api.accounts.check({ accountId: selectedAccount.id });
      const currentMultiAccount = settingsRef.current.multiAccount;
      const nextAccounts = result.account
        ? upsertAccountById(currentMultiAccount.accounts, result.account)
        : setAccountCredentialStatus(currentMultiAccount.accounts, selectedAccount.id, result.reason);

      commitMultiAccount({
        accounts: nextAccounts,
        activeAccountByProvider: cleanupActiveAccountByProvider(
          currentMultiAccount.activeAccountByProvider,
          nextAccounts,
        ),
      });
      await refreshAccounts();
    } catch (error) {
      setActionError(toActionErrorMessage(error, "Unable to check account status."));
    } finally {
      setPendingAction(null);
    }
  }, [commitMultiAccount, refreshAccounts, selectedAccount]);

  const handleRemoveSelectedAccount = useCallback(async () => {
    if (!selectedAccount) {
      setActionError("Select an account to remove.");
      return;
    }

    const api = ensureNativeApi();
    const confirmed = await api.dialogs.confirm(
      `Remove account "${selectedAccount.name}" from Codex?`,
    );
    if (!confirmed) return;

    setPendingAction(`remove:${selectedAccount.id}`);
    setActionError(null);

    try {
      await api.accounts.remove({ accountId: selectedAccount.id });
      const nextMultiAccount = removeAccountAndCleanupActive(
        settingsRef.current.multiAccount,
        selectedAccount.id,
      );
      commitMultiAccount(nextMultiAccount);
      await refreshAccounts();
    } catch (error) {
      setActionError(toActionErrorMessage(error, "Unable to remove account."));
    } finally {
      setPendingAction(null);
    }
  }, [commitMultiAccount, refreshAccounts, selectedAccount]);

  const primaryRemainingPercent = readPrimaryRemainingPercent(selectedAccount);
  const primaryResetLabel = formatResetTimestamp(selectedAccount);

  return (
    <section id="accounts" className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Accounts</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select provider, connect a Codex account, then choose the active account for new sessions.
          </p>
        </div>
        <Button size="xs" variant="outline" onClick={() => void refreshAccounts()} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {loadError ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {loadError}
        </div>
      ) : null}
      {actionError ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}
      {hasActiveSession ? (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Account switching is locked while a session is running.
        </div>
      ) : null}

      <div className="space-y-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-foreground">Provider</span>
          <Select
            items={supportedProviders.map((provider) => ({
              label: provider === "codex" ? "Codex" : provider,
              value: provider,
            }))}
            value={selectedProvider}
            onValueChange={(value) => {
              if (!value || value !== CODEX_ONLY_PROVIDER) return;
              setSelectedProvider(CODEX_ONLY_PROVIDER);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              <SelectItem value={CODEX_ONLY_PROVIDER}>Codex</SelectItem>
            </SelectPopup>
          </Select>
        </label>

        <div className="rounded-lg border border-border bg-background px-3 py-3">
          <p className="text-xs font-medium text-foreground">Connect Codex account</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Runs <code>codex login</code> and stores credentials in <code>~/.t3code/accounts</code>.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={newAccountName}
              onChange={(event) => setNewAccountName(event.target.value)}
              placeholder="Account name (for example: Work)"
              aria-label="Codex account name"
            />
            <Button
              onClick={() => void handleAddAccount()}
              disabled={pendingAction === "add" || isLoading}
            >
              {pendingAction === "add" ? "Connecting..." : "Connect account"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background px-3 py-3">
          <p className="text-xs font-medium text-foreground">Active account</p>
          <select
            className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-70"
            value={activeAccountId ?? DEFAULT_ACCOUNT_VALUE}
            onChange={(event) => handleActiveAccountChange(event.target.value)}
            disabled={providerAccounts.length === 0 || hasActiveSession}
            aria-label="Active Codex account"
          >
            <option value={DEFAULT_ACCOUNT_VALUE}>Default (system credentials)</option>
            {providerAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>

          {providerAccounts.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">No Codex accounts connected yet.</p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-background px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Selected account details</p>
            {selectedAccount ? (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                {activeAccountId === selectedAccount.id ? "Active" : "Connected"}
              </Badge>
            ) : null}
          </div>

          {selectedAccount ? (
            <>
              <label className="sr-only" htmlFor="selected-account">Selected account</label>
              <select
                id="selected-account"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                value={selectedAccount.id}
                onChange={(event) => setSelectedAccountId(event.target.value)}
              >
                {providerAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>

              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <p>
                  Alias: <span className="font-medium text-foreground">{selectedAccount.name}</span>
                </p>
                <p>
                  Name:{" "}
                  <span className="font-medium text-foreground">
                    {selectedAccount.codexProfile?.name ?? "Unknown"}
                  </span>
                </p>
                <p>
                  Email:{" "}
                  <span className="font-medium text-foreground">
                    {selectedAccount.codexProfile?.email ?? "Unknown"}
                  </span>
                </p>
                <p>
                  Account type:{" "}
                  <span className="font-medium text-foreground">
                    {selectedAccount.codexProfile?.type ?? "Unknown"}
                  </span>
                </p>
                <p>
                  Plan:{" "}
                  <span className="font-medium text-foreground">
                    {selectedAccount.codexProfile?.planType ?? "Unknown"}
                  </span>
                </p>
                <p>
                  Remaining limit:{" "}
                  <span className="font-medium text-foreground">
                    {primaryRemainingPercent !== null ? `${primaryRemainingPercent}%` : "Unknown"}
                  </span>
                </p>
                <p>
                  Resets:{" "}
                  <span className="font-medium text-foreground">{primaryResetLabel ?? "Unknown"}</span>
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void handleCheckSelectedAccount()}
                  disabled={pendingAction === `check:${selectedAccount.id}`}
                >
                  {pendingAction === `check:${selectedAccount.id}` ? "Checking..." : "Check status"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => void handleRemoveSelectedAccount()}
                  disabled={pendingAction === `remove:${selectedAccount.id}`}
                >
                  {pendingAction === `remove:${selectedAccount.id}` ? "Removing..." : "Remove"}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">Select or connect an account to view details.</p>
          )}
        </div>
      </div>
    </section>
  );
}

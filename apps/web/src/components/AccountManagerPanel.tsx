import { type ProviderAccount, type ProviderKind, type AccountCheckReason } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type AppSettings, useAppSettings } from "../appSettings";
import { ensureNativeApi } from "../nativeApi";
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
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  codex: "Codex (OpenAI)",
  claudeCode: "Claude Code (Anthropic)",
  cursor: "Cursor",
};

const ACCOUNT_STATUS_LABELS: Record<AccountCheckReason, string> = {
  ok: "Healthy",
  missing: "Missing",
  malformed: "Malformed",
  expired: "Expired",
};

const ADD_FORM_DEFAULT: Record<ProviderKind, { name: string; apiKey: string }> = {
  codex: { name: "", apiKey: "" },
  claudeCode: { name: "", apiKey: "" },
  cursor: { name: "", apiKey: "" },
};

function toActionErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function AccountStatusBadge({ reason }: { reason: AccountCheckReason | undefined }) {
  if (!reason) {
    return (
      <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Unknown
      </Badge>
    );
  }
  const variant = reason === "ok" ? "secondary" : "outline";
  const colorClass =
    reason === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-amber-700 dark:text-amber-300";
  return (
    <Badge variant={variant} className={`text-[10px] uppercase tracking-wide ${colorClass}`}>
      {ACCOUNT_STATUS_LABELS[reason]}
    </Badge>
  );
}

export function AccountManagerPanel() {
  const { settings, updateSettings } = useAppSettings();
  const settingsRef = useRef(settings);
  const [supportedProviders, setSupportedProviders] = useState<ProviderKind[]>(["codex"]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [addFormByProvider, setAddFormByProvider] =
    useState<Record<ProviderKind, { name: string; apiKey: string }>>(ADD_FORM_DEFAULT);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [renameDraftByAccountId, setRenameDraftByAccountId] = useState<Record<string, string>>({});

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
      api.accounts.list({ accounts: currentMultiAccount.accounts }),
    ]);

    const providers = normalizeSupportedProviders([
      ...supported.providers,
      ...currentMultiAccount.accounts.map((account) => account.providerKind),
    ]);
    const nextAccounts = listed.accounts;
    const nextActive = cleanupActiveAccountByProvider(
      currentMultiAccount.activeAccountByProvider,
      nextAccounts,
    );

    commitMultiAccount({
      accounts: nextAccounts,
      activeAccountByProvider: nextActive,
    });
    setSupportedProviders(providers.length > 0 ? providers : ["codex"]);
    setLoadError(null);
  }, [commitMultiAccount]);

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

  const providersToRender = useMemo(
    () =>
      normalizeSupportedProviders([
        ...supportedProviders,
        ...settings.multiAccount.accounts.map((account) => account.providerKind),
      ]),
    [settings.multiAccount.accounts, supportedProviders],
  );

  const accountsByProvider = useMemo(() => {
    const grouped: Record<ProviderKind, ProviderAccount[]> = {
      codex: [],
      claudeCode: [],
      cursor: [],
    };
    for (const account of settings.multiAccount.accounts) {
      grouped[account.providerKind].push(account);
    }
    return grouped;
  }, [settings.multiAccount.accounts]);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setActionError(null);
    void refreshAccounts()
      .catch((error) => {
        setLoadError(toActionErrorMessage(error, "Unable to refresh accounts."));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [refreshAccounts]);

  const handleAddAccount = useCallback(
    async (providerKind: ProviderKind) => {
      const form = addFormByProvider[providerKind];
      const name = form.name.trim();
      const apiKey = form.apiKey.trim();
      if (!name) {
        setActionError("Enter an account name.");
        return;
      }
      if (providerKind === "claudeCode" && !apiKey) {
        setActionError("Claude Code accounts require an API key.");
        return;
      }

      setPendingAction(`add:${providerKind}`);
      setActionError(null);

      try {
        const api = ensureNativeApi();
        const response = await api.accounts.add(
          providerKind === "claudeCode"
            ? { providerKind, name, apiKey }
            : { providerKind, name },
        );

        const currentMultiAccount = settingsRef.current.multiAccount;
        const nextAccounts = upsertAccountById(currentMultiAccount.accounts, response.account);
        const nextActive = currentMultiAccount.activeAccountByProvider[providerKind]
          ? currentMultiAccount.activeAccountByProvider
          : setActiveForAccount(currentMultiAccount.activeAccountByProvider, response.account);

        commitMultiAccount({
          accounts: nextAccounts,
          activeAccountByProvider: cleanupActiveAccountByProvider(nextActive, nextAccounts),
        });

        setAddFormByProvider((existing) => ({
          ...existing,
          [providerKind]: { name: "", apiKey: "" },
        }));

        await refreshAccounts();
      } catch (error) {
        setActionError(toActionErrorMessage(error, "Unable to add account."));
      } finally {
        setPendingAction(null);
      }
    },
    [addFormByProvider, commitMultiAccount, refreshAccounts],
  );

  const handleRemoveAccount = useCallback(
    async (account: ProviderAccount) => {
      const api = ensureNativeApi();
      const confirmed = await api.dialogs.confirm(
        `Remove account "${account.name}" from ${PROVIDER_LABELS[account.providerKind]}?`,
      );
      if (!confirmed) return;

      setPendingAction(`remove:${account.id}`);
      setActionError(null);
      try {
        await api.accounts.remove({
          accountId: account.id,
          accounts: settingsRef.current.multiAccount.accounts,
        });
        const nextMultiAccount = removeAccountAndCleanupActive(
          settingsRef.current.multiAccount,
          account.id,
        );
        commitMultiAccount(nextMultiAccount);
        setEditingAccountId((current) => (current === account.id ? null : current));
      } catch (error) {
        setActionError(toActionErrorMessage(error, "Unable to remove account."));
      } finally {
        setPendingAction(null);
      }
    },
    [commitMultiAccount],
  );

  const handleSetActive = useCallback(
    (account: ProviderAccount) => {
      setActionError(null);
      const currentMultiAccount = settingsRef.current.multiAccount;
      commitMultiAccount({
        accounts: currentMultiAccount.accounts,
        activeAccountByProvider: setActiveForAccount(
          currentMultiAccount.activeAccountByProvider,
          account,
        ),
      });
    },
    [commitMultiAccount],
  );

  const handleClearActive = useCallback(
    (providerKind: ProviderKind) => {
      setActionError(null);
      const currentMultiAccount = settingsRef.current.multiAccount;
      commitMultiAccount({
        accounts: currentMultiAccount.accounts,
        activeAccountByProvider: clearActiveForProvider(
          currentMultiAccount.activeAccountByProvider,
          providerKind,
        ),
      });
    },
    [commitMultiAccount],
  );

  const handleSaveRename = useCallback(
    (account: ProviderAccount) => {
      const draft = renameDraftByAccountId[account.id] ?? account.name;
      const trimmedDraft = draft.trim();
      if (!trimmedDraft) {
        setActionError("Account name cannot be empty.");
        return;
      }
      setActionError(null);
      const currentMultiAccount = settingsRef.current.multiAccount;
      commitMultiAccount({
        accounts: renameAccountById(currentMultiAccount.accounts, account.id, trimmedDraft),
        activeAccountByProvider: currentMultiAccount.activeAccountByProvider,
      });
      setEditingAccountId(null);
    },
    [commitMultiAccount, renameDraftByAccountId],
  );

  const handleCheckAccount = useCallback(
    async (account: ProviderAccount) => {
      setPendingAction(`check:${account.id}`);
      setActionError(null);
      try {
        const api = ensureNativeApi();
        const result = await api.accounts.check({
          accountId: account.id,
          accounts: settingsRef.current.multiAccount.accounts,
        });
        const currentMultiAccount = settingsRef.current.multiAccount;
        commitMultiAccount({
          accounts: setAccountCredentialStatus(
            currentMultiAccount.accounts,
            account.id,
            result.reason,
          ),
          activeAccountByProvider: currentMultiAccount.activeAccountByProvider,
        });
      } catch (error) {
        setActionError(toActionErrorMessage(error, "Unable to check account status."));
      } finally {
        setPendingAction(null);
      }
    },
    [commitMultiAccount],
  );

  return (
    <section id="accounts" className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-foreground">Accounts</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect provider accounts, choose an active account per provider, and verify credential
            health.
          </p>
        </div>
        <Button size="xs" variant="outline" onClick={handleRetry} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {loadError ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {loadError}
        </div>
      ) : null}
      {actionError ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {actionError}
        </div>
      ) : null}

      <div className="space-y-4">
        {providersToRender.map((providerKind) => {
          const providerAccounts = accountsByProvider[providerKind];
          const activeAccountId = settings.multiAccount.activeAccountByProvider[providerKind];
          const addForm = addFormByProvider[providerKind];
          const addPending = pendingAction === `add:${providerKind}`;
          return (
            <div key={providerKind} className="rounded-xl border border-border bg-background/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-foreground">{PROVIDER_LABELS[providerKind]}</h3>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  Supported
                </Badge>
              </div>

              <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Input
                  value={addForm.name}
                  onChange={(event) =>
                    setAddFormByProvider((existing) => ({
                      ...existing,
                      [providerKind]: {
                        ...existing[providerKind],
                        name: event.target.value,
                      },
                    }))
                  }
                  placeholder="Account name"
                  aria-label={`${PROVIDER_LABELS[providerKind]} account name`}
                />
                <Input
                  value={addForm.apiKey}
                  onChange={(event) =>
                    setAddFormByProvider((existing) => ({
                      ...existing,
                      [providerKind]: {
                        ...existing[providerKind],
                        apiKey: event.target.value,
                      },
                    }))
                  }
                  placeholder={
                    providerKind === "claudeCode" ? "API key (required)" : "API key (optional)"
                  }
                  aria-label={`${PROVIDER_LABELS[providerKind]} API key`}
                  type="password"
                  disabled={providerKind !== "claudeCode"}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    void handleAddAccount(providerKind);
                  }}
                  disabled={addPending || isLoading}
                >
                  {addPending ? "Adding..." : "Add account"}
                </Button>
              </div>

              {providerAccounts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-background px-3 py-3 text-xs text-muted-foreground">
                  No accounts added for this provider.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-end">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleClearActive(providerKind)}
                      disabled={!activeAccountId}
                    >
                      Use default credentials
                    </Button>
                  </div>
                  {providerAccounts.map((account) => {
                    const isEditing = editingAccountId === account.id;
                    const isRemoving = pendingAction === `remove:${account.id}`;
                    const isChecking = pendingAction === `check:${account.id}`;
                    const renameDraft = renameDraftByAccountId[account.id] ?? account.name;
                    const isActive = activeAccountId === account.id;
                    return (
                      <div
                        key={account.id}
                        className="rounded-lg border border-border bg-background px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          {isEditing ? (
                            <Input
                              value={renameDraft}
                              onChange={(event) =>
                                setRenameDraftByAccountId((existing) => ({
                                  ...existing,
                                  [account.id]: event.target.value,
                                }))
                              }
                              className="h-8 max-w-sm"
                              aria-label={`Rename ${account.name}`}
                            />
                          ) : (
                            <p className="text-sm font-medium text-foreground">{account.name}</p>
                          )}

                          {isActive ? (
                            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                              Active
                            </Badge>
                          ) : null}
                          <AccountStatusBadge reason={account.credentialStatus} />
                        </div>

                        <p className="mt-1 break-all text-[11px] text-muted-foreground">
                          {account.profilePath}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {isEditing ? (
                            <>
                              <Button size="xs" onClick={() => handleSaveRename(account)}>
                                Save
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  setEditingAccountId(null);
                                  setRenameDraftByAccountId((existing) => ({
                                    ...existing,
                                    [account.id]: account.name,
                                  }));
                                }}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => handleSetActive(account)}
                                disabled={isActive}
                              >
                                {isActive ? "Active account" : "Set active"}
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  setEditingAccountId(account.id);
                                  setRenameDraftByAccountId((existing) => ({
                                    ...existing,
                                    [account.id]: account.name,
                                  }));
                                }}
                              >
                                Rename
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  void handleCheckAccount(account);
                                }}
                                disabled={isChecking}
                              >
                                {isChecking ? "Checking..." : "Check"}
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  void handleRemoveAccount(account);
                                }}
                                disabled={isRemoving}
                              >
                                {isRemoving ? "Removing..." : "Remove"}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

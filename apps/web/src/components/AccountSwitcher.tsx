import { useQuery } from "@tanstack/react-query";
import type {
  AccountCheckReason,
  ProviderAccount,
  ProviderKind,
  ResolvedKeybindingsConfig,
  ThreadId,
} from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { defaultAccountDisplayLabel } from "../accountDisplay";
import { toAccountActionErrorMessage } from "../accountErrorMessages";
import { useAppSettings } from "../appSettings";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import {
  cleanupActiveAccountByProvider,
  clearActiveForProvider,
  upsertAccountById,
} from "./AccountManagerPanel.state";
import {
  DEFAULT_OPTION_VALUE,
  getActiveAccountForProvider,
  getNextActiveAccountByProvider,
  getProviderAccounts,
} from "./AccountSwitcher.logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeCode: "Claude",
  cursor: "Cursor",
};

const STATUS_LABELS: Record<AccountCheckReason, string> = {
  ok: "Healthy",
  missing: "Missing",
  malformed: "Malformed",
  expired: "Expired",
};

const WARN_STATUS: ReadonlySet<AccountCheckReason> = new Set(["missing", "malformed", "expired"]);
const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];

function accountLabel(account: ProviderAccount): string {
  if (!account.credentialStatus || account.credentialStatus === "ok") {
    return account.name;
  }
  return `${account.name} (${STATUS_LABELS[account.credentialStatus]})`;
}

function inlineAccountLabel(account: ProviderAccount): string {
  const remainingPercent = readPrimaryRemainingPercent(account);
  if (remainingPercent === null) {
    return account.name;
  }
  return `${account.name} · ${remainingPercent}%`;
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

function parseAccountSelectCommand(command: string): { provider: ProviderKind; slot: number } | null {
  const match = /^account\.(codex|claudeCode|cursor)\.select([1-5])$/.exec(command);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const slot = Number(match[2]);
  if (!Number.isInteger(slot) || slot < 1 || slot > 5) {
    return null;
  }
  return {
    provider: match[1] as ProviderKind,
    slot,
  };
}

export interface AccountSwitcherProps {
  readonly provider: ProviderKind;
  readonly disabled?: boolean;
  readonly variant?: "inline" | "panel";
  readonly sessionActive?: boolean;
  readonly threadId?: ThreadId | null;
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

function readPrimaryUsedPercent(account: ProviderAccount | null): number | null {
  const primary = account?.codexProfile?.rateLimits?.primary;
  if (!primary) return null;
  if (typeof primary.usedPercent === "number") {
    return Math.max(0, Math.min(100, Math.round(primary.usedPercent)));
  }
  if (typeof primary.remainingPercent === "number") {
    return Math.max(0, Math.min(100, Math.round(100 - primary.remainingPercent)));
  }
  return null;
}

function formatResetLabel(account: ProviderAccount | null): string | null {
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

function CircleUsageIndicator({
  percent,
}: {
  readonly percent: number | null;
}) {
  const size = 16;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalizedPercent = percent !== null ? Math.max(0, Math.min(100, percent)) : null;
  const progress = normalizedPercent ?? 0;
  const offset = circumference * (1 - progress / 100);

  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      viewBox={`0 0 ${size} ${size}`}
      role="presentation"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity={normalizedPercent === null ? 0.35 : 0.8}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
        style={{
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
          strokeDasharray: circumference,
          strokeDashoffset: offset,
          transition: "stroke-dashoffset 180ms ease",
        }}
      />
    </svg>
  );
}

export function AccountSwitcher({
  provider,
  disabled = false,
  variant = "inline",
  sessionActive = false,
  threadId = null,
}: AccountSwitcherProps) {
  const { data: serverConfig } = useQuery(serverConfigQueryOptions());
  const { settings, updateSettings } = useAppSettings();
  const keybindings = serverConfig?.keybindings ?? EMPTY_KEYBINDINGS;
  const hasHydratedAccountsRef = useRef(false);
  const settingsRef = useRef(settings);
  const [isOpen, setIsOpen] = useState(false);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [defaultProviderAccount, setDefaultProviderAccount] = useState<ProviderAccount | null>(null);
  const [sessionProviderAccount, setSessionProviderAccount] = useState<ProviderAccount | null>(null);

  const providerAccounts = useMemo(
    () =>
      getProviderAccounts(settings.multiAccount.accounts, provider).filter(
        (account) => !account.isDefault,
      ),
    [provider, settings.multiAccount.accounts],
  );

  const activeAccountId = settings.multiAccount.activeAccountByProvider[provider] ?? null;
  const activeAccount = getActiveAccountForProvider(providerAccounts, activeAccountId);
  const detailsAccount =
    (sessionActive ? sessionProviderAccount : null) ??
    activeAccount ??
    defaultProviderAccount ??
    providerAccounts[0] ??
    null;

  const selectedValue = activeAccount ? activeAccount.id : DEFAULT_OPTION_VALUE;
  const primaryRemainingPercent = readPrimaryRemainingPercent(detailsAccount);
  const primaryUsedPercent = readPrimaryUsedPercent(detailsAccount);
  const primaryResetLabel = formatResetLabel(detailsAccount);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const commitMultiAccount = useCallback(
    (nextMultiAccount: typeof settings.multiAccount) => {
      settingsRef.current = {
        ...settingsRef.current,
        multiAccount: nextMultiAccount,
      };
      updateSettings({ multiAccount: nextMultiAccount });
    },
    [updateSettings],
  );

  const applyListedAccounts = useCallback(
    (listedAccounts: readonly ProviderAccount[]) => {
      const nextProviderAccounts = getProviderAccounts(listedAccounts, provider);
      const nextDefaultAccount =
        nextProviderAccounts.find((account) => account.isDefault) ?? null;
      setDefaultProviderAccount(nextDefaultAccount);

      const currentMultiAccount = settingsRef.current.multiAccount;
      const nextAccounts = listedAccounts.filter((account) => !account.isDefault);
      const nextActive = cleanupActiveAccountByProvider(
        currentMultiAccount.activeAccountByProvider,
        nextAccounts,
      );

      commitMultiAccount({
        accounts: nextAccounts,
        activeAccountByProvider: nextActive,
      });
    },
    [commitMultiAccount, provider],
  );

  const refreshSessionRateLimitDetails = useCallback(
    async (options?: { readonly includeList?: boolean }) => {
      const api = readNativeApi();
      if (!api) return;

      const currentMultiAccount = settingsRef.current.multiAccount;
      const selectedAccountId = currentMultiAccount.activeAccountByProvider[provider] ?? null;
      const currentSnapshot = await api.accounts
        .current({
          providerKind: provider,
          ...(threadId ? { threadId } : {}),
        })
        .catch(() => ({ account: undefined }));

      if (currentSnapshot.account) {
        if (currentSnapshot.account.isDefault) {
          setDefaultProviderAccount(currentSnapshot.account);
          setSessionProviderAccount(currentSnapshot.account);
        } else {
          setSessionProviderAccount(currentSnapshot.account);
          const nextAccounts = upsertAccountById(currentMultiAccount.accounts, currentSnapshot.account);
          const nextActive = cleanupActiveAccountByProvider(
            currentMultiAccount.activeAccountByProvider,
            nextAccounts,
          );
          commitMultiAccount({
            accounts: nextAccounts,
            activeAccountByProvider: nextActive,
          });
        }
      } else {
        setSessionProviderAccount(null);
      }

      const accountIdToCheck = currentSnapshot.account?.id ?? selectedAccountId;
      if (accountIdToCheck) {
        try {
          const checked = await api.accounts.check({ accountId: accountIdToCheck });
          if (checked.account) {
            if (checked.account.isDefault) {
              setDefaultProviderAccount(checked.account);
              setSessionProviderAccount(checked.account);
            } else {
              const nextAccounts = upsertAccountById(currentMultiAccount.accounts, checked.account);
              const nextActive = cleanupActiveAccountByProvider(
                currentMultiAccount.activeAccountByProvider,
                nextAccounts,
              );
              commitMultiAccount({
                accounts: nextAccounts,
                activeAccountByProvider: nextActive,
              });
            }
          }
        } catch {
          // Non-blocking: keep existing account details if a refresh probe fails.
        }
      }

      if (options?.includeList || !selectedAccountId) {
        try {
          const listed = await api.accounts.list({});
          applyListedAccounts(listed.accounts);
        } catch {
          // Non-blocking: keep existing local state if listing fails.
        }
      }
    },
    [applyListedAccounts, commitMultiAccount, provider, threadId],
  );

  useEffect(() => {
    if (sessionActive) {
      return;
    }
    setSessionProviderAccount(null);
  }, [sessionActive, threadId]);

  useEffect(() => {
    if (!activeAccountId) {
      return;
    }
    if (activeAccount) {
      return;
    }
    const currentMultiAccount = settingsRef.current.multiAccount;
    commitMultiAccount({
      accounts: currentMultiAccount.accounts,
      activeAccountByProvider: clearActiveForProvider(
        currentMultiAccount.activeAccountByProvider,
        provider,
      ),
    });
  }, [activeAccount, activeAccountId, commitMultiAccount, provider]);

  useEffect(() => {
    if (hasHydratedAccountsRef.current) {
      return;
    }
    hasHydratedAccountsRef.current = true;
    let cancelled = false;
    void refreshSessionRateLimitDetails({ includeList: true }).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [refreshSessionRateLimitDetails]);

  useEffect(() => {
    if (!hasHydratedAccountsRef.current) {
      return;
    }
    const includeList = selectedValue === DEFAULT_OPTION_VALUE;
    void refreshSessionRateLimitDetails({ includeList });
  }, [refreshSessionRateLimitDetails, selectedValue]);

  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    const includeList = selectedValue === DEFAULT_OPTION_VALUE;
    void refreshSessionRateLimitDetails({ includeList });
    const timer = window.setInterval(() => {
      void refreshSessionRateLimitDetails({ includeList });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshSessionRateLimitDetails, selectedValue, sessionActive]);

  const applySelection = useCallback(
    (value: string) => {
      if (disabled) {
        return;
      }

      const currentMultiAccount = settingsRef.current.multiAccount;
      const nextActiveAccountByProvider = getNextActiveAccountByProvider({
        provider,
        selectedValue: value,
        providerAccounts,
        activeAccountByProvider: currentMultiAccount.activeAccountByProvider,
      });

      commitMultiAccount({
        accounts: currentMultiAccount.accounts,
        activeAccountByProvider: nextActiveAccountByProvider,
      });
      setInlineError(null);
    },
    [commitMultiAccount, disabled, provider, providerAccounts],
  );

  useEffect(() => {
    if (variant !== "inline") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || isEditableEventTarget(event.target)) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: false,
          terminalOpen: false,
        },
      });
      if (!command) {
        return;
      }

      if (command === "account.switcher.open") {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(true);
        setInlineError(null);
        return;
      }

      const selection = parseAccountSelectCommand(command);
      if (!selection || selection.provider !== provider) {
        return;
      }
      const account = providerAccounts[selection.slot - 1];
      if (!account) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      applySelection(account.id);
      setIsOpen(false);
      setInlineError(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [applySelection, disabled, keybindings, provider, providerAccounts, variant]);

  const submitConnectAccount = useCallback(async () => {
    if (provider !== "codex") {
      setInlineError(`Connecting accounts for ${PROVIDER_LABELS[provider]} is not supported yet.`);
      return;
    }

    const name = newAccountName.trim();
    if (!name) {
      setInlineError("Enter an account name.");
      return;
    }

    const api = readNativeApi();
    if (!api) {
      setInlineError("Native API is unavailable.");
      return;
    }

    setIsConnecting(true);
    setInlineError(null);
    try {
      const currentMultiAccount = settingsRef.current.multiAccount;
      const response = await api.accounts.add({
        providerKind: provider,
        name,
      });
      const nextAccounts = upsertAccountById(currentMultiAccount.accounts, response.account);
      const nextActive = getNextActiveAccountByProvider({
        provider,
        selectedValue: response.account.id,
        providerAccounts: nextAccounts.filter((account) => account.providerKind === provider),
        activeAccountByProvider: cleanupActiveAccountByProvider(
          currentMultiAccount.activeAccountByProvider,
          nextAccounts,
        ),
      });

      commitMultiAccount({
        accounts: nextAccounts,
        activeAccountByProvider: nextActive,
      });
      setNewAccountName("");
      setIsConnectDialogOpen(false);
      setIsOpen(false);
      void refreshSessionRateLimitDetails({ includeList: true });
    } catch (error) {
      setInlineError(toAccountActionErrorMessage(error, "Unable to connect account."));
    } finally {
      setIsConnecting(false);
    }
  }, [
    commitMultiAccount,
    newAccountName,
    provider,
    refreshSessionRateLimitDetails,
  ]);

  const triggerLabel =
    selectedValue === DEFAULT_OPTION_VALUE
      ? defaultAccountDisplayLabel(defaultProviderAccount)
      : activeAccount?.name ?? defaultAccountDisplayLabel(defaultProviderAccount);
  const contextWindowFullPercent =
    primaryUsedPercent ?? (primaryRemainingPercent !== null ? 100 - primaryRemainingPercent : null);
  const creditsBalance = detailsAccount?.codexProfile?.rateLimits?.credits?.balance?.trim() || null;
  const remainingLimitLine =
    primaryRemainingPercent !== null
      ? `${primaryRemainingPercent}% remaining`
      : creditsBalance && creditsBalance.length > 0
        ? creditsBalance.includes("/")
          ? creditsBalance
          : `${creditsBalance} remaining`
        : "Unknown";
  const contextUsageLine =
    creditsBalance && creditsBalance.length > 0
      ? creditsBalance.includes("/")
        ? `${creditsBalance} tokens used`
        : `${creditsBalance} credits remaining`
      : contextWindowFullPercent !== null && primaryRemainingPercent !== null
        ? `${contextWindowFullPercent}% used · ${primaryRemainingPercent}% remaining`
        : contextWindowFullPercent !== null
          ? `${contextWindowFullPercent}% used`
          : primaryRemainingPercent !== null
            ? `${primaryRemainingPercent}% remaining`
            : "Usage details unavailable";
  const openSwitcherShortcutLabel =
    shortcutLabelForCommand(keybindings, "account.switcher.open") ?? "⌘⇧A";
  const selectorTrigger = (
    <MenuTrigger
      render={
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
        />
      }
      disabled={disabled || isConnecting}
      title={`Switch account (${openSwitcherShortcutLabel})`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{triggerLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
      </span>
    </MenuTrigger>
  );

  if (variant === "inline") {
    return (
      <div className="flex min-w-0 max-w-full items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0 p-0 text-muted-foreground/70 hover:text-foreground/80"
                title="Usage details"
                aria-label="Usage details"
              />
            }
          >
            <CircleUsageIndicator percent={contextWindowFullPercent} />
          </TooltipTrigger>
          <TooltipPopup side="top" sideOffset={8} className="w-60 whitespace-normal px-3 py-2">
            <div className="space-y-1 text-center">
              <p className="text-xs text-muted-foreground">Remaining limit:</p>
              <p className="text-xl font-semibold leading-none">{remainingLimitLine}</p>
              <p className="text-sm font-medium">{contextUsageLine}</p>
              <p className="pt-1 text-sm text-muted-foreground">
                The active provider manages context automatically
              </p>
            </div>
          </TooltipPopup>
        </Tooltip>
        <Menu
          open={isOpen}
          onOpenChange={(open) => {
            if (disabled || isConnecting) {
              setIsOpen(false);
              return;
            }
            setIsOpen(open);
          }}
        >
          {selectorTrigger}
          <MenuPopup align="end" side="top">
            <MenuSub>
              <MenuSubTrigger>{PROVIDER_LABELS[provider]}</MenuSubTrigger>
              <MenuSubPopup className="w-56 [--available-height:min(22rem,70vh)]">
                {inlineError ? (
                  <>
                    <div className="px-2 py-1.5 text-xs text-destructive">{inlineError}</div>
                    <MenuSeparator />
                  </>
                ) : null}
                <MenuGroup>
                  <MenuRadioGroup
                    value={selectedValue}
                    onValueChange={(value) => {
                      applySelection(value);
                      setIsOpen(false);
                    }}
                  >
                    <MenuRadioItem value={DEFAULT_OPTION_VALUE}>
                      <span className="truncate">
                        {defaultAccountDisplayLabel(defaultProviderAccount)}
                      </span>
                    </MenuRadioItem>
                    {providerAccounts.map((account) => (
                      <MenuRadioItem key={account.id} value={account.id}>
                        <span className="truncate">{inlineAccountLabel(account)}</span>
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuItem
                  disabled={isConnecting}
                  onClick={() => {
                    setInlineError(null);
                    setNewAccountName("");
                    setIsOpen(false);
                    setIsConnectDialogOpen(true);
                  }}
                >
                  {isConnecting ? "Connecting account..." : "+ Connect account"}
                </MenuItem>
              </MenuSubPopup>
            </MenuSub>
          </MenuPopup>
        </Menu>
        <Dialog open={isConnectDialogOpen} onOpenChange={setIsConnectDialogOpen}>
          <DialogPopup className="max-w-md">
            <DialogHeader>
              <DialogTitle>Connect Codex account</DialogTitle>
              <DialogDescription>
                Enter a label for this account. Sign-in starts after you confirm.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-3">
              <Input
                value={newAccountName}
                onChange={(event) => setNewAccountName(event.target.value)}
                placeholder="Account name (for example: Work)"
                autoFocus
                aria-label="Codex account name"
                disabled={isConnecting}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitConnectAccount();
                  }
                }}
              />
              {inlineError ? <p className="text-xs text-destructive">{inlineError}</p> : null}
            </DialogPanel>
            <DialogFooter>
              <Button
                size="sm"
                variant="outline"
                disabled={isConnecting}
                onClick={() => setIsConnectDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={isConnecting} onClick={() => void submitConnectAccount()}>
                {isConnecting ? "Connecting..." : "Connect"}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      </div>
    );
  }

  const selectClasses =
    "w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-70";

  return (
    <div className="rounded-lg border border-border/70 bg-background/70 px-2 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
          Account ({PROVIDER_LABELS[provider]})
        </p>
        {disabled && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Locked
          </span>
        )}
      </div>

      <label className="sr-only" htmlFor={`account-switcher-${provider}`}>
        Active {PROVIDER_LABELS[provider]} account
      </label>
      <select
        id={`account-switcher-${provider}`}
        className={selectClasses}
        value={selectedValue}
        onChange={(event) => applySelection(event.target.value)}
        disabled={disabled || providerAccounts.length === 0}
        aria-label={`Active ${PROVIDER_LABELS[provider]} account`}
      >
        <option value={DEFAULT_OPTION_VALUE}>
          {defaultAccountDisplayLabel(defaultProviderAccount)}
        </option>
        {providerAccounts.map((account) => (
          <option key={account.id} value={account.id}>
            {accountLabel(account)}
          </option>
        ))}
      </select>

      {providerAccounts.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          No {PROVIDER_LABELS[provider]} accounts yet. Manage accounts in{" "}
          <a href="/settings" className="underline underline-offset-2">
            Settings
          </a>
          .
        </p>
      ) :
      activeAccount &&
        activeAccount.credentialStatus &&
        WARN_STATUS.has(activeAccount.credentialStatus) ? (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
          Active account status: {STATUS_LABELS[activeAccount.credentialStatus]}.
        </p>
      ) : null}

      {detailsAccount ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          {detailsAccount.codexProfile?.email ? `${detailsAccount.codexProfile.email} · ` : ""}
          {detailsAccount.codexProfile?.type ? `${detailsAccount.codexProfile.type} · ` : ""}
          {primaryRemainingPercent !== null
            ? `${primaryRemainingPercent}% remaining${primaryUsedPercent !== null ? ` (${primaryUsedPercent}% used)` : ""}`
            : "Limit unavailable"}
          {primaryResetLabel ? ` · resets ${primaryResetLabel}` : ""}
        </p>
      ) : null}

      {disabled ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          Switching is disabled while this session is active.
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground/70">Applies to new sessions only.</p>
      )}
    </div>
  );
}

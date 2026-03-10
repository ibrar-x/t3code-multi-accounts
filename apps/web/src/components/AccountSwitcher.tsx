import type { AccountCheckReason, ProviderAccount, ProviderKind } from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { defaultAccountDisplayLabel } from "../accountDisplay";
import { toAccountActionErrorMessage } from "../accountErrorMessages";
import { useAppSettings } from "../appSettings";
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
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";

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

function isOpenShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || !event.shiftKey) {
    return false;
  }
  if (event.key.toLowerCase() !== "a") {
    return false;
  }
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export interface AccountSwitcherProps {
  readonly provider: ProviderKind;
  readonly disabled?: boolean;
  readonly variant?: "inline" | "panel";
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

export function AccountSwitcher({
  provider,
  disabled = false,
  variant = "inline",
}: AccountSwitcherProps) {
  const { settings, updateSettings } = useAppSettings();
  const hasHydratedAccountsRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [defaultProviderAccount, setDefaultProviderAccount] = useState<ProviderAccount | null>(null);

  const providerAccounts = useMemo(
    () =>
      getProviderAccounts(settings.multiAccount.accounts, provider).filter(
        (account) => !account.isDefault,
      ),
    [provider, settings.multiAccount.accounts],
  );

  const activeAccountId = settings.multiAccount.activeAccountByProvider[provider] ?? null;
  const activeAccount = getActiveAccountForProvider(providerAccounts, activeAccountId);
  const detailsAccount = activeAccount ?? defaultProviderAccount ?? providerAccounts[0] ?? null;

  const selectedValue = activeAccount ? activeAccount.id : DEFAULT_OPTION_VALUE;
  const primaryRemainingPercent = readPrimaryRemainingPercent(detailsAccount);
  const primaryResetLabel = formatResetLabel(detailsAccount);

  useEffect(() => {
    if (!activeAccountId) {
      return;
    }
    if (activeAccount) {
      return;
    }
    updateSettings({
      multiAccount: {
        accounts: settings.multiAccount.accounts,
        activeAccountByProvider: clearActiveForProvider(
          settings.multiAccount.activeAccountByProvider,
          provider,
        ),
      },
    });
  }, [
    activeAccount,
    activeAccountId,
    provider,
    settings.multiAccount.accounts,
    settings.multiAccount.activeAccountByProvider,
    updateSettings,
  ]);

  useEffect(() => {
    if (hasHydratedAccountsRef.current) {
      return;
    }
    hasHydratedAccountsRef.current = true;
    const api = readNativeApi();
    if (!api) {
      return;
    }
    let cancelled = false;
    void api.accounts
      .list({})
      .then((response) => {
        if (cancelled) return;
        const nextProviderAccounts = getProviderAccounts(response.accounts, provider);
        const nextDefaultAccount =
          nextProviderAccounts.find((account) => account.isDefault) ?? null;
        setDefaultProviderAccount(nextDefaultAccount);
        const nextAccounts = response.accounts.filter((account) => !account.isDefault);
        const nextActive = cleanupActiveAccountByProvider(
          settings.multiAccount.activeAccountByProvider,
          nextAccounts,
        );
        updateSettings({
          multiAccount: {
            accounts: nextAccounts,
            activeAccountByProvider: nextActive,
          },
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [provider, settings.multiAccount.activeAccountByProvider, updateSettings]);

  useEffect(() => {
    if (variant !== "inline") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled || isEditableEventTarget(event.target) || !isOpenShortcut(event)) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setInlineError(null);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [disabled, variant]);

  const applySelection = useCallback(
    (value: string) => {
      if (disabled) {
        return;
      }

      const currentMultiAccount = settings.multiAccount;
      const nextActiveAccountByProvider = getNextActiveAccountByProvider({
        provider,
        selectedValue: value,
        providerAccounts,
        activeAccountByProvider: currentMultiAccount.activeAccountByProvider,
      });

      updateSettings({
        multiAccount: {
          accounts: currentMultiAccount.accounts,
          activeAccountByProvider: nextActiveAccountByProvider,
        },
      });
      setInlineError(null);
    },
    [disabled, provider, providerAccounts, settings.multiAccount, updateSettings],
  );

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
      const response = await api.accounts.add({
        providerKind: provider,
        name,
      });
      const nextAccounts = upsertAccountById(settings.multiAccount.accounts, response.account);
      const nextActive = getNextActiveAccountByProvider({
        provider,
        selectedValue: response.account.id,
        providerAccounts: nextAccounts.filter((account) => account.providerKind === provider),
        activeAccountByProvider: cleanupActiveAccountByProvider(
          settings.multiAccount.activeAccountByProvider,
          nextAccounts,
        ),
      });

      updateSettings({
        multiAccount: {
          accounts: nextAccounts,
          activeAccountByProvider: nextActive,
        },
      });
      setNewAccountName("");
      setIsConnectDialogOpen(false);
      setIsOpen(false);
    } catch (error) {
      setInlineError(toAccountActionErrorMessage(error, "Unable to connect account."));
    } finally {
      setIsConnecting(false);
    }
  }, [
    newAccountName,
    provider,
    settings.multiAccount.accounts,
    settings.multiAccount.activeAccountByProvider,
    updateSettings,
  ]);

  const triggerLabel =
    selectedValue === DEFAULT_OPTION_VALUE
      ? defaultAccountDisplayLabel(defaultProviderAccount)
      : activeAccount?.name ?? defaultAccountDisplayLabel(defaultProviderAccount);

  if (variant === "inline") {
    return (
      <div className="min-w-0 max-w-full">
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
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
              />
            }
            disabled={disabled || isConnecting}
            title="Switch account (Cmd+Shift+A)"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{triggerLabel}</span>
              <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
            </span>
          </MenuTrigger>
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
                  <MenuShortcut>⌘⇧A</MenuShortcut>
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
            ? `${primaryRemainingPercent}% remaining`
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

import type { AccountCheckReason, ProviderAccount, ProviderKind } from "@t3tools/contracts";

import { useEffect, useMemo } from "react";

import { type AppSettings, useAppSettings } from "../appSettings";
import { clearActiveForProvider, setActiveForAccount } from "./AccountManagerPanel.state";

const DEFAULT_OPTION_VALUE = "__default__";

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
  activeAccountByProvider: AppSettings["multiAccount"]["activeAccountByProvider"];
}): AppSettings["multiAccount"]["activeAccountByProvider"] {
  if (input.selectedValue === DEFAULT_OPTION_VALUE) {
    return clearActiveForProvider(input.activeAccountByProvider, input.provider);
  }
  const account = input.providerAccounts.find((entry) => entry.id === input.selectedValue);
  if (!account) {
    return input.activeAccountByProvider;
  }
  return setActiveForAccount(input.activeAccountByProvider, account);
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

  const providerAccounts = useMemo(
    () => getProviderAccounts(settings.multiAccount.accounts, provider),
    [provider, settings.multiAccount.accounts],
  );

  const activeAccountId = settings.multiAccount.activeAccountByProvider[provider] ?? null;
  const activeAccount = getActiveAccountForProvider(providerAccounts, activeAccountId);

  const selectedValue = activeAccount ? activeAccount.id : DEFAULT_OPTION_VALUE;
  const primaryRemainingPercent = readPrimaryRemainingPercent(activeAccount);
  const primaryResetLabel = formatResetLabel(activeAccount);
  const inlineActiveSummary = activeAccount
    ? [
        activeAccount.codexProfile?.email,
        activeAccount.codexProfile?.type,
        primaryRemainingPercent !== null ? `${primaryRemainingPercent}% remaining` : null,
        primaryResetLabel ? `resets ${primaryResetLabel}` : null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" · ")
    : null;

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

  const handleChange = (value: string) => {
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
  };

  const wrapperClasses =
    variant === "panel"
      ? "rounded-lg border border-border/70 bg-background/70 px-2 py-2"
      : "min-w-0";
  const selectClasses =
    variant === "panel"
      ? "w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-70"
      : "h-8 max-w-[240px] rounded-md border border-border/60 bg-background/70 px-2 py-1 text-xs text-foreground/90 disabled:cursor-not-allowed disabled:opacity-70";

  return (
    <div className={wrapperClasses}>
      {variant === "inline" ? (
        <>
          <label className="sr-only" htmlFor={`account-switcher-${provider}`}>
            Active {PROVIDER_LABELS[provider]} account
          </label>
          <select
            id={`account-switcher-${provider}`}
            className={selectClasses}
            value={selectedValue}
            onChange={(event) => handleChange(event.target.value)}
            disabled={disabled || providerAccounts.length === 0}
            aria-label={`Active ${PROVIDER_LABELS[provider]} account`}
            title={inlineActiveSummary ?? undefined}
          >
            <option value={DEFAULT_OPTION_VALUE}>Default account</option>
            {providerAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {inlineAccountLabel(account)}
              </option>
            ))}
          </select>
        </>
      ) : (
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
      )}

      {variant === "panel" ? (
        <>
          <label className="sr-only" htmlFor={`account-switcher-${provider}`}>
            Active {PROVIDER_LABELS[provider]} account
          </label>
          <select
            id={`account-switcher-${provider}`}
            className={selectClasses}
            value={selectedValue}
            onChange={(event) => handleChange(event.target.value)}
            disabled={disabled || providerAccounts.length === 0}
            aria-label={`Active ${PROVIDER_LABELS[provider]} account`}
          >
            <option value={DEFAULT_OPTION_VALUE}>Default (system credentials)</option>
            {providerAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {variant === "panel" && providerAccounts.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          No {PROVIDER_LABELS[provider]} accounts yet. Manage accounts in{" "}
          <a href="/settings" className="underline underline-offset-2">
            Settings
          </a>
          .
        </p>
      ) : variant === "panel" &&
        activeAccount &&
        activeAccount.credentialStatus &&
        WARN_STATUS.has(activeAccount.credentialStatus) ? (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
          Active account status: {STATUS_LABELS[activeAccount.credentialStatus]}.
        </p>
      ) : null}

      {variant === "panel" && activeAccount ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          {activeAccount.codexProfile?.email ? `${activeAccount.codexProfile.email} · ` : ""}
          {activeAccount.codexProfile?.type ? `${activeAccount.codexProfile.type} · ` : ""}
          {primaryRemainingPercent !== null
            ? `${primaryRemainingPercent}% remaining`
            : "Limit unavailable"}
          {primaryResetLabel ? ` · resets ${primaryResetLabel}` : ""}
        </p>
      ) : null}

      {variant === "panel" && disabled ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">
          Switching is disabled while this session is active.
        </p>
      ) : variant === "panel" ? (
        <p className="mt-1 text-[11px] text-muted-foreground/70">Applies to new sessions only.</p>
      ) : null}
    </div>
  );
}

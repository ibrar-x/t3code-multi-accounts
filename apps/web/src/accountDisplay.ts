import type { ProviderAccount } from "@t3tools/contracts";

export function defaultAccountDisplayLabel(defaultAccount: ProviderAccount | null): string {
  if (!defaultAccount) {
    return "System account";
  }
  const base =
    defaultAccount.name?.trim() || defaultAccount.codexProfile?.email?.trim() || "System account";
  const tier = defaultAccount.codexProfile?.planType ?? defaultAccount.codexProfile?.type;
  return tier ? `${base} (${tier})` : base;
}

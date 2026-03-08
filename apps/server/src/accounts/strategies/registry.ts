import type { ProviderKind } from "@t3tools/contracts";
import type { CredentialIsolationStrategy } from "../credentialStrategy.ts";
import { ClaudeCodeCredentialStrategy } from "./claudeCodeStrategy.ts";
import { CodexCredentialStrategy } from "./codexStrategy.ts";

const registry = new Map<ProviderKind, CredentialIsolationStrategy>([
  ["codex", new CodexCredentialStrategy()],
  ["claudeCode", new ClaudeCodeCredentialStrategy()],
]);

export function getStrategy(providerKind: ProviderKind): CredentialIsolationStrategy {
  const strategy = registry.get(providerKind);
  if (!strategy) {
    throw new Error(
      `No credential strategy registered for provider: "${providerKind}". Add a strategy to apps/server/src/accounts/strategies/registry.ts`,
    );
  }
  return strategy;
}

export function getSupportedProviders(): ProviderKind[] {
  return Array.from(registry.keys());
}

export function hasStrategy(providerKind: ProviderKind): boolean {
  return registry.has(providerKind);
}

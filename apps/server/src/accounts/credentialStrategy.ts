import type { ProviderKind } from "@t3tools/contracts";

export type CredentialStatus =
  | { valid: true }
  | { valid: false; reason: "missing" | "malformed" | "expired" };

export interface CredentialLoginOptions {
  readonly apiKey?: string;
  readonly [key: string]: string | undefined;
}

export interface CredentialIsolationStrategy {
  readonly providerKind: ProviderKind;
  initProfileDir(profilePath: string): Promise<void>;
  runLoginFlow(profilePath: string, options?: CredentialLoginOptions): Promise<void>;
  getSessionEnv(profilePath: string): Record<string, string>;
  checkCredentials(profilePath: string): Promise<CredentialStatus>;
  removeProfile(profilePath: string): Promise<void>;
}

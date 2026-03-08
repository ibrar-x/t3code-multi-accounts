import { Schema } from "effect";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

const AccountId = TrimmedNonEmptyString;
const AccountName = TrimmedNonEmptyString.check(Schema.isMaxLength(120));
const AccountProfilePath = TrimmedNonEmptyString.check(Schema.isMaxLength(4096));
export const AccountCheckReason = Schema.Literals(["ok", "missing", "malformed", "expired"]);
export type AccountCheckReason = typeof AccountCheckReason.Type;

export const CodexRateLimitWindow = Schema.Struct({
  usedPercent: Schema.Number,
  remainingPercent: Schema.optional(Schema.Number),
  windowDurationMins: Schema.optional(Schema.Number),
  resetsAt: Schema.optional(Schema.Number),
});
export type CodexRateLimitWindow = typeof CodexRateLimitWindow.Type;

export const CodexRateLimitCredits = Schema.Struct({
  hasCredits: Schema.optional(Schema.Boolean),
  unlimited: Schema.optional(Schema.Boolean),
  balance: Schema.optional(Schema.String),
});
export type CodexRateLimitCredits = typeof CodexRateLimitCredits.Type;

export const CodexRateLimits = Schema.Struct({
  limitId: Schema.optional(Schema.String),
  limitName: Schema.optional(Schema.NullOr(Schema.String)),
  planType: Schema.optional(Schema.String),
  primary: Schema.optional(CodexRateLimitWindow),
  secondary: Schema.optional(CodexRateLimitWindow),
  credits: Schema.optional(CodexRateLimitCredits),
});
export type CodexRateLimits = typeof CodexRateLimits.Type;

export const CodexAccountProfile = Schema.Struct({
  type: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  planType: Schema.optional(Schema.String),
  rateLimits: Schema.optional(CodexRateLimits),
  syncedAt: Schema.optional(IsoDateTime),
});
export type CodexAccountProfile = typeof CodexAccountProfile.Type;

export const ProviderAccount = Schema.Struct({
  id: AccountId,
  providerKind: ProviderKind,
  name: AccountName,
  profilePath: AccountProfilePath,
  isDefault: Schema.Boolean,
  credentialStatus: Schema.optional(AccountCheckReason),
  codexProfile: Schema.optional(CodexAccountProfile),
  createdAt: IsoDateTime,
  lastUsedAt: Schema.NullOr(IsoDateTime),
});
export type ProviderAccount = typeof ProviderAccount.Type;

export const ActiveAccountByProvider = Schema.Struct({
  codex: Schema.optional(AccountId),
  claudeCode: Schema.optional(AccountId),
  cursor: Schema.optional(AccountId),
});
export type ActiveAccountByProvider = typeof ActiveAccountByProvider.Type;

export const MultiAccountSettings = Schema.Struct({
  accounts: Schema.Array(ProviderAccount),
  activeAccountByProvider: ActiveAccountByProvider,
});
export type MultiAccountSettings = typeof MultiAccountSettings.Type;

export const AccountAddRequest = Schema.Struct({
  providerKind: ProviderKind,
  name: AccountName,
  apiKey: Schema.optional(TrimmedNonEmptyString),
});
export type AccountAddRequest = typeof AccountAddRequest.Type;

export const AccountAddResponse = Schema.Struct({
  account: ProviderAccount,
});
export type AccountAddResponse = typeof AccountAddResponse.Type;

export const AccountListRequest = Schema.Struct({
  accounts: Schema.optional(Schema.Array(ProviderAccount)),
});
export type AccountListRequest = typeof AccountListRequest.Type;

export const AccountRemoveRequest = Schema.Struct({
  accountId: AccountId,
  accounts: Schema.optional(Schema.Array(ProviderAccount)),
});
export type AccountRemoveRequest = typeof AccountRemoveRequest.Type;

export const AccountRemoveResponse = Schema.Struct({
  success: Schema.Boolean,
});
export type AccountRemoveResponse = typeof AccountRemoveResponse.Type;

export const AccountCheckRequest = Schema.Struct({
  accountId: AccountId,
  accounts: Schema.optional(Schema.Array(ProviderAccount)),
});
export type AccountCheckRequest = typeof AccountCheckRequest.Type;

export const AccountCheckResponse = Schema.Struct({
  accountId: AccountId,
  valid: Schema.Boolean,
  reason: AccountCheckReason,
  account: Schema.optional(ProviderAccount),
});
export type AccountCheckResponse = typeof AccountCheckResponse.Type;

export const AccountListResponse = Schema.Struct({
  accounts: Schema.Array(ProviderAccount),
});
export type AccountListResponse = typeof AccountListResponse.Type;

export const AccountSupportedProvidersResponse = Schema.Struct({
  providers: Schema.Array(ProviderKind),
});
export type AccountSupportedProvidersResponse = typeof AccountSupportedProvidersResponse.Type;

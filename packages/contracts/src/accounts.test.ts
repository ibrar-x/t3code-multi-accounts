import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  AccountAddRequest,
  AccountCheckResponse,
  AccountCurrentRequest,
  AccountCurrentResponse,
  AccountSupportedProvidersResponse,
  MultiAccountSettings,
  ProviderAccount,
} from "./accounts";

const decodeProviderAccount = Schema.decodeUnknownSync(ProviderAccount);
const decodeMultiAccountSettings = Schema.decodeUnknownSync(MultiAccountSettings);
const decodeAccountAddRequest = Schema.decodeUnknownSync(AccountAddRequest);
const decodeAccountCheckResponse = Schema.decodeUnknownSync(AccountCheckResponse);
const decodeAccountCurrentRequest = Schema.decodeUnknownSync(AccountCurrentRequest);
const decodeAccountCurrentResponse = Schema.decodeUnknownSync(AccountCurrentResponse);
const decodeAccountSupportedProvidersResponse = Schema.decodeUnknownSync(
  AccountSupportedProvidersResponse,
);

describe("ProviderAccount", () => {
  it("decodes a valid provider account", () => {
    const parsed = decodeProviderAccount({
      id: "acc_abc123",
      providerKind: "codex",
      name: "Personal",
      profilePath: "/Users/me/.t3code/accounts/acc_abc123",
      isDefault: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: null,
    });

    expect(parsed.providerKind).toBe("codex");
    expect(parsed.isDefault).toBe(true);
    expect(parsed.lastUsedAt).toBeNull();
  });

  it("rejects unknown provider kinds", () => {
    expect(() =>
      decodeProviderAccount({
        id: "acc_abc123",
        providerKind: "unknown",
        name: "Personal",
        profilePath: "/Users/me/.t3code/accounts/acc_abc123",
        isDefault: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
      }),
    ).toThrow();
  });
});

describe("MultiAccountSettings", () => {
  it("supports per-provider active account selections", () => {
    const parsed = decodeMultiAccountSettings({
      accounts: [],
      activeAccountByProvider: {
        codex: "acc_codex_1",
      },
    });

    expect(parsed.activeAccountByProvider.codex).toBe("acc_codex_1");
    expect(parsed.activeAccountByProvider.claudeCode).toBeUndefined();
  });
});

describe("account payload schemas", () => {
  it("accepts account.add payloads with optional apiKey", () => {
    const parsed = decodeAccountAddRequest({
      providerKind: "claudeCode",
      name: "Claude Main",
      apiKey: "sk-ant-test",
    });

    expect(parsed.providerKind).toBe("claudeCode");
    expect(parsed.apiKey).toBe("sk-ant-test");
  });

  it("decodes account.check responses", () => {
    const parsed = decodeAccountCheckResponse({
      accountId: "acc_codex_1",
      valid: true,
      reason: "ok",
      account: {
        id: "acc_codex_1",
        providerKind: "codex",
        name: "Work",
        profilePath: "/Users/me/.t3code/accounts/acc_codex_1",
        isDefault: false,
        credentialStatus: "ok",
        codexProfile: {
          type: "chatgpt",
          email: "work@example.com",
          planType: "plus",
          rateLimits: {
            limitId: "codex",
            primary: {
              usedPercent: 42,
              remainingPercent: 58,
              windowDurationMins: 300,
            },
          },
          syncedAt: "2026-01-01T00:00:00.000Z",
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
      },
    });

    expect(parsed.valid).toBe(true);
    expect(parsed.reason).toBe("ok");
    expect(parsed.account?.codexProfile?.email).toBe("work@example.com");
    expect(parsed.account?.codexProfile?.rateLimits?.primary?.remainingPercent).toBe(58);
  });

  it("decodes supported-providers response", () => {
    const parsed = decodeAccountSupportedProvidersResponse({
      providers: ["codex", "claudeCode"],
    });

    expect(parsed.providers).toEqual(["codex", "claudeCode"]);
  });

  it("decodes current account request and response payloads", () => {
    const request = decodeAccountCurrentRequest({
      providerKind: "codex",
      threadId: "thread_1",
    });
    expect(request.providerKind).toBe("codex");
    expect(request.threadId).toBe("thread_1");

    const response = decodeAccountCurrentResponse({
      providerKind: "codex",
      account: {
        id: "acc_codex_1",
        providerKind: "codex",
        name: "Work",
        profilePath: "/Users/me/.t3code/accounts/acc_codex_1",
        isDefault: false,
        credentialStatus: "ok",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
      },
    });
    expect(response.providerKind).toBe("codex");
    expect(response.account?.id).toBe("acc_codex_1");
  });
});

import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ProviderSendTurnInput, ProviderSessionStartInput } from "./provider";

const decodeProviderSessionStartInput = Schema.decodeUnknownSync(ProviderSessionStartInput);
const decodeProviderSendTurnInput = Schema.decodeUnknownSync(ProviderSendTurnInput);

describe("ProviderSessionStartInput", () => {
  it("accepts codex-compatible payloads", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      cwd: "/tmp/workspace",
      model: "gpt-5.3-codex",
      modelOptions: {
        codex: {
          reasoningEffort: "high",
          fastMode: true,
        },
      },
      runtimeMode: "full-access",
      providerOptions: {
        codex: {
          binaryPath: "/usr/local/bin/codex",
          homePath: "/tmp/.codex",
        },
      },
    });
    expect(parsed.runtimeMode).toBe("full-access");
    expect(parsed.modelOptions?.codex?.reasoningEffort).toBe("high");
    expect(parsed.modelOptions?.codex?.fastMode).toBe(true);
    expect(parsed.providerOptions?.codex?.binaryPath).toBe("/usr/local/bin/codex");
    expect(parsed.providerOptions?.codex?.homePath).toBe("/tmp/.codex");
  });

  it("rejects payloads without runtime mode", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "codex",
      }),
    ).toThrow();
  });

  it("accepts non-codex provider values in baseline contracts", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "claudeCode",
      runtimeMode: "full-access",
    });

    expect(parsed.provider).toBe("claudeCode");
  });

  it("accepts optional account resolution metadata and env overrides", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "codex",
      accountId: "acc_codex_1",
      account: {
        id: "acc_codex_1",
        providerKind: "codex",
        name: "Work",
        profilePath: "/tmp/.t3/accounts/acc_codex_1",
        isDefault: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
      },
      accounts: [
        {
          id: "acc_codex_1",
          providerKind: "codex",
          name: "Work",
          profilePath: "/tmp/.t3/accounts/acc_codex_1",
          isDefault: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
      env: { CODEX_HOME: "/tmp/.t3/accounts/acc_codex_1" },
      runtimeMode: "full-access",
    });

    expect(parsed.accountId).toBe("acc_codex_1");
    expect(parsed.account?.id).toBe("acc_codex_1");
    expect(parsed.accounts?.[0]?.id).toBe("acc_codex_1");
    expect(parsed.env?.CODEX_HOME).toBe("/tmp/.t3/accounts/acc_codex_1");
  });
});

describe("ProviderSendTurnInput", () => {
  it("accepts provider-scoped model options", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      model: "gpt-5.3-codex",
      modelOptions: {
        codex: {
          reasoningEffort: "xhigh",
          fastMode: true,
        },
      },
    });

    expect(parsed.model).toBe("gpt-5.3-codex");
    expect(parsed.modelOptions?.codex?.reasoningEffort).toBe("xhigh");
    expect(parsed.modelOptions?.codex?.fastMode).toBe(true);
  });
});

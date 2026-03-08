import { describe, expect, it } from "vitest";

import {
  decodePersistedAppSettings,
  getAppModelOptions,
  getSlashModelOptions,
  normalizeCustomModelSlugs,
  resolveAppServiceTier,
  shouldShowFastTierIcon,
  resolveAppModelSelection,
} from "./appSettings";

function makeLegacyPersistedSettings(overrides: Record<string, unknown> = {}) {
  return {
    codexBinaryPath: "",
    codexHomePath: "",
    confirmThreadDelete: true,
    enableAssistantStreaming: false,
    codexServiceTier: "auto",
    customCodexModels: [],
    ...overrides,
  };
}

describe("normalizeCustomModelSlugs", () => {
  it("normalizes aliases, removes built-ins, and deduplicates values", () => {
    expect(
      normalizeCustomModelSlugs([
        " custom/internal-model ",
        "gpt-5.3-codex",
        "5.3",
        "custom/internal-model",
        "",
        null,
      ]),
    ).toEqual(["custom/internal-model"]);
  });
});

describe("getAppModelOptions", () => {
  it("appends saved custom models after the built-in options", () => {
    const options = getAppModelOptions("codex", ["custom/internal-model"]);

    expect(options.map((option) => option.slug)).toEqual([
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "custom/internal-model",
    ]);
  });

  it("keeps the currently selected custom model available even if it is no longer saved", () => {
    const options = getAppModelOptions("codex", [], "custom/selected-model");

    expect(options.at(-1)).toEqual({
      slug: "custom/selected-model",
      name: "custom/selected-model",
      isCustom: true,
    });
  });
});

describe("resolveAppModelSelection", () => {
  it("preserves saved custom model slugs instead of falling back to the default", () => {
    expect(resolveAppModelSelection("codex", ["galapagos-alpha"], "galapagos-alpha")).toBe(
      "galapagos-alpha",
    );
  });

  it("falls back to the provider default when no model is selected", () => {
    expect(resolveAppModelSelection("codex", [], "")).toBe("gpt-5.4");
  });
});

describe("getSlashModelOptions", () => {
  it("includes saved custom model slugs for /model command suggestions", () => {
    const options = getSlashModelOptions(
      "codex",
      ["custom/internal-model"],
      "",
      "gpt-5.3-codex",
    );

    expect(options.some((option) => option.slug === "custom/internal-model")).toBe(true);
  });

  it("filters slash-model suggestions across built-in and custom model names", () => {
    const options = getSlashModelOptions(
      "codex",
      ["openai/gpt-oss-120b"],
      "oss",
      "gpt-5.3-codex",
    );

    expect(options.map((option) => option.slug)).toEqual(["openai/gpt-oss-120b"]);
  });
});

describe("resolveAppServiceTier", () => {
  it("maps automatic to no override", () => {
    expect(resolveAppServiceTier("auto")).toBeNull();
  });

  it("preserves explicit service tier overrides", () => {
    expect(resolveAppServiceTier("fast")).toBe("fast");
    expect(resolveAppServiceTier("flex")).toBe("flex");
  });
});

describe("shouldShowFastTierIcon", () => {
  it("shows the fast-tier icon only for gpt-5.4 on fast tier", () => {
    expect(shouldShowFastTierIcon("gpt-5.4", "fast")).toBe(true);
    expect(shouldShowFastTierIcon("gpt-5.4", "auto")).toBe(false);
    expect(shouldShowFastTierIcon("gpt-5.3-codex", "fast")).toBe(false);
  });
});

describe("decodePersistedAppSettings", () => {
  it("defaults multiAccount without wiping legacy settings", () => {
    const parsed = decodePersistedAppSettings(
      JSON.stringify(
        makeLegacyPersistedSettings({
          codexBinaryPath: "/opt/codex",
          confirmThreadDelete: false,
          customCodexModels: ["custom/legacy-model"],
        }),
      ),
    );

    expect(parsed.codexBinaryPath).toBe("/opt/codex");
    expect(parsed.confirmThreadDelete).toBe(false);
    expect(parsed.customCodexModels).toEqual(["custom/legacy-model"]);
    expect(parsed.multiAccount).toEqual({
      accounts: [],
      activeAccountByProvider: {},
    });
  });

  it("does not fall back to full defaults when multiAccount is absent", () => {
    const parsed = decodePersistedAppSettings(
      JSON.stringify(
        makeLegacyPersistedSettings({
          codexServiceTier: "flex",
        }),
      ),
    );

    expect(parsed.codexServiceTier).toBe("flex");
    expect(parsed.multiAccount).toEqual({
      accounts: [],
      activeAccountByProvider: {},
    });
  });

  it("preserves persisted multiAccount values when present", () => {
    const parsed = decodePersistedAppSettings(
      JSON.stringify(
        makeLegacyPersistedSettings({
          multiAccount: {
            accounts: [
              {
                id: "acc_codex_1",
                providerKind: "codex",
                name: "Work",
                profilePath: "/Users/me/.t3code/accounts/acc_codex_1",
                isDefault: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                lastUsedAt: null,
              },
            ],
            activeAccountByProvider: {
              codex: "acc_codex_1",
            },
          },
        }),
      ),
    );

    expect(parsed.multiAccount.accounts).toHaveLength(1);
    expect(parsed.multiAccount.activeAccountByProvider.codex).toBe("acc_codex_1");
  });
});

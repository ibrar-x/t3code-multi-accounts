import { describe, expect, it } from "vitest";
import { getStrategy, getSupportedProviders, hasStrategy } from "./registry.ts";

describe("credential strategy registry", () => {
  it("exposes registered providers", () => {
    expect(getSupportedProviders()).toEqual(["codex", "claudeCode"]);
    expect(hasStrategy("codex")).toBe(true);
    expect(hasStrategy("claudeCode")).toBe(true);
    expect(hasStrategy("cursor")).toBe(false);
  });

  it("resolves strategies by provider kind", () => {
    expect(getStrategy("codex").providerKind).toBe("codex");
    expect(getStrategy("claudeCode").providerKind).toBe("claudeCode");
  });

  it("throws for providers without a registered strategy", () => {
    expect(() => getStrategy("cursor")).toThrow(
      'No credential strategy registered for provider: "cursor".',
    );
  });
});

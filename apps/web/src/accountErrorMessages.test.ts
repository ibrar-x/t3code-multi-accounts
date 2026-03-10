import { describe, expect, it } from "vitest";

import { toAccountActionErrorMessage } from "./accountErrorMessages";

describe("toAccountActionErrorMessage", () => {
  it("maps accounts.add timeout to user guidance", () => {
    const message = toAccountActionErrorMessage(
      new Error("Request timed out: accounts.add"),
      "fallback",
    );
    expect(message).toContain("Login is taking longer than expected");
    expect(message).toContain("no account was added");
  });

  it("maps codex fallback developer error to user-friendly copy", () => {
    const message = toAccountActionErrorMessage(
      new Error("codex login fallback failed. Device auth error: x. Browser login error: y"),
      "fallback",
    );
    expect(message).toContain("Couldn't complete Codex sign-in");
  });

  it("keeps explicit cancellation messaging concise", () => {
    const message = toAccountActionErrorMessage(
      new Error("Sign-in was cancelled. No account was added."),
      "fallback",
    );
    expect(message).toBe("Sign-in was cancelled. No account was added.");
  });

  it("falls back when no useful message is present", () => {
    expect(toAccountActionErrorMessage(new Error("   "), "fallback")).toBe("fallback");
    expect(toAccountActionErrorMessage("not-an-error", "fallback")).toBe("fallback");
  });
});

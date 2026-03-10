import { WS_METHODS } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { formatRpcServerError, formatRpcTimeoutMessage } from "./rpcErrorMessages";

describe("formatRpcTimeoutMessage", () => {
  it("returns method-specific timeout guidance", () => {
    expect(formatRpcTimeoutMessage(WS_METHODS.serverGetKeybindingsConfig)).toContain(
      "Loading keybindings is taking too long",
    );
    expect(formatRpcTimeoutMessage(WS_METHODS.serverPickFolder)).toContain(
      "Folder picker is taking too long",
    );
  });

  it("falls back to generic timeout guidance", () => {
    expect(formatRpcTimeoutMessage("unknown.method")).toBe(
      "This request is taking too long. Please try again.",
    );
  });
});

describe("formatRpcServerError", () => {
  it("maps keybindings read/write backend errors to meaningful messages", () => {
    expect(
      formatRpcServerError(
        WS_METHODS.serverGetKeybindingsConfig,
        "Failed to read keybindings config: EACCES",
      ),
    ).toContain("Unable to read keybindings file");

    expect(
      formatRpcServerError(
        WS_METHODS.serverSetKeybindingsConfig,
        "failed to write keybindings config",
      ),
    ).toContain("Unable to save keybindings file");
  });

  it("keeps existing readable messages unchanged", () => {
    expect(formatRpcServerError("accounts.add", "Sign-in was cancelled. No account was added.")).toBe(
      "Sign-in was cancelled. No account was added.",
    );
  });
});


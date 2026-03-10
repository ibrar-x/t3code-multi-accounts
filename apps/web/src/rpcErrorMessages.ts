import { WS_METHODS } from "@t3tools/contracts";

const TIMEOUT_MESSAGE_BY_METHOD: Partial<Record<string, string>> = {
  [WS_METHODS.serverGetKeybindingsConfig]:
    "Loading keybindings is taking too long. Close and reopen the editor, then try again.",
  [WS_METHODS.serverSetKeybindingsConfig]:
    "Saving keybindings is taking too long. Please try saving again.",
  [WS_METHODS.serverPickFolder]:
    "Folder picker is taking too long. Enter the project path manually or try again.",
  [WS_METHODS.accountsSupported]:
    "Loading account providers is taking too long. Try refreshing Accounts again.",
  [WS_METHODS.accountsAdd]:
    "Connecting the account is taking too long. If you closed login, no account was added.",
  [WS_METHODS.accountsList]:
    "Loading accounts is taking too long. Try refreshing Accounts again.",
};

const GENERIC_TIMEOUT_MESSAGE = "This request is taking too long. Please try again.";

const SERVER_MESSAGE_OVERRIDES: Array<{
  readonly match: (method: string, message: string) => boolean;
  readonly replace: string;
}> = [
  {
    match: (method, message) =>
      method === WS_METHODS.serverGetKeybindingsConfig &&
      message.toLowerCase().includes("failed to read keybindings config"),
    replace: "Unable to read keybindings file right now. Please check file permissions and try again.",
  },
  {
    match: (method, message) =>
      method === WS_METHODS.serverSetKeybindingsConfig &&
      message.toLowerCase().includes("failed to write keybindings config"),
    replace:
      "Unable to save keybindings file. Check file permissions or disk space, then try again.",
  },
  {
    match: (method, message) =>
      method === WS_METHODS.serverPickFolder &&
      message.toLowerCase().includes("failed to pick folder"),
    replace: "Unable to open the folder picker. Enter the project path manually and try again.",
  },
];

export function formatRpcTimeoutMessage(method: string): string {
  return TIMEOUT_MESSAGE_BY_METHOD[method] ?? GENERIC_TIMEOUT_MESSAGE;
}

export function formatRpcServerError(method: string, message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return "Request failed. Please try again.";
  }
  const override = SERVER_MESSAGE_OVERRIDES.find((entry) => entry.match(method, trimmed));
  return override?.replace ?? trimmed;
}


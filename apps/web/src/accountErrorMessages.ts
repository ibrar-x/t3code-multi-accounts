const ACCOUNTS_ADD_TIMEOUT_MESSAGE =
  "Login is taking longer than expected. If you closed the sign-in window, no account was added. Try Connect account again.";
const ACCOUNTS_LIST_TIMEOUT_MESSAGE =
  "Account refresh is taking too long. Please check your server connection and try Refresh again.";

export function toAccountActionErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const raw = error.message.trim();
  if (raw.length === 0) {
    return fallback;
  }

  const normalized = raw.toLowerCase();

  if (normalized.includes("request timed out: accounts.add")) {
    return ACCOUNTS_ADD_TIMEOUT_MESSAGE;
  }
  if (
    normalized.includes("request timed out: accounts.list") ||
    normalized.includes("request timed out: accounts.supported")
  ) {
    return ACCOUNTS_LIST_TIMEOUT_MESSAGE;
  }
  if (
    normalized.includes("couldn't complete codex sign-in") ||
    normalized.includes("codex login fallback failed")
  ) {
    return "Couldn't complete Codex sign-in. Please try again and keep the login page open until it finishes.";
  }
  if (normalized.includes("sign-in was cancelled")) {
    return "Sign-in was cancelled. No account was added.";
  }
  if (normalized.includes("sign-in timed out")) {
    return "Sign-in timed out before completion. Please try connecting again.";
  }
  if (normalized.includes("sign-in code expired")) {
    return "The sign-in code expired. Please start Connect account again.";
  }
  if (normalized.includes("codex cli not found")) {
    return "Codex CLI is not installed. Install it with `npm install -g @openai/codex`, then try again.";
  }
  if (normalized.includes("a login is already in progress")) {
    return "A login is already in progress. Wait for it to finish, then try again.";
  }

  return raw;
}

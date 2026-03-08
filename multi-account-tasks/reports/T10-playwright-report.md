# T10 AI UI Test Report (Playwright)

- Task File: ../completed/T10-chat-layout-account-switcher.md
- Test Mode: Playwright MCP
- App Launch Command: `/Users/ibrar/.bun/bin/bun run dev`
- App URL Tested: `http://localhost:5733/190deae1-a813-495b-b5c6-afa3263ee531`
- Browser Mode: Headed (visual)
- Command or MCP Flow Used: `browser_navigate`, `browser_snapshot`, `browser_evaluate`, `browser_select_option`, `browser_type`, `browser_click`, `browser_wait_for`, `browser_take_screenshot`
- Scope: Current task changes only
- Date/Time (UTC): 2026-03-08T19:30:15Z
- Branch: `branch-t10-chat-layout-account-switcher`
- Commit: `pending` (captured before commit)

## Visual Checklist

- [x] App loaded and primary layout rendered
- [x] Changed UI flow for this task completed end-to-end
- [x] No unexpected visual regressions in touched areas

## Scenario Coverage

- Provider-scoped option list:
  - Seeded `multiAccount` settings via localStorage with Codex + Claude accounts.
  - Verified switcher renders `Account (Codex)` and options contain only Codex entries (`Work`, `Personal`) plus default option.
  - Verified Claude account does not appear in the Codex switcher.
- Selection persistence:
  - Switched from `Work` to `Personal`.
  - Verified `localStorage["t3code:app-settings:v1"].multiAccount.activeAccountByProvider.codex` changed to `acc_codex_personal`.
  - Switched back to `Default (system credentials)` and verified Codex active mapping is removed while preserving Claude mapping.
- Running-session lock behavior:
  - Sent a live chat turn.
  - Verified switcher enters locked state: lock badge shown, select disabled, lock help text shown.
  - Verified switcher re-enabled after session ended in a prior run (same route) and rendered unlocked state.
- Empty/unsupported guidance:
  - With no provider accounts configured, verified switcher renders disabled state with settings guidance link and does not break chat layout.

## Result

- Status: PASS
- Summary: T10 account switcher is mounted in sidebar, scoped to active provider, persists account selection for new sessions, and blocks switching during active session execution.

## Failing Steps/Specs (if any)

- None for T10 feature behavior.

## Evidence

- Snapshot/screenshot/video paths:
  - `multi-account-tasks/reports/artifacts/T10/t10-switcher-unlocked.png`
  - `multi-account-tasks/reports/artifacts/T10/t10-switcher-locked-running.png`
- Trace paths: N/A
- Console/network notes:
  - Observed provider runtime error banner from test session (`rmcp::transport::worker` response decode failure). This occurred in active-thread runtime and is not introduced by T10 switcher changes.

## Notes / Follow-ups

- Unit-level coverage added in `apps/web/src/components/AccountSwitcher.test.tsx` for provider filtering, selection updates, default clearing, and invalid-selection stability.

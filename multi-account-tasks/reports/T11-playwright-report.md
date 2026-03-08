# T11 AI UI Test Report (Playwright)

- Task File: `../T11-hardening-and-edge-cases.md`
- Test Mode: Playwright MCP (headed visual behavior checks)
- App Launch Command: `PATH="/Users/ibrar/.bun/bin:$PATH" bun run dev -- --no-browser --state-dir /tmp/t3-t11-state`
- App URL Tested: `http://localhost:5733`
- Browser Mode: Headed (visual)
- Scope: Current task changes only (T11 hardening + edge cases)
- Date: 2026-03-08
- Branch: `branch-t11-hardening-and-edge-cases`
- Commit: pending (captured after final commit)

## Commands Run

- `PATH="/Users/ibrar/.bun/bin:$PATH" bun run lint`
- `PATH="/Users/ibrar/.bun/bin:$PATH" bun run typecheck`
- `PATH="/Users/ibrar/.bun/bin:$PATH" bun run test`
- `PATH="/Users/ibrar/.bun/bin:$PATH" bun run test -- src/provider/Layers/ProviderService.test.ts src/wsServer.test.ts src/accounts/accountManager.hardening.test.ts`

## Scenario Coverage

- Startup stale active-account cleanup:
  - Seeded `localStorage` with stale `multiAccount.activeAccountByProvider.codex = "acc_stale_missing"`.
  - Reloaded app.
  - Verified sidebar account switcher fell back to `Default (system credentials)`.
  - Verified stale codex mapping was removed from persisted settings.
- Sidebar account switcher lock while session active:
  - Forced selected thread session status to `running` through app store.
  - Verified sidebar account switcher rendered `Locked`, disabled combobox, and lock helper text.
  - Forced session status back to `ready`.
  - Verified switcher returned to unlocked state.
- Settings account manager lock while session active:
  - Forced at least one thread session status to `running`.
  - Verified account manager panel warning banner displayed.
  - Verified `Set active`/`Use default credentials` controls were disabled.
  - Forced session status back to `ready`.
  - Verified banner removed and controls became actionable again.

## Result

- Status: PASS
- Summary:
  - UI behavior for T11 hardening paths is working in visual end-to-end checks.
  - Automated backend + RPC tests for T11 guards also pass (`accountManager.hardening`, `ProviderService` guard, `wsServer` in-use account deletion block).

## Failures and Fixes During Validation

- Initial full test run failed in `ProviderService.accountResolution` because `accountManager.getSessionEnv` was over-hardened with path-root validation.
- Fix: scoped traversal protection to deletion-sensitive paths while restoring existing env-injection behavior in `getSessionEnv`.
- Re-ran full gates (`lint`, `typecheck`, `test`) successfully.

## Evidence

- `multi-account-tasks/reports/artifacts/T11/t11-stale-active-cleanup-sidebar.png`
- `multi-account-tasks/reports/artifacts/T11/t11-sidebar-switcher-locked-running.png`
- `multi-account-tasks/reports/artifacts/T11/t11-sidebar-switcher-unlocked-after-ready.png`
- `multi-account-tasks/reports/artifacts/T11/t11-settings-switch-lock-running-accounts-panel.png`
- `multi-account-tasks/reports/artifacts/T11/t11-settings-switch-unlocked-after-ready.png`

## Notes

- Several account rows showed `Missing` credential status in this run because test profiles in persisted settings were intentionally non-existent local paths.

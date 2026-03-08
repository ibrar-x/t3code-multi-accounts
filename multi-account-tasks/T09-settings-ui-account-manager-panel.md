# T09 - Settings UI: Account Manager Panel

## Architecture Docs To Read
These files are outside the repo and are the canonical implementation references for this feature set:

- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/INDEX.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-01-contracts-and-types.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-02-credential-strategy-codex.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-03-claude-code-strategy.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-04-account-manager.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-05-codex-session-env-injection.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-06-provider-service-account-resolution.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-07-ipc-bridge.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-08-settings-ui.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-09-account-switcher.md`
- `/Users/ibrar/Downloads/T3Code Multi-Account Architecture/FEATURE-10-edge-cases-hardening.md`

## Task
- [ ] Run task-focused functional validation for behavior introduced in this task (not generic page smoke checks).
- [ ] Execute positive, negative, and regression scenarios tied to this task's touched files and APIs.
- [ ] Use the right test surface for this task: unit/integration/RPC tests first; add Playwright for UI behavior changed by this task.
- [ ] If Playwright is used, validate end-to-end feature behavior and resulting state changes (not screenshot-only checks).
- [ ] Write functional test report: `multi-account-tasks/reports/T09-playwright-report.md` (include scenarios, expected vs actual outcomes, commands run, evidence paths, failures, and fixes).
- [ ] Create a dedicated branch before starting: `git checkout -b branch-t09-settings-ui-account-manager-panel`
- [ ] After implementation and all required tests pass, commit changes on this task branch.
- [ ] Push the task branch to remote: `git push -u origin <task-branch>`
- [ ] Merge this task branch into `main` after tests pass so the next task starts from the combined codebase.
- [ ] Before starting the next task, pull latest `main` and create the next `branch-*` from it.
- [ ] Read: `FEATURE-08-settings-ui.md`
- [ ] Implement account management panel UI and connect to account RPC methods.
- [ ] Add add/remove/rename/set-active flows and error display.
- [ ] Mount panel in settings route.
- [ ] Touch:
  - `apps/web/src/components/AccountManagerPanel.tsx` (new)
  - `apps/web/src/components/AccountManagerPanel.test.tsx` (new)
  - `apps/web/src/routes/_chat.settings.tsx`


## Functional Scenarios (Must Pass)

- [ ] Validate panel loads account list and supported-provider metadata from the account API.
- [ ] Validate add/remove/rename/set-active actions produce correct backend mutations and UI refresh state.
- [ ] Validate provider-specific login/check status is shown accurately after operations.
- [ ] Validate error/retry behavior for failing account operations (network, validation, auth failure).

## Quality Gates
- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] Task-focused functional validation completed for this task (including non-UI behavior), and report updated.

## Completion Checks
- [ ] All ordered tasks complete.
- [ ] All new methods/types are contract-aligned across server and web.
- [ ] No regression in existing codex-only flows.
- [ ] Quality gates pass.

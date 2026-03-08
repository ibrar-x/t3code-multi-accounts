# T11 - Hardening and Edge Cases

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
- [ ] Write functional test report: `multi-account-tasks/reports/T11-playwright-report.md` (include scenarios, expected vs actual outcomes, commands run, evidence paths, failures, and fixes).
- [ ] Create a dedicated branch before starting: `git checkout -b branch-t11-hardening-and-edge-cases`
- [ ] After implementation and all required tests pass, commit changes on this task branch.
- [ ] Push the task branch to remote: `git push -u origin <task-branch>`
- [ ] Merge this task branch into `main` after tests pass so the next task starts from the combined codebase.
- [ ] Before starting the next task, pull latest `main` and create the next `branch-*` from it.
- [ ] Read: `FEATURE-10-edge-cases-hardening.md`
- [ ] Add startup account validation and stale/orphan profile cleanup.
- [ ] Add path traversal guards for profile deletion.
- [ ] Block deletion of in-use accounts.
- [ ] Add server-side guard against account switching during active session.
- [ ] Add hardening tests.
- [ ] Touch:
  - `apps/server/src/accounts/accountManager.ts`
  - `apps/server/src/accounts/accountManager.hardening.test.ts` (new)
  - `apps/server/src/provider/Layers/ProviderService.ts`
  - `apps/server/src/wsServer.ts`
  - `apps/server/src/main.ts` (startup hooks if needed)
  - `apps/web/src/components/AccountManagerPanel.tsx`
  - `apps/web/src/components/AccountSwitcher.tsx`


## Functional Scenarios (Must Pass)

- [ ] Validate startup account validation handles stale/orphan profiles safely and predictably.
- [ ] Validate path traversal protections prevent deletion outside allowed account/profile roots.
- [ ] Validate in-use account deletion is blocked with explicit errors and no partial cleanup.
- [ ] Validate server and UI both block account switching during active sessions and recover correctly afterward.

## Quality Gates (Run After Each Major Phase)

- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] Task-focused functional validation completed for this task (including non-UI behavior), and report updated.

## Completion Criteria

- [ ] All ordered tasks complete.
- [ ] All new methods/types are contract-aligned across server and web.
- [ ] No regression in existing codex-only flows.
- [ ] Quality gates pass.

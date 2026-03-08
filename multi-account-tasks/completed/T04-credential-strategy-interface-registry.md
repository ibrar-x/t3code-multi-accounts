# T04 - Credential Strategy Interface + Registry

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
- [x] Run task-focused functional validation for behavior introduced in this task (not generic page smoke checks).
- [x] Execute positive, negative, and regression scenarios tied to this task's touched files and APIs.
- [x] Use the right test surface for this task: unit/integration/RPC tests first; add Playwright for UI behavior changed by this task.
- [x] If Playwright is used, validate end-to-end feature behavior and resulting state changes (not screenshot-only checks).
- [x] Write functional test report: `multi-account-tasks/reports/T04-playwright-report.md` (include scenarios, expected vs actual outcomes, commands run, evidence paths, failures, and fixes).
- [x] Create a dedicated branch before starting: `git checkout -b branch-t04-credential-strategy-interface-registry`
- [x] After implementation and all required tests pass, commit changes on this task branch.
- [x] Push the task branch to remote: `git push -u origin <task-branch>`
- [x] Merge this task branch into `main` after tests pass so the next task starts from the combined codebase.
- [x] Before starting the next task, pull latest `main` and create the next `branch-*` from it.
- [x] Read: `FEATURE-02-credential-strategy-codex.md`, `FEATURE-03-claude-code-strategy.md`
- [x] Add `CredentialIsolationStrategy` interface and registry.
- [x] Add codex strategy implementation.
- [x] Add claude strategy implementation scaffold/logic.
- [x] Touch:
  - `apps/server/src/accounts/credentialStrategy.ts` (new)
  - `apps/server/src/accounts/strategies/codexStrategy.ts` (new)
  - `apps/server/src/accounts/strategies/claudeCodeStrategy.ts` (new)
  - `apps/server/src/accounts/strategies/registry.ts` (new)


## Functional Scenarios (Must Pass)

- [x] Validate strategy registry resolves codex and claude strategies deterministically by provider kind.
- [x] Validate unsupported provider lookups return explicit, non-crashing errors.
- [x] Validate codex strategy returns isolated credential environment/path inputs per account.
- [x] Validate claude strategy behavior/scaffold is explicit (implemented or unsupported) and covered by tests.

## Quality Gates
- [x] `bun run lint`
- [x] `bun run typecheck`
- [x] `bun run test`
- [x] Task-focused functional validation completed for this task (including non-UI behavior), and report updated.

## Completion Checks
- [x] All ordered tasks complete.
- [x] All new methods/types are contract-aligned across server and web.
- [x] No regression in existing codex-only flows.
- [x] Quality gates pass.

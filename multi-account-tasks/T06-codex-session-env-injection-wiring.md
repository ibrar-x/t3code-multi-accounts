# T06 - Codex Session Env Injection Wiring

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
- [ ] Write functional test report: `multi-account-tasks/reports/T06-playwright-report.md` (include scenarios, expected vs actual outcomes, commands run, evidence paths, failures, and fixes).
- [ ] Create a dedicated branch before starting: `git checkout -b branch-t06-codex-session-env-injection-wiring`
- [ ] After implementation and all required tests pass, commit changes on this task branch.
- [ ] Push the task branch to remote: `git push -u origin <task-branch>`
- [ ] Merge this task branch into `main` after tests pass so the next task starts from the combined codebase.
- [ ] Before starting the next task, pull latest `main` and create the next `branch-*` from it.
- [ ] Read: `FEATURE-05-codex-session-env-injection.md`
- [ ] Wire account-derived `CODEX_HOME` env into codex app-server startup path.
- [ ] Keep existing provider option behavior intact (`codexHomePath`, `binaryPath`).
- [ ] Add tests around env selection and validation order.
- [ ] Touch:
  - `apps/server/src/codexAppServerManager.ts`
  - `apps/server/src/codexAppServerManager.accountEnv.test.ts` (new)


## Functional Scenarios (Must Pass)

- [ ] Validate selected account injects account-derived `CODEX_HOME` into codex app-server startup.
- [ ] Validate existing provider options (`codexHomePath`, `binaryPath`) retain documented precedence/behavior.
- [ ] Validate no-account sessions still use existing default env behavior.
- [ ] Validate invalid or missing account env paths fail safely with actionable errors/warnings.

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

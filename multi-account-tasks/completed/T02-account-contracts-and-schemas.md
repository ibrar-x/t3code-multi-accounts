# T02 - Account Contracts and Schemas

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
- [x] Write functional test report: `multi-account-tasks/reports/T02-playwright-report.md` (include scenarios, expected vs actual outcomes, commands run, evidence paths, failures, and fixes).
- [x] Create a dedicated branch before starting: `git checkout -b branch-t02-account-contracts-and-schemas`
- [x] After implementation and all required tests pass, commit changes on this task branch.
- [x] Push the task branch to remote: `git push -u origin <task-branch>`
- [x] Merge this task branch into `main` after tests pass so the next task starts from the combined codebase.
- [x] Before starting the next task, pull latest `main` and create the next `branch-*` from it.
- [x] Read: `FEATURE-01-contracts-and-types.md`
- [x] Add account contracts/schemas (`ProviderAccount`, `MultiAccountSettings`, account API payloads).
- [x] Create new contracts module and export it.
- [x] Touch:
  - `packages/contracts/src/accounts.ts` (new)
  - `packages/contracts/src/index.ts`


## Functional Scenarios (Must Pass)

- [ ] Validate account schemas parse valid add/list/remove/check/supported payloads and responses.
- [ ] Validate invalid payloads are rejected with structured schema errors (missing/invalid provider/account fields).
- [ ] Validate new contracts are exported via `packages/contracts/src/index.ts` and are consumable by server/web builds.
- [ ] Validate contract changes are backward-compatible with existing codex-only flows.

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

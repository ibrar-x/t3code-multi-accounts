# T08 - WS/Native API Account Methods

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
- [ ] Write functional test report: `multi-account-tasks/reports/T08-playwright-report.md` (include scenarios, expected vs actual outcomes, commands run, evidence paths, failures, and fixes).
- [ ] Create a dedicated branch before starting: `git checkout -b branch-t08-ws-native-api-account-methods`
- [ ] After implementation and all required tests pass, commit changes on this task branch.
- [ ] Push the task branch to remote: `git push -u origin <task-branch>`
- [ ] Merge this task branch into `main` after tests pass so the next task starts from the combined codebase.
- [ ] Before starting the next task, pull latest `main` and create the next `branch-*` from it.
- [ ] Read: `FEATURE-07-ipc-bridge.md`
- [ ] Add account RPC methods (`accounts.list/add/remove/check/supported`) to contracts and server router.
- [ ] Expose them through frontend native API wrapper.
- [ ] Add server method tests.
- [ ] Touch:
  - `packages/contracts/src/ws.ts`
  - `packages/contracts/src/ipc.ts`
  - `apps/server/src/wsServer.ts`
  - `apps/server/src/wsServer.accounts.test.ts` (new)
  - `apps/web/src/wsNativeApi.ts`
  - `apps/web/src/nativeApi.ts`


## Functional Scenarios (Must Pass)

- [ ] Validate WS contracts and router support `accounts.list/add/remove/check/supported` end-to-end.
- [ ] Validate wsServer method routing returns expected success and error envelopes for each account method.
- [ ] Validate `wsNativeApi` method bindings send/receive correct payload shapes.
- [ ] Validate RPC flow consistency from web client -> WS transport -> server manager for account CRUD/check paths.

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

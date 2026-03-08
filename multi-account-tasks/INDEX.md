# Multi-Account Tasks Index

Split task files for implementation, based on the architecture set in:

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

## Execution Rules

- Complete tasks in order. Do not skip ahead.
- Keep contracts and runtime consistent (`@t3tools/contracts`, `effect/Schema` style).
- Preserve existing codex behavior while adding account-aware paths.
- Run quality gates after each major phase.
- For each task, run task-focused functional validation of the behavior introduced in that task (not generic UI smoke checks), then update that task report file.
- Commit/push/merge each completed task branch after tests pass, then create the next task branch from updated `main`.

## Task Files

- [T06 - Codex Session Env Injection Wiring](./T06-codex-session-env-injection-wiring.md)
- [T07 - ProviderService Account Resolution](./T07-providerservice-account-resolution.md)
- [T08 - WS/Native API Account Methods](./T08-ws-native-api-account-methods.md)
- [T09 - Settings UI: Account Manager Panel](./T09-settings-ui-account-manager-panel.md)
- [T10 - Chat Layout: Account Switcher](./T10-chat-layout-account-switcher.md)
- [T11 - Hardening and Edge Cases](./T11-hardening-and-edge-cases.md)

## Completed Tasks

- [x] [T01 - Provider/Contract Baseline](./completed/T01-provider-contract-baseline.md)
- [x] [T02 - Account Contracts and Schemas](./completed/T02-account-contracts-and-schemas.md)
- [x] [T03 - App Settings Migration for Multi-Account](./completed/T03-app-settings-migration-for-multi-account.md)
- [x] [T04 - Credential Strategy Interface + Registry](./completed/T04-credential-strategy-interface-registry.md)
- [x] [T05 - Account Store and Account Manager](./completed/T05-account-store-and-account-manager.md)

## Global Quality Gates

- [x] `bun run lint`
- [x] `bun run typecheck`
- [x] `bun run test`
- [x] Task-focused functional validation completed per task (including backend, RPC, persistence, and UI behavior where applicable), with reports updated.

## Global Completion Criteria

- [ ] All ordered tasks complete.
- [ ] All new methods/types are contract-aligned across server and web.
- [ ] No regression in existing codex-only flows.
- [ ] Quality gates pass.

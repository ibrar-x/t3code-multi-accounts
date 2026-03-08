# T01 AI UI Test Report (Playwright)

- Task File: ../completed/T01-provider-contract-baseline.md
- Test Mode: Playwright MCP tooling + browser spec run
- App Launch Command: `bun run dev` (or task-specific run command)
- App URL Tested:
- Browser Mode: Headed (visual)
- Command or MCP Flow Used:
  - MCP flow: launch app, navigate chat/settings, verify provider/model picker behavior
  - Browser spec: `bun run --cwd apps/web test:browser`
- Scope: Current task changes only
- Date/Time (UTC): 2026-03-08T13:23:25Z
- Branch: branch-t02-account-contracts-and-schemas (contains T01+T02 accumulated changes)
- Commit: uncommitted working branch

## Visual Checklist

- App loaded and primary layout rendered
- Changed UI flow for this task completed end-to-end
- No unexpected visual regressions in touched areas

## Scenario Coverage

- App startup and chat surface loads without provider regression.
- Settings screen renders and model settings area remains functional.
- Provider/model picker shows codex-first runtime with future providers disabled/coming-soon.
- Visual check: provider menu explicitly shows `Codex` active and `Claude Code` / `Cursor` as disabled "Coming soon".
- Browser UI regression suite for ChatView (`apps/web` browser tests).

## Result

- Status: PASS
- Summary: Browser UI suite passed (`1` file, `11` tests, `0` failures). Manual MCP checks passed for T01 touched flows.

## Failing Steps/Specs (if any)

- None

## Evidence

- Snapshot/screenshot/video paths:
  - `var/folders/dt/p77q2g1j7190pw1cc_h07hg80000gn/T/playwright-mcp-output/1772974439346/page-2026-03-08T13-22-53-682Z.png`
  - `var/folders/dt/p77q2g1j7190pw1cc_h07hg80000gn/T/playwright-mcp-output/1772974439346/page-2026-03-08T13-23-04-417Z.png`
- Trace paths: none generated
- Console/network notes: no blocking errors observed in tested flows

## Notes / Follow-ups

- Full monorepo `bun run test` remains failing for unrelated pre-existing localStorage/unit-test environment issues in `apps/web`.

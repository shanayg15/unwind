# UNDO handoff

Updated 2026-10-17 18:20 PDT. Read `CLAUDE.md` first, then `spec/UNDO_Execution.md`.

- Repo: github.com/shanayg15/yc_hack_1017 (private), branch main. Last good commit: see `git log -1`.
- Deployment: Manufact server `fa0d3fbb-466f-44fe-80b3-8b806ace54ff`, MCP `https://bold-cloud-77gfl.run.mcp-use.com/mcp`,
  dashboard https://manufact.com/cloud/org-808238af-w8cml/servers/fa0d3fbb-466f-44fe-80b3-8b806ace54ff/overview
- DB: Neon project `fragrant-lab-49686944` (org undo-hackathon): branch main = demo/eval stores; branch `test` = integration tests.
- Inkbox: identity `yc-hack-shanay`; subscription `fcaedd1a…` → `/webhooks/inkbox`. The Claude Code bridge is STOPPED on purpose
  (it would double-reply). Its old subscriptions point at the stopped tunnel.
- Active processes: worker in the "UNDO worker" terminal tab (`env -u CLAUDE_CODE_OAUTH_TOKEN pnpm worker`). MUST unset the zshenv token.
- Private config: `.env`, `.private/tokens.json`, `.private/deploy.env`, `.private/armature-eval-token.txt` (all git-ignored, 600).

Commands: `pnpm demo:reset` · `pnpm demo:launch` · `pnpm demo:activity` · `pnpm worker` · `pnpm test:integration` · `pnpm test:mcp`
(`MCP_PROBE_URL=<deployed>/mcp pnpm test:mcp` for deployed) · `pnpm run deploy` (NOT `pnpm deploy`, which is a pnpm built-in).
Pouch demo: `pnpm demo:launch -- --scenario pouch` · `pnpm demo:activity -- --scenario pouch` (4 gift orders) · `--scenario pouch-one` (one more, for the stale-plan race). Runbook: docs/DEMO_POUCH.md.

Deploys: pushing main auto-deploys through the Manufact GitHub App (`pnpm deploy` pushes, waits for that commit, writes reports/deploy.json).
Approvals: owner replies "YES <code>" by text (worker code checks it) or uses the optional link page.
Headless Chromium for `mcp-use screenshot`: started on DevTools port 9333 (profile in the session scratchpad); restart with the Playwright Chromium binary if gone.

Exact next action (21:30): Armature only (U24). User does evals/ARMATURE_SETUP.md steps 1-3; then run cases via POST /api/armature/v1/workflows/<case id>/runs with `pnpm eval:fixture` (or evalPouchFixture for E) before each mutating case, record reports/armature.json (run ids + outcomes + DB checks), rerun `scripts/verify-all.ts --aggregate` and `scripts/final-report.ts`.
Everything else is done: 3 rehearsals (reports/runs/rehearsal-{1,2,3}.json), V01 call, pouch run, final report, docs. Rehearsal emails used 4/4; owner-text automation approval covered rehearsals 2-3 only (shop thread +1 937-896-2724, script scripts/rehearsal-drive.ts).
Not yet written: scripts/provider-smoke.ts (test:providers).

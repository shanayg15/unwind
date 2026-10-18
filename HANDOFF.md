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

Exact next action (18:20): owner replies YES to the pouch plan (case case_3a6r290hjh) → send customer email via Composio (gmail_wading-tuth, ≤3 rehearsal sends approved) → `scripts/evidence.ts pouch-1` + `scripts/pa-report.ts` → V01 live call (weekend scenario, owner text includes "call me") → Armature (evals/ARMATURE_SETUP.md) → 3 rehearsals + recording + final report.
Restart the worker after the pouch run so it picks up the label-based preview prompt.
Not yet written: scripts/provider-smoke.ts (test:providers).

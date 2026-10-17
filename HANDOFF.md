# UNDO handoff

Updated 2026-10-17 15:20 PDT. Read `CLAUDE.md` first, then `spec/UNDO_Execution.md`.

- Repo: github.com/shanayg15/yc_hack_1017 (private), branch main. Last good commit: see `git log -1`.
- Deployment: Manufact server `fa0d3fbb-466f-44fe-80b3-8b806ace54ff`, MCP `https://bold-cloud-77gfl.run.mcp-use.com/mcp`,
  dashboard https://manufact.com/cloud/org-808238af-w8cml/servers/fa0d3fbb-466f-44fe-80b3-8b806ace54ff/overview
- DB: Neon project `fragrant-lab-49686944` (org undo-hackathon): branch main = demo/eval stores; branch `test` = integration tests.
- Inkbox: identity `yc-hack-shanay`; subscription `fcaedd1a…` → `/webhooks/inkbox`. The Claude Code bridge is STOPPED on purpose
  (it would double-reply). Its old subscriptions point at the stopped tunnel.
- Active processes: worker in the "UNDO worker" terminal tab (`env -u CLAUDE_CODE_OAUTH_TOKEN pnpm worker`). MUST unset the zshenv token.
- Private config: `.env`, `.private/tokens.json`, `.private/deploy.env`, `.private/armature-eval-token.txt` (all git-ignored, 600).

Commands: `pnpm demo:reset` · `pnpm demo:launch` · `pnpm demo:activity` · `pnpm worker` · `pnpm test:integration` · `pnpm test:mcp`
(`MCP_PROBE_URL=<deployed>/mcp pnpm test:mcp` for deployed) · `pnpm deploy` (TODO script; currently `npx mcp-use deploy -y`).

Exact next action: live owner text test; then customer email; then Armature cases; then e2e/security tests and rehearsals.
Known failing/missing: scripts setup-check, e2e, provider-smoke, smoke-deployed, demo-verify, verify-all, eval-agent not written yet.

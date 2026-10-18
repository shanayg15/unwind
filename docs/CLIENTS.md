# Connect an MCP client to UNDO

Endpoint: `https://bold-cloud-77gfl.run.mcp-use.com/mcp` (streamable HTTP). Every request needs `Authorization: Bearer <token>`.
Tokens are role-, store- and membership-scoped and stored hashed. Demo credentials are minted by `pnpm demo:reset` into
`.private/tokens.json` (git-ignored). Use an `agent` token for the demo store, or an `evaluator` token for the evaluation store.
Customer tokens only see their own orders.

## Claude Code

```bash
claude mcp add --transport http undo https://bold-cloud-77gfl.run.mcp-use.com/mcp --header "Authorization: Bearer <token>"
```

Then ask, for example: "Withdraw the premium part of the weekend launch but keep later edits." Verified headless on 2026-10-17
(`reports/clients/claude-code.json`): Claude Code 2.1.238 authenticated, called `undo_capabilities` and `undo_history`, and
reported the store, its role and the latest rollout.

## Any MCP client (JSON config)

```json
{
  "mcpServers": {
    "undo": {
      "type": "http",
      "url": "https://bold-cloud-77gfl.run.mcp-use.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Claude Agent SDK (what the shop worker uses)

`worker/agent-runner.ts` passes `mcpServers: { undo: { type: "http", url, headers: { Authorization: "Bearer …" } } }`, with
`strictMcpConfig`, no built-in tools, and a fresh case-scoped token per turn. Evidence: every live and rehearsal run
(`reports/runs/*.json`, agent_run events) and fresh-agent evals (`reports/eval-agent.json`).

## MCP App host (RecoveryReceipt)

`undo_preview` and `undo_verify` render the RecoveryReceipt view in hosts that support MCP Apps. Rendered from the deployed
server with the mcp-use App host:

```bash
pnpm exec mcp-use screenshot --mcp https://bold-cloud-77gfl.run.mcp-use.com/mcp -H "Authorization: Bearer <token>" --tool undo_preview '{"labels":["premium"]}'
```

Screenshots: `reports/app-view/`.

## First calls for a new agent

1. `undo_capabilities` returns your role, limits, recovery rules and `quickstart` recipes.
2. `undo_history` returns rollouts with `label_summary` and the next call to make.
3. `undo_preview {rollout_id, labels:[...]}` (or `all_changes: true`). Nothing is written.
4. Owner confirmation, then `undo_apply {plan_id, approval_id}`, then `undo_verify {recovery_id}`.

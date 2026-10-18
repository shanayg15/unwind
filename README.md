# UNDO

**Undo the campaign. Keep the business running.**

UNDO is an MCP server that gives a shop agent commerce-aware undo. Every store change the agent makes is recorded with exact before/after values and revisions. Later, a fresh agent with no memory of the launch can withdraw just part of it (say, only the premium items). Edits other people made afterwards, independent fixes, unselected changes, and every existing order stay as they are. Owner approval happens by text, and the server verifies the result by reading the store back.

The purchase-aware extension adds **Undo the experiment. Keep the customer promises.** Stopping a free-gift promotion releases only the gift stock the promotion still holds. Every accepted order keeps its gift and the unit committed to it.

This is a controlled, Shopify-style demo store on Postgres, not a Shopify integration. Checkout is test-only, and no payment is taken.

## Live

| | |
|---|---|
| MCP endpoint (bearer token) | `https://bold-cloud-77gfl.run.mcp-use.com/mcp` (hosted on Manufact) |
| Storefront | `https://bold-cloud-77gfl.run.mcp-use.com/store` |
| Pick list (immutable orders + gifts) | `https://bold-cloud-77gfl.run.mcp-use.com/store/picklist` |
| Owner channel | One Inkbox identity: iMessage text + contact-scoped voice call |
| Customer channel | Same identity's mailbox, threaded email replies |

## The seven tools

| Tool | What it does |
|---|---|
| `undo_capabilities` | Your role and store, the supported components, limits, recovery rules, current targets with revisions and stock, and quickstart recipes |
| `undo_history` | Recorded rollouts with change ids, labels, before/after values, revisions, recovery status, and per-label counts |
| `undo_execute` | Propose a typed rollout (prices, promo copy, slots, gift promotion), then run it after the owner approves its exact hash |
| `undo_preview` | Build a recovery plan by labels (`["premium"]`), `all_changes`, or exact change ids. Classifies each change as eligible, conflict, kept by owner decision, or already reverted. Nothing is written |
| `undo_impact` | Order facts from checkout provenance (direct price link vs. coincidental vs. unknown) plus gift commitments by entitlement. Read-only |
| `undo_apply` | Apply a plan under lock with owner approval (or a narrow standing grant). Never overwrites a later edit. Gift offers are retired purchase-aware. Moved order dependencies give `stale_dependency_state` with a fresh plan |
| `undo_verify` | Readback verdict: restored components, no unselected writes, preserved edits, byte-identical orders, gift and stock accounting, communications |

`undo_preview` and `undo_verify` render the **RecoveryReceipt** MCP App. It shows per-component original/launch/current values, conflicts and kept exceptions, order impact, approval and message state, and a gift-stock strip (units on orders / held / released).

### How an agent uses it

```text
undo_history                                  -> find the rollout by goal, read label_summary
undo_preview {rollout_id, labels:["premium"]} -> conflicts?  ask the owner; re-preview with keep_current_change_ids
owner confirms the plan by text (YES + code)  -> undo_apply {plan_id, approval_id}
undo_verify {recovery_id}                     -> readback proof
```

Idempotency keys are optional (retry-safe defaults). The rollout is inferred when only one is recoverable. Every error carries a stable code and a `next_action`.

## Safety model

- **Recorded writes only.** Price, content, slot and inventory writes go through trigger-guarded writers that bump revisions and journal before/after values. Order snapshots, gift entitlements, change history and the audit log are immutable.
- **Never overwrite later work.** A change is restorable only while its component is still at the recorded launch revision. Anything else is a conflict: it is withheld, or kept as an owner-accepted exception.
- **Owner authority is explicit.** Approval is a 4-digit code bound to one plan hash, checked by worker code (not the model) and accepted only from the owner's verified phone. An optional single-use link page exists. Call transcripts are proposed intent, never approval.
- **Purchase-aware stock.** Stock is tracked as available = on hand − held − committed, with every move journaled. Retiring an offer releases only the remainder still held. The plan is bound to a dependency watermark, so an order arriving after preview supersedes the plan instead of re-scoping the approval.
- **Scoped credentials.** Bearer tokens are hashed and bound to role, store and membership. The agent worker gets a case-scoped token per turn. Customers see only their own orders.
- **Bounded live I/O.** Sending is gated (`LIVE_SEND_ENABLED`). Messages and calls have hard budgets (calls ≤ 180 s with a hang-up kill switch), outbox dedupe, signed webhooks with unique provider event ids, and leased inbox processing.

See [docs/SECURITY_AND_LIMITS.md](docs/SECURITY_AND_LIMITS.md).

## Architecture

```text
Owner phone (iMessage/voice) ─┐                    ┌─ Manufact: MCP server (index.ts, 7 tools, RecoveryReceipt views,
Customer email ───────────────┤ Inkbox identity ───┤  storefront, approval page, signed /webhooks/inkbox receiver)
                              │  (one shop)        │        │
                              └── signed events ───┘   Neon Postgres (journal, plans, orders, stock, cases, inbox/outbox)
                                                            │
                     Local agent worker (worker/, Claude Agent SDK, fresh context per turn, case-scoped MCP token)
```

## Run it

```bash
pnpm install
```

```bash
pnpm db:migrate && pnpm demo:reset
```

```bash
pnpm dev
```

```bash
env -u CLAUDE_CODE_OAUTH_TOKEN pnpm worker
```

Config names are in [.env.example](.env.example). Demo scripts: `pnpm demo:launch` (a real agent launches the weekend campaign), `pnpm demo:activity` (test orders + operator edits), `pnpm demo:verify`; add `-- --scenario pouch` for the gift experiment ([docs/DEMO_POUCH.md](docs/DEMO_POUCH.md)). Connect your own MCP client: [docs/CLIENTS.md](docs/CLIENTS.md). Deploy: `pnpm run deploy`.

## Evidence

| What | Where |
|---|---|
| Acceptance roll-up (U01–U32, V01–V05) | `reports/acceptance.json`, `reports/FINAL_VERIFICATION.md` |
| Purchase-aware PA01–PA12 | `reports/PURCHASE_AWARE_ACCEPTANCE.md` |
| Live runs (owner iMessage, voice call, customer email) | `reports/runs/live-*.json`, `reports/runs/pouch-1.json` |
| Three rehearsals on the deployed build | `reports/runs/rehearsal-{1,2,3}.json` |
| Fresh-agent goal evals on the deployed MCP | `reports/eval-agent.json` |
| MCP clients (Claude Agent SDK worker, Claude Code CLI, mcp-use App host) | `reports/clients/`, `reports/app-view/` |
| Deployed probes | `reports/mcp-probe.json`, `reports/smoke-deployed.json`, `reports/e2e.json`, `reports/provider-smoke.json` |
| Backup recording (labeled) | `reports/recording/` |

## Limits

One controlled store and one gift-rule adapter. Local Postgres transactions are not a global lock over third-party systems. Test orders only, with no shipping, refunds or payments. Owner SMS is replaced by iMessage (approved). The identity's default voice authority can't be narrowed with our key, so every call sets `contact_scoped` explicitly and inbound calls are rejected. No claim of universal undo, novelty, or production certification.

# UNDO — Undo the campaign. Keep the business running.

> **Commerce-aware recovery for a shop agent's live changes.**
> **Your agent can change the store. UNDO gives it the history and recovery rules to change course.**

**Revision 5 — October 17, 2026. Selected for implementation by the user.** MOTOR is not in this build. This package is a specification, not already implemented software. `UNDO_Execution.md` governs acceptance; `INKBOX_Channel_Plan.md` fixes channel roles. Resolve real setup before paid/external work. The preceding technician, ticket, discount-stacking, and deliberately mistaken-selection stories are superseded.

## 1. The product in one paragraph

A shop agent performs supported edits through UNDO, which captures exact before/after values, component revisions, and rollout identity. When the owner later withdraws one part of a valid campaign, a fresh agent can retrieve that history, preview selective recovery, inspect related orders, reverse eligible edits, and verify the result. Later independent work remains; same-component conflicts require a scoped decision. Inkbox carries owner texts/calls and customer email. The reusable MCP is the product; the storefront is its demonstration.

## 2. Pitch pack

### Five seconds
**Ctrl+Z for a shop agent's live changes.**

### Two sentences
> UNDO gives shop agents a recovery toolkit for their live changes. When a campaign needs to be withdrawn, the agent restores the relevant parts, preserves subsequent orders and edits under the supported recovery rules, and coordinates exceptions without reconstructing history or handing cleanup back to the owner.

### Agent-side reason to want it
> I can edit this store already. What I need is exact change history, enforceable reversal rules, and order-specific evidence so I can recover correctly even in a fresh session.

### Thirty seconds
> An owner approves a launch across prices, promotional copy, and homepage placement. Later they withdraw only the premium collection. A shop agent should not have to remember every old description or accidentally erase a sizing correction someone made afterward. UNDO records the original edits, checks what can still be restored, identifies orders that used the rollout's prices, and verifies the recovery. Through one Inkbox identity it texts or calls the owner about exceptions and emails customers with facts about their existing orders. The agent takes responsibility for cleanup instead of giving it back to the owner.

### Sixty seconds
> UNDO is commerce-aware recovery for agent actions. A normal store tool tells an agent how to change a price. We give it captured history, a selective reversal plan, order-linked impact, and enforced recovery checks.
>
> In our demo, a valid approved campaign changes premium and clearance products. The owner then says: withdraw premium, keep clearance, the improved navigation, and existing orders. We start a fresh agent without the launch transcript. It retrieves the rollout and restores eligible prices, promotional copy, and homepage components. It preserves a human's later sizing correction and flags a separate price conflict.
>
> Inkbox gets the owner's scoped decision by text or an enabled call and carries a customer's email about their unchanged order. Manufact delivers the MCP and a real recovery-receipt App. Armature tests whether unfamiliar agents handle the difficult cases correctly.
>
> Existing undo tools are real. Our entry is judged on this complete, evidence-backed recovery workflow, not on claiming to have invented rollback.

### Technical answer
A typed recorded-change layer with transactional capture on a controlled Postgres adapter, component-level revisions, conditional inverses, order-price provenance, scoped decisions, and explicit verification. It is not arbitrary SQL repair or universal reversal of external consequences.

## 3. What the MCP adds beyond an ordinary personal agent

| Proposed capability | What it provides |
|---|---|
| Recorded execution | Exact previous values and committed results grouped under a named rollout. |
| Selective recovery | A plan over selected change IDs, not a guessed full-record or database restore. |
| Order-aware impact | The orders whose price revisions are actually linked to the rollout, plus separate temporal-only context. |
| Enforced application | Revision checks at the moment of applying an inverse; repeat requests cannot repeat the same local effect. |
| Verification | Readback, preserved-order assertions, accepted exceptions, and remaining communication obligations. |

An agent can implement this machinery or use a competing product. We package it as a reusable capability; we are not adding a new reasoning model. A demo that just changes one remembered price back is too weak.

## 4. Canonical tools

These are our application tool names, not sponsor SDK methods. Use underscores on the wire; pitch labels may use `undo.execute` for readability.

**Five headline tools:** `undo_execute`, `undo_preview`, `undo_impact`, `undo_apply`, `undo_verify`.
**Two supporting read tools:** `undo_capabilities`, `undo_history`.

`undo_capabilities` explains supported operations and limits; `undo_history` lets a fresh agent discover rollouts. Do not require access to the old chat. Tool inputs reference configured connections and recorded IDs, never private keys or agent-invented before-state. Owner/customer communication is a separate, role-scoped agent capability, not permission to send from any product tool.

## 5. Final hero scenario: new intent after an approved launch

### Launch
An apparel-store owner approves a weekend launch across selected premium and clearance prices, promotional descriptions, a premium homepage tile, and navigation. All price floors, discount caps, and review requirements pass. The agent applies the exact authorized changes through UNDO.

### Ordinary subsequent activity
- A customer creates a test order at a launch price. No real funds move.
- An operator corrects one jacket's sizing information.
- Another operator changes one premium shoe price after launch.
- An unrelated customer order is created.

### Changed instruction
The owner sends the shop-agent identity a text:

> Withdraw premium from the weekend launch. Restore its original prices, promotional copy, and homepage placement. Keep clearance, improved navigation, existing orders, and subsequent independent edits.

This new authenticated instruction is the trigger. No numerical cap predicts a later change in intent or supplies old content. Keep prevention rules active. A known, fully anticipated cancellation workflow can be hardcoded; UNDO's proposed benefit is avoiding bespoke reconstruction and cleanup for each recorded task.

### Concrete fixture (illustrative values to implement and verify)

| Component | Original | Approved launch | Later activity | Expected outcome |
|---|---|---|---|---|
| Jacket price | $120 | $108 | None | Restore $120. |
| Jacket promotional copy | Evergreen text | Weekend text | None | Restore captured evergreen text. |
| Jacket sizing information | Original sizing | Not part of rollout | Human improves sizing | Keep the improvement. |
| Shoe price | $150 | $135 | Human sets $139 | Preserve and flag; owner may accept $139. |
| Shoe promotional copy | Evergreen | Weekend | None | Restore if independently valid. |
| Premium homepage slot | Evergreen | Premium campaign | None | Restore only that slot. |
| Clearance price | $50 | $40 | None | Keep $40. |
| Navigation | Old | Improved | None | Keep improved version. |
| Launch order | None | Jacket ordered at $108 | Order exists | Preserve original order facts. |
| Unrelated order | None | New independent purchase | Exists | Preserve it. |

Use independently versioned price, promotional copy, sizing, and slot components. Never restore an entire product JSON blob over a later unrelated edit. Conflicting edits inside the SAME text component require review, not an untested automatic merge. Coupled components belong to a declared all-or-withhold recovery group.

### Recovery and communication
1. Start a fresh runtime agent without the rollout transcript or manually supplied old values.
2. It discovers the rollout with `undo_history`, interprets the owner's request, and previews exact selected change IDs.
3. `undo_impact` reports orders linked to rollout price revisions; no claim of marketing causation or complete audience exposure.
4. Owner receives a text about the $139 conflict. Optional enabled voice can gather the same scoped decision. The owner says to keep $139 and restore the eligible remainder, with an authenticated case-bound confirmation or an already-granted narrow policy.
5. Agent applies the plan; server revalidates revisions and writes exact recorded inverses.
6. Customer emails: “The promotion disappeared. Is my order still confirmed at $108?” The agent checks the customer's order and the authorized honor-orders policy, then emails the actual facts.
7. `undo_verify` establishes what was restored and preserved. It reports the accepted exception and communication state separately.

The owner uses PHONE channels; customers use EMAIL. One public Inkbox identity does not imply mixing everyone's conversation context or business authority.

## 6. The live presentation

Show a working storefront, the recovery-receipt MCP App, and genuine agent tool traces. The demo participants use real phone/email accounts approved for testing.

1. Show approved launch and recorded history.
2. Create two test orders and two real alternate-actor edits.
3. Send the new owner instruction by text; demonstrate recovery in a fresh agent session.
4. Show the selective preview and order-impact results.
5. Resolve the price conflict through the owner phone workflow; text first, optional call after core readiness.
6. Watch only eligible premium changes revert.
7. Receive the customer's email and send a grounded answer.
8. Show final verification: restored components, preserved sizing/navigation/clearance/orders, accepted price exception, and message status.

Call variants and recorded segments must be labeled. Actual delivery latency is not guaranteed. Do not display a simulated message as a provider-delivered one.

## 7. Sponsor roles and build scope

**Manufact:** deployed authenticated MCP plus `RecoveryReceipt` App; real tool traffic and fresh-client usability. [S1–S3]

**Inkbox:** one shop-agent identity with a mailbox and provisioned phone channel. Owner texts are the primary decision channel; voice is a separately enabled owner path. Customer communication uses email in/out. The application supplies case binding, role separation, durable resumption, deduplication, and authorization. [U1–U4][U9–U12]

**Armature:** goal-based tests of selective recovery, partial/conflicting state, impact interpretation, fresh-session discovery, stale approvals, repeated requests, and customer authority boundaries. Deterministic store/order assertions remain the correctness authority. [S4]

These are the three priority tracks. One Postgres/backend provider is supporting infrastructure. Do not add Primitive for duplicate messaging or Stripe for a refund story. Inkbox's listed prize is credits; no guaranteed cash/prize claim.

Default target: a clearly labeled Shopify-style demo store on controlled Postgres. An actual Shopify adapter is not implied. No arbitrary external API atomicity, payment changes, sent-email recall, destructive deletes, real customer data, or unsupported production guarantee.

## 8. Important objections

**Why not a price cap?** Keep it. This approved launch obeys it; the trigger is a new owner decision.

**Why not disable the campaign?** Use native disable when it solves the whole problem. This fixture has multiple persistent edits and retained changes, not one campaign flag.

**Why not a personal agent?** An agent can reason about the task. UNDO provides durable recorded state and enforced recovery conditions, including after losing the original conversation.

**Is impact attribution complete?** No. Report only captured price-revision and communication associations. Temporal coincidence is a separate, weaker classification.

**Is this new?** Amend, UndoMCP, and Cowboy MCP overlap. Demonstrate implementation quality and this supported workflow, not invention of undo. [U6][U8]

**Can an order be undone?** Not in this release. Orders stay intact. A catalog rollback does not recover margin or erase customer expectations.

## 9. Execution handoff

Read `README_START_HERE.md`, this brief, `UNDO_Execution.md`, `INKBOX_Channel_Plan.md`, `DEMO_RUNBOOK.md`, then `SOURCE_NOTES.md`. Use `UNDO_Goal.txt` to start. User has selected UNDO; do not reopen ideation. Confirm the repository, scope, deadline, budget, accounts, and consent before external work.

The full definition of done is in the execution file: complete recovery and impact tools, real owner-phone/customer-email flow, genuine deployed MCP/App and Armature tests, hardening checks, persisted evidence, and three repeatable rehearsals. Voice is reported separately and becomes mandatory if enabled in approved scope. No one-channel downgrade without approval. The package itself has not built or tested the application.

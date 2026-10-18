# UNDO — live-demo and verification runbook

**Selected build, October 17, 2026.** This is the approved demonstration direction, not a record of a working demo. Use the current remaining time and actual organizer stage limit. Default channel split: owner texts / optional enabled call; customer email.

## 1. Headline and claim

**Undo the campaign. Keep the business running.**

Prove that a fresh agent can recover selected recorded edits while preserving real subsequent activity, then answer people from verified state. Do not claim a native integration with Shopify unless one is actually built/tested. Label the controlled store and test checkout.

## 2. Fixture

6–12 products, premium and clearance collections, independently versioned prices/promotional copy/sizing, separate homepage and navigation slots, two test users plus owner/operator roles.

Known demonstration values: jacket $120 -> approved $108, shoes $150 -> approved $135 -> later human $139, clearance shirt $50 -> $40. Price caps pass. Jacket sizing changes after launch in a separate component. Premium slot changes; navigation improvement is retained. Store exact initial content in application rows and the change journal; the recovery agent cannot read hidden test-oracle snapshots.

Create one order whose price revision links to the jacket launch change and one unrelated order with no relevant price-change link. Preserve their exact snapshots and provenance. No actual charge unless a separately authorized payment sandbox is implemented and labeled.

## 3. Roles and interfaces

- **Launch agent:** actual scoped MCP calls publish the reviewed proposal.
- **Recovery agent:** fresh session, no original launch chat or copied previous values. Uses history, preview, impact, apply, and verify.
- **Owner:** consenting person on configured phone text; linked admin confirmation session. Optional call route only if enabled/tested.
- **Customer:** consenting person emailing from the approved test address; authenticated access to their order.
- **Operator:** separate logged-in session creating actual sizing and price writes.
- **Judge view:** main storefront + actual RecoveryReceipt MCP App + concise real tool/message events. No infrastructure admin Inspector exposed publicly.

## 4. Complete rehearsal sequence

1. Run approved fixture reset and `pnpm demo:verify` to check the before-state.
2. Launch the valid campaign through the actual agent and product MCP. Save rollout ID and proposal receipt.
3. Place both test orders through checkout. Perform the operator sizing change and shoe-price edit through actual versioned writers.
4. Start the fresh recovery agent with only standard docs, a scoped connection, and the current case. No supplied old prices or prepared inverse JSON.
5. Owner texts the withdrawal instruction through the same Inkbox identity. Receiver verifies/persists and worker resumes the agent.
6. Agent finds the rollout, previews selected premium changes, and obtains `undo_impact`. App shows directly linked versus unrelated/unknown order classifications and the price conflict.
7. Agent texts the owner the real conflict. Owner replies keep $139 and provides the required scoped authorization. Optional alternate rehearsal uses the enabled owner-call path.
8. Agent applies and verifies. Actual storefront shows restored premium copy/prices/placement, preserved sizing/clearance/navigation, and accepted $139 exception.
9. Customer sends an actual inquiry email. Agent verifies their unchanged $108 test order and sends a threaded factual response from the shop mailbox.
10. Run deterministic final checks and save run IDs, current build/commit, timestamps, message statuses, and an evidence-linked report.

Three complete rehearsals are required by the base release contract. Do not reset provider inbox history or reuse a case ID so that stale replies contaminate the new run. Cancel any pending jobs, expire old approval tokens, and create a unique run/case namespace. Reuse real participant contacts only within consented budgets.

## 5. Two-minute presentation outline

**0:00:** “My shop agent launched an approved campaign. I now want premium withdrawn, without undoing the rest of the store.”

**0:15:** Show original rollout, sizing change, conflicting price, and existing order. Launch may be a labeled earlier real run to fit stage time.

**0:30:** Owner text arrives; fresh recovery agent uses MCP history/preview/impact. Show actual calls.

**0:55:** Owner resolves the conflict through phone text or an already-verified call. Show the case-bound confirmation, not a hidden force override.

**1:15:** Apply/readback changes storefront. Highlight preserved order and sizing correction, not just a green toast.

**1:35:** Customer email question and factual answer. Open exact order snapshot.

**1:50:** End with actual verified recovery, exception, and communication state. “The agent didn't need its old conversation or ask me to reconstruct the store.”

Real model, SMS, email, and call timing can exceed this outline. Rehearse against the actual limit. Use clearly labeled recordings for slow portions; show live tool/interaction where practical. Never pretend prerecorded traces or queued messages are live completed events.

## 6. Optional judge variation

Have a judge choose which supported collection to withdraw or create one new independent/same-component edit before preview/apply. The same generic recovery engine must handle it. Do not write a special `if premium` solver. Changes are limited to approved test namespace and current supported operations.

## 7. Release evidence to show

- Hosted MCP initialization/tool listing and genuine tool calls.
- Real MCP App rendering/refresh and authorization behavior.
- Fresh session uses persisted rollout history.
- Restoration and preservation checks with revision/change IDs.
- Order-impact provenance and untouched purchase snapshots.
- Real owner text/customer email provider IDs with truthful delivery status.
- Actual Armature runs connected to deterministic checks.
- Voice status and supporting evidence only if enabled.

## 8. Failure responses during presentation

If an owner reply is delayed, show pending state; do not fabricate it. If a later edit prevents restoration, show a conflict and preserve it. If customer email delivery is uncertain, recovery stays complete with a pending communication obligation. If backend or sponsor access fails, use a labeled recorded run rather than claim the live path succeeded. A recording is a backup, not permission to omit mandatory operational release checks.

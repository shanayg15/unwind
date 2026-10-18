# Demo: undo the experiment, keep the customer promises

Purchase-aware rollback video path (addendum section 8). Every number is read from the live store; nothing is staged.
Test store only: no payment is taken. Keep the original premium-withdrawal demo (`spec/DEMO_RUNBOOK.md`) available as the backup.

## Before recording (about 2 minutes)

```bash
pnpm demo:reset
```

```bash
env -u CLAUDE_CODE_OAUTH_TOKEN pnpm demo:launch -- --scenario pouch
```

```bash
pnpm demo:activity -- --scenario pouch
```

The worker must be running (`pnpm worker`, with `CLAUDE_CODE_OAUTH_TOKEN` unset). After this the store has the free-pouch offer,
10 pouches set aside, and 4 accepted gift orders: 4 committed, 6 still held, 0 available.

## On camera

1. **The experiment.** Open `/store`: the "Free travel pouch" offer card (gifts left), the premium tile, and the pouch card
   "0 available · 6 set aside for an offer". Open `/store/picklist`: each accepted order lists its pouch as a gift.
2. **The owner stops it by text.** From the owner phone, text the shop's iMessage:
   "Stop the free-pouch experiment. Put the campaign pages back. Honor every accepted order and release only the unused promotional stock."
3. **The fresh agent plans it.** The agent texts back the plan: 4 accepted orders keep their pouch, 6 held pouches go back to stock,
   tile and pack copy restored, nothing changed yet, plus a one-time code. Show the RecoveryReceipt (undo_preview view): the
   gift-stock strip shows 4 units on orders and 6 releasable.
4. **Optional race (strong technical beat).** Before replying, run `pnpm demo:activity -- --scenario pouch-one`. Reply `YES <code>`.
   Apply refuses the stale plan (`stale_dependency_state`, nothing written) and the agent texts the new numbers: 5 kept, 5 released.
   Reply YES to the new code.
5. **Apply.** Reply `YES <code>`. The agent applies, verifies, and texts the completion summary. Refresh `/store`: offer gone,
   pouch "6 available" (or 5 after the race), tile and copy restored. `/store/picklist` still lists every promised pouch.
6. **The customer asks.** From the test customer address, email the shop mailbox:
   "The gift offer disappeared. Is the pouch still included in my order?" The agent answers from that customer's own verified
   order: included and allocated in their accepted order, no charge; it does not say shipped.
7. **Proof.** Show the RecoveryReceipt (undo_verify view) and the checks: future_eligibility_closed,
   remaining_allocation_released_once, order_commitments_preserved, stock_accounting_reconciles, fulfillment_lists_promised_gifts.
   Optionally show `reports/PURCHASE_AWARE_ACCEPTANCE.md` and the race tests (PA05/PA06).

## What not to claim

- Four test orders are not an A/B result; the demo proves recovery, not promotion optimization.
- "Allocated" is not shipped. No payments, refunds or shipping happen in the fixture.
- Native promotion platforms may already handle parts of this lifecycle; the claim is recorded, composable recovery of the
  agent's own rollout effects with order-aware stock, enforced by the server.

## After recording

```bash
pnpm exec tsx --env-file=.env scripts/evidence.ts pouch-1
```

```bash
pnpm exec tsx --env-file=.env scripts/pa-report.ts
```

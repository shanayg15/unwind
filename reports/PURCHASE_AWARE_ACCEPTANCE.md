# Purchase-aware rollback: acceptance

Commit `844b4d1` (working tree has uncommitted source changes) · generated 2026-10-18T00:44:37.738Z

Scope: one gift-promotion adapter (`start_gift_promotion`) on the controlled demo store's own inventory pool, and its relationship to accepted test orders. No shipping, payments, refunds, external platform inventory or general bundles. A handful of fixtures does not certify production safety.

| ID | Test | Result | Evidence |
|---|---|---|---|
| PA01 | Real reserve/checkout/retire (computed counts) | **passed** | tests/integration/purchase-aware.test.ts: PA01 reserve -> accepted orders -> retire (computed counts) > 10 held -> 4 committed + 6 held -> 4 committed + 6 available |
| PA02 | Immutable order contents and gift terms | **passed** | tests/integration/purchase-aware.test.ts: PA02 / PA03 immutable orders and fulfillment readback > order contents, gift terms and amounts are byte-identical; the pick list still has every pouch |
| PA03 | Fulfillment readback without an active-rule lookup | **passed** | tests/integration/purchase-aware.test.ts: PA02 / PA03 immutable orders and fulfillment readback > order contents, gift terms and amounts are byte-identical; the pick list still has every pouch |
| PA04 | New checkout after retirement / stale offer reconfirmation | **passed** | tests/integration/purchase-aware.test.ts: PA04 checkout after retirement > a stale accepted offer gets OFFER_CHANGED_RECONFIRM; ordinary orders still work from released stock<br>tests/integration/purchase-aware.test.ts: PA04 checkout after retirement > changed terms or an exhausted cap also ask to reconfirm instead of silently dropping the gift |
| PA05 | Concurrent order wins first (sequential + barrier) | **passed** | tests/integration/purchase-aware.test.ts: PA05 an order wins the race (dependency changed after preview) > sequential: the stale plan writes nothing; a fresh plan reflects 5 committed / 5 released<br>tests/integration/purchase-aware.test.ts: PA05 an order wins the race (dependency changed after preview) > barrier: a checkout holding the offer lock commits first; apply then sees it and refuses the stale plan |
| PA06 | Retirement wins first (barrier) | **passed** | tests/integration/purchase-aware.test.ts: PA06 retirement wins the race > barrier: a checkout waiting on the offer lock cannot draw from the released allocation |
| PA07 | Repeated retirement / send retry | **passed** | tests/integration/purchase-aware.test.ts: PA07 repeated retirement and message retry > releases once; replays return the persisted outcome; a message retry cannot release again |
| PA08 | Unrelated stock activity | **passed** | tests/integration/purchase-aware.test.ts: PA08 unrelated stock activity > another campaign's allocation and ordinary commitments stay; the books reconcile |
| PA09 | Crash / response timeout | **passed** | tests/integration/purchase-aware.test.ts: PA09 crash and response timeout > a failure after the retirement writes rolls back everything; the retry applies exactly once |
| PA10 | Fresh agent and real conversation | **missing** | eval case E not run<br>no verified live pouch run yet |
| PA11 | Scope/auth bypass denied | **passed** | tests/integration/purchase-aware.test.ts: PA11 scope and authorization bypass > committed stock and gift entitlements cannot be released or altered outside the protocol<br>tests/integration/purchase-aware.test.ts: PA11 scope and authorization bypass > customers cannot preview, apply, or see other orders; setup cannot over-allocate; non-qualifying carts get no gift<br>tests/integration/purchase-aware.test.ts: PA11 scope and authorization bypass > a coupled presentation conflict withholds the whole offer group instead of half-retiring it |
| PA12 | Regression and rehearsal | **missing** | 76 unit/integration/security tests passing, including the original U-series recovery tests<br>pouch rehearsal on the release build not yet recorded |

## Invariants checked by `undo_verify` after every retirement

- `future_eligibility_closed`: promotion retired, zero gifts accepted after the retirement timestamp.
- `remaining_allocation_released_once`: allocation remaining 0, released equals the held remainder at apply, exactly one `release_remaining` move.
- `order_commitments_preserved`: every accepted order still holds its gift entitlement; committed quantity unchanged.
- `stock_accounting_reconciles`: for every product, held equals units owned by holding allocations, committed equals purchased lines plus gift entitlements, available is never negative, and available + held + committed = on hand.
- `fulfillment_lists_promised_gifts`: the pick list (built from immutable order snapshots and entitlements only) lists every promised gift.

## Known limits

- One gift per order, one location, no fulfillment/returns/restocks in the fixture (the invariant would need those categories if added).
- Local Postgres transactions and row locks; no claim of a global cutoff across external systems.
- A stale exact plan is never re-scoped: it is superseded and a fresh plan needs its own owner confirmation (no race-time standing policy).
- Order counts in the demo are illustrative test orders, not an A/B result.

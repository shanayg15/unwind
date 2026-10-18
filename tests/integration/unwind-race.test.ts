import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveViaCode, createApprovalRequest } from "../../src/approvals/approvals.js";
import { openCase } from "../../src/cases/cases.js";
import { closePool, query, withTx } from "../../src/db/pool.js";
import { pouchExperimentProposal, productId } from "../../src/fixtures/demo.js";
import { checkout } from "../../src/orders/checkout.js";
import { orderSnapshot } from "../../src/orders/snapshot.js";
import { pickList, stockAccounting } from "../../src/promotions/gift.js";
import { type Proposal } from "../../src/recovery/execute.js";
import { undoApply, undoPreview } from "../../src/recovery/plan.js";
import { undoVerify } from "../../src/recovery/verify.js";
import { type Actors, freshStores, key, launch } from "../helpers.js";

// The UNWIND recording sequence end to end at the service level, with the same owner text-code approvals the worker uses:
// 10 set aside -> 4 accepted -> preview 4/6 + code -> 5th order -> YES old code -> apply refuses the stale plan
// -> fresh plan 5/5 + new code -> YES new code -> apply -> 5 committed, 5 available, offer retired, orders intact.
const S = "store_demo";
const POUCH = productId(S, "pouch");
let a: Actors;
let rollout: Awaited<ReturnType<typeof launch>>;
afterAll(() => closePool());
beforeAll(async () => {
  a = await freshStores();
  rollout = await launch(a, pouchExperimentProposal(S) as unknown as Proposal);
});

const stock = async () => (await query(`select held, committed, on_hand, on_hand - held - committed as available from inventory where product_id=$1`, [POUCH])).rows[0];
const offer = async () => (await query(`select id as promotion_id, terms_hash from promotions where store_id=$1 and state='active'`, [S])).rows[0];

describe("PA05/PA10 UNWIND race sequence with owner text-code approvals", () => {
  it("stale plan cannot release 6; the refreshed plan needs a new code and releases 5", async () => {
    expect(await stock()).toMatchObject({ held: 10, committed: 0, available: 0, on_hand: 10 });
    for (const [c, sku] of [[a.customerA, "PRM-JKT"], [a.customerB, "PRM-SHO"], [a.customerA, "PRM-KNT"], [a.customerB, "PRM-PCK"]] as const) {
      await checkout(c, { items: [{ sku, quantity: 1 }], accept_offer: await offer(), idempotency_key: key("o") });
    }
    expect(await stock()).toMatchObject({ held: 6, committed: 4, available: 0 });

    const caseId = (await openCase(S, "owner", "pr_owner", "imessage", `conv_${key("t")}`)).id;
    const agent = { ...a.agent, caseId };
    const p1 = (await undoPreview(agent, { rollout_id: rollout.rollout_id, all_changes: true })) as { plan_id: string; plan_hash: string; purchase_dependencies: Array<{ committed_to_accepted_orders: number; releasable_on_apply: number }> };
    expect(p1.purchase_dependencies[0]).toMatchObject({ committed_to_accepted_orders: 4, releasable_on_apply: 6 });
    const req1 = await withTx((tx) => createApprovalRequest(tx, S, "recovery", p1.plan_id, caseId, 30, "imessage"));

    await checkout(a.customerB, { items: [{ sku: "PRM-JKT", quantity: 1 }], accept_offer: await offer(), idempotency_key: key("o") }); // fifth order at the review gate
    expect(await stock()).toMatchObject({ held: 5, committed: 5, available: 0 });
    const snapshotBefore = await withTx((tx) => orderSnapshot(tx, S));

    const yes1 = await approveViaCode(caseId, "pr_owner", `YES ${req1.code}`);
    expect(yes1).toMatchObject({ matched: true, ok: true, decision: "approve" });
    const stale = (await undoApply(agent, { plan_id: p1.plan_id, approval_id: (yes1 as { approvalId: string }).approvalId })) as Record<string, any>;
    expect(stale).toMatchObject({ status: "stale_dependency_state", mutations: "none" });
    expect(stale.fresh_plan.purchase_dependencies[0]).toMatchObject({ committed_to_accepted_orders: 5, releasable_on_apply: 5 });
    expect(await stock()).toMatchObject({ held: 5, committed: 5, available: 0 }); // the stale plan released nothing
    // The old approval cannot be stretched to the fresh plan.
    await expect(undoApply(agent, { plan_id: stale.fresh_plan.plan_id, approval_id: (yes1 as { approvalId: string }).approvalId })).rejects.toMatchObject({ code: "approval_invalid" });

    const req2 = await withTx((tx) => createApprovalRequest(tx, S, "recovery", stale.fresh_plan.plan_id, caseId, 30, "imessage"));
    expect(await approveViaCode(caseId, "pr_owner", `YES ${req1.code}`)).toMatchObject({ matched: true, ok: false }); // a late reply with the old code does nothing
    const yes2 = await approveViaCode(caseId, "pr_owner", `YES ${req2.code}`);
    expect(yes2).toMatchObject({ ok: true });
    const done = (await undoApply(agent, { plan_id: stale.fresh_plan.plan_id, approval_id: (yes2 as { approvalId: string }).approvalId })) as Record<string, any>;
    expect(done.status).toBe("fully_reverted");
    expect(await stock()).toMatchObject({ held: 0, committed: 5, available: 5, on_hand: 10 });
    expect((await query(`select state from promotions where store_id=$1`, [S])).rows[0].state).toBe("retired");
    expect((await withTx((tx) => orderSnapshot(tx, S, snapshotBefore.maxSeq))).hash).toBe(snapshotBefore.hash);
    expect((await withTx((tx) => pickList(tx, S))).flatMap((o) => o.pick.filter((x) => x.sku === "COR-PCH"))).toHaveLength(5);
    expect((await withTx((tx) => stockAccounting(tx, S))).every((b) => b.balanced)).toBe(true);
    const v = (await undoVerify(agent, { recovery_id: done.recovery_id })) as { verdict: string };
    expect(v.verdict).toBe("verified");
    // Retrying the completed apply never releases again; post-retirement checkout must reconfirm.
    const again = (await undoApply(agent, { plan_id: stale.fresh_plan.plan_id, approval_id: (yes2 as { approvalId: string }).approvalId })) as Record<string, any>;
    expect(again).toMatchObject({ replayed: true, recovery_id: done.recovery_id });
    expect(await stock()).toMatchObject({ held: 0, committed: 5, available: 5 });
  });
});
